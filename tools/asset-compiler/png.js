'use strict';
/*
 * Leitura e escrita de PNG em RGBA, sem dependencias externas.
 *
 * Suporta o que o Aseprite exporta: 8 bits por canal, color type 6 (RGBA) e
 * 2 (RGB), com os cinco filtros do PNG. Nao suporta paleta (type 3) nem
 * interlace -- se aparecer, o erro e explicito em vez de sair imagem torta.
 */

const fs = require('fs');
const zlib = require('zlib');

/** Imagem RGBA: pixels em Buffer, 4 bytes por pixel, origem no topo-esquerda. */
class Image {
  constructor(width, height, pixels) {
    this.width = width;
    this.height = height;
    this.pixels = pixels || Buffer.alloc(width * height * 4);
  }

  static blank(width, height) {
    return new Image(width, height);
  }

  offset(x, y) {
    return (y * this.width + x) * 4;
  }

  /** Alpha do pixel (0 = transparente). */
  alphaAt(x, y) {
    return this.pixels[this.offset(x, y) + 3];
  }

  isEmpty() {
    for (let i = 3; i < this.pixels.length; i += 4) {
      if (this.pixels[i] !== 0) return false;
    }
    return true;
  }

  /** Recorta uma regiao. Partes fora da imagem saem transparentes. */
  crop(x0, y0, w, h) {
    const out = Image.blank(w, h);
    for (let y = 0; y < h; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= this.height) continue;
      for (let x = 0; x < w; x++) {
        const sx = x0 + x;
        if (sx < 0 || sx >= this.width) continue;
        this.pixels.copy(out.pixels, out.offset(x, y), this.offset(sx, sy), this.offset(sx, sy) + 4);
      }
    }
    return out;
  }

  /** Espelha horizontalmente -- e assim que Norte e Leste sao gerados. */
  flipX() {
    const out = Image.blank(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const src = this.offset(this.width - 1 - x, y);
        this.pixels.copy(out.pixels, out.offset(x, y), src, src + 4);
      }
    }
    return out;
  }

  /** Cola `src` nesta imagem em (dx, dy), respeitando os limites. */
  blit(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        const so = src.offset(x, y);
        src.pixels.copy(this.pixels, this.offset(tx, ty), so, so + 4);
      }
    }
  }
}

// -------------------------------------------------------------- leitura

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function readPNG(file) {
  return decodePNG(fs.readFileSync(file), file);
}

/*
 * Mesmo decodificador, a partir de um buffer. E assim que os sprites chegam
 * no .cwm, que guarda PNG empacotado em vez de pixels crus -- ler de volta o
 * que escrevemos exige decodificar sem passar por arquivo.
 */
function decodePNG(buf, file = '<buffer>') {
  if (buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${file}: nao e um PNG`);
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];

  if (bitDepth !== 8) throw new Error(`${file}: bit depth ${bitDepth}, esperado 8`);
  if (interlace !== 0) throw new Error(`${file}: PNG interlaced nao e suportado`);
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`${file}: color type ${colorType}, esperado 6 (RGBA) ou 2 (RGB)`);
  }
  const channels = colorType === 6 ? 4 : 3;

  const chunks = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') chunks.push(buf.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));

  // Desfiltra linha a linha. Os filtros referenciam o pixel a esquerda (a),
  // o de cima (b) e o diagonal (c) -- ja desfiltrados.
  const stride = width * channels;
  const lines = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? lines[y * stride + x - channels] : 0;
      const b = y > 0 ? lines[(y - 1) * stride + x] : 0;
      const c = (x >= channels && y > 0) ? lines[(y - 1) * stride + x - channels] : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
        default: throw new Error(`${file}: filtro ${filter} invalido na linha ${y}`);
      }
      lines[y * stride + x] = v & 0xff;
    }
  }

  const img = Image.blank(width, height);
  if (channels === 4) {
    lines.copy(img.pixels);
  } else {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      img.pixels[i * 4] = lines[j];
      img.pixels[i * 4 + 1] = lines[j + 1];
      img.pixels[i * 4 + 2] = lines[j + 2];
      img.pixels[i * 4 + 3] = 255;
    }
  }
  return img;
}

// -------------------------------------------------------------- escrita

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Escreve RGBA sem filtro (type 0) -- basta para os facesets. */
function encodePNG(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // filtro adaptativo
  ihdr[12] = 0;  // sem interlace

  const stride = img.width * 4;
  const raw = Buffer.alloc(img.height * (stride + 1));
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    img.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePNG(file, img) {
  fs.writeFileSync(file, encodePNG(img));
}

module.exports = { Image, readPNG, decodePNG, writePNG, encodePNG };
