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
const FIRST_ID = 100;
const idDoTile = (n) => FIRST_ID + n;

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
const WATER = escolher('water');

/**
 * O que cada celula do mapa contem.
 *
 * Devolve { ground, altura } -- a altura e quantos itens EXTRA empilhar,
 * cada um contando como um nivel para o hasHeight.
 */
function celula(x, y) {
  // Zona da escada: x 20..31, degraus de altura crescente a cada 2 colunas.
  // Com JUMP=4 o personagem sobe ate o degrau 4 e para no 5.
  if (x >= 20 && x < 32 && y >= 8 && y < 24) {
    const degrau = Math.floor((x - 20) / 2);   // 0,1,2,3,4,5
    return { ground: GROUND, altura: Math.min(degrau, 5) };
  }

  // Lago: x 8..19, y 30..45.
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

          // A altura e uma PILHA: cada item extra conta um nivel para o
          // hasHeight. Usa o mesmo id do chao -- o que importa e a contagem,
          // e repetir a arte deixa o degrau visivel na tela.
          for (let i = 0; i < c.altura; i++) {
            tile.child(OTBM_ITEM).props.u16(idDoTile(c.ground));
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
