'use strict';
/*
 * gen-tileset-dat.js -- gera .dat + .cwm a partir de um tileset de mapa.
 *
 *   node tools/asset-compiler/gen-tileset-dat.js [nome]
 *
 * Exemplo:
 *   node tools/asset-compiler/gen-tileset-dat.js aizenfield
 *
 *
 * O QUE ELE PRODUZ
 *
 * Um datapack minimo, so com a categoria `tilesets` -- a quinta, que o
 * client passou a entender. Serve para provar o caminho novo ponta a ponta
 * sem depender dos assets antigos (assets/items e assets/outfits foram
 * esvaziados, e o compile.js nao tem de onde ler).
 *
 * Nao ha itens nem outfits: nao vai haver personagem na tela. E deliberado
 * -- a pergunta aqui e se o client desenha um tileset 8x8 de 5 categorias.
 *
 *
 * A UNIDADE E A CELULA, NAO O TILE
 *
 * O tileset guarda tiles de 8x8, mas a celula do mapa e 32x16 -- ou seja,
 * 4x2 tiles. Cada thing do .dat e uma celula, montada de 8 sprites.
 *
 * A ordem dos sprites dentro do thing tem que casar com
 * ThingType::getTexture do client, que percorre a grade da direita para a
 * esquerda e de baixo para cima. O mosaic.js:slice ja faz isso, e o
 * cellPosition e a inversa exata -- por isso uso as duas em vez de reinventar
 * a indexacao.
 */

const fs = require('fs');
const path = require('path');
const { Image, readPNG } = require('./png.js');
const { buildDat } = require('./dat.js');
const { buildCwm } = require('./cwm.js');
const { slice } = require('./mosaic.js');

const CELL = 8;            // o sprite
const CELULA_W = 32;       // a celula do mapa
const CELULA_H = 16;

const DAT_SIGNATURE = 0x4c2c7993;

/** Junta os sprites iguais num so id, como o SpriteTable do compile.js. */
class TabelaDeSprites {
  constructor() {
    this.sprites = [null];   // o indice 0 e "sem sprite"
    this.porConteudo = new Map();
  }

  add(img) {
    if (img.isEmpty()) return 0;
    const k = img.pixels.toString('latin1');
    let id = this.porConteudo.get(k);
    if (id === undefined) {
      id = this.sprites.length;
      this.sprites.push(img);
      this.porConteudo.set(k, id);
    }
    return id;
  }
}

function main() {
  const nome = process.argv[2] || 'aizenfield';
  const RAIZ = path.resolve(__dirname, '..', '..');

  const dirTileset = path.join(RAIZ, 'assets', 'ffta', 'tilesets', nome);
  const mapa = JSON.parse(fs.readFileSync(path.join(dirTileset, 'mapa.json'), 'utf8'));
  const atlas = readPNG(path.join(dirTileset, 'tiles.png'));

  if (mapa.celula !== CELL) {
    throw new Error(`tileset com celula ${mapa.celula}, esperado ${CELL}`);
  }

  /** Recorta o tile `id` do atlas. id 0 = vazio. */
  function tileDoAtlas(id) {
    if (!id) return null;
    const i = id - 1;
    return atlas.crop((i % mapa.atlasColunas) * CELL,
                      Math.floor(i / mapa.atlasColunas) * CELL, CELL, CELL);
  }

  const tabela = new TabelaDeSprites();
  const things = [];

  /*
   * Cada CELULA do mapa vira um thing. Percorre a grade em passos de 4x2
   * tiles, que e o tamanho de uma celula em tiles de 8px.
   */
  const camada = mapa.camadas[0];
  const colsCelula = CELULA_W / CELL;   // 4
  const rowsCelula = CELULA_H / CELL;   // 2

  const celulasX = Math.floor(camada.largura / colsCelula);
  const celulasY = Math.floor(camada.altura / rowsCelula);

  let vazias = 0;

  for (let cy = 0; cy < celulasY; cy++) {
    for (let cx = 0; cx < celulasX; cx++) {
      // Monta a imagem da celula a partir dos tiles do atlas.
      const img = Image.blank(CELULA_W, CELULA_H);
      let algumTile = false;

      for (let ty = 0; ty < rowsCelula; ty++) {
        for (let tx = 0; tx < colsCelula; tx++) {
          const linha = cy * rowsCelula + ty;
          const coluna = cx * colsCelula + tx;
          const t = tileDoAtlas(camada.grade[linha][coluna]);
          if (!t) continue;
          img.blit(t, tx * CELL, ty * CELL);
          algumTile = true;
        }
      }

      if (!algumTile) { vazias++; continue; }

      // slice() fatia na ordem que o client espera montar de volta.
      const { cells } = slice(img, CELL);
      const ids = cells.map((c) => tabela.add(c));

      things.push({
        attrs: {},   // tileset nao leva flag: e so desenho
        groups: [{
          type: 0,
          width: colsCelula,
          height: rowsCelula,
          layers: 1,
          patternX: 1, patternY: 1, patternZ: 1,
          phases: 1,
          exactSize: Math.max(CELULA_W, CELULA_H),
          sprites: ids,
        }],
      });
    }
  }

  const dat = buildDat({
    signature: DAT_SIGNATURE,
    items: [], outfits: [], effects: [], missiles: [],
    tilesets: things,
  });
  const cwm = buildCwm(tabela.sprites, CELL);

  const saida = path.join(RAIZ, 'client', 'data', 'things', '860');
  fs.mkdirSync(saida, { recursive: true });
  fs.writeFileSync(path.join(saida, 'Tibia.dat'), dat);
  fs.writeFileSync(path.join(saida, 'Tibia.cwm'), cwm);

  /*
   * O client escolhe o arquivo de sprites por EXTENSAO: loadSpr prefere
   * .cwm sobre .spr (spritemanager.cpp:73-77). Deixar o .spr velho ao lado
   * nao quebra -- mas confunde na hora de investigar, porque ele parece a
   * fonte e nao e.
   */
  const spr = path.join(saida, 'Tibia.spr');
  if (fs.existsSync(spr)) {
    fs.renameSync(spr, spr + '.obsoleto');
    console.log('Tibia.spr renomeado para .obsoleto (o client usa o .cwm)');
  }

  console.log(`celulas de ${CELULA_W}x${CELULA_H}: ${things.length}   (${vazias} vazias, puladas)`);
  console.log(`sprites ${CELL}x${CELL} unicos: ${tabela.sprites.length - 1}`);
  console.log(`Tibia.dat  ${(dat.length / 1024).toFixed(1)} KB`);
  console.log(`Tibia.cwm  ${(cwm.length / 1024).toFixed(1)} KB`);
}

main();
