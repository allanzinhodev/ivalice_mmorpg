'use strict';
/*
 * gen-map-test.js -- mapa de teste da logica isometrica.
 *
 *   node tools/datapack-gen/gen-map-test.js
 *
 * Nao e um mapa bonito: e um banco de provas. Cada zona existe para
 * exercitar uma coisa que precisa ser vista na tela.
 *
 *   chao plano        a projecao em losango e a caminhada nas 8 direcoes
 *   escada 0..5       o JUMP: com 4, o degrau de 4 passa e o de 5 barra
 *   agua              o zPattern 2 da criatura
 *   pedras            o bloqueio (FLAG_BLOCK_SOLID)
 *   plantas           pisavel mas sem degrau
 *
 * Um andar so (z = MAP_Z). A altura NAO e o z do OTBM: e uma PILHA de itens
 * com FLAG_HAS_HEIGHT, que e o que Tile::hasHeight(n) conta
 * (server/src/tile.cpp:127) e o que o JUMP do personagem compara.
 *
 * Grava em server/data/world E sincroniza para server/build/data/world --
 * o server roda com working directory em build/, e aquela arvore e uma
 * COPIA. Esquecer a copia faz ele servir o mapa antigo sem erro nenhum.
 */

const fs = require('fs');
const path = require('path');
const { Node, buildFile } = require('./otb-common');
const { classificar } = require('../asset-compiler/tile-spec.js');

// --- formato (server/src/iomap.h) ---
const OTBM_MAP_DATA = 2;
const OTBM_TILE_AREA = 4;
const OTBM_TILE = 5;
const OTBM_ITEM = 6;
const OTBM_TOWNS = 12;
const OTBM_TOWN = 13;
const OTBM_ATTR_EXT_SPAWN_FILE = 11;
const OTBM_ATTR_EXT_HOUSE_FILE = 13;
const OTBM_VERSION = 2;
const MAJOR_ITEMS = 3;
const MINOR_ITEMS = 20;

const SPAWN_FILE = 'world-spawn.xml';
const HOUSE_FILE = 'world-house.xml';

const MAP_W = 64;
const MAP_H = 64;
const MAP_Z = 7;
const AREA_SIZE = 256;   // os offsets de tile dentro da area sao u8

const TOWN_ID = 1;
const TOWN_NAME = 'Temple';
const TEMPLE = { x: 8, y: 8, z: MAP_Z };

// Os ids seguem a ordem alfabetica de assets/items/, comecando em 100 --
// a mesma regra do compile.js e do gen-items.js. Como os arquivos sao
// tile_000..tile_114, o id do tile N e 100 + N.
/*
 * Os ids seguem a lista expandida do tile-spec: cada tile que e degrau gera
 * DOIS itens -- o ground e o gemeo `#bloco`, empilhavel. Calcular o id por
 * `100 + n` so valia quando era um item por PNG.
 */
const { expandirItens, ehBloco, numeroDe } = require('../asset-compiler/tile-spec.js');

const FIRST_ID = 100;

const LISTA = (() => {
  const dir = path.resolve(__dirname, '../../assets/items');
  const pngs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  return expandirItens(pngs);
})();

/** id do item de CHAO do tile n. */
function idDoTile(n) {
  const alvo = 'tile_' + String(n).padStart(3, '0') + '.png';
  const i = LISTA.indexOf(alvo);
  if (i < 0) throw new Error('tile ' + n + ' nao esta na lista de itens');
  return FIRST_ID + i;
}

/** id do BLOCO empilhavel do tile n, ou null se ele nao for degrau. */
function idDoBloco(n) {
  const alvo = 'tile_' + String(n).padStart(3, '0') + '.png#bloco';
  const i = LISTA.indexOf(alvo);
  return i < 0 ? null : FIRST_ID + i;
}

/** Um representante de cada tipo, escolhido entre os que a spec classifica. */
function escolher(tipo, querAndavel) {
  for (let n = 0; n <= 114; n++) {
    const c = classificar(n);
    if (c && c.tipo === tipo && (querAndavel === undefined || c.walkable === querAndavel)) {
      return n;
    }
  }
  throw new Error(`nenhum tile ${tipo} andavel=${querAndavel}`);
}

const GROUND = escolher('ground', true);
const GRASS = escolher('grass', true);
const GRASS_ALTO = escolher('grass', false);   // o 36
const PLANT = escolher('plant', true);
const STONE_BAIXO = escolher('stone', false);
const STONE_ANDAVEL = escolher('stone', true);
/*
 * A agua do mapa e o tile 90, nao o primeiro water da lista.
 *
 * Os tiles 82-85 sao a ANIMACAO de espuma: tem 6 a 9 pixels opacos cada, e
 * pintam quase nada. Escolhidos como chao, o mapa aparece com buracos pretos
 * onde deveria haver agua -- foi o que aconteceu.
 */
const WATER = 90;

/**
 * O que cada celula do mapa contem.
 *
 * Devolve { ground, altura } -- a altura e quantos itens EXTRA empilhar,
 * cada um contando como um nivel para o hasHeight.
 */
function celula(x, y) {
  /*
   * DEGRAUS AO LADO DO NASCIMENTO (temple em 8,8).
   *
   * Nao e escada para outro andar -- aqui nao existem andares. E pilha de
   * itens no MESMO tile: cada item com displacement e um nivel, e cada nivel
   * empurra o personagem 8px para cima na tela.
   *
   * Uma coluna de 1 a 6 niveis logo a direita do nascimento. Com JUMP=4:
   * sobe ate o de 4, barra no de 5. E descer de qualquer altura e livre.
   */
  if (x >= 10 && x <= 15 && y === 8) {
    return { ground: GROUND, altura: x - 9 };   // 1,2,3,4,5,6
  }

  /*
   * DEGRAUS ABRUPTOS, para testar o limite do JUMP.
   *
   * A rampa acima sobe de 1 em 1, entao nunca exercita o teto: qualquer JUMP
   * >= 1 vence todos os degraus dela. Aqui o salto e do chao (altura 0)
   * direto para a altura alvo, na coluna y=10:
   *
   *   (10,10) altura 4  -> subida 4: com JUMP=4, PASSA (no limite)
   *   (12,10) altura 5  -> subida 5: com JUMP=4, BARRA
   *
   * Os vizinhos ficam no chao de proposito, para a subida ser a altura
   * inteira do degrau.
   */
  if (y === 10 && (x === 10 || x === 12)) {
    return { ground: GROUND, altura: x === 10 ? 4 : 5 };
  }

  /*
   * PILHA ALTA, para provar que nao ha limite.
   *
   * 12 niveis = 96px de deslocamento. O client guardava a elevacao num
   * uint8 com teto em 248; com pilha sem limite o tipo passou a int.
   */
  // Fora da poca (x 6..10, y 10..12) de proposito: as duas zonas se
  // sobrepunham e a agua, testada depois, ganhava -- a pilha existia no
  // OTBM mas nunca aparecia na tela.
  if (x === 14 && y === 14) {
    return { ground: GROUND, altura: 12 };
  }

  // Campo de alturas variadas, para ver o relevo de longe e testar o jump
  // entre tiles vizinhos de alturas diferentes.
  if (x >= 20 && x < 32 && y >= 8 && y < 24) {
    const degrau = Math.floor((x - 20) / 2);   // 0..5
    return { ground: GROUND, altura: Math.min(degrau, 5) };
  }

  /*
   * POCA DE AGUA AO LADO DO NASCIMENTO.
   *
   * O lago grande fica em y 30..45, longe demais para conferir o zPattern
   * sem caminhar. Esta fica a dois passos abaixo do temple (8,8): pisando
   * nela, a outfit deve trocar para o terceiro padrao -- o indice que antes
   * era da montaria.
   */
  if (x >= 6 && x <= 10 && y >= 10 && y <= 12) {
    return { ground: WATER, altura: 0 };
  }

  // Lago grande: x 8..19, y 30..45.
  if (x >= 8 && x < 20 && y >= 30 && y < 46) {
    return { ground: WATER, altura: 0 };
  }

  // Muro de pedra baixa: uma linha que barra a passagem.
  if (y === 20 && x >= 4 && x < 16) {
    return { ground: STONE_BAIXO, altura: 0 };
  }

  // Pedras andaveis, para comparar com as bloqueadas ao lado.
  if (y === 22 && x >= 4 && x < 16) {
    return { ground: STONE_ANDAVEL, altura: 1 };
  }

  // Grama alta: pisavel? nao. Serve para ver bloqueio sem parecer parede.
  if (x >= 36 && x < 44 && y >= 8 && y < 16) {
    return { ground: GRASS_ALTO, altura: 0 };
  }

  // Canteiro de plantas: pisavel, mas NAO e degrau -- o personagem atravessa
  // sem subir.
  if (x >= 36 && x < 44 && y >= 20 && y < 28) {
    return { ground: PLANT, altura: 0 };
  }

  // O resto: grama no miolo, terra na borda, so para haver contraste.
  const borda = x < 4 || y < 4 || x >= MAP_W - 4 || y >= MAP_H - 4;
  return { ground: borda ? GROUND : GRASS, altura: 0 };
}

function buildOtbm() {
  const root = new Node(0);
  root.props.u32(OTBM_VERSION).u16(MAP_W).u16(MAP_H).u32(MAJOR_ITEMS).u32(MINOR_ITEMS);

  const mapData = root.child(OTBM_MAP_DATA);
  mapData.props.u8(OTBM_ATTR_EXT_SPAWN_FILE).string(SPAWN_FILE);
  mapData.props.u8(OTBM_ATTR_EXT_HOUSE_FILE).string(HOUSE_FILE);

  let tiles = 0, empilhados = 0;
  for (let baseY = 0; baseY < MAP_H; baseY += AREA_SIZE) {
    for (let baseX = 0; baseX < MAP_W; baseX += AREA_SIZE) {
      const area = mapData.child(OTBM_TILE_AREA);
      area.props.u16(baseX).u16(baseY).u8(MAP_Z);

      // Clampa: uma area maior que o mapa geraria tiles fora dos limites
      // declarados no header.
      const h = Math.min(AREA_SIZE, MAP_H - baseY);
      const w = Math.min(AREA_SIZE, MAP_W - baseX);

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const c = celula(baseX + dx, baseY + dy);
          const tile = area.child(OTBM_TILE);
          tile.props.u8(dx).u8(dy);

          tile.child(OTBM_ITEM).props.u16(idDoTile(c.ground));

          /*
           * A altura e uma PILHA, feita com o gemeo `#bloco`.
           *
           * NAO da para repetir o id do chao: o server aceita um ground por
           * tile e descarta o resto (Tile::internalAddThing, tile.cpp:1718).
           * O bloco tem a mesma arte e a mesma elevacao, mas sem
           * ThingAttrGround -- entao empilha.
           */
          const idBloco = idDoBloco(c.ground);
          if (c.altura > 0 && idBloco === null) {
            throw new Error('tile ' + c.ground + ' nao e degrau, nao pode empilhar');
          }
          for (let i = 0; i < c.altura; i++) {
            tile.child(OTBM_ITEM).props.u16(idBloco);
            empilhados++;
          }
          tiles++;
        }
      }
    }
  }

  // Town id 1 -- sem ela TODO login falha em iologindata.cpp.
  const towns = mapData.child(OTBM_TOWNS);
  towns.child(OTBM_TOWN).props
    .u32(TOWN_ID).string(TOWN_NAME)
    .u16(TEMPLE.x).u16(TEMPLE.y).u8(TEMPLE.z);

  return { buffer: buildFile(root), tiles, empilhados };
}

function main() {
  const raiz = path.resolve(__dirname, '../..');
  const outDir = path.join(raiz, 'server/data/world');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const r = buildOtbm();
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  fs.writeFileSync(path.join(outDir, 'world.otbm'), r.buffer);
  fs.writeFileSync(path.join(outDir, SPAWN_FILE), `${xml}<spawns/>\n`);
  fs.writeFileSync(path.join(outDir, HOUSE_FILE), `${xml}<houses/>\n`);

  console.log(`world.otbm  ${(r.buffer.length / 1024).toFixed(1)} KB, ${r.tiles} tiles`);
  console.log(`pilha       ${r.empilhados} itens de altura`);
  console.log(`temple      (${TEMPLE.x},${TEMPLE.y},${TEMPLE.z})`);
  console.log(`tiles usados: ground=${GROUND} grass=${GRASS} grassAlto=${GRASS_ALTO}`
    + ` plant=${PLANT} stoneBaixo=${STONE_BAIXO} stoneAndavel=${STONE_ANDAVEL} water=${WATER}`);

  // Sincroniza com a arvore de onde o server LE. Deixar manual ja custou uma
  // sessao: o server servia o mapa antigo sem erro nenhum.
  const build = path.join(raiz, 'server/build/data/world');
  if (fs.existsSync(build)) {
    for (const f of ['world.otbm', SPAWN_FILE, HOUSE_FILE]) {
      fs.copyFileSync(path.join(outDir, f), path.join(build, f));
    }
    console.log('sincronizado com server/build/data/world/');
  } else {
    console.log('AVISO: server/build/data/world nao existe -- o server nao vera este mapa');
  }
}

if (require.main === module) main();

module.exports = { celula, buildOtbm, MAP_W, MAP_H, MAP_Z };
