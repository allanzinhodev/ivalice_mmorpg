'use strict';
/*
 * Escrita do Tibia.cwm -- o formato de sprites que aceita tamanho diferente
 * de 32x32.
 *
 *
 * POR QUE CWM E NAO .spr
 *
 * O plano novo usa sprites de 8x8 em mosaico. O `.spr` classico nao serve: o
 * 32 esta cravado no loader (spritemanager.cpp:70, :328, :465). Ja o loader
 * CWM (`loadCwmSpr`, :500-531) le o tamanho do sprite DO ARQUIVO e guarda os
 * sprites como PNG empacotado -- ou seja, o 8x8 sai sem tocar em C++.
 *
 * O dispatcher em SpriteManager::loadSpr (:60-85) escolhe CWM > OTV8 > .spr,
 * procurando pelo mesmo nome de arquivo com outra extensao. Entao basta
 * existir um Tibia.cwm ao lado do Tibia.spr para o client passar a usa-lo.
 * Nao ha flag: quem manda e o arquivo existir.
 *
 *
 * LAYOUT (lido de SpriteManager::loadCwmSpr + PngUnpacker::unpack)
 *
 *   [u8  versao = 0x01]
 *   [u16 spriteSize]                  em pixels; vira m_spriteSize direto
 *   [u32 quantidade]
 *   por entrada:  [u32 offset] [u32 tamanho] [u16 tamanho do nome] [nome]
 *   ...dados dos PNGs...
 *
 * Dois detalhes que o formato nao anuncia e que quebram em silencio:
 *
 * 1. O OFFSET E RELATIVO ao fim da tabela de metadados, nao ao inicio do
 *    arquivo. O loader guarda `pos = file->tell()` depois de ler a tabela e
 *    faz `seek(pos + offset)`.
 *
 * 2. O NOME E O ID DO SPRITE, em decimal. `PngUnpacker::unpack` faz
 *    `std::stoi(fileName)` e usa o resultado como chave. Nome que nao for
 *    numero derruba a leitura.
 *
 * Sprite ausente do mapa devolve nullptr em getSpriteImageHd, e o client ja
 * trata isso (`if (!spriteImage) continue`). Por isso celula vazia
 * simplesmente NAO e gravada -- e o equivalente ao offset 0 do .spr.
 */

const { encodePNG } = require('./png.js');

const CWM_VERSION = 0x01;

/**
 * Monta o arquivo .cwm inteiro.
 *
 * `sprites` e indexado a partir de 1, igual ao .spr -- o id 0 e "sem sprite".
 * Buracos podem ser null/undefined, e sprites totalmente transparentes sao
 * descartados.
 */
function buildCwm(sprites, spriteSize) {
  const metadata = [];
  const bodies = [];
  let cursor = 0;

  for (let id = 1; id < sprites.length; id++) {
    const img = sprites[id];
    if (!img || img.isEmpty()) continue;

    if (img.width !== spriteSize || img.height !== spriteSize) {
      throw new Error(
        `sprite ${id} tem ${img.width}x${img.height}, esperado ${spriteSize}x${spriteSize}`);
    }

    const png = encodePNG(img);
    const nome = Buffer.from(String(id), 'ascii');

    const head = Buffer.alloc(10 + nome.length);
    head.writeUInt32LE(cursor, 0);
    head.writeUInt32LE(png.length, 4);
    head.writeUInt16LE(nome.length, 8);
    nome.copy(head, 10);

    metadata.push(head);
    bodies.push(png);
    cursor += png.length;
  }

  const header = Buffer.alloc(7);
  header.writeUInt8(CWM_VERSION, 0);
  header.writeUInt16LE(spriteSize, 1);
  header.writeUInt32LE(metadata.length, 3);

  return Buffer.concat([header, ...metadata, ...bodies]);
}

/**
 * Le um .cwm de volta, espelhando loadCwmSpr + PngUnpacker::unpack.
 * Serve de verificacao independente: se isto nao remontar, o client tambem
 * nao remonta.
 */
function readCwm(buf) {
  const version = buf.readUInt8(0);
  if (version !== CWM_VERSION) throw new Error(`versao ${version}, esperado ${CWM_VERSION}`);

  const spriteSize = buf.readUInt16LE(1);
  const count = buf.readUInt32LE(3);

  let p = 7;
  const meta = [];
  for (let i = 0; i < count; i++) {
    const offset = buf.readUInt32LE(p);
    const size = buf.readUInt32LE(p + 4);
    const nameLen = buf.readUInt16LE(p + 8);
    const name = buf.subarray(p + 10, p + 10 + nameLen).toString('ascii');
    p += 10 + nameLen;
    meta.push({ offset, size, name });
  }

  const base = p; // o loader guarda `tell()` aqui e soma o offset a partir dele
  const sprites = new Map();
  for (const m of meta) {
    if (base + m.offset + m.size > buf.length) {
      throw new Error(`sprite ${m.name} passa do fim do arquivo`);
    }
    sprites.set(Number(m.name), buf.subarray(base + m.offset, base + m.offset + m.size));
  }

  return { version, spriteSize, count, sprites };
}

module.exports = { buildCwm, readCwm, CWM_VERSION };
