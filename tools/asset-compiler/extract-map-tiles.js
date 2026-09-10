'use strict';
/*
 * extract-map-tiles.js — recorta os tiles de um mapa do FFTA a partir da
 * imagem de referencia, e emite os ground items + a grade do mapa.
 *
 *   node tools/asset-compiler/extract-map-tiles.js [--map=150] [--calib]
 *
 * ENTRADA
 *   assets/mapref/aisenfield.png   o mapa renderizado (veio do jogo)
 *   tools/rom.gba                  para o height map (altura por celula)
 *
 * SAIDA
 *   assets/items/NNN-<mapa>-<n>.png   tiles unicos, 32x32
 *   assets/mapdata/<mapa>.json        grade: por celula { tile, altura, z }
 *   assets/debug/<mapa>-calib.png     com --calib: grade sobre a referencia
 *
 * POR QUE A IMAGEM E NAO A ROM
 *
 * O arrangement da ROM nao foi decodificado por completo: os indices nao
 * casam com a referencia (38/202 na melhor tentativa). Ja a imagem casa
 * 1008 tiles contra o tileset. Ver .claude/skills/ffta-map/SKILL.md.
 *
 * O DESVIO ISOMETRICO E OS ANDARES
 *
 * Este e o ponto que mais confunde. O TFS/OTBM tem a sua propria convencao
 * de andar, em Position::coveredUp: subir um andar e (x+1, y+1, z-1).
 * Nosso client desenha com levantamento vertical (- dz * FLOOR_LIFT).
 *
 * As duas descrevem A MESMA geometria:
 *
 *   coveredUp:  ((col+1)-(row+1))*16 = (col-row)*16   -> X nao muda
 *               ((col+1)+(row+1))*8  = (col+row)*8+16 -> Y desloca 16
 *   lift:       (col+row)*8 - dz*16                   -> Y desloca 16
 *
 * O deslocamento diagonal do coveredUp CANCELA em X no losango e sobra
 * exatamente 16px em Y -- que e o FLOOR_LIFT. Nao e coincidencia:
 * FLOOR_LIFT = 2 * TILE_HALF_H e o que faz o client concordar com o OTBM.
 *
 * Por isso aqui usamos a mesma formula do client
 * (MapView::transformPositionTo2D), e o OTBM gerado depois bate sozinho.
 */

const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, Image } = require('./png.js');
const G = require('../ffta-extract/gfx.js');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'assets');

// Tem que bater com Otc::TILE_HALF_W/H e FLOOR_LIFT em client/src/client/const.h
const TILE_HALF_W = 16;
const TILE_HALF_H = 8;
const FLOOR_LIFT = 16;

// Sprite do Tibia. O losango tem 32x16, mas recortamos 32x32 para pegar
// tambem a face lateral do bloco -- e o que da o visual do FFTA.
const SPRITE = 32;

// Altura do FFTA -> andar. Ver gen-map-ffta.js, que usa a mesma constante.
const HEIGHT_PER_FLOOR = 3;

// Height map: stride 16.
//
// Em ALGUNS mapas as ultimas colunas nao sao terreno e sim enderecos -- no
// mapa 0 a coluna 14 vai 32,64,96,128... de 32 em 32, e o RenderHeightMap.cs
// do FFTAUtils pula essas colunas ("it's addresses, not values").
//
// Mas isso NAO vale para todos: no mapa 150 as 16 colunas tem terreno de
// verdade (valores 2..7, sem a progressao de endereco), e 16+13 = 29 casa
// exatamente com a largura da referencia (464/16 = 29). Por isso detectamos
// em vez de fixar em 14.
const HM_STRIDE = 16;

const BASE = 0x569104, REC = 0x58;

function loadHeightMap(rom, mapIndex) {
  const ptr = (o) => (rom.readUInt32LE(o) + BASE) >>> 0;
  const out = G.decompress(rom, ptr(BASE + mapIndex * REC + 0x10));
  if (!out || !out.data) throw new Error(`mapa ${mapIndex}: heightmap nao descomprimiu`);

  const data = out.data;
  const rows = Math.floor(((data.length - 4) / 2) / HM_STRIDE);
  const at = (r, c) => data[4 + (r * HM_STRIDE + c) * 2];

  // Descobre quantas colunas sao terreno: uma coluna de ENDERECO cresce de 32
  // em 32 a cada linha (mod 256). Terreno nao faz isso.
  let cols = HM_STRIDE;
  if (rows > 2) {
    for (let c = HM_STRIDE - 1; c >= 8; c--) {
      let isAddr = true;
      for (let r = 1; r < rows; r++) {
        if (((at(r - 1, c) + 32) & 0xff) !== at(r, c)) { isAddr = false; break; }
      }
      if (isAddr) cols = c; else break;
    }
  }

  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(at(r, c));
    grid.push(row);
  }
  grid.cols = cols;
  return grid;
}

/** Projecao identica a MapView::transformPositionTo2D do client. */
function project(col, row, z, origin) {
  return {
    x: origin.x + (col - row) * TILE_HALF_W,
    y: origin.y + (col + row) * TILE_HALF_H - z * FLOOR_LIFT,
  };
}

/**
 * Calcula a origem da grade GEOMETRICAMENTE.
 *
 * Forca bruta nao serve aqui: qualquer origem que caia numa regiao densa
 * pontua alto, e a "melhor" acabava empurrando a grade para a direita,
 * cobrindo so parte do mapa. Com 208/208 celulas "com conteudo" o resultado
 * parecia perfeito e estava deslocado 11px.
 *
 * A conta e direta. Na projecao isometrica:
 *   screenX = origin.x + (col - row) * TILE_HALF_W
 *   screenY = origin.y + (col + row) * TILE_HALF_H - z * FLOOR_LIFT
 *
 * O ponto mais a ESQUERDA do desenho e a celula (col=0, row=rowMax), e o mais
 * ALTO e aquele que minimiza (col+row)*HH - z*LIFT. Igualando esses extremos
 * ao bounding box do conteudo da imagem, a origem sai fechada.
 */
function calibrate(ref, hm) {
  const rows = hm.length, cols = hm[0].length;

  // bounding box do conteudo
  let bx0 = ref.width, by0 = ref.height;
  for (let y = 0; y < ref.height; y++) {
    for (let x = 0; x < ref.width; x++) {
      if (ref.alphaAt(x, y) !== 0) { if (x < bx0) bx0 = x; if (y < by0) by0 = y; }
    }
  }

  // extremos da grade, em coordenadas relativas (origin = 0)
  let relMinX = Infinity, relMinY = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const z = Math.floor(hm[r][c] / HEIGHT_PER_FLOOR);
      const x = (c - r) * TILE_HALF_W;
      // o topo do bloco: a celula sobe z*FLOOR_LIFT e o sprite tem a face
      // lateral acima do losango
      const y = (c + r) * TILE_HALF_H - z * FLOOR_LIFT - (SPRITE - 2 * TILE_HALF_H);
      if (x < relMinX) relMinX = x;
      if (y < relMinY) relMinY = y;
    }
  }

  return { x: bx0 - relMinX, y: by0 - relMinY };
}

/** Recorta a celula 32x32, com a base do losango encostada embaixo. */
function cutCell(ref, col, row, z, origin) {
  const p = project(col, row, z, origin);
  // O losango de 32x16 fica na PARTE DE BAIXO do sprite de 32x32: os 16px de
  // cima sao a face lateral / o que o bloco projeta para cima.
  return ref.crop(p.x, p.y - (SPRITE - 2 * TILE_HALF_H), SPRITE, SPRITE);
}

class TileTable {
  constructor() { this.tiles = []; this.byHash = new Map(); }
  add(img) {
    if (img.isEmpty()) return null;
    const key = img.pixels.toString('latin1');
    if (this.byHash.has(key)) return this.byHash.get(key);
    const id = this.tiles.length;
    this.tiles.push(img);
    this.byHash.set(key, id);
    return id;
  }
}

function drawGridOverlay(ref, hm, origin) {
  const out = Image.blank(ref.width, ref.height);
  out.blit(ref, 0, 0);
  const mark = (x, y, rgba) => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
    const o = out.offset(x, y);
    out.pixels[o] = rgba[0]; out.pixels[o + 1] = rgba[1];
    out.pixels[o + 2] = rgba[2]; out.pixels[o + 3] = 255;
  };
  for (let r = 0; r < hm.length; r++) {
    for (let c = 0; c < hm[0].length; c++) {
      const z = Math.floor(hm[r][c] / HEIGHT_PER_FLOOR);
      const p = project(c, r, z, origin);
      // desenha o losango da celula
      for (let i = 0; i < TILE_HALF_W; i++) {
        const dy = Math.floor(i / 2);
        mark(p.x + i, p.y + TILE_HALF_H - dy, [255, 0, 0]);
        mark(p.x + TILE_HALF_W * 2 - i, p.y + TILE_HALF_H - dy, [255, 0, 0]);
        mark(p.x + i, p.y + TILE_HALF_H + dy, [255, 0, 0]);
        mark(p.x + TILE_HALF_W * 2 - i, p.y + TILE_HALF_H + dy, [255, 0, 0]);
      }
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const mapIndex = parseInt((args.find((a) => a.startsWith('--map=')) || '--map=150').slice(6), 10);
  const calib = args.includes('--calib');

  const refPath = path.join(ASSETS, 'mapref/aisenfield.png');
  if (!fs.existsSync(refPath)) throw new Error(`nao achei ${refPath}`);
  const ref = readPNG(refPath);

  const rom = fs.readFileSync(path.join(ROOT, 'tools/rom.gba'));
  const hm = loadHeightMap(rom, mapIndex);

  console.log(`mapa ${mapIndex}: ${hm[0].length}x${hm.length} celulas`);
  console.log(`referencia: ${ref.width}x${ref.height}`);

  const origin = calibrate(ref, hm);
  console.log(`origem: (${origin.x},${origin.y})  calculada pelo bounding box do conteudo`);

  if (calib) {
    const dbg = path.join(ASSETS, 'debug');
    if (!fs.existsSync(dbg)) fs.mkdirSync(dbg, { recursive: true });
    const out = path.join(dbg, `map${mapIndex}-calib.png`);
    writePNG(out, drawGridOverlay(ref, hm, origin));
    console.log(`-> ${path.relative(ROOT, out)}`);
    return;
  }

  const table = new TileTable();
  const grid = [];
  for (let r = 0; r < hm.length; r++) {
    const row = [];
    for (let c = 0; c < hm[0].length; c++) {
      const h = hm[r][c];
      const z = Math.floor(h / HEIGHT_PER_FLOOR);
      const cell = cutCell(ref, c, r, z, origin);
      row.push({ tile: table.add(cell), height: h, z });
    }
    grid.push(row);
  }

  const itemsDir = path.join(ASSETS, 'items');
  const dataDir = path.join(ASSETS, 'mapdata');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  table.tiles.forEach((img, i) => {
    const name = `${String(200 + i).padStart(3, '0')}-map${mapIndex}-${i}.png`;
    writePNG(path.join(itemsDir, name), img);
  });

  fs.writeFileSync(
    path.join(dataDir, `map${mapIndex}.json`),
    JSON.stringify({ map: mapIndex, cols: hm[0].length, rows: hm.length, origin, grid }, null, 1)
  );

  console.log(`tiles unicos: ${table.tiles.length}`);
  console.log(`-> assets/items/ e assets/mapdata/map${mapIndex}.json`);
}

if (require.main === module) main();

module.exports = { project, loadHeightMap, TILE_HALF_W, TILE_HALF_H, FLOOR_LIFT, HEIGHT_PER_FLOOR };
