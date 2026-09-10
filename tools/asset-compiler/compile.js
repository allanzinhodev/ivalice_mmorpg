'use strict';
/*
 * Compila assets/ -> client/data/things/860/Tibia.dat + Tibia.spr
 *
 *   node tools/asset-compiler/compile.js
 *
 * assets/ e a fonte da verdade. Nao editar os binarios a mao: rode isto.
 * Substitui o Object Builder (que precisa do Adobe AIR SDK) e os scripts de
 * remendo fix-dat.js / add-frame-groups.js, que corrigiam depois o que o
 * editor gerava errado.
 *
 * ENTRADA
 *   assets/items/NN-nome.png       32x32, um ground tile cada
 *   assets/outfits/NN-nome.png     96x808, spritesheet conforme
 *                                  tools/prompts/Playable character Spritesheet.txt
 *
 * SAIDA
 *   client/data/things/860/Tibia.dat
 *   client/data/things/860/Tibia.spr
 *   assets/facesets/NN-nome.png    recortados, ainda NAO usados no jogo
 */

const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, Image } = require('./png.js');
const { buildSpr, SPRITE_SIZE } = require('./spr.js');
const { buildCwm } = require('./cwm.js');
const { slice } = require('./mosaic.js');
const { buildDat, FrameGroup, FRAME_GROUP_NAMES } = require('./dat.js');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'assets');
const OUT_DIR = path.join(ROOT, 'client/data/things/860');

/*
 * TAMANHO DA CELULA DE SPRITE
 *
 * A arte continua sendo autorada no mesmo tamanho de sempre (tile 32x32,
 * frame de personagem 32x64). O que muda e em quantos SPRITES cada quadro e
 * fatiado antes de ir para o arquivo:
 *
 *   --cell=32  (padrao)  um sprite por quadro, como sempre -> Tibia.spr
 *   --cell=8             mosaico de 8x8, como o GBA monta  -> Tibia.cwm
 *
 * O 8x8 existe para deduplicar: pedacos iguais entre tiles diferentes viram
 * um sprite so. O `.spr` classico nao aceita outro tamanho (o 32 esta cravado
 * no loader), por isso o mosaico sai em CWM -- ver cwm.js.
 */
const CELL = (() => {
  const arg = process.argv.find((a) => a.startsWith('--cell='));
  const v = arg ? Number(arg.slice('--cell='.length)) : SPRITE_SIZE;
  if (![8, 16, 32].includes(v)) throw new Error(`--cell=${v} invalido (use 8, 16 ou 32)`);
  return v;
})();

// Assinaturas: mantidas iguais as atuais para nao invalidar caches do client.
const DAT_SIGNATURE = 0x4c2c7993;
const SPR_SIGNATURE = 0x4c220594;

// --- spritesheet de entrada (ver a spec em tools/prompts/) ---
const SRC_FRAME_W = 24;
const SRC_FRAME_H = 48;
const OUT_FRAME_W = 32;
const OUT_FRAME_H = 64;   // = 2 sprites de 32x32 empilhados

// Colunas: 0=Sul, 1=Oeste, 2=Agua-Sul, 3=Agua-Oeste
const COL_SOUTH = 0, COL_WEST = 1, COL_WATER_SOUTH = 2, COL_WATER_WEST = 3;

// Ordem das linhas na folha. Cada entrada e [grupo, quantidade de frames].
const SHEET_ROWS = [
  [FrameGroup.IDLE, 2],
  [FrameGroup.WALK, 2],
  [FrameGroup.EVADE, 1],
  [FrameGroup.JUMP, 2],
  [FrameGroup.HIT, 1],
  [FrameGroup.DEAD, 2],
  [FrameGroup.ATTACK, 3],
  [FrameGroup.WEAK, 2],
];

const TOTAL_ROWS = SHEET_ROWS.reduce((a, [, n]) => a + n, 0); // 15
const FACESET_Y = TOTAL_ROWS * SRC_FRAME_H;                   // 720
const FACESET_SIZE = 96;

const FRAME_DURATION_MS = 300;

/**
 * Direcoes na ordem que o client espera (patternX = 4):
 *   0 = Norte, 1 = Leste, 2 = Sul, 3 = Oeste
 *
 * A folha so tras Sul e Oeste; Norte e o Oeste espelhado e Leste e o Sul
 * espelhado (spec). Por isso `mirror`.
 */
const DIRECTIONS = [
  { name: 'norte', col: COL_WEST, mirror: true },
  { name: 'leste', col: COL_SOUTH, mirror: true },
  { name: 'sul', col: COL_SOUTH, mirror: false },
  { name: 'oeste', col: COL_WEST, mirror: false },
];

const WATER_COL = { [COL_SOUTH]: COL_WATER_SOUTH, [COL_WEST]: COL_WATER_WEST };

/** Coleta as celulas de sprite e devolve ids, deduplicando as repetidas. */
class SpriteTable {
  constructor() {
    this.sprites = [null];   // indice 0 nao e usado pelo formato
    this.byHash = new Map();
    this.emptyId = 0;        // sprite vazio = id 0
  }

  add(img) {
    if (img.isEmpty()) return this.emptyId;
    const key = img.pixels.toString('latin1');
    const found = this.byHash.get(key);
    if (found !== undefined) return found;
    const id = this.sprites.length;
    this.sprites.push(img);
    this.byHash.set(key, id);
    return id;
  }
}

/**
 * Converte a ANCORA (onde o canto superior-esquerdo do quadro deve cair, em
 * pixels relativos a `dest`) no valor de displacement que vai no .dat.
 *
 * Existe porque o displacement do .dat nao e uma medida de tela: o client faz
 *
 *   boxTopLeft = dest - displacement * (cell/32) - (cols-1, rows-1) * cell
 *
 * (ThingType::draw, client/src/client/thingtype.cpp). Os dois termos que
 * dependem do tamanho da celula sao justamente os que mudam quando a mesma
 * arte e fatiada em 8x8 em vez de 32x32 -- um tile de 32x32 sai de 1x1 para
 * 4x4 celulas, e o termo (cols-1, rows-1)*cell salta de 0 para 24px.
 *
 * Escrever o displacement a mao daria um numero certo para um tamanho de
 * celula e silenciosamente errado para o outro. Autoramos a ancora, que e o
 * que de fato queremos ver na tela, e derivamos o resto:
 *
 *   displacement = (-ancora - (cols-1, rows-1) * cell) * 32/cell
 */
function displacementFor(anchor, cols, rows, cell) {
  const escala = 32 / cell;
  return [
    Math.round((-anchor[0] - (cols - 1) * cell) * escala),
    Math.round((-anchor[1] - (rows - 1) * cell) * escala),
  ];
}

/**
 * Fatia um quadro ja pronto nas celulas do .dat e devolve os ids na ordem em
 * que o client os espera. Ver mosaic.js -- a ordem comeca na celula
 * INFERIOR-DIREITA, e nao e a que parece.
 */
function sliceToIds(img, table) {
  const { cells, cols, rows } = slice(img, CELL);
  return { ids: cells.map((c) => table.add(c)), cols, rows };
}

/**
 * Descobre a BASE da folha: o maior y com pixel opaco em qualquer celula.
 *
 * O alinhamento "embaixo" da spec tem que ser feito pelo CONTEUDO, nao pela
 * celula: dentro dos 48px de cada celula sobra uma margem transparente (5-6px
 * no soldier), e blitar a celula inteira faz o personagem flutuar acima do
 * chao e o corte de 32px cair no meio do corpo.
 *
 * A base e UMA SO para a folha inteira, de proposito. Alinhar cada frame pelo
 * seu proprio conteudo faria o personagem "pular" entre frames de alturas
 * diferentes -- e, pior, destruiria uma diferenca que e INTENCIONAL na arte:
 * as colunas de agua terminam ~7px mais alto que as de terra, porque o
 * personagem esta submerso. Com base unica esse deslocamento e preservado.
 */
function findSheetBaseline(sheet, rows) {
  let baseline = -1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 4; col++) {
      const cell = sheet.crop(col * SRC_FRAME_W, row * SRC_FRAME_H, SRC_FRAME_W, SRC_FRAME_H);
      for (let y = SRC_FRAME_H - 1; y > baseline; y--) {
        let has = false;
        for (let x = 0; x < SRC_FRAME_W; x++) {
          if (cell.alphaAt(x, y) !== 0) { has = true; break; }
        }
        if (has) { baseline = y; break; }
      }
    }
  }
  return baseline < 0 ? SRC_FRAME_H - 1 : baseline;
}

/**
 * Recorta um frame da folha e converte 24x48 -> 32x64.
 * A spec manda alinhar a ESQUERDA e EMBAIXO -- ver findSheetBaseline para o
 * que "embaixo" significa aqui.
 */
function extractFrame(sheet, col, row, mirror, baseline) {
  const src = sheet.crop(col * SRC_FRAME_W, row * SRC_FRAME_H, SRC_FRAME_W, SRC_FRAME_H);

  // Limites horizontais do conteudo dentro da celula.
  //
  // O desenho NAO esta centrado na celula de 24px: no soldier ele ocupa
  // x 9..23, colado na borda direita. Espelhar a celula inteira jogaria o
  // personagem para a borda ESQUERDA, e ele "pularia" 9px de lado ao trocar
  // de direcao. Por isso recortamos o conteudo antes de espelhar.
  let x0 = SRC_FRAME_W, x1 = -1;
  for (let y = 0; y < SRC_FRAME_H; y++) {
    for (let x = 0; x < SRC_FRAME_W; x++) {
      if (src.alphaAt(x, y) !== 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }

  const out = Image.blank(OUT_FRAME_W, OUT_FRAME_H);
  if (x1 < 0) return out; // celula vazia (ex.: attack nao tem versao na agua)

  const contentW = x1 - x0 + 1;
  const content = src.crop(x0, 0, contentW, SRC_FRAME_H);
  const shaped = mirror ? content.flipX() : content;

  // Centraliza na horizontal e encosta a base do conteudo na base do frame:
  // a linha `baseline` da celula vai para a ultima linha do frame de saida.
  const base = baseline === undefined ? SRC_FRAME_H - 1 : baseline;
  const dx = Math.floor((OUT_FRAME_W - contentW) / 2);
  out.blit(shaped, dx, OUT_FRAME_H - 1 - base);
  return out;
}

/**
 * Monta um frame group do outfit.
 *
 * A ordem dos sprites tem que casar com ThingType::getSpriteIndex:
 *   ((((((fase * patZ + z) * patY + y) * patX + x) * layers + l) * h + hh) * w + ww)
 * ou seja, o indice mais rapido e a largura, depois altura, layer, patternX,
 * patternY, patternZ, e o mais lento e a fase.
 */
function buildOutfitGroup(sheet, table, groupType, firstRow, phases, baseline) {
  const sprites = [];
  let cols = 0, rows = 0;

  for (let phase = 0; phase < phases; phase++) {
    const row = firstRow + phase;
    for (let z = 0; z < 2; z++) {            // patternZ: 0 = seco, 1 = agua
      for (const dir of DIRECTIONS) {         // patternX: as 4 direcoes
        const col = z === 0 ? dir.col : WATER_COL[dir.col];
        const frame = extractFrame(sheet, col, row, dir.mirror, baseline);
        const fatiado = sliceToIds(frame, table);
        cols = fatiado.cols;
        rows = fatiado.rows;
        sprites.push(...fatiado.ids);
      }
    }
  }

  return {
    type: groupType,
    width: cols,
    height: rows,
    // O client sobrescreve isto em tempo de execucao (ThingType::getExactSize
    // recalcula a partir da textura), mas o byte precisa existir e ser
    // coerente para o stream nao dessincronizar.
    exactSize: Math.max(OUT_FRAME_W, OUT_FRAME_H),
    layers: 1,
    patternX: 4,
    patternY: 1,
    patternZ: 2,
    phases,
    durationMs: FRAME_DURATION_MS,
    sprites,
  };
}

function listAssets(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
}

function compileItems(table) {
  const dir = path.join(ASSETS, 'items');
  const files = listAssets(dir);
  const items = [];

  for (const file of files) {
    const img = readPNG(path.join(dir, file));
    if (img.width !== SPRITE_SIZE || img.height !== SPRITE_SIZE) {
      throw new Error(`${file}: item tem que ser ${SPRITE_SIZE}x${SPRITE_SIZE}, veio ${img.width}x${img.height}`);
    }
    const { ids, cols, rows } = sliceToIds(img, table);
    items.push({
      name: file,
      attrs: {
        // ThingAttrGround e obrigatorio: sem ele Tile::drawGround para na
        // primeira iteracao e o chao nao aparece.
        ground: 110,
        // Ancora: o quadro de 32x32 cai meio losango ABAIXO de `dest`, que e
        // o vertice superior da celula. Antes isto era displacement [0,-16]
        // cravado, que so vale enquanto o tile for UM sprite de 32x32 -- em
        // mosaico o mesmo numero apontaria 24px fora. Ver displacementFor.
        displacement: displacementFor([0, 16], cols, rows, CELL),
        fullGround: true,
        // Elevation faz o client empilhar: cada item com elevation soma
        // m_drawElevation e desenha o proximo mais acima
        // (client/src/client/tile.cpp:62-63). E o lado visual do
        // FLAG_HAS_HEIGHT que o gen-items.js poe no items.otb -- os dois
        // precisam andar juntos, senao o server deixa subir num degrau que a
        // tela mostra plano.
        //
        // TILE_HALF_H = 8: uma unidade de altura do FFTA vale meio tile em Y.
        elevation: /-map[0-9]+-/.test(file) ? 8 : 0,
        /*
         * MERAMENTE VISUAL: tudo em assets/items/ hoje e chao -- pedaco de
         * cenario, nao objeto de jogo. Sem esta marca o alvo do clique cai
         * no chao pelo fallback das funcoes getTop*Thing do client
         * (tile.cpp), que devolvem m_things[0] quando nada mais serve.
         *
         * A marca e do lado do CLIENT. Nao ha nada a fazer no items.otb:
         * gen-items.js ja emite estes ids sem FLAG_MOVEABLE e sem
         * FLAG_PICKUPABLE, entao o server nunca os tratou como objeto.
         *
         * Quando entrarem itens de verdade (os que se pega e usa), eles
         * simplesmente nao levam este atributo.
         */
        visualOnly: true,
      },
      groups: [{
        type: 0,
        width: cols, height: rows, layers: 1,
        exactSize: SPRITE_SIZE,
        patternX: 1, patternY: 1, patternZ: 1,
        phases: 1,
        sprites: ids,
      }],
    });
  }

  return items;
}

function compileOutfits(table) {
  const dir = path.join(ASSETS, 'outfits');
  const files = listAssets(dir);
  const outfits = [];
  const facesets = [];

  for (const file of files) {
    const sheet = readPNG(path.join(dir, file));

    const expectedW = 4 * SRC_FRAME_W;
    if (sheet.width !== expectedW) {
      throw new Error(`${file}: largura ${sheet.width}, esperado ${expectedW} (4 colunas de ${SRC_FRAME_W})`);
    }
    if (sheet.height < FACESET_Y) {
      throw new Error(`${file}: altura ${sheet.height}, precisa de ao menos ${FACESET_Y} (${TOTAL_ROWS} linhas de ${SRC_FRAME_H})`);
    }

    const baseline = findSheetBaseline(sheet, TOTAL_ROWS);

    const groups = [];
    let row = 0;
    for (const [groupType, phases] of SHEET_ROWS) {
      groups.push(buildOutfitGroup(sheet, table, groupType, row, phases, baseline));
      row += phases;
    }

    /*
     * ANCORA DO PERSONAGEM: o canto superior-esquerdo do quadro de 32x64 cai
     * 8px a esquerda e 68px acima de `dest`.
     *
     * O numero vem de reproduzir exatamente o que estava na tela antes, e nao
     * de uma medida nova. O valor antigo era displacement [8, 4] com height=2
     * -- so que o compilador emitia as duas metades TROCADAS (ver mosaic.js),
     * entao o boneco era desenhado 32px acima do que aquele displacement
     * dizia. Corrigida a ordem, a ancora abaixo devolve o mesmo pixel:
     *   -(8, 4) - (0, 32) = (-8, -68)
     *
     * Ou seja: a troca de ordem e a ancora se cancelam de proposito. A
     * correcao e estrutural, e a tela nao muda.
     */
    outfits.push({
      name: file,
      attrs: {
        displacement: displacementFor([-8, -68], groups[0].width, groups[0].height, CELL),
      },
      groups,
    });

    // Faceset: recortado e exportado, mas ainda NAO usado no jogo.
    facesets.push({ name: file, image: sheet.crop(0, FACESET_Y, FACESET_SIZE, FACESET_SIZE) });
  }

  return { outfits, facesets };
}

/*
 * O Tibia.otfi. Passou a ser gerado porque com o mosaico ele mentia: dizia
 * `sprites-file: Tibia.spr` e `sprite-size: 32` enquanto o client carregava
 * um .cwm de 8x8.
 *
 * Vale saber o que aqui e LIDO e o que e enfeite. O client so faz casamento
 * de string sobre tres campos (game_things/things.lua:31-70):
 *
 *   frame-groups: true      \ qualquer um dos dois liga os recursos modernos
 *   sprite-data-size: 4096  /
 *   transparency: true      -> liga GameSpritesAlphaChannel
 *
 * `sprites-file` e `sprite-size` NAO sao lidos por ninguem -- quem escolhe o
 * arquivo e a extensao (ver o comentario no main), e o tamanho do sprite vem
 * de dentro do proprio .cwm. Ficam aqui como documentacao, e agora corretos.
 */
function buildOtfi(nomeDoArquivoDeSprites) {
  return [
    'DatSpr',
    '  extended: true',
    '  transparency: true',
    '  frame-durations: true',
    '  frame-groups: true',
    '  metadata-controller: Default',
    '  metadata-file: Tibia.dat',
    `  sprites-file: ${nomeDoArquivoDeSprites}`,
    `  sprite-size: ${CELL}`,
    `  sprite-data-size: ${CELL * CELL * 4}`,
    '',
  ].join('\n');
}

/** Effect e missile minimos -- o formato exige ao menos um de cada. */
function stubThing() {
  return {
    attrs: {},
    groups: [{
      type: 0,
      width: 1, height: 1, layers: 1,
      patternX: 1, patternY: 1, patternZ: 1,
      phases: 1,
      sprites: [0],
    }],
  };
}

function main() {
  const table = new SpriteTable();

  const items = compileItems(table);
  const { outfits, facesets } = compileOutfits(table);

  const effects = [stubThing()];
  const missiles = [{
    attrs: {},
    groups: [{
      type: 0,
      width: 1, height: 1, layers: 1,
      patternX: 3, patternY: 3, patternZ: 1,
      phases: 1,
      sprites: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    }],
  }];

  const dat = buildDat({ signature: DAT_SIGNATURE, items, outfits, effects, missiles });

  /*
   * O client escolhe o arquivo de sprites por EXTENSAO, nao por configuracao:
   * SpriteManager::loadSpr procura Tibia.cwm antes de Tibia.spr. Entao os dois
   * nao podem coexistir -- um .cwm esquecido no diretorio silenciosamente
   * ganha de um .spr recem-compilado, e o sintoma (sprites velhos) nao aponta
   * para a causa. Gravamos um e APAGAMOS o outro.
   */
  const usaCwm = CELL !== SPRITE_SIZE;
  const sprites = usaCwm
    ? { nome: 'Tibia.cwm', dados: buildCwm(table.sprites, CELL), obsoleto: 'Tibia.spr' }
    : { nome: 'Tibia.spr', dados: buildSpr(table.sprites, SPR_SIGNATURE), obsoleto: 'Tibia.cwm' };

  // Backup antes de sobrescrever.
  for (const f of ['Tibia.dat', sprites.nome]) {
    const p = path.join(OUT_DIR, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'Tibia.dat'), dat);
  fs.writeFileSync(path.join(OUT_DIR, sprites.nome), sprites.dados);

  const obsoleto = path.join(OUT_DIR, sprites.obsoleto);
  if (fs.existsSync(obsoleto)) {
    fs.renameSync(obsoleto, obsoleto + '.bak');
    console.log(`${sprites.obsoleto} removido (viraria o arquivo escolhido pelo client) -> .bak`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'Tibia.otfi'), buildOtfi(sprites.nome));

  const faceDir = path.join(ASSETS, 'facesets');
  if (!fs.existsSync(faceDir)) fs.mkdirSync(faceDir, { recursive: true });
  for (const f of facesets) writePNG(path.join(faceDir, f.name), f.image);

  console.log(`items    ${items.length}  (ids 100..${99 + items.length})`);
  console.log(`outfits  ${outfits.length}  x ${SHEET_ROWS.length} frame groups`);
  for (const [type, phases] of SHEET_ROWS) {
    console.log(`           ${String(type).padStart(2)} ${FRAME_GROUP_NAMES[type].padEnd(7)} ${phases} fase(s)`);
  }
  console.log(`celula   ${CELL}x${CELL}${usaCwm ? ' (mosaico)' : ''}`);
  console.log(`sprites  ${table.sprites.length - 1} unicos`);
  console.log(`facesets ${facesets.length} -> assets/facesets/ (nao usados no jogo ainda)`);
  console.log(`Tibia.dat ${dat.length} bytes`);
  console.log(`${sprites.nome} ${sprites.dados.length} bytes`);
}

if (require.main === module) main();

module.exports = { SHEET_ROWS, DIRECTIONS, extractFrame, findSheetBaseline, TOTAL_ROWS };
