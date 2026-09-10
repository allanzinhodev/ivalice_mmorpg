'use strict';
/*
 * gfx.js — descompressores e util de imagem para os graficos de mapa de FFTA.
 *
 * LZ77 e LZSS portados de tools/FFTAUtils/FFTA_MapEditor/LZ77.cs e LZSS.cs.
 * O byte de "tipo" antes do stream indica: 0x10 -> LZ77, 0x20/0x22 -> LZSS,
 * 0x11/0x12 -> variações, 0x01 -> nao comprimido (packed).
 * PNG: codificador RGBA minimo em JS puro (DEFLATE stored + CRC), sem libs.
 */
const zlib = require('zlib');

// -------------------------------------------------- LZ77 (MSB-first, header>>8 = tamanho)
function lz77(src, from = 0) {
  const header = src[from] | (src[from + 1] << 8) | (src[from + 2] << 16) | (src[from + 3] << 24);
  let outLen = header >>> 8;
  const dest = Buffer.alloc(outLen);
  let xIn = from + 4, xOut = 0, left = outLen;
  while (left > 0) {
    let d = src[xIn++];
    for (let i = 0; i < 8; i++) {
      if (d & 0x80) {
        const data = (src[xIn] << 8) | src[xIn + 1];
        xIn += 2;
        const length = (data >> 12) + 3;
        let w = xOut - (data & 0xFFF) - 1;
        for (let j = 0; j < length; j++) {
          dest[xOut++] = w >= 0 ? dest[w] : 0;
          w++;
          if (--left === 0) return dest;
        }
      } else {
        dest[xOut++] = src[xIn++];
        if (--left === 0) return dest;
      }
      d = (d << 1) & 0xFF;
    }
  }
  return dest;
}

// -------------------------------------------------- LZSS (header big-endian = tamanho)
function lzss(src, from = 0) {
  const retlen = (src[from] << 24) | (src[from + 1] << 16) | (src[from + 2] << 8) | src[from + 3];
  const dest = Buffer.alloc(retlen);
  let xIn = from + 4, xOut = 0;
  while (xOut < retlen) {
    const b = src[xIn];
    if (b & 0x80) {
      let tmp = xOut - ((b & 0x07) << 8) - src[xIn + 1] - 1;
      for (let i = ((b >> 3) & 0x0F) + 3; i > 0; i--) { dest[xOut++] = tmp >= 0 ? dest[tmp] : 0; tmp++; }
      xIn += 2;
    } else if (b & 0x40) {
      for (let i = (b & 0x3F) + 1; i > 0; i--) { xIn++; dest[xOut++] = src[xIn]; }
      xIn++;
    } else if (b & 0x20) {
      for (let i = (b & 0x1F) + 2; i > 0; i--) dest[xOut++] = 0;
      xIn++;
    } else if (b & 0x10) {
      const j = ((src[xIn + 1] & 0x3F) << 8) | src[xIn + 2];
      let tmp = Math.max(0, xOut - j - 1);
      for (let i = (((src[xIn + 1] >> 2) & 0x30) | (b & 0x0F)) + 4; i > 0; i--) { dest[xOut++] = dest[tmp]; tmp++; }
      xIn += 3;
    } else if (b === 0x01) {
      for (let i = src[xIn + 1] + 3; i > 0; i--) dest[xOut++] = 0xFF;
      xIn += 2;
    } else if (b === 0x02) {
      for (let i = src[xIn + 1] + 3; i > 0; i--) dest[xOut++] = 0x00;
      xIn += 2;
    } else if (b === 0x00) {
      const j = (src[xIn + 2] << 8) | src[xIn + 3];
      let tmp = Math.max(0, xOut - j - 1);
      for (let i = src[xIn + 1] + 4; i > 0; i--) { dest[xOut++] = dest[tmp]; tmp++; }
      xIn += 4;
    } else {
      break; // tipo desconhecido -> para
    }
  }
  return dest;
}

// Offsets do stream conforme FFTA_MapEditor/Form1.cs:
//   0x10 -> LZ77 a partir do proprio byte de tipo (ele e o low byte do header)
//   0x11 -> LZ77 a partir de off+4 (pula tipo + 3 bytes de "trueMap")
//   0x20 -> LZSS a partir de off+4
//   0x22 -> LZSS a partir de off+8
//   0x01 -> nao comprimido (packed)
function decompress(rom, off) {
  const type = rom[off];
  if (type === 0x10) return { type, data: lz77(rom, off) };
  if (type === 0x11) return { type, data: lz77(rom, off + 4) };
  if (type === 0x12) return { type, data: lz77(rom, off + 4) };
  if (type === 0x20) return { type, data: lzss(rom, off + 4) };
  if (type === 0x22) return { type, data: lzss(rom, off + 8) };
  if (type === 0x01) return { type, data: null }; // packed cru
  return { type, data: null };
}

// -------------------------------------------------- paleta BGR555 -> RGBA
function palToRGBA(buf, count) {
  const pal = [];
  for (let i = 0; i < count; i++) {
    const v = buf[i * 2] | (buf[i * 2 + 1] << 8);
    // 5 bits -> 8 bits por deslocamento, NAO por regra de tres.
    //
    // O jogo (e o hardware do GBA) usa v<<3: o valor 21 vira 168, nao 173.
    // Conferido contra assets/mapref/aisenfield.png, que veio do jogo: com
    // <<3 as cores batem EXATAMENTE (168,136,72 / 40,64,80 / 104,152,0);
    // com *255/31 saem todas alguns pontos acima e nada casa.
    const r = (v & 0x1F) << 3;
    const g = ((v >> 5) & 0x1F) << 3;
    const b = ((v >> 10) & 0x1F) << 3;
    pal.push([r, g, b, i === 0 ? 0 : 255]);
  }
  return pal;
}

// -------------------------------------------------- 4bpp tiles -> RGBA raster
// tiles de 8x8, 32 bytes cada, dispostos numa grade de `cols` colunas.
function tiles4bppToRGBA(data, palette, cols = 16) {
  const tileCount = Math.floor(data.length / 32);
  const rows = Math.ceil(tileCount / cols);
  const W = cols * 8, H = rows * 8;
  const out = Buffer.alloc(W * H * 4);
  for (let t = 0; t < tileCount; t++) {
    const tx = (t % cols) * 8, ty = Math.floor(t / cols) * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px += 2) {
        const byte = data[t * 32 + py * 4 + px / 2];
        for (const [ofs, idx] of [[0, byte & 0x0F], [1, byte >> 4]]) {
          const c = palette[idx] || [0, 0, 0, 0];
          const o = ((ty + py) * W + (tx + px + ofs)) * 4;
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
        }
      }
    }
  }
  return { width: W, height: H, rgba: out, tileCount };
}

// -------------------------------------------------- PNG (RGBA, zlib real)
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { lz77, lzss, decompress, palToRGBA, tiles4bppToRGBA, encodePNG };
