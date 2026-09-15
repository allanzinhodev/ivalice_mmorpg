'use strict';
/*
 * compilar-outfits.js -- transforma as sprites do FFTA2 em outfits do .dat.
 *
 * Roda com:  node tools/ffta2-extract/compilar-outfits.js [--unidades=N]
 *
 *
 * O QUE ENTRA
 *
 *   as animacoes  -> UnitSst.pak (arvore binaria por unidade)
 *   a arte        -> Unit Sprites/<unidade>/<paleta>/<spriteIndex>.png
 *
 *
 * O QUE SAI
 *
 *   blocos 8x8 deduplicados + um frame group por animacao
 *
 *
 * AS REGRAS DO SPEC
 *
 * 1. nao duplicar partes transparentes
 *    Um quadro de 32x48 vira 24 blocos de 8x8, e 62,8% deles sao inteiramente
 *    transparentes. Esses viram o sprite id 0, que o client ja trata como
 *    vazio -- nao ocupam lugar no .spr. Os demais passam por dedup exato por
 *    bytes: 207.789 blocos -> 41.073 unicos nas 324 unidades.
 *
 * 2. um frame group por animacao
 *    O `type` do grupo e o `animationId` do FFTA2, nao um enum nosso. O
 *    client le o tipo sem validar faixa (thingtype.cpp:328), entao ids ate
 *    111 passam limpos; ele so nao sabe endereca-los ainda, o que e o
 *    esperado -- os grupos existem agora, o endereçamento vem depois.
 *
 * 3. so Sul e Oeste na arte
 *    O FFTA2 guarda duas direcoes (dataType 0 e 16), que e o par Sul/Oeste.
 *    Norte e Leste saem por espelhamento horizontal EM CODIGO, no client.
 *    Por isso patternX = 2, nao 4.
 *
 * 4. agua no z
 *    patternZ = 2: indice 0 = terra, 1 = agua. Onde nao houver arte de agua,
 *    repete a de terra, como voce pediu.
 *
 * 5. 200ms fixo
 *    A duracao vem do spec, nao do ROM. O campo `duration` de cada frame
 *    existe no FFTA2 e e lido, mas nao e usado.
 */

const fs = require('fs');
const path = require('path');
const { SPRITES, unitSsts } = require('./fontes.js');
const { lerPNGIndexado } = require('./png-indexado.js');
const { lerUnidade } = require('./unit-sst.js');

const CELULA = 8;
const LARGURA = 32, ALTURA = 48;
const COLS = LARGURA / CELULA, ROWS = ALTURA / CELULA;   // 4 x 6 = 24 blocos
const DURACAO_MS = 200;

/*
 * As duas direcoes guardadas.
 *
 * O `dataType` de um no e `base + 16 * direcao`: a base diz de que conjunto
 * a animacao faz parte, e o +16 e a segunda direcao. Medido nas 324
 * unidades, as combinacoes que aparecem sao [0,16] em 177, [1,17] em 76,
 * [0,1,16,17] em 31, [0] sozinho em 26, [1,2,17,18] em 8 e [0,1,16] em 6.
 *
 * Tratar so a base 0 perde 84 das 324 unidades -- as que usam base 1 ou 2.
 */
const PASSO_DIRECAO = 16;

/*
 * O `type` do frame group.
 *
 * O animationId sozinho nao identifica a animacao: uma unidade pode ter mais
 * de uma base, e os ids COLIDEM entre elas -- a unidade 8 tem {54,86,87} nas
 * bases 0 e 1 ao mesmo tempo. Sao 45 unidades nessa situacao.
 *
 * `base * 112 + animationId` separa as duas e continua reversivel, entao o
 * indice do jogo esta preservado. O maximo medido e 229, que cabe no u8 do
 * campo (o client le o tipo sem validar faixa, thingtype.cpp:328).
 */
const IDS_POR_BASE = 112;
const tipoDoGrupo = (base, animationId) => base * IDS_POR_BASE + animationId;

/**
 * Banco de blocos 8x8 deduplicados.
 *
 * O id 0 e reservado para "vazio": o client ja entende sprite id 0 como nada
 * a desenhar, entao os 62,8% de blocos transparentes nao custam bytes.
 */
class BancoDeBlocos {
  constructor() {
    this.porHash = new Map();
    this.blocos = [];        // blocos[0] nao existe: id 0 = vazio
  }

  /** Devolve o id do bloco, 0 se ele for inteiramente transparente. */
  id(indices, transparente) {
    let vazio = true;
    for (const i of indices) {
      if (!transparente(i)) { vazio = false; break; }
    }
    if (vazio) return 0;

    const chave = indices.toString('latin1');
    let id = this.porHash.get(chave);
    if (id === undefined) {
      id = this.blocos.length + 1;
      this.porHash.set(chave, id);
      this.blocos.push(Buffer.from(indices));
    }
    return id;
  }

  get quantidade() { return this.blocos.length; }
}

/** Fatia um quadro 32x48 em 24 ids de bloco, na ordem que o client espera. */
function fatiar(img, banco) {
  const ids = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const bloco = img.bloco(c * CELULA, r * CELULA, CELULA, CELULA);
      ids.push(banco.id(bloco, (i) => img.transparente(i)));
    }
  }
  return ids;
}

/**
 * Carrega os quadros de uma unidade, por spriteIndex.
 *
 * `paleta` e a subpasta. A paleta 0 e a padrao; as outras sao variantes de
 * cor, que entram no registro de paletas em vez de virar sprite nova.
 */
function quadrosDaUnidade(unidade, paleta = 0) {
  const dir = path.join(SPRITES, String(unidade), String(paleta));
  if (!fs.existsSync(dir)) return new Map();

  const quadros = new Map();
  for (const nome of fs.readdirSync(dir)) {
    if (!nome.endsWith('.png')) continue;
    const idx = parseInt(nome, 10);
    if (isNaN(idx)) continue;
    quadros.set(idx, lerPNGIndexado(path.join(dir, nome)));
  }
  return quadros;
}

/**
 * Monta os frame groups de uma unidade.
 *
 * Cada `animationId` vira um grupo. Dentro dele, a ordem dos sprites segue
 * getSpriteIndex do client:
 *
 *   ((((((fase * patZ + z) * patY + y) * patX + x) * layers + l)
 *      * altura + h) * largura + w)
 *
 * Com layers=1, patY=1: para cada fase, para cada z (terra/agua), para cada
 * x (Sul/Oeste), os 24 blocos do quadro.
 */
function gruposDaUnidade(unidade, banco) {
  const sst = unitSsts();
  const bloco = sst.arquivo(unidade);
  if (!bloco) return null;

  const u = lerUnidade(bloco);
  if (!u || !u.animacoes.length) return null;

  const quadros = quadrosDaUnidade(unidade);
  if (!quadros.size) return null;

  // cache: spriteIndex -> os 24 ids de bloco daquele quadro
  const fatiado = new Map();
  const idsDoQuadro = (spriteIndex) => {
    if (!fatiado.has(spriteIndex)) {
      const img = quadros.get(spriteIndex);
      fatiado.set(spriteIndex, img ? fatiar(img, banco) : new Array(24).fill(0));
    }
    return fatiado.get(spriteIndex);
  };

  /*
   * Agrupa por (base, animationId). O dataType e `base + 16 * direcao`:
   * direcao 0 e a primeira do par (Sul), direcao 1 a segunda (Oeste).
   */
  const porChave = new Map();
  for (const a of u.animacoes) {
    const base = a.dataType % PASSO_DIRECAO;
    const direcao = Math.floor(a.dataType / PASSO_DIRECAO);
    if (direcao > 1) continue;            // so existem duas direcoes

    const chave = tipoDoGrupo(base, a.animationId);
    if (!porChave.has(chave)) porChave.set(chave, {});
    porChave.get(chave)[direcao] = a;
  }

  const grupos = [];
  for (const [tipo, dirs] of [...porChave].sort((a, b) => a[0] - b[0])) {
    const sul = dirs[0];
    const oeste = dirs[1];

    // uma direcao pode faltar; nesse caso repete a outra
    const ref = sul || oeste;
    if (!ref) continue;
    const fases = ref.frames.length;

    const sprites = [];
    for (let f = 0; f < fases; f++) {
      for (let z = 0; z < 2; z++) {            // 0 = terra, 1 = agua
        for (let x = 0; x < 2; x++) {          // 0 = Sul, 1 = Oeste
          const anim = x === 0 ? (sul || oeste) : (oeste || sul);
          const frame = anim.frames[Math.min(f, anim.frames.length - 1)];
          // a arte de agua ainda nao foi exportada: repete a de terra
          sprites.push(...idsDoQuadro(frame.sprite));
        }
      }
    }

    grupos.push({
      type: tipo,
      width: COLS, height: ROWS,
      exactSize: ALTURA,
      layers: 1,
      patternX: 2,      // Sul, Oeste -- Norte e Leste por flip em codigo
      patternY: 1,
      patternZ: 2,      // terra, agua
      phases: fases,
      durationMs: DURACAO_MS,
      sprites,
    });
  }

  return grupos.length ? grupos : null;
}

module.exports = {
  BancoDeBlocos, fatiar, quadrosDaUnidade, gruposDaUnidade,
  CELULA, LARGURA, ALTURA, COLS, ROWS, DURACAO_MS,
  PASSO_DIRECAO, IDS_POR_BASE, tipoDoGrupo,
};
