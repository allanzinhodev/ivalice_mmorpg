'use strict';
/*
 * png-indexado.js -- le PNG de paleta (color type 3) preservando o indice.
 *
 * O png.js do asset-compiler le RGBA e recusa color type 3. Aqui o indice
 * E o dado que interessa: as sprites do FFTA2 sao 32x48 8bpp indexadas, e o
 * plano e trocar a paleta em runtime no lugar do set-outfit. Converter para
 * RGBA jogaria fora exatamente a informacao que da a troca de cor.
 *
 * Suporta o que o editor exporta: bit depth 8, sem interlace.
 */

const fs = require('fs');
const zlib = require('zlib');

/** Imagem indexada: um byte por pixel, mais a paleta e a transparencia. */
class ImagemIndexada {
  constructor(largura, altura, indices, paleta, trns) {
    this.largura = largura;
    this.altura = altura;
    this.indices = indices;      // Buffer, 1 byte por pixel
    this.paleta = paleta;        // Buffer, 3 bytes por cor (RGB)
    this.trns = trns || Buffer.alloc(0);   // alpha por indice
  }

  indice(x, y) { return this.indices[y * this.largura + x]; }

  /** true se o indice e totalmente transparente. */
  transparente(i) { return i < this.trns.length && this.trns[i] === 0; }

  /** Recorta um bloco, devolvendo so os indices. */
  bloco(x0, y0, largura, altura) {
    const out = Buffer.alloc(largura * altura);
    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        const sx = x0 + x, sy = y0 + y;
        out[y * largura + x] =
          sx < this.largura && sy < this.altura ? this.indice(sx, sy) : 0;
      }
    }
    return out;
  }

  cor(i) {
    return [this.paleta[i * 3], this.paleta[i * 3 + 1], this.paleta[i * 3 + 2]];
  }
}

/*
 * Desfaz os filtros por linha do PNG.
 *
 * Com 8bpp indexado, bpp = 1, entao "o pixel a esquerda" e o byte anterior.
 */
function desfiltrar(bruto, largura, altura) {
  const bpp = 1;
  const saida = Buffer.alloc(largura * altura);
  let p = 0;
  let anterior = Buffer.alloc(largura);

  for (let y = 0; y < altura; y++) {
    const filtro = bruto[p++];
    const linha = Buffer.from(bruto.subarray(p, p + largura));
    p += largura;

    for (let x = 0; x < largura; x++) {
      const a = x >= bpp ? linha[x - bpp] : 0;
      const b = anterior[x];
      const c = x >= bpp ? anterior[x - bpp] : 0;

      switch (filtro) {
        case 0: break;
        case 1: linha[x] = (linha[x] + a) & 0xff; break;
        case 2: linha[x] = (linha[x] + b) & 0xff; break;
        case 3: linha[x] = (linha[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          linha[x] = (linha[x] + pred) & 0xff;
          break;
        }
        default:
          throw new Error(`filtro PNG desconhecido: ${filtro}`);
      }
    }

    linha.copy(saida, y * largura);
    anterior = linha;
  }
  return saida;
}

function lerPNGIndexado(caminho) {
  const b = fs.readFileSync(caminho);

  if (b.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${caminho}: nao e PNG`);
  }

  const largura = b.readUInt32BE(16);
  const altura = b.readUInt32BE(20);
  const profundidade = b[24];
  const tipoCor = b[25];
  const interlace = b[28];

  if (tipoCor !== 3) {
    throw new Error(`${caminho}: color type ${tipoCor}, esperava 3 (paleta)`);
  }
  if (profundidade !== 8) {
    throw new Error(`${caminho}: bit depth ${profundidade}, esperava 8`);
  }
  if (interlace !== 0) {
    throw new Error(`${caminho}: interlace nao suportado`);
  }

  let paleta = Buffer.alloc(0);
  let trns = Buffer.alloc(0);
  const dados = [];

  let p = 8;
  while (p < b.length) {
    const tamanho = b.readUInt32BE(p);
    const tipo = b.toString('ascii', p + 4, p + 8);
    const corpo = b.subarray(p + 8, p + 8 + tamanho);

    if (tipo === 'PLTE') paleta = Buffer.from(corpo);
    else if (tipo === 'tRNS') trns = Buffer.from(corpo);
    else if (tipo === 'IDAT') dados.push(corpo);
    else if (tipo === 'IEND') break;

    p += 12 + tamanho;
  }

  const bruto = zlib.inflateSync(Buffer.concat(dados));
  const indices = desfiltrar(bruto, largura, altura);

  return new ImagemIndexada(largura, altura, indices, paleta, trns);
}

module.exports = { ImagemIndexada, lerPNGIndexado };
