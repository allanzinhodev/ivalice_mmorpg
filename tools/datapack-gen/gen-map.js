'use strict';
/*
 * Gera data/world/world.otbm -- mapa plano 1024x1024, 1 andar (z=7),
 * em quadrantes de grass/sand/stone, sem monstros e sem houses.
 *
 * Referencias no server:
 *   iomap.h:38-56    OTBM_NodeTypes_t
 *   iomap.h:13-36    OTBM_AttrTypes_t
 *   iomap.h:66-73    OTBM_root_header (16 bytes, packed)
 *   iomap.cpp:253-284 validacao do header
 *   iomap.cpp:305-321 MAP_DATA so aceita TILE_AREA/TOWNS/WAYPOINTS
 *   iomap.cpp:425-441 TILE_AREA: u16 base_x, u16 base_y, u8 z
 *   iomap.cpp:648-691 TOWNS/TOWN
 *
 * Decisoes importantes:
 * - Usamos no filho OTBM_ITEM (FE 06) e NAO o atributo inline 09, porque o
 *   parser inline consome o resto do stream da tile (mapcache.cpp:711-713).
 * - Emitimos uma town com id 1: sem ela TODO login falha em
 *   iologindata.cpp:576-581 ("Town ID 1 doesn't exist").
 */

const fs = require('fs');
const path = require('path');
const { Props, Node, buildFile } = require('./otb-common');

// --- OTBM_NodeTypes_t (iomap.h:38-56) ---
const OTBM_MAP_DATA = 2;
const OTBM_TILE_AREA = 4;
const OTBM_TILE = 5;
const OTBM_ITEM = 6;
const OTBM_TOWNS = 12;
const OTBM_TOWN = 13;

// --- OTBM_AttrTypes_t (iomap.h:13-36) ---
const OTBM_ATTR_EXT_SPAWN_FILE = 11;
const OTBM_ATTR_EXT_HOUSE_FILE = 13;

// --- parametros do mapa ---
const MAP_WIDTH = 1024;
const MAP_HEIGHT = 1024;
const MAP_Z = 7; // andar do "chao" no padrao Tibia
const AREA_SIZE = 256; // offsets de tile sao u8 -> chunk 256x256

const OTBM_VERSION = 2; // 1 ou 2; 2 habilita WAYPOINTS
const MAJOR_ITEMS = 3; // tem que casar com o items.otb
const MINOR_ITEMS = 20; // CLIENT_VERSION_860

const SPAWN_FILE = 'world-spawn.xml';
const HOUSE_FILE = 'world-house.xml';

const TOWN_ID = 1;
const TOWN_NAME = 'Temple';
const TEMPLE = { x: 512, y: 512, z: MAP_Z };

// ids de chao (client id == server id, ver gen-items.js)
const GRASS = 1;
const SAND = 2;
const STONE = 3;

/**
 * Quadrantes: divide o mapa em faixas verticais de um terco.
 * Contiguo de proposito -- fica obvio na tela se a projecao/alinhamento
 * estiver errado.
 */
function groundIdFor(x, _y) {
  const third = MAP_WIDTH / 3;
  if (x < third) return GRASS;
  if (x < third * 2) return SAND;
  return STONE;
}

function buildOtbm() {
  const root = new Node(0); // o no raiz do OTBM tambem tem type byte 0

  // OTBM_root_header: u32 version, u16 width, u16 height, u32 major, u32 minor
  root.props
    .u32(OTBM_VERSION)
    .u16(MAP_WIDTH)
    .u16(MAP_HEIGHT)
    .u32(MAJOR_ITEMS)
    .u32(MINOR_ITEMS);

  const mapData = root.child(OTBM_MAP_DATA);
  // Caminhos de spawn/house sao resolvidos relativos ao diretorio do .otbm
  // (iomap.cpp:403,413). Emitir explicitamente evita o fallback relativo ao CWD.
  mapData.props.u8(OTBM_ATTR_EXT_SPAWN_FILE).string(SPAWN_FILE);
  mapData.props.u8(OTBM_ATTR_EXT_HOUSE_FILE).string(HOUSE_FILE);

  let tileCount = 0;
  for (let baseY = 0; baseY < MAP_HEIGHT; baseY += AREA_SIZE) {
    for (let baseX = 0; baseX < MAP_WIDTH; baseX += AREA_SIZE) {
      const area = mapData.child(OTBM_TILE_AREA);
      area.props.u16(baseX).u16(baseY).u8(MAP_Z);

      for (let dy = 0; dy < AREA_SIZE; dy++) {
        for (let dx = 0; dx < AREA_SIZE; dx++) {
          const tile = area.child(OTBM_TILE);
          tile.props.u8(dx).u8(dy);
          const item = tile.child(OTBM_ITEM);
          item.props.u16(groundIdFor(baseX + dx, baseY + dy));
          tileCount++;
        }
      }
    }
  }

  // Town id 1 -- obrigatoria para o login funcionar.
  const towns = mapData.child(OTBM_TOWNS);
  const town = towns.child(OTBM_TOWN);
  town.props
    .u32(TOWN_ID)
    .string(TOWN_NAME)
    .u16(TEMPLE.x)
    .u16(TEMPLE.y)
    .u8(TEMPLE.z);

  return { buffer: buildFile(root), tileCount };
}

function main() {
  const outDir = path.resolve(__dirname, '../../server/data/world');
  if (!fs.existsSync(outDir)) {
    throw new Error(`diretorio nao encontrado: ${outDir}`);
  }

  const { buffer, tileCount } = buildOtbm();
  fs.writeFileSync(path.join(outDir, 'world.otbm'), buffer);

  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
  fs.writeFileSync(path.join(outDir, SPAWN_FILE), `${xmlHeader}<spawns/>\n`);
  fs.writeFileSync(path.join(outDir, HOUSE_FILE), `${xmlHeader}<houses/>\n`);

  const mb = (buffer.length / 1048576).toFixed(2);
  console.log(`world.otbm  ${mb} MB, ${tileCount} tiles, ${MAP_WIDTH}x${MAP_HEIGHT} z=${MAP_Z}`);
  console.log(`town ${TOWN_ID} "${TOWN_NAME}" temple=(${TEMPLE.x},${TEMPLE.y},${TEMPLE.z})`);
  console.log(`${SPAWN_FILE} e ${HOUSE_FILE} vazios (sem monstros, sem houses)`);
}

if (require.main === module) main();

module.exports = { buildOtbm, TEMPLE, TOWN_ID };
