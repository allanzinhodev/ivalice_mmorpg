'use strict';
/*
 * Escrita do Tibia.spr no formato que o client le em
 * SpriteManager::loadCasualSpr / getSpriteImage.
 *
 * Layout do arquivo:
 *   [u32 signature] [u32 count]         count e u32 porque GameSpritesU32 esta ligado
 *   [u32 offset] * count                offset 0 = sprite vazio
 *   por sprite: [u8 r][u8 g][u8 b]      color key (255,0,255)
 *               [u16 tamanho em bytes dos runs]
 *               runs ate preencher 32x32
 *
 * Cada run e: [u16 pixels transparentes] [u16 pixels coloridos] [RGBA * coloridos]
 *
 * PIXELS SAO RGBA (4 bytes), nao RGB. O .otfi declara `transparency: true` e o
 * client so le assim com GameSpritesAlphaChannel ligado. Com RGB o stream
 * dessincroniza e o sprite vira lixo -- foi o bug que deixou a tela preta.
 *
 * O decodificador do client EXIGE que os runs somem exatamente 32*32*4 = 4096
 * bytes; se sobrar ou faltar ele lanca "Incomplete sprite data".
 */

const SPRITE_SIZE = 32;
const SPRITE_PIXELS = SPRITE_SIZE * SPRITE_SIZE;
const SPRITE_DATA_SIZE = SPRITE_PIXELS * 4;

const COLOR_KEY = [255, 0, 255];

/**
 * Codifica uma Image 32x32 nos runs do .spr.
 * Devolve null se o sprite for totalmente transparente -- o chamador grava
 * offset 0 nesses casos, que e como o formato representa "sem sprite".
 */
function encodeSprite(img) {
  if (img.width !== SPRITE_SIZE || img.height !== SPRITE_SIZE) {
    throw new Error(`sprite tem que ser ${SPRITE_SIZE}x${SPRITE_SIZE}, veio ${img.width}x${img.height}`);
  }
  if (img.isEmpty()) return null;

  const out = [];
  let i = 0;
  while (i < SPRITE_PIXELS) {
    // conta transparentes
    let transparent = 0;
    while (i < SPRITE_PIXELS && img.pixels[i * 4 + 3] === 0) {
      transparent++;
      i++;
    }
    // conta coloridos
    const start = i;
    while (i < SPRITE_PIXELS && img.pixels[i * 4 + 3] !== 0) i++;
    const colored = i - start;

    // Um run so de transparentes no fim do sprite nao precisa ser gravado: o
    // decodificador para quando os runs acabam. Mas gravar tambem e valido, e
    // e o que mantem a conta fechando em 4096 -- por isso emitimos sempre.
    const head = Buffer.alloc(4);
    head.writeUInt16LE(transparent, 0);
    head.writeUInt16LE(colored, 2);
    out.push(head);

    if (colored > 0) {
      const px = Buffer.alloc(colored * 4);
      img.pixels.copy(px, 0, start * 4, (start + colored) * 4);
      out.push(px);
    }
  }

  return Buffer.concat(out);
}

/**
 * Decodifica de volta, espelhando getSpriteImage do client.
 * Serve de verificacao: o total escrito TEM que fechar em 4096.
 */
function decodeSprite(buf) {
  const pixels = Buffer.alloc(SPRITE_DATA_SIZE);
  let writePos = 0;
  let o = 0;
  while (o < buf.length) {
    if (buf.length - o < 4) throw new Error('run truncado');
    const transparent = buf.readUInt16LE(o); o += 2;
    const colored = buf.readUInt16LE(o); o += 2;

    writePos += transparent * 4;
    if (writePos > SPRITE_DATA_SIZE) throw new Error('run transparente estoura 4096');

    for (let i = 0; i < colored; i++) {
      if (writePos + 4 > SPRITE_DATA_SIZE) throw new Error('run colorido estoura 4096');
      buf.copy(pixels, writePos, o, o + 4);
      o += 4;
      writePos += 4;
    }
  }
  // NAO exigimos writePos == SPRITE_DATA_SIZE.
  //
  // O caminho de arquivo do client (SpriteManager::getSpriteImage) roda
  // `while (read < pixelDataSize && writePos < spriteDataSize)` e NAO tem
  // checagem final: transparencia no fim do sprite fica implicita, e o buffer
  // de pixels ja nasce zerado. Os sprites exportados do Aseprite terminam em
  // 4040 de 4096 exatamente por isso.
  //
  // O que nao pode e PASSAR de 4096 -- ai o client escreveria fora do buffer.
  // Isso e checado dentro do laco acima.
  return { pixels, writePos };
}

/**
 * Monta o arquivo .spr inteiro.
 * `sprites` e indexado a partir de 1 (o id 0 e "sem sprite"); buracos podem
 * ser null/undefined.
 */
function buildSpr(sprites, signature) {
  const count = sprites.length - 1; // indice 0 nao conta
  const table = Buffer.alloc(count * 4);
  const bodies = [];

  // offsets sao absolutos: 4 (signature) + 4 (count) + tabela
  let cursor = 4 + 4 + count * 4;

  for (let id = 1; id <= count; id++) {
    const img = sprites[id];
    if (!img) {
      table.writeUInt32LE(0, (id - 1) * 4);
      continue;
    }
    const data = encodeSprite(img);
    if (!data) {
      table.writeUInt32LE(0, (id - 1) * 4);
      continue;
    }

    // valida antes de gravar: melhor falhar aqui que no client
    decodeSprite(data);

    const head = Buffer.alloc(5);
    head[0] = COLOR_KEY[0];
    head[1] = COLOR_KEY[1];
    head[2] = COLOR_KEY[2];
    head.writeUInt16LE(data.length, 3);

    table.writeUInt32LE(cursor, (id - 1) * 4);
    bodies.push(head, data);
    cursor += head.length + data.length;
  }

  const header = Buffer.alloc(8);
  header.writeUInt32LE(signature >>> 0, 0);
  header.writeUInt32LE(count, 4);

  return Buffer.concat([header, table, ...bodies]);
}

/** Le um .spr de volta, para verificacao independente. */
function readSpr(buf) {
  const signature = buf.readUInt32LE(0);
  const count = buf.readUInt32LE(4);
  const sprites = [];
  for (let id = 1; id <= count; id++) {
    const off = buf.readUInt32LE(8 + (id - 1) * 4);
    if (off === 0) { sprites.push(null); continue; }
    const size = buf.readUInt16LE(off + 3);
    const data = buf.subarray(off + 5, off + 5 + size);
    sprites.push({ id, size, data });
  }
  return { signature, count, sprites };
}

module.exports = {
  SPRITE_SIZE, SPRITE_DATA_SIZE, COLOR_KEY,
  encodeSprite, decodeSprite, buildSpr, readSpr,
};
