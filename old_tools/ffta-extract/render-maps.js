'use strict';
/*
 * render-maps.js — monta o cenario de cada mapa do FFTA num PNG legivel.
 *
 *   node tools/ffta-extract/render-maps.js [indice]
 *
 * Sem argumento renderiza os 163. Saida em extracted/graphics/map-png/.
 *
 * POR QUE ISSO EXISTE
 *
 * Os PNGs em tileset-png/ sao dumps CRUS: os tiles enfileirados numa grade,
 * sem o arranjo. Servem para conferir a paleta, nao para reconhecer um mapa.
 * Este script aplica o arrangement e produz o cenario montado -- que e o que
 * permite identificar visualmente qual mapa e qual (o registro de 88 bytes
 * NAO tem campo de nome, entao nao ha como resolver "Aisenfield" por dado).
 *
 * O FORMATO DO ARRANGEMENT
 *
 * Nao e um array plano: e uma lista de runs, decodificada em
 * tools/FFTAUtils/DecodeArrangeData/Program.cs
 *
 *   [u32 header]
 *   repetir:
 *     [u16 destAddr]    endereco na VRAM; 0 termina
 *     [u8  tileCount]
 *     [u16 tileNo] * tileCount
 *
 * Cada run diz "escreva estes N tiles a partir deste endereco".
 *
 * COMO VIRA TELA (tools/FFTAUtils/RenderArrangeMap/Form1.cs)
 *
 * Grid de 128x64 (A_WIDTH=0x80, A_HEIGHT=0x40), tile desenhado em (x*4, y*8),
 * em DUAS camadas separadas por `yCoord < A_HEIGHT`. O tile em si e 8x8, mas
 * o passo horizontal e 4 -- os tiles se sobrepoem pela metade, e e isso que
 * monta o cenario isometrico do FFTA.
 */

const fs = require('fs');
const path = require('path');
const G = require('./gfx');
const { Image, writePNG } = require('../asset-compiler/png.js');

const ROM = process.argv.find((a) => a.endsWith('.gba')) || path.join(__dirname, '..', 'rom.gba');
const OUT = path.join(__dirname, '..', 'extracted', 'graphics');
const OUT_PNG = path.join(OUT, 'map-png');

const BASE = 0x569104, REC = 0x58, COUNT = 163;

// Form1.cs: A_WIDTH / A_HEIGHT
const A_WIDTH = 0x80;   // 128 colunas
const A_HEIGHT = 0x40;  // 64 linhas por camada
// O endereco avanca 4 por tile na horizontal, mas cada tile ocupa 8px.
// Por isso a coluna do tile e (addr % A_WIDTH) / 4, e o passo de desenho e 8.
//
// Usar (addr % A_WIDTH) direto com passo 4 -- como o RenderArrangeMap do
// FFTAUtils faz -- espalha os tiles de 16 em 16px e deixa 8px de buraco entre
// eles. Com passo 2 eles encostam, mas o mapa sai espremido na horizontal.
const ADDR_PER_TILE = 4;
const STEP_X = 8;
const STEP_Y = 8;

const GRID_W = A_WIDTH / 4;   // colunas de tile (o endereco avanca 4 por tile)
const TILE = 8;

// Subpaleta usada para colorir os tiles. Ver o comentario em renderMap.
const SUBPALETTE = (() => {
  const a = process.argv.find((x) => x.startsWith('--pal='));
  return a ? parseInt(a.slice(6), 10) : 1;
})();

const d = fs.readFileSync(ROM);
const ptr = (o) => (d.readUInt32LE(o) + BASE) >>> 0;
const hex = (n) => '0x' + n.toString(16).toUpperCase();

/** Igual ao readPalette do extract-graphics.js. */
function readPalette(rec) {
  const palType = d[rec + 0x54] & 0x03;
  try {
    if (palType !== 1 && palType !== 2) {
      const p = ptr(rec + 0x0C);
      if (d[p] === 0x10) return G.lz77(d, p);
      return d.slice(p + 4, p + 4 + 0x200);
    }
    const tableOff = (palType === 1 ? d.readUInt32LE(0x01A4F8) : d.readUInt32LE(0x01A514)) & 0x1FFFFFF;
    const rel = d.readUInt16LE(tableOff + d[rec + 0x56] * 2);
    return G.lzss(d, tableOff + rel);
  } catch (e) {
    return null;
  }
}

/**
 * Le os runs do arrangement e devolve as duas camadas como arrays planos de
 * A_WIDTH*A_HEIGHT, com -1 onde nao ha tile.
 *
 * A separacao das camadas e por endereco: yCoord >= A_HEIGHT vai para a
 * camada 1 (fundo), abaixo disso para a camada 2 (frente). Ver
 * convertToPlanarArray em Form1.cs.
 */
function parseArrangement(buf) {
  const layer1 = new Int32Array(GRID_W * A_HEIGHT).fill(-1);
  const layer2 = new Int32Array(GRID_W * A_HEIGHT).fill(-1);

  let p = 4; // pula o header u32
  let maxTile = 0;
  while (p + 3 <= buf.length) {
    const addr = buf.readUInt16LE(p);
    if (addr === 0) break;
    const count = buf[p + 2];
    for (let i = 0; i < count; i++) {
      const off = p + 3 + i * 2;
      if (off + 1 >= buf.length) break;
      const tileNo = buf.readUInt16LE(off);
      if (tileNo > maxTile) maxTile = tileNo;

      // Cada entrada do run avanca 4 no endereco -- e assim que o
      // RenderArrangeMap do FFTAUtils faz (tileRec.addr = nextAddr + i*4), e
      // e o que produz a silhueta isometrica coerente.
      //
      // Tentei addr/2 + i (tratando addr como byte e a entrada como u16):
      // a faixa cabe melhor na grade, mas o desenho se parte em quatro
      // quadrantes. O stride 4 e o correto.
      const cell = addr + i * ADDR_PER_TILE;
      const y = Math.floor(cell / A_WIDTH);
      const x = Math.floor((cell % A_WIDTH) / ADDR_PER_TILE);
      if (x >= GRID_W) continue;
      if (y >= A_HEIGHT) {
        const idx = (y % A_HEIGHT) * GRID_W + x;
        if (idx < layer1.length) layer1[idx] = tileNo;
      } else {
        const idx = y * GRID_W + x;
        if (idx < layer2.length) layer2[idx] = tileNo;
      }
    }
    p += count * 2 + 3;
  }

  return { layer1, layer2, maxTile };
}

/** Recorta o tile `n` do atlas RGBA gerado por tiles4bppToRGBA. */
function tileFromAtlas(atlas, atlasCols, n) {
  const tx = (n % atlasCols) * TILE;
  const ty = Math.floor(n / atlasCols) * TILE;
  return { tx, ty };
}

function renderMap(index) {
  const rec = BASE + index * REC;
  const gOff = ptr(rec + 0x00);
  const aOff = ptr(rec + 0x04);

  const gfx = G.decompress(d, gOff);
  if (!gfx || !gfx.data) return { index, error: `tileset tipo ${hex(d[gOff])} nao descomprimiu` };

  // Tipo 0x01 e "packed": nao comprimido, os dados vem logo apos o header de
  // 4 bytes. O decompress do gfx.js devolve null nesse caso (ele so trata os
  // formatos comprimidos), entao fatiamos direto -- sao 47 dos 163 mapas.
  let arrData;
  if (d[aOff] === 0x01) {
    arrData = d.subarray(aOff + 4);
  } else {
    const arr = G.decompress(d, aOff);
    if (!arr || !arr.data) return { index, error: `arrangement tipo ${hex(d[aOff])} nao descomprimiu` };
    arrData = arr.data;
  }

  const palBuf = readPalette(rec);
  if (!palBuf) return { index, error: 'paleta nao lida' };

  // A paleta traz VARIAS subpaletas de 16 cores (o mapa 0 tem 5 = 160 bytes).
  // Em 4bpp cada tile escolhe a sua, mas o arrangement deste formato nao
  // carrega esse indice -- os tileNo sao so indices de tile, sem os bits de
  // paleta/flip do tilemap padrao do GBA.
  //
  // Na pratica a subpaleta 0 e a de UI (azul/laranja) e as seguintes sao as de
  // terreno. Por isso o default e 1, e da para trocar com --pal=N para
  // conferir as outras.
  const subCount = Math.max(1, Math.floor(palBuf.length / 32));
  const sub = Math.min(SUBPALETTE, subCount - 1);
  const palette = G.palToRGBA(palBuf.subarray(sub * 32, (sub + 1) * 32), 16);

  // Atlas com todos os tiles do tileset, 16 por linha.
  // tiles4bppToRGBA devolve { width, height, rgba, tileCount }.
  const ATLAS_COLS = 16;
  const a = G.tiles4bppToRGBA(gfx.data, palette, ATLAS_COLS);
  const tileCount = a.tileCount;
  const atlas = new Image(a.width, a.height, a.rgba);

  const { layer1, layer2, maxTile } = parseArrangement(arrData);

  const out = Image.blank(GRID_W * STEP_X + TILE, A_HEIGHT * STEP_Y + TILE);

  // Camada 1 (fundo) primeiro, camada 2 por cima -- a ordem de Form1.cs.
  let drawn = 0;
  for (const layer of [layer1, layer2]) {
    for (let i = 0; i < layer.length; i++) {
      const n = layer[i];
      if (n < 0 || n >= tileCount) continue;
      const y = Math.floor(i / GRID_W);
      const x = i % GRID_W;
      const { tx, ty } = tileFromAtlas(atlas, ATLAS_COLS, n);
      const tile = atlas.crop(tx, ty, TILE, TILE);
      out.blit(tile, x * STEP_X, y * STEP_Y);
      drawn++;
    }
  }

  return { index, image: out, tiles: tileCount, maxTile, drawn };
}

function main() {
  fs.mkdirSync(OUT_PNG, { recursive: true });

  const arg = process.argv[2];
  const only = arg && !arg.endsWith('.gba') && !arg.startsWith('--') ? parseInt(arg, 10) : null;
  const list = only !== null ? [only] : Array.from({ length: COUNT }, (_, i) => i);

  let ok = 0;
  const errors = [];
  for (const i of list) {
    const r = renderMap(i);
    if (r.error) { errors.push(`map ${i}: ${r.error}`); continue; }
    const id = String(i).padStart(3, '0');
    writePNG(path.join(OUT_PNG, `map${id}.png`), r.image);
    ok++;
    if (only !== null || i % 20 === 0) {
      console.log(`map ${id}: ${r.tiles} tiles, ${r.drawn} desenhados, maior indice ${r.maxTile}`);
    }
  }

  console.log(`\n${ok} mapas renderizados em extracted/graphics/map-png/`);
  if (errors.length) {
    console.log(`${errors.length} com problema:`);
    for (const e of errors.slice(0, 10)) console.log('  ' + e);
  }
}

if (require.main === module) main();

module.exports = { renderMap, parseArrangement, A_WIDTH, A_HEIGHT, GRID_W, STEP_X, STEP_Y };
