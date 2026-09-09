'use strict';
/*
 * Descomprime um bloco LZ77 do pc.bin e desenha como folha de tiles 4bpp,
 * para inspecao visual.
 *
 * Sem paleta verdadeira nao da para ver a cor certa, mas da para ver a FORMA:
 * se o bloco e tile grafico, aparecem silhuetas e blocos 8x8 alinhados; se e
 * codigo ou tabela, aparece ruido. E o teste mais barato para separar os dois,
 * e nao depende de identificar o formato do container.
 *
 * O DS guarda tile 4bpp assim: 8x8 pixels, 32 bytes por tile, 2 pixels por
 * byte, o pixel da ESQUERDA nos 4 bits baixos. Ver GBATEK, "DS Video BG Modes".
 *
 * Usa so zlib do proprio Node para escrever o PNG -- nada de dependencia nova
 * num repo que hoje nao tem nenhuma.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { descomprimir } = require('./find-lz77');

const ROM = path.resolve(__dirname, '../ffta2.nds');

// --- PNG minimo (cor indexada seria melhor, mas RGB e mais simples) ---------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}

/** Escreve PNG RGB de 8 bits a partir de um buffer de pixels (3 bytes cada). */
function escreverPNG(caminho, largura, altura, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;  // bits por canal
  ihdr[9] = 2;  // truecolor
  const linhas = Buffer.alloc(altura * (largura * 3 + 1));
  for (let y = 0; y < altura; y++) {
    linhas[y * (largura * 3 + 1)] = 0; // filtro none
    rgb.copy(linhas, y * (largura * 3 + 1) + 1, y * largura * 3, (y + 1) * largura * 3);
  }
  fs.writeFileSync(caminho, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(linhas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// --- tiles 4bpp -------------------------------------------------------------

/** Paleta de cinza: nao e a real, serve para revelar forma. */
const CINZA = [];
for (let i = 0; i < 16; i++) { const v = Math.round((i / 15) * 255); CINZA.push([v, v, v]); }

function desenharTiles(dados, tilesPorLinha, paleta = CINZA) {
  const nTiles = Math.floor(dados.length / 32);
  const linhasDeTile = Math.ceil(nTiles / tilesPorLinha);
  const largura = tilesPorLinha * 8;
  const altura = linhasDeTile * 8;
  const rgb = Buffer.alloc(largura * altura * 3);

  for (let t = 0; t < nTiles; t++) {
    const tx = (t % tilesPorLinha) * 8;
    const ty = Math.floor(t / tilesPorLinha) * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px += 2) {
        const b = dados[t * 32 + py * 4 + px / 2];
        const c0 = b & 0x0f;        // pixel da esquerda nos bits baixos
        const c1 = (b >> 4) & 0x0f;
        for (const [dx, c] of [[0, c0], [1, c1]]) {
          const x = tx + px + dx, y = ty + py;
          const o = (y * largura + x) * 3;
          rgb[o] = paleta[c][0]; rgb[o + 1] = paleta[c][1]; rgb[o + 2] = paleta[c][2];
        }
      }
    }
  }
  return { rgb, largura, altura, nTiles };
}

function main() {
  const off = parseInt(process.argv[2], 16);
  const saida = process.argv[3] || 'bloco.png';
  const tilesPorLinha = Number(process.argv[4] || 32);
  const maxTiles = Number(process.argv[5] || 4096);

  const buf = fs.readFileSync(ROM);
  const r = descomprimir(buf, off, 4 << 20);
  if (!r) { console.error(`0x${off.toString(16)} nao e LZ77 valido`); process.exit(1); }

  const usar = r.dados.subarray(0, Math.min(r.dados.length, maxTiles * 32));
  const { rgb, largura, altura, nTiles } = desenharTiles(usar, tilesPorLinha);
  escreverPNG(saida, largura, altura, rgb);
  console.log(`0x${off.toString(16)}: ${r.consumido} -> ${r.tamanho} bytes`);
  console.log(`${nTiles} tiles 4bpp desenhados em ${saida} (${largura}x${altura})`);
}

if (require.main === module) main();
module.exports = { escreverPNG, desenharTiles, CINZA };
