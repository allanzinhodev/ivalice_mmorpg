'use strict';
/*
 * Testes da ordem de fatiamento.  Rodar:  node --test tools/asset-compiler/
 *
 * O teste que importa e o ultimo: ele reimplementa a formula do client a
 * partir do codigo-fonte dele e exige que `slice` case. Se alguem "arrumar" a
 * ordem em mosaic.js sem mexer no client, este teste quebra.
 */

const test = require('node:test');
const assert = require('node:assert');
const { Image } = require('./png.js');
const { slice, cellPosition } = require('./mosaic.js');

/** Imagem em que cada celula de `cell` px tem uma cor unica e reconhecivel. */
function imagemMarcada(cols, rows, cell) {
  const img = Image.blank(cols * cell, rows * cell);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const marca = r * cols + c + 1;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const o = ((r * cell + y) * img.width + (c * cell + x)) * 4;
          img.pixels[o] = marca;
          img.pixels[o + 3] = 255;
        }
      }
    }
  }
  return img;
}

const marcaDe = (celula) => celula.pixels[0];

test('recusa imagem que nao e multipla da celula', () => {
  assert.throws(() => slice(Image.blank(30, 16), 8), /nao e multipla/);
  assert.throws(() => slice(Image.blank(32, 20), 8), /nao e multipla/);
});

test('indice 0 e a celula inferior-direita', () => {
  const cell = 8;
  const { cells, cols, rows } = slice(imagemMarcada(4, 2, cell), cell);
  assert.strictEqual(cols, 4);
  assert.strictEqual(rows, 2);
  // marcas: linha de cima 1..4, linha de baixo 5..8. Inferior-direita = 8.
  assert.strictEqual(marcaDe(cells[0]), 8);
});

test('o indice anda da direita para a esquerda, de baixo para cima', () => {
  const cell = 8;
  const { cells } = slice(imagemMarcada(4, 2, cell), cell);
  assert.deepStrictEqual(cells.map(marcaDe), [8, 7, 6, 5, 4, 3, 2, 1]);
});

test('cellPosition e a inversa de slice: remontar devolve a original', () => {
  for (const [cols, rows, cell] of [[4, 2, 8], [1, 2, 32], [4, 8, 8], [1, 1, 32]]) {
    const original = imagemMarcada(cols, rows, cell);
    const { cells } = slice(original, cell);

    const remontada = Image.blank(cols * cell, rows * cell);
    cells.forEach((c, i) => {
      const { x, y } = cellPosition(i, cols, rows, cell);
      remontada.blit(c, x, y);
    });

    assert.deepStrictEqual(remontada.pixels, original.pixels,
      `remontagem falhou em ${cols}x${rows} celulas de ${cell}`);
  }
});

test('casa com a formula do ThingType::getTexture do client', () => {
  /*
   * Transcrito de client/src/client/thingtype.cpp:
   *   spriteIndex = getSpriteIndex(w, h, ...) = (... * H + h) * W + w
   *   spritePos   = Point(W - w - 1, H - h - 1) * spriteSize
   *
   * Para um unico frame (layers/patterns/fase todos em 0) o indice se reduz a
   * h * W + w, que e exatamente o laco de `slice`.
   */
  const cell = 8, W = 4, H = 2;
  const { cells } = slice(imagemMarcada(W, H, cell), cell);

  for (let h = 0; h < H; h++) {
    for (let w = 0; w < W; w++) {
      const indice = h * W + w;
      const posClient = { x: (W - w - 1) * cell, y: (H - h - 1) * cell };
      assert.deepStrictEqual(cellPosition(indice, W, H, cell), posClient,
        `celula ${indice} (w=${w}, h=${h}) nao cai onde o client desenha`);
    }
  }
});
