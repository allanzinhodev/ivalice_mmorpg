'use strict';
/*
 * paletas.js -- as paletas de cor das unidades do FFTA2.
 *
 * Elas existem para substituir o set-outfit: em vez das 4 cores multiplicadas
 * por mascara que o Tibia usa (shadersources.h), aqui cada variante de
 * aparencia e uma paleta inteira, do jeito que o GBA/NDS faz.
 *
 *
 * DE ONDE VEM
 *
 * Duas fontes, e elas batem exatamente:
 *
 *   1. o no `dataType` 240 da arvore do UnitSst  -- BGR555, 2 bytes por cor
 *   2. o chunk PLTE dos PNG exportados pelo editor
 *
 * Verificado nas 32 cores da unidade 0: identicas, desde que a conversao
 * BGR555 -> RGB888 seja por TRUNCAMENTO (`floor(c * 255 / 31)`). Arredondar
 * erra 26 das 32 cores por uma unidade -- o bastante para o dedup por bytes
 * exatos deixar de casar.
 *
 *
 * QUANTAS
 *
 * Cada unidade tem de 1 a 12 paletas (as subpastas de `Unit Sprites/<n>/`).
 * A distribuicao medida nas 324 unidades: 64 com uma so, 114 com duas, 104
 * com tres, e uma cauda ate 12.
 */

const fs = require('fs');
const path = require('path');
const { SPRITES } = require('./fontes.js');
const { lerPNGIndexado } = require('./png-indexado.js');

/** BGR555 -> [r,g,b]. Trunca, como o editor. */
function bgr555(v) {
  return [
    Math.floor((v & 31) * 255 / 31),
    Math.floor(((v >> 5) & 31) * 255 / 31),
    Math.floor(((v >> 10) & 31) * 255 / 31),
  ];
}

/** As cores de um bloco BGR555 do .pak. */
function paletaDoPak(buf) {
  const cores = [];
  for (let k = 0; k * 2 + 1 < buf.length; k++) {
    cores.push(bgr555(buf.readUInt16LE(k * 2)));
  }
  return cores;
}

/**
 * As paletas de uma unidade, lidas dos PNG exportados.
 *
 * Devolve uma lista de listas de cores. O indice de cada paleta e o nome da
 * subpasta, que e o que o jogo usa para escolher a variante.
 */
function paletasDaUnidade(unidade, { primeiraCor = 224, quantidade = 32 } = {}) {
  const dir = path.join(SPRITES, String(unidade));
  if (!fs.existsSync(dir)) return [];

  const subs = fs.readdirSync(dir)
    .filter((n) => fs.statSync(path.join(dir, n)).isDirectory())
    .map((n) => parseInt(n, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  const saida = [];
  for (const s of subs) {
    const pngs = fs.readdirSync(path.join(dir, String(s)))
      .filter((n) => n.endsWith('.png'));
    if (!pngs.length) continue;

    const img = lerPNGIndexado(path.join(dir, String(s), pngs[0]));
    const cores = [];
    for (let k = 0; k < quantidade; k++) cores.push(img.cor(primeiraCor + k));
    saida.push({ indice: s, cores });
  }
  return saida;
}

/** Todas as paletas, prontas para virar JSON. */
function todasAsPaletas() {
  const unidades = fs.readdirSync(SPRITES)
    .map((n) => parseInt(n, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  const saida = {};
  for (const u of unidades) {
    const p = paletasDaUnidade(u);
    if (p.length) saida[u] = p;
  }
  return saida;
}

module.exports = { bgr555, paletaDoPak, paletasDaUnidade, todasAsPaletas };
