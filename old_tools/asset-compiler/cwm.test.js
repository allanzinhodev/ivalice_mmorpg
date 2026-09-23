'use strict';
/* Rodar:  node --test tools/asset-compiler/cwm.test.js */

const test = require('node:test');
const assert = require('node:assert');
const { Image } = require('./png.js');
const { buildCwm, readCwm } = require('./cwm.js');

function solido(size, r, g, b) {
  const img = Image.blank(size, size);
  for (let i = 0; i < size * size; i++) {
    img.pixels[i * 4] = r;
    img.pixels[i * 4 + 1] = g;
    img.pixels[i * 4 + 2] = b;
    img.pixels[i * 4 + 3] = 255;
  }
  return img;
}

test('round-trip: o que foi gravado e o que se le de volta', () => {
  const sprites = [null, solido(8, 10, 0, 0), solido(8, 20, 0, 0), solido(8, 30, 0, 0)];
  const lido = readCwm(buildCwm(sprites, 8));

  assert.strictEqual(lido.spriteSize, 8);
  assert.strictEqual(lido.count, 3);
  assert.deepStrictEqual([...lido.sprites.keys()].sort((a, b) => a - b), [1, 2, 3]);
  for (const png of lido.sprites.values()) {
    assert.deepStrictEqual(png.subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'nao e PNG');
  }
});

test('sprite vazio nao e gravado, e o id continua valendo', () => {
  // O id 2 e transparente: sai do arquivo, mas 1 e 3 mantem seus ids.
  const sprites = [null, solido(8, 10, 0, 0), Image.blank(8, 8), solido(8, 30, 0, 0)];
  const lido = readCwm(buildCwm(sprites, 8));

  assert.strictEqual(lido.count, 2);
  assert.deepStrictEqual([...lido.sprites.keys()].sort((a, b) => a - b), [1, 3]);
});

test('recusa sprite com tamanho diferente do declarado', () => {
  assert.throws(() => buildCwm([null, solido(32, 1, 1, 1)], 8), /esperado 8x8/);
});

test('o offset e relativo ao fim da tabela, nao ao inicio do arquivo', () => {
  /*
   * E a armadilha do formato: `loadCwmSpr` faz seek(pos + offset) com
   * pos = tell() depois da tabela. Se gravassemos offset absoluto, o primeiro
   * sprite ainda "funcionaria" por acaso quando a tabela fosse pequena, e os
   * outros viriam corrompidos. Fixamos aqui: o primeiro offset e 0.
   */
  const buf = buildCwm([null, solido(8, 1, 2, 3), solido(8, 4, 5, 6)], 8);
  const primeiroOffset = buf.readUInt32LE(7);
  assert.strictEqual(primeiroOffset, 0);

  // e o segundo comeca exatamente onde o primeiro acaba
  const primeiroTamanho = buf.readUInt32LE(11);
  const nomeLen = buf.readUInt16LE(15);
  assert.strictEqual(buf.readUInt32LE(17 + nomeLen), primeiroTamanho);
});

test('o nome da entrada e o id em decimal', () => {
  // PngUnpacker faz std::stoi(nome) e usa como chave; nome nao-numerico quebra.
  const buf = buildCwm([null, null, null, solido(8, 1, 1, 1)], 8);
  const nomeLen = buf.readUInt16LE(15);
  const nome = buf.subarray(17, 17 + nomeLen).toString('ascii');
  assert.strictEqual(nome, '3');
});
