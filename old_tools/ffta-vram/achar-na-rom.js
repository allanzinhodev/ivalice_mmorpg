'use strict';
/*
 * achar-na-rom.js -- diz onde, na ROM, esta um sprite exportado do emulador.
 *
 *   node tools/ffta-vram/achar-na-rom.js <sprite.png> [rom.gba]
 *
 * Exemplo:
 *   node tools/ffta-vram/achar-na-rom.js tools/espadada.png
 *
 *
 * O METODO
 *
 * Treze tentativas de achar as sprites por analise estatica falharam porque
 * todas procuravam streams LZ77 -- e a arte de sprite do FFTA esta CRUA, num
 * banco de 2,3 MB em 0x69B000..0x8EA000 (ver BANCO-SPRITES.md).
 *
 * O caminho que funciona e o inverso: em vez de adivinhar onde a arte esta,
 * pegar um sprite que o emulador ja decodificou e procurar os bytes dele.
 *
 *   1. sprite view do mGBA exporta PNG indexado
 *   2. converte os indices de pixel para 4bpp do GBA
 *   3. procura na ROM crua
 *
 * O detalhe que decide: o NIBBLE BAIXO VEM PRIMEIRO. Pixel par no nibble
 * baixo, pixel impar no alto. Com a ordem invertida nao casa nada.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BANCO_INI = 0x69B000;
const BANCO_FIM = 0x8EA000;

/** Decodifica um PNG indexado (4 ou 8 bpp) para um byte de indice por pixel. */
function lerIndexado(arquivo) {
  const b = fs.readFileSync(arquivo);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${arquivo}: nao e PNG`);

  const largura = b.readUInt32BE(16);
  const altura = b.readUInt32BE(20);
  const bits = b[24];
  const tipoCor = b[25];

  if (tipoCor !== 3) {
    throw new Error(`${arquivo}: color type ${tipoCor}, esperado 3 (indexado).\n` +
      '  O sprite view do mGBA exporta indexado; outra origem pode nao servir.');
  }

  const idat = [];
  let paleta = null;
  let o = 8;
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const tipo = b.slice(o + 4, o + 8).toString('latin1');
    if (tipo === 'PLTE') paleta = b.slice(o + 8, o + 8 + len);
    else if (tipo === 'IDAT') idat.push(b.slice(o + 8, o + 8 + len));
    else if (tipo === 'IEND') break;
    o += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bytesPorLinha = Math.ceil(largura * bits / 8);
  const px = Buffer.alloc(largura * altura);
  let anterior = Buffer.alloc(bytesPorLinha);

  for (let y = 0; y < altura; y++) {
    const filtro = raw[y * (bytesPorLinha + 1)];
    const linha = Buffer.from(raw.slice(y * (bytesPorLinha + 1) + 1,
                                        y * (bytesPorLinha + 1) + 1 + bytesPorLinha));
    // Desfaz o filtro do PNG. Em indexado o "pixel anterior" e 1 byte atras.
    for (let i = 0; i < bytesPorLinha; i++) {
      const a = i >= 1 ? linha[i - 1] : 0;
      const c = anterior[i];
      const d = i >= 1 ? anterior[i - 1] : 0;
      if (filtro === 1) linha[i] = (linha[i] + a) & 255;
      else if (filtro === 2) linha[i] = (linha[i] + c) & 255;
      else if (filtro === 3) linha[i] = (linha[i] + ((a + c) >> 1)) & 255;
      else if (filtro === 4) {
        const p = a + c - d;
        const pa = Math.abs(p - a), pb = Math.abs(p - c), pc = Math.abs(p - d);
        linha[i] = (linha[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d)) & 255;
      }
    }
    for (let x = 0; x < largura; x++) {
      px[y * largura + x] = bits === 4
        ? ((x & 1) ? (linha[x >> 1] & 15) : (linha[x >> 1] >> 4))
        : linha[x];
    }
    anterior = linha;
  }

  return { largura, altura, bits, paleta, px };
}

/** Um tile 8x8 em 4bpp do GBA: nibble BAIXO e o pixel par. */
function tile4bpp(img, tx, ty) {
  const t = Buffer.alloc(32);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x += 2) {
      const a = img.px[(ty * 8 + y) * img.largura + tx * 8 + x] & 15;
      const b = img.px[(ty * 8 + y) * img.largura + tx * 8 + x + 1] & 15;
      t[y * 4 + (x >> 1)] = (b << 4) | a;
    }
  }
  return t;
}

function main() {
  const arquivo = process.argv[2];
  const romPath = process.argv[3] || path.resolve(__dirname, '..', 'rom.gba');

  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error('uso: node tools/ffta-vram/achar-na-rom.js <sprite.png> [rom.gba]');
    process.exit(1);
  }
  if (!fs.existsSync(romPath)) {
    console.error(`ROM nao encontrada em ${romPath}`);
    console.error('A ROM nao e versionada (material comercial).');
    process.exit(1);
  }

  const img = lerIndexado(arquivo);
  const rom = fs.readFileSync(romPath);

  console.log(`${path.basename(arquivo)}: ${img.largura}x${img.altura}, ${img.bits}bpp`);
  console.log(`tiles: ${img.largura / 8}x${img.altura / 8}\n`);

  const achados = [];
  for (let ty = 0; ty < img.altura / 8; ty++) {
    for (let tx = 0; tx < img.largura / 8; tx++) {
      const t = tile4bpp(img, tx, ty);
      const naoZero = [...t].filter((v) => v !== 0).length;

      /*
       * Tile quase vazio casa em qualquer lugar por coincidencia -- um tile
       * com 1 byte nao-zero apareceu num offset 5 MB longe dos vizinhos.
       * Abaixo de 8 bytes o resultado nao significa nada.
       */
      if (naoZero < 8) {
        console.log(`  tile(${tx},${ty})  ${String(naoZero).padStart(2)} bytes uteis  -- vazio demais, ignorado`);
        continue;
      }

      const p = rom.indexOf(t);
      achados.push({ tx, ty, p, naoZero });
      console.log(`  tile(${tx},${ty})  ${String(naoZero).padStart(2)} bytes uteis  ` +
        (p >= 0 ? `0x${p.toString(16).toUpperCase()}` : 'nao achado'));
    }
  }

  const bons = achados.filter((a) => a.p >= 0).sort((a, b) => a.p - b.p);
  console.log();

  if (!bons.length) {
    console.log('Nenhum tile localizado.');
    console.log('  - o sprite pode ser montado de tiles espalhados (nao contiguos)');
    console.log('  - ou a arte dele esta comprimida, ao contrario da maioria');
    return;
  }

  const base = bons[0].p;
  console.log(`SPRITE EM 0x${base.toString(16).toUpperCase()}`);

  const dentro = base >= BANCO_INI && base < BANCO_FIM;
  console.log(`  ${dentro ? 'dentro' : 'FORA'} do banco de sprites ` +
    `(0x${BANCO_INI.toString(16).toUpperCase()}-0x${BANCO_FIM.toString(16).toUpperCase()})`);

  if (bons.length > 1) {
    const saltos = bons.slice(1).map((a, i) => a.p - bons[i].p);
    const contiguo = saltos.every((s) => s === 32);
    console.log(`  tiles ${contiguo ? 'CONSECUTIVOS' : 'espalhados'} (saltos: ${saltos.join(', ')})`);
  }

  console.log();
  console.log('Para ver a vizinhanca (sprites do mesmo conjunto ficam juntos):');
  console.log(`  node tools/ffta-vram/ver-regiao.js 0x${base.toString(16).toUpperCase()} ${arquivo}`);
}

main();
