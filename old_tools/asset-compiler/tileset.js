'use strict';
/*
 * tileset.js -- transforma as camadas de um mapa num tileset deduplicado.
 *
 *   node tools/asset-compiler/tileset.js <nome> <camada1.png> [camada2.png ...]
 *
 * Exemplo:
 *   node tools/asset-compiler/tileset.js aizenfield \
 *     tools/aizenfield.png tools/aizenfield2.png tools/aizenfield3.png
 *
 *
 * O QUE ELE FAZ
 *
 * Recorta cada camada em tiles de 8x8, joga fora os repetidos e grava:
 *
 *   tiles.png     o atlas, um tile por celula, em ordem de primeiro uso
 *   paleta.json   as cores distintas, em bancos de 16 (formato do GBA)
 *   mapa.json     por camada, qual tile ocupa cada posicao da grade
 *
 * O DEDUP E GLOBAL, NAO POR CAMADA. Medido no Aizenfield: por camada dao
 * 255+60+324 = 639 tiles unicos; deduplicando entre elas, 351. Sao 45% a
 * mais de economia, porque as camadas compartilham muito -- grama, terra,
 * bordas.
 *
 * O dedup e por bytes de pixel EXATOS. O rebuild-map.js tem dedup por
 * semelhanca com tolerancia; nao serve aqui. A arte e pixel-art, e fundir
 * tiles parecidos introduziria um erro que o teste de fidelidade
 * (remontar.js) pegaria sem conseguir explicar a causa.
 *
 *
 * POR QUE NAO USA mosaic.js:slice
 *
 * Aquele slice fatia na ordem INVERTIDA (inferior-direita primeiro), porque
 * e assim que ThingType::getTexture monta um thing no client. Um tileset de
 * mapa e outra coisa: a grade e indexada por (coluna, linha) em ordem de
 * leitura, e inverter aqui so criaria uma conversao a mais para errar.
 */

const fs = require('fs');
const path = require('path');
const { Image, readPNG, writePNG } = require('./png.js');

const CELL = 8;

/** Chave de conteudo de um tile: os bytes RGBA crus. */
function chaveDe(img) {
  return img.pixels.toString('latin1');
}

/** Um tile totalmente transparente nao entra no atlas -- vira o indice 0. */
function vazio(img) {
  return img.isEmpty();
}

/**
 * Recorta uma camada em tiles e devolve a grade de indices.
 *
 * `tabela` e compartilhada entre as camadas: e o que faz o dedup ser global.
 */
function fatiar(img, tabela, atlas) {
  if (img.width % CELL || img.height % CELL) {
    throw new Error(`${img.width}x${img.height} nao e multiplo de ${CELL}`);
  }

  const cols = img.width / CELL;
  const rows = img.height / CELL;
  const grade = [];

  for (let linha = 0; linha < rows; linha++) {
    const l = [];
    for (let coluna = 0; coluna < cols; coluna++) {
      const tile = img.crop(coluna * CELL, linha * CELL, CELL, CELL);

      if (vazio(tile)) { l.push(0); continue; }

      const k = chaveDe(tile);
      let id = tabela.get(k);
      if (id === undefined) {
        // +1 porque o 0 e reservado para "celula vazia".
        id = atlas.length + 1;
        tabela.set(k, id);
        atlas.push(tile);
      }
      l.push(id);
    }
    grade.push(l);
  }

  return { grade, cols, rows };
}

/** Todas as cores opacas que aparecem no atlas, por frequencia. */
function levantarPaleta(atlas) {
  const cont = new Map();
  for (const tile of atlas) {
    for (let i = 0; i < CELL * CELL; i++) {
      if (tile.pixels[i * 4 + 3] === 0) continue;
      const k = (tile.pixels[i * 4] << 16) | (tile.pixels[i * 4 + 1] << 8) | tile.pixels[i * 4 + 2];
      cont.set(k, (cont.get(k) || 0) + 1);
    }
  }

  const ordenadas = [...cont.entries()].sort((a, b) => b[1] - a[1]);
  return ordenadas.map(([rgb, n]) => ({
    hex: '#' + rgb.toString(16).padStart(6, '0'),
    r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255,
    pixels: n,
  }));
}

/**
 * Monta o atlas como uma imagem quadrada-ish.
 *
 * A largura em tiles e fixa para o mapa.json nao depender do numero de
 * tiles: quem le sabe que o tile N esta em (N % LARGURA, N / LARGURA).
 */
const ATLAS_COLS = 16;

function montarAtlas(atlas) {
  const linhas = Math.ceil(atlas.length / ATLAS_COLS);
  const img = Image.blank(ATLAS_COLS * CELL, linhas * CELL);

  atlas.forEach((tile, i) => {
    const x = (i % ATLAS_COLS) * CELL;
    const y = Math.floor(i / ATLAS_COLS) * CELL;
    img.blit(tile, x, y);
  });

  return img;
}

function main() {
  const nome = process.argv[2];
  const entradas = process.argv.slice(3);

  if (!nome || !entradas.length) {
    console.error('uso: node tools/asset-compiler/tileset.js <nome> <camada.png...>');
    process.exit(1);
  }

  const tabela = new Map();
  const atlas = [];
  const camadas = [];

  for (const arquivo of entradas) {
    if (!fs.existsSync(arquivo)) {
      console.error(`${arquivo}: nao existe`);
      process.exit(1);
    }

    const antes = atlas.length;
    const img = readPNG(arquivo);
    const { grade, cols, rows } = fatiar(img, tabela, atlas);

    camadas.push({
      arquivo: path.basename(arquivo),
      largura: cols,
      altura: rows,
      grade,
    });

    const usados = new Set(grade.flat().filter((v) => v));
    console.log(`  ${path.basename(arquivo).padEnd(20)} ${cols}x${rows} tiles   ` +
      `${String(usados.size).padStart(4)} distintos   ` +
      `+${atlas.length - antes} novos no atlas`);
  }

  const paleta = levantarPaleta(atlas);
  const bancos = Math.ceil(paleta.length / 16);

  const saida = path.resolve(__dirname, '..', '..', 'assets', 'ffta', 'tilesets', nome);
  fs.mkdirSync(saida, { recursive: true });

  writePNG(path.join(saida, 'tiles.png'), montarAtlas(atlas));

  fs.writeFileSync(path.join(saida, 'paleta.json'), JSON.stringify({
    nota: 'Cores distintas do tileset, por frequencia. Bancos de 16 como no GBA; ' +
          'o indice 0 de cada banco e a transparencia.',
    cores: paleta.length,
    bancos,
    paleta,
  }, null, 1));

  fs.writeFileSync(path.join(saida, 'mapa.json'), JSON.stringify({
    nota: 'Qual tile ocupa cada posicao, por camada. 0 = celula vazia. ' +
          'O tile N fica no atlas em (N-1 % ' + ATLAS_COLS + ', (N-1) / ' + ATLAS_COLS + '), ' +
          'em celulas de ' + CELL + 'px.',
    celula: CELL,
    atlasColunas: ATLAS_COLS,
    tiles: atlas.length,
    camadas,
  }, null, 1));

  const brutos = camadas.reduce((s, c) => s + c.largura * c.altura, 0);
  const naoVazios = camadas.reduce((s, c) => s + c.grade.flat().filter((v) => v).length, 0);

  console.log();
  console.log(`tiles brutos      ${brutos}`);
  console.log(`nao-vazios        ${naoVazios}`);
  console.log(`unicos no atlas   ${atlas.length}   (${(100 - 100 * atlas.length / naoVazios).toFixed(1)}% de economia)`);
  console.log(`cores             ${paleta.length}   em ${bancos} banco(s) de 16`);
  console.log();
  console.log(`-> assets/ffta/tilesets/${nome}/`);
}

main();
