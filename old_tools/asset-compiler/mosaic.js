'use strict';
/*
 * Fatia uma imagem nas celulas de sprite que o .dat espera, NA ORDEM CERTA.
 *
 *
 * A ORDEM E DE TRAS PARA FRENTE, NOS DOIS EIXOS
 *
 * Esta e a regra que o resto do compilador precisa respeitar, e ela nao e
 * obvia. O client monta a textura assim
 * (ThingType::getTexture, client/src/client/thingtype.cpp):
 *
 *     spriteIndex = getSpriteIndex(w, h, ...)   // indice = (... * H + h) * W + w
 *     spritePos   = Point(W - w - 1, H - h - 1) * spriteSize
 *
 * Ou seja, o sprite de indice 0 (w=0, h=0) vai para a celula
 * INFERIOR-DIREITA, e o indice cresce da direita para a esquerda, de baixo
 * para cima. E a ordem classica do Tibia.
 *
 * O compilador vinha assumindo o contrario -- `sliceFrame` devolvia
 * [topo, baixo] com o comentario "a ordem e de CIMA para baixo". Com
 * height=2 o erro so trocava as duas metades (e como o boneco cabia inteiro
 * numa delas, aparecia apenas como um deslocamento vertical de 32px, que o
 * displacement mascarava). Num mosaico de 4x2 celulas o mesmo erro
 * embaralharia o tile inteiro, entao a regra virou codigo, com teste.
 *
 * Conferido lendo o binario: no Tibia.dat compilado, o outfit 1 tem
 * ids [0, 205, 0, 206, ...] -- o sprite VAZIO no indice 0. Como o boneco e
 * desenhado com os pes na base do quadro de 32x64, a metade vazia e a de
 * CIMA; estar no indice 0 confirma que o indice 0 e a celula de baixo.
 */

/**
 * Fatia `img` em celulas de `cell` x `cell`.
 *
 * Devolve as celulas na ordem do .dat (indice 0 = inferior-direita), junto
 * com a largura e altura em CELULAS, que sao o que vai nos campos
 * width/height do frame group.
 *
 * A imagem tem que ser multipla de `cell` nos dois eixos: um resto silencioso
 * cortaria pixels da arte.
 */
function slice(img, cell) {
  if (img.width % cell !== 0 || img.height % cell !== 0) {
    throw new Error(
      `imagem ${img.width}x${img.height} nao e multipla de ${cell}`);
  }

  const cols = img.width / cell;
  const rows = img.height / cell;

  const cells = [];
  for (let h = 0; h < rows; h++) {
    for (let w = 0; w < cols; w++) {
      cells.push(img.crop((cols - w - 1) * cell, (rows - h - 1) * cell, cell, cell));
    }
  }

  return { cells, cols, rows };
}

/**
 * Onde a celula de indice `i` vai parar na imagem remontada, em pixels.
 * Existe para o teste e para quem precisar reconstruir a imagem a partir das
 * celulas -- e a inversa exata de `slice`.
 */
function cellPosition(i, cols, rows, cell) {
  const w = i % cols;
  const h = Math.floor(i / cols);
  return { x: (cols - w - 1) * cell, y: (rows - h - 1) * cell };
}

module.exports = { slice, cellPosition };
