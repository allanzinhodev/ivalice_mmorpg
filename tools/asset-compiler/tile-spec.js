'use strict';
/*
 * tile-spec.js -- a classificacao dos tiles de terreno, em UM lugar so.
 *
 * O compilador (.dat/.spr) e o gerador de itens (.otb) leem daqui. Manter a
 * classificacao em dois lugares e como o hasHeight divergiu antes: o client
 * achava que um item era de um jeito, o server de outro, e o sintoma
 * aparecia longe da causa.
 *
 * TRES PROPRIEDADES, INDEPENDENTES ENTRE SI
 *
 *   walkable       da para pisar. Vira FLAG_BLOCK_SOLID no .otb quando falso.
 *   displacement   conta como degrau. Vira FLAG_HAS_HEIGHT no .otb.
 *   water          e agua. Vira ThingAttrWater no .dat, e faz a criatura
 *                  sobre ela desenhar com zPattern 2.
 *
 * Elas nao andam juntas: uma planta e andavel mas nao e degrau; uma pedra
 * alta nao e andavel e mesmo assim ocupa altura.
 */

/**
 * Faixas na ordem em que foram ditadas. A busca e do FIM para o comeco, para
 * que uma excecao (o 36) sobreponha a faixa que a contem (22-40).
 */
const FAIXAS = [
  // ground
  { de: 0, ate: 21, tipo: 'ground', walkable: true, displacement: true },
  { de: 25, ate: 26, tipo: 'ground', walkable: true, displacement: true },

  // grass
  { de: 22, ate: 24, tipo: 'grass', walkable: true, displacement: true },
  { de: 27, ate: 40, tipo: 'grass', walkable: true, displacement: true },
  // ... com uma excecao no meio: grama alta, nao se anda sobre ela
  { de: 36, ate: 36, tipo: 'grass', walkable: false, displacement: true },

  // plant: da para pisar, mas nao e degrau
  { de: 41, ate: 47, tipo: 'plant', walkable: true, displacement: false },

  // stone baixo: nao se anda nem conta altura
  { de: 48, ate: 60, tipo: 'stone', walkable: false, displacement: false },

  // stone alto: ocupa altura, e so alguns sao andaveis
  { de: 61, ate: 81, tipo: 'stone', walkable: false, displacement: true },

  /*
   * water: ANDAVEL, e nunca degrau.
   *
   * Andavel de proposito. A spec original dizia que agua bloqueia, mas o
   * recurso de "personagem na agua" -- que troca a outfit para o zPattern 2,
   * o indice que antes era da montaria -- pressupoe que da para pisar nela.
   * As duas regras se excluiam, e esta ganhou.
   *
   * 82-85 sao UMA animacao so (quatro fases do mesmo tile), o resto sao
   * tiles distintos. Para a classificacao dao no mesmo; a diferenca importa
   * quando o compilador montar os frames.
   */
  { de: 82, ate: 114, tipo: 'water', walkable: true, displacement: false, water: true },
];

/** Os unicos andaveis da faixa 61-81. O resto dela bloqueia. */
const STONE_ANDAVEL = new Set([61, 62, 63, 66, 69, 70, 77]);

/** A animacao de agua: quatro tiles que sao fases do mesmo. */
const WATER_ANIM = { de: 82, ate: 85 };

/**
 * Classifica um tile pelo numero.
 *
 * Devolve null para numero fora das faixas -- o chamador decide se isso e
 * erro ou um tile que ainda nao foi classificado.
 */
function classificar(n) {
  let achado = null;
  // De tras para frente: a excecao do 36 vem depois da faixa 27-40 e precisa
  // ganhar dela.
  for (let i = FAIXAS.length - 1; i >= 0; i--) {
    const f = FAIXAS[i];
    if (n >= f.de && n <= f.ate) { achado = f; break; }
  }
  if (!achado) return null;

  let walkable = achado.walkable;
  if (achado.tipo === 'stone' && n >= 61 && n <= 81) {
    walkable = STONE_ANDAVEL.has(n);
  }

  return {
    tipo: achado.tipo,
    walkable,
    displacement: achado.displacement,
    water: !!achado.water,
    animado: n >= WATER_ANIM.de && n <= WATER_ANIM.ate,
  };
}

/** O numero do tile a partir do nome do arquivo, ou null. */
function numeroDe(arquivo) {
  const m = /^tile_(\d+)\.png$/i.exec(arquivo);
  return m ? parseInt(m[1], 10) : null;
}

/** Classifica pelo nome do arquivo. null se nao for um tile_NNN.png. */
function classificarArquivo(arquivo) {
  const n = numeroDe(arquivo);
  return n === null ? null : classificar(n);
}

module.exports = { classificar, classificarArquivo, numeroDe, FAIXAS, STONE_ANDAVEL, WATER_ANIM };
