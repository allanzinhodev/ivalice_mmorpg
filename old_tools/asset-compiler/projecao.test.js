'use strict';
/* Rodar:  node --test tools/asset-compiler/projecao.test.js */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CONST_H = path.resolve(__dirname, '../../client/src/client/const.h');

/**
 * As constantes saem do proprio const.h, nao de copias aqui.
 *
 * Um teste que redeclara `TILE_HALF_W = 16` continua passando depois de
 * alguem trocar o valor no C++ -- ele testaria a copia, nao o jogo.
 */
function constanteDoHeader(nome) {
  const fonte = fs.readFileSync(CONST_H, 'utf8');
  const m = fonte.match(new RegExp(nome + '\\s*=\\s*(\\d+)'));
  assert.ok(m, `${nome} nao encontrada em const.h`);
  return Number(m[1]);
}

const HW = constanteDoHeader('TILE_HALF_W');
const HH = constanteDoHeader('TILE_HALF_H');

// Centro do framebuffer. O valor nao importa -- projecao e inversa usam o
// mesmo -- mas ser diferente de zero pega erro de origem esquecida.
const OX = 1000, OY = 600;

/** MapView::transformPositionTo2D */
function projetar(col, row) {
  return { x: OX + (col - row) * HW, y: OY + (col + row) * HH };
}

/** MapView::getPosition -- floor em float, nao divisao inteira. */
function inverter(sx, sy) {
  const fx = (sx - OX) / HW;
  const fy = (sy - OY) / HH;
  return { col: Math.floor((fx + fy) / 2), row: Math.floor((fy - fx) / 2) };
}

test('a inversa devolve o tile que a projecao gerou, nos quatro quadrantes', () => {
  for (let row = -40; row <= 40; row++) {
    for (let col = -40; col <= 40; col++) {
      // O vertice superior e a fronteira entre dois losangos; um pixel para
      // dentro pertence sem ambiguidade a este tile.
      const p = projetar(col, row);
      const r = inverter(p.x, p.y + 1);
      assert.deepStrictEqual(r, { col, row },
        `tile (${col},${row}) voltou como (${r.col},${r.row})`);
    }
  }
});

test('todo pixel cai no losango do tile que a inversa aponta', () => {
  // A tesselacao nao pode ter folga nem sobreposicao: o ponto tem que estar
  // dentro do losango com vertice superior no `dest` do tile escolhido --
  // a mesma inequacao que o gen-things.js usa para rasterizar o chao.
  for (let sy = OY - 300; sy < OY + 300; sy += 3) {
    for (let sx = OX - 600; sx < OX + 600; sx += 3) {
      const t = inverter(sx, sy);
      const p = projetar(t.col, t.row);
      const dx = sx - p.x, dy = sy - p.y;
      const dentro = dx + 2 * dy >= 0 && dx + 2 * dy < 2 * HW
                  && 2 * dy - dx >= 0 && 2 * dy - dx < 2 * HW;
      assert.ok(dentro,
        `(${sx},${sy}) virou tile (${t.col},${t.row}), delta (${dx},${dy}) fora do losango`);
    }
  }
});

test('truncar em vez de floor erraria o tile a esquerda/acima da camera', () => {
  /*
   * Este teste guarda a razao de o codigo usar std::floor em float.
   *
   * Divisao inteira trunca em direcao a zero: -0.5 vira 0, nao -1. A camera
   * fica no centro, entao metade da tela tem col/row negativos -- e la o
   * truncamento devolve o tile vizinho. Se alguem "simplificar" o floor para
   * divisao inteira, este teste cai.
   */
  let divergencias = 0;
  for (let sy = OY - 300; sy < OY + 300; sy += 3) {
    for (let sx = OX - 600; sx < OX + 600; sx += 3) {
      const fx = (sx - OX) / HW, fy = (sy - OY) / HH;
      const comFloor = [Math.floor((fx + fy) / 2), Math.floor((fy - fx) / 2)];
      const comTrunc = [Math.trunc((fx + fy) / 2), Math.trunc((fy - fx) / 2)];
      if (comFloor[0] !== comTrunc[0] || comFloor[1] !== comTrunc[1]) {
        divergencias++;
        // Onde diverge, e sempre porque ao menos um eixo e negativo.
        assert.ok(fx + fy < 0 || fy - fx < 0,
          `divergencia em (${sx},${sy}) com ambos os eixos positivos`);
      }
    }
  }
  assert.ok(divergencias > 0,
    'nenhuma divergencia: o teste nao esta cobrindo o quadrante negativo');
});

test('o passo de elevacao e -8px em Y, sem componente em X', () => {
  const STEP = constanteDoHeader('ELEVATION_STEP');
  assert.strictEqual(STEP, HH,
    'um nivel de elevacao tem que subir exatamente meia altura de tile');
});
