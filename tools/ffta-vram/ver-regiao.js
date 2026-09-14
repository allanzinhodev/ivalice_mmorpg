'use strict';
/*
 * ver-regiao.js -- renderiza os tiles da ROM ao redor de um offset.
 *
 *   node tools/ffta-vram/ver-regiao.js <offset> [sprite-com-a-paleta.png] [tiles]
 *
 * Exemplo:
 *   node tools/ffta-vram/ver-regiao.js 0x79411C tools/espadada.png 1024
 *
 *
 * PARA QUE SERVE
 *
 * Quando o achar-na-rom.js localiza um sprite, os vizinhos dele quase sempre
 * sao do mesmo conjunto -- outras armas, outros frames da mesma animacao. Este
 * script desenha a vizinhanca para voce ver o que mais esta ali.
 *
 * A paleta vem de um PNG indexado exportado do emulador: sem ela as cores
 * saem erradas, porque a ROM guarda so indices. Sem argumento de paleta,
 * desenha em escala de cinza -- o suficiente para reconhecer a forma.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const G = require('../ffta-extract/gfx.js');

/** Extrai so a PLTE de um PNG indexado. */
function paletaDe(arquivo) {
  const b = fs.readFileSync(arquivo);
  let o = 8;
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const tipo = b.slice(o + 4, o + 8).toString('latin1');
    if (tipo === 'PLTE') {
      const p = b.slice(o + 8, o + 8 + len);
      const cores = [];
      for (let i = 0; i < 16; i++) {
        cores.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2], i === 0 ? 0 : 255]);
      }
      return cores;
    }
    if (tipo === 'IEND') break;
    o += 12 + len;
  }
  return null;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('uso: node tools/ffta-vram/ver-regiao.js <offset> [paleta.png] [tiles]');
    console.error('exemplo: node tools/ffta-vram/ver-regiao.js 0x79411C tools/espadada.png');
    process.exit(1);
  }

  const offset = arg.startsWith('0x') ? parseInt(arg, 16) : parseInt(arg, 10);
  const palArquivo = process.argv[3] && process.argv[3].endsWith('.png') ? process.argv[3] : null;
  const nTiles = parseInt(process.argv[4] || '512', 10);

  const romPath = path.resolve(__dirname, '..', 'rom.gba');
  if (!fs.existsSync(romPath)) {
    console.error('ROM nao encontrada em tools/rom.gba (nao e versionada).');
    process.exit(1);
  }
  const rom = fs.readFileSync(romPath);

  let pal = palArquivo ? paletaDe(palArquivo) : null;
  if (!pal) {
    pal = [];
    for (let i = 0; i < 16; i++) pal.push([i * 17, i * 17, i * 17, i === 0 ? 0 : 255]);
    console.log('sem paleta -- desenhando em escala de cinza');
  } else {
    console.log(`paleta de ${path.basename(palArquivo)}`);
  }

  // Recua um pouco: o sprite achado raramente e o primeiro do conjunto.
  const inicio = Math.max(0, offset - 32 * 64);

  const COLS = 32;
  const rows = Math.ceil(nTiles / COLS);
  const W = COLS * 8, H = rows * 8;
  const px = Buffer.alloc(W * H * 4);

  for (let t = 0; t < nTiles; t++) {
    const tx = (t % COLS) * 8, ty = Math.floor(t / COLS) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const o = inicio + t * 32 + y * 4 + (x >> 1);
        if (o >= rom.length) continue;
        const b = rom[o];
        const v = (x & 1) ? (b >> 4) : (b & 15);
        const c = pal[v];
        const d = ((ty + y) * W + (tx + x)) * 4;
        px[d] = c[0]; px[d + 1] = c[1]; px[d + 2] = c[2]; px[d + 3] = c[3];
      }
    }
  }

  const saida = path.join(__dirname, `regiao-${offset.toString(16).toUpperCase()}.png`);
  fs.writeFileSync(saida, G.encodePNG(W, H, px));

  console.log(`${W}x${H}, ${nTiles} tiles a partir de 0x${inicio.toString(16).toUpperCase()}`);
  console.log(`-> ${saida}`);
  console.log(`   (o sprite pedido esta no tile ${(offset - inicio) / 32})`);
}

main();
