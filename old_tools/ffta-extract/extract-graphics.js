'use strict';
/*
 * extract-graphics.js — descompressao dos graficos de mapa de FFTA.
 *
 *   node tools/ffta-extract/extract-graphics.js [rom.gba]
 *
 * Para cada um dos 163 registros de mapa (base 0x569104, 0x58 bytes):
 *   - tileset  (rec+0x00, +byte de tipo)   -> .bin 4bpp + .png
 *   - arrange  (rec+0x04)                  -> .bin (indices de tile do mapa)
 *   - height   (rec+0x10)                  -> .bin (altura/permissao por celula)
 *   - paleta   (rec+0x0C ou tabela 0x1A4F8/0x1A514 conforme rec+0x54)
 * Streams identicos (mesmo offset) sao gravados uma unica vez.
 */
const fs = require('fs');
const path = require('path');
const G = require('./gfx');

const ROM = process.argv[2] || path.join(__dirname, '..', 'rom.gba');
const OUT = path.join(__dirname, '..', 'extracted', 'graphics');
const d = fs.readFileSync(ROM);

const BASE = 0x569104, REC = 0x58, COUNT = 163;
const ptr = (o) => (d.readUInt32LE(o) + BASE) >>> 0;

fs.mkdirSync(path.join(OUT, 'tileset-bin'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'tileset-png'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'arrange-bin'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'height-bin'), { recursive: true });

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

const seen = { gfx: new Set(), arr: new Set(), hgt: new Set() };
const maps = [];

for (let i = 0; i < COUNT; i++) {
  const rec = BASE + i * REC;
  const gOff = ptr(rec + 0x00), aOff = ptr(rec + 0x04), hOff = ptr(rec + 0x10);
  const id = String(i).padStart(3, '0');
  const entry = { index: i, gfxOffset: hex(gOff), arrangeOffset: hex(aOff), heightOffset: hex(hOff) };

  // ---- tileset
  try {
    const g = G.decompress(d, gOff);
    entry.gfxType = hex(d[gOff]);
    if (g.data && g.data.length) {
      entry.tiles = g.data.length / 32;
      if (!seen.gfx.has(gOff)) {
        seen.gfx.add(gOff);
        fs.writeFileSync(path.join(OUT, 'tileset-bin', `map${id}_${hex(gOff)}.bin`), g.data);
        const pal = readPalette(rec);
        if (pal) {
          const palette = G.palToRGBA(pal, 16);
          const img = G.tiles4bppToRGBA(g.data, palette, 16);
          fs.writeFileSync(path.join(OUT, 'tileset-png', `map${id}.png`), G.encodePNG(img.width, img.height, img.rgba));
          entry.png = `tileset-png/map${id}.png`;
        }
      }
    }
  } catch (e) { entry.gfxError = e.message; }

  // ---- arrangement
  try {
    const a = G.decompress(d, aOff);
    entry.arrangeType = hex(d[aOff]);
    if (a.data && a.data.length && !seen.arr.has(aOff)) {
      seen.arr.add(aOff);
      fs.writeFileSync(path.join(OUT, 'arrange-bin', `map${id}_${hex(aOff)}.bin`), a.data);
    }
  } catch (e) { entry.arrangeError = e.message; }

  // ---- heightmap
  try {
    const h = G.decompress(d, hOff);
    entry.heightType = hex(d[hOff]);
    if (h.data && h.data.length && !seen.hgt.has(hOff)) {
      seen.hgt.add(hOff);
      fs.writeFileSync(path.join(OUT, 'height-bin', `map${id}_${hex(hOff)}.bin`), h.data);
    }
  } catch (e) { entry.heightError = e.message; }

  maps.push(entry);
}

fs.writeFileSync(path.join(OUT, 'maps.json'), JSON.stringify({
  note: 'Graficos de mapa descomprimidos. tileset = tiles 4bpp de 8x8 (32 bytes cada). '
      + 'arrange = grade de indices de tile. height = altura + permissao por celula. '
      + 'Descompressores portados de tools/FFTAUtils/FFTA_MapEditor.',
  pointerTableOffset: '0x569104', recordSize: 88, count: COUNT,
  uniqueTilesets: seen.gfx.size, uniqueArrangements: seen.arr.size, uniqueHeightmaps: seen.hgt.size,
  maps,
}, null, 2) + '\n');

console.log(`maps=${COUNT} tilesets=${seen.gfx.size} arrangements=${seen.arr.size} heightmaps=${seen.hgt.size}`);
console.log('-> ' + OUT);

function hex(n) { return '0x' + (n >>> 0).toString(16).toUpperCase(); }
