'use strict';
/*
 * A regra de atribuicao de id dos ground items, num lugar so.
 *
 * Tres ferramentas precisam concordar sobre qual id e qual tile -- o
 * compile.js (que escreve o .dat), o gen-items.js (que escreve o items.otb) e
 * o gen-map-ffta.js (que escreve o .otbm). As tres liam o diretorio por conta
 * propria e repetiam a mesma convencao, e divergir significava mapa com id
 * que o server nao conhece: "Failed to create item" e o mapa nem carrega.
 *
 *
 * O ITEM DE ALTURA
 *
 * A altura de uma celula e uma PILHA de itens: Tile::hasHeight(n) conta os
 * que tem CONST_PROP_HASHEIGHT (server/src/tile.cpp:127), e e assim que o
 * server sabe quao alto o terreno e.
 *
 * Mas empilhar copias do proprio tile, que era o que se fazia, desenha a arte
 * N vezes. Cada copia tem 48px de face lateral e fica 8px acima da anterior,
 * entao a de baixo SOBRA por baixo da de cima: a face do bloco sai listrada e
 * o mapa ganha uma saia extra embaixo. Na tela parece uma segunda camada
 * desenhada por baixo da primeira -- que e exatamente o que era.
 *
 * A pilha e informacao de JOGO, nao de desenho. Entao os itens de altura
 * passam a ser INVISIVEIS (sprite id 0) e o tile de verdade vai por ULTIMO:
 *
 *   [altura] [altura] ... [tile]
 *
 * Tile::drawGround desenha cada thing com a elevacao ACUMULADA ate ali e so
 * depois soma a dele (client/src/client/tile.cpp). Os invisiveis nao pintam
 * nada e so empurram o contador; quando chega no tile, a elevacao ja e a
 * altura inteira da celula. Resultado: a arte aparece UMA vez, na altura
 * certa, e o server continua contando a pilha como antes.
 */

const fs = require('fs');
const path = require('path');

const ITEMS_DIR = path.resolve(__dirname, '../../assets/items');

/** O primeiro id de item do .dat. Os ids 1..99 sao reservados pelo formato
 *  (thingtypemanager.cpp usa firstId = 100). */
const FIRST_ITEM_ID = 100;

/** Os PNGs de assets/items/, na ordem que define os ids. */
function listItemFiles(dir = ITEMS_DIR) {
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
}

/*
 * Nome de tile de mapa:  NNN-map<mapa>[L<camada>]-<tile>.png
 *
 *   200-map150-7.png     camada 1 -- o terreno
 *   200-map150L2-7.png   camada 2 -- a decoracao que fica POR CIMA
 *
 * A camada 1 nao leva marca por ser a que ja existia; renomear os 181
 * arquivos dela so para ficar simetrico trocaria todos os ids e invalidaria
 * qualquer mapa gravado.
 */
const RE_TILE = /-map(\d+)(?:L(\d+))?-(\d+)\.png$/i;

function isMapTile(file) {
  return RE_TILE.test(file);
}

/** { map, layer, tile } do arquivo, ou null se nao for tile de mapa. */
function mapIndexOf(file) {
  const m = file.match(RE_TILE);
  return m ? { map: Number(m[1]), layer: m[2] ? Number(m[2]) : 1, tile: Number(m[3]) } : null;
}

/**
 * A camada 2 e DECORACAO: pedra, arbusto, tufo de grama.
 *
 * Ela nao e chao -- nao se anda sobre ela, e ela nao carrega altura. No
 * client vira ThingAttrOnTop, que Tile::drawTop desenha DEPOIS das criaturas;
 * e o que faz a pedra passar na frente do personagem em vez de sumir atras
 * dele.
 */
function isDecoration(file) {
  const m = mapIndexOf(file);
  return !!m && m.layer === 2;
}

/**
 * O id do item de altura invisivel.
 *
 * Vem DEPOIS de todos os arquivos, de proposito: assim acrescentar ou tirar
 * um tile nao renumera nada que ja esteja num mapa gravado.
 */
function heightFillerId(files) {
  return FIRST_ITEM_ID + files.length;
}

/** Mapa de "indice do tile daquele mapa" -> id de item. */
function mapTileIds(mapIndex, layer = 1, files = listItemFiles()) {
  const ids = new Map();
  files.forEach((f, i) => {
    const m = mapIndexOf(f);
    if (m && m.map === mapIndex && m.layer === layer) ids.set(m.tile, FIRST_ITEM_ID + i);
  });
  return ids;
}

module.exports = {
  ITEMS_DIR, FIRST_ITEM_ID,
  listItemFiles, isMapTile, isDecoration, mapIndexOf, heightFillerId, mapTileIds,
};
