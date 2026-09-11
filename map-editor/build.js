'use strict';
/*
 * build.js -- gera o editor de mapa como um HTML unico, que roda no navegador
 * sem servidor e sem dependencia nenhuma.
 *
 *   node map-editor/build.js
 *   -> map-editor/editor.html   (abra no navegador)
 *
 * POR QUE UM ARQUIVO SO
 *
 * O editor le tres fontes do projeto -- o .dat, o .cwm e o .otbm -- que um
 * navegador nao alcanca a partir de file://. Em vez de subir um servidor, o
 * build embute tudo o que a pagina precisa: as duas camadas ja rasterizadas em
 * PNG e a grade em JSON. O HTML resultante e autocontido.
 *
 * Rode de novo sempre que o datapack ou o mapa mudarem.
 */

const fs = require('fs');
const path = require('path');
const { readDat } = require('../tools/asset-compiler/dat-read.js');
const { abrirSprites } = require('../tools/asset-compiler/render-check.js');
const { readOtbm } = require('../tools/datapack-gen/otbm-read.js');
const { Image, writePNG } = require('../tools/asset-compiler/png.js');

const ROOT = path.resolve(__dirname, '..');
const DATAPACK = path.join(ROOT, 'client/data/things/860');
const WORLD = path.join(ROOT, 'server/data/world/world.otbm');
const MAPDATA = path.join(ROOT, 'assets/mapdata/map150.json');
const AQUI = __dirname;

// Tem que bater com client/src/client/const.h
const TILE_HALF_W = 16;
const TILE_HALF_H = 8;
const FLOOR_LIFT = 16;

/**
 * Monta o quadro de um thing a partir das celulas do mosaico.
 *
 * A ordem dos sprites no .dat e de tras para frente nos DOIS eixos: o indice 0
 * e a celula inferior-direita. Ver tools/asset-compiler/mosaic.js, que tem o
 * teste que fixa essa regra.
 */
function quadroDe(thing, sprites, cell) {
  const g = thing.groups[0];
  const img = Image.blank(g.width * cell, g.height * cell);
  for (let h = 0; h < g.height; h++) {
    for (let w = 0; w < g.width; w++) {
      const cel = sprites.get(g.sprites[h * g.width + w]);
      if (!cel) continue;
      img.blit(cel, (g.width - w - 1) * cell, (g.height - h - 1) * cell);
    }
  }
  const disp = thing.attrs.displacement || [0, 0];
  const fator = cell / 32;
  return {
    img,
    origem: [
      -Math.trunc(disp[0] * fator) - (g.width - 1) * cell,
      -Math.trunc(disp[1] * fator) - (g.height - 1) * cell,
    ],
  };
}

/** Compoe respeitando alpha. Image.blit copia ate os transparentes e apaga o vizinho. */
function blitOver(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const so = src.offset(x, y);
      if (src.pixels[so + 3] === 0) continue;
      src.pixels.copy(dst.pixels, dst.offset(tx, ty), so, so + 4);
    }
  }
}

function main() {
  const sprites = abrirSprites(DATAPACK);
  const dat = readDat(fs.readFileSync(path.join(DATAPACK, 'Tibia.dat')));
  const mundo = readOtbm(fs.readFileSync(WORLD));
  const mapdata = JSON.parse(fs.readFileSync(MAPDATA, 'utf8'));
  const cell = sprites.cell;

  const porId = new Map();
  for (const it of dat.items) porId.set(it.id, it);

  const cache = new Map();
  const quadro = (id) => {
    if (!cache.has(id)) {
      const t = porId.get(id);
      cache.set(id, t ? quadroDe(t, sprites, cell) : null);
    }
    return cache.get(id);
  };

  const zs = [...new Set(mundo.tiles.map((t) => t.z))];
  const zBase = Math.max(...zs);
  const posDe = (t) => ({
    x: (t.x - t.y) * TILE_HALF_W,
    y: (t.x + t.y) * TILE_HALF_H - (zBase - t.z) * FLOOR_LIFT,
  });

  // Limites, para as imagens sairem justas.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of mundo.tiles) {
    const p = posDe(t);
    for (const id of t.items) {
      const q = quadro(id);
      if (!q) continue;
      minX = Math.min(minX, p.x + q.origem[0]);
      minY = Math.min(minY, p.y + q.origem[1]);
      maxX = Math.max(maxX, p.x + q.origem[0] + q.img.width);
      maxY = Math.max(maxY, p.y + q.origem[1] + q.img.height);
    }
  }
  const W = maxX - minX, H = maxY - minY;

  /*
   * Ordem igual a do client: andar mais baixo primeiro (z maior) e, dentro do
   * andar, por anti-diagonal (x + y) crescente -- a ordem em que
   * updateVisibleTilesCache enfileira as celulas.
   */
  const ordem = [...mundo.tiles].sort((a, b) =>
    (b.z - a.z) || ((a.x + a.y) - (b.x + b.y)) || (a.x - b.x));

  // Uma imagem por camada, para a pagina poder ligar e desligar cada uma.
  const camadas = { 1: Image.blank(W, H), 2: Image.blank(W, H) };
  const itensPorCamada = { 1: 0, 2: 0 };

  for (const t of ordem) {
    const p = posDe(t);
    for (const id of t.items) {
      const thing = porId.get(id);
      const q = quadro(id);
      // A camada vem do atributo onTop do .dat -- a MESMA fonte que o client
      // usa em Tile::addThing para ordenar a pilha.
      const camada = thing && thing.attrs.onTop ? 2 : 1;
      itensPorCamada[camada]++;
      if (!q) continue;
      blitOver(camadas[camada], q.img, p.x + q.origem[0] - minX, p.y + q.origem[1] - minY);
    }
  }

  const tmp = path.join(AQUI, '.build');
  fs.mkdirSync(tmp, { recursive: true });
  writePNG(path.join(tmp, 'c1.png'), camadas[1]);
  writePNG(path.join(tmp, 'c2.png'), camadas[2]);

  // A grade: uma entrada por celula, com o que o editor precisa saber.
  const celulas = [];
  for (let r = 0; r < mapdata.rows; r++) {
    for (let c = 0; c < mapdata.cols; c++) {
      const x = mapdata.grid[r][c];
      if (!x) continue;
      celulas.push([
        c, r,
        x.tile,
        x.tile2 === undefined ? null : x.tile2,
        x.andar !== undefined ? x.andar : x.height,
        x.terreno || 'walk',
        x.offset || null,
      ]);
    }
  }

  const meta = {
    map: mapdata.map,
    cols: mapdata.cols,
    rows: mapdata.rows,
    origin: mapdata.origin,
    gridOffset: mapdata.gridOffset || [0, 0],
    minHeight: mapdata.minHeight,
    largura: W,
    altura: H,
    celula: cell,
    itens: itensPorCamada,
  };

  const b64 = (f) => fs.readFileSync(path.join(tmp, f)).toString('base64');
  const payload = 'const CELLS=' + JSON.stringify(celulas) + ';\n'
    + 'const MAPMETA=' + JSON.stringify(meta) + ';\n'
    + 'const PNG1="' + b64('c1.png') + '";\n'
    + 'const PNG2="' + b64('c2.png') + '";\n';

  const shell = fs.readFileSync(path.join(AQUI, 'editor.tpl.html'), 'utf8');
  const html = shell.replace('/*PAYLOAD*/', payload);
  const saida = path.join(AQUI, 'editor.html');
  fs.writeFileSync(saida, html);

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`datapack: celula ${cell}px, ${dat.items.length} itens`);
  console.log(`mundo:    ${mundo.tiles.length} tiles, ${W}x${H}`);
  console.log(`camadas:  ${itensPorCamada[1]} terreno + ${itensPorCamada[2]} por cima`);
  console.log(`-> map-editor/editor.html  (${(html.length / 1024).toFixed(0)} KB)`);
}

if (require.main === module) main();

module.exports = { quadroDe, blitOver };
