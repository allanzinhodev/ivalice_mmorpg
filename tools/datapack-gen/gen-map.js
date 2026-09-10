'use strict';
/*
 * Gera data/world/world.otbm -- mapa plano 1024x1024, 1 andar (z=7),
 * com grass/sand/stone embaralhados por tile, sem monstros e sem houses.
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
// Mundo pequeno de teste. Com 1024x1024 eram 1.048.576 tiles e ~10 MB de
// OTBM, o que deixava a geracao e o boot do server lentos sem necessidade
// para testar render/caminhada. 128x128 = 16.384 tiles, gera na hora.
//
// A aware range do client e 18x14, entao 128x128 ja e MUITO maior que a
// area visivel -- da para andar bastante sem chegar na borda.
const MAP_WIDTH = 128;
const MAP_HEIGHT = 128;
const MAP_Z = 7; // andar do "chao" no padrao Tibia
const AREA_SIZE = 256; // offsets de tile sao u8 -> chunk 256x256

const OTBM_VERSION = 2; // 1 ou 2; 2 habilita WAYPOINTS
const MAJOR_ITEMS = 3; // tem que casar com o items.otb
const MINOR_ITEMS = 20; // CLIENT_VERSION_860

const SPAWN_FILE = 'world-spawn.xml';
const HOUSE_FILE = 'world-house.xml';

const TOWN_ID = 1;
const TOWN_NAME = 'Temple';
// Centro do mapa. Derivado do tamanho de proposito: um valor fixo cairia
// fora se o mapa encolhesse, e a temple TEM que estar num tile andavel --
// senao loadPlayer falha e ninguem loga.
const TEMPLE = { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2), z: MAP_Z };

// ids de chao (client id == server id, ver gen-items.js)
const GRASS = 100;
const SAND = 101;
const STONE = 102;

const GROUNDS = [GRASS, SAND, STONE];

/**
 * Mistura os 3 chaos tile a tile, de forma DETERMINISTICA.
 *
 * Antes eram tres faixas verticais contiguas de um terco do mapa. Aquilo servia
 * para conferir alinhamento -- uma emenda reta denuncia projecao torta -- mas
 * atrapalha o teste de CAMINHADA: dentro de uma faixa todos os tiles sao
 * iguais, entao andar nao muda nada na tela e nao da para saber se o passo foi
 * para a direcao certa, nem se foi um passo so.
 *
 * Com o padrao embaralhado cada vizinhanca fica visualmente unica: um passo
 * desloca o padrao inteiro em exatamente uma celula, e a direcao do
 * deslocamento diz a direcao do passo. Na projecao isometrica isso importa
 * mais que no grid quadrado, porque +x e +y viram diagonais na tela
 * ((+16,+8) e (-16,+8)) e sao faceis de confundir uma com a outra.
 *
 * Deterministico de proposito (hash de x,y, sem Math.random): regerar o mapa
 * produz exatamente o mesmo arquivo, entao da para comparar dois runs e o
 * verify.js continua reprodutivel.
 */
function groundIdFor(x, y) {
  // Hash inteiro de 32 bits no estilo do finalizador do MurmurHash3. O
  // objetivo e so descorrelacionar x e y -- um `(x + y) % 3` faria faixas
  // diagonais, que na projecao isometrica sairiam alinhadas com os eixos da
  // tela e voltariam a nao dar referencia nenhuma.
  let h = (x * 0x1f1f1f1f) ^ y;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return GROUNDS[h % GROUNDS.length];
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

      // Clampa ao tamanho do mapa. Sem isto, um mapa que nao seja multiplo
      // exato de AREA_SIZE gera tiles FORA dos limites declarados no header
      // -- com 128x128 e AREA_SIZE 256 saiam 65.536 tiles em vez de 16.384.
      // Nao aparecia com 1024 porque 1024 e multiplo de 256.
      const areaH = Math.min(AREA_SIZE, MAP_HEIGHT - baseY);
      const areaW = Math.min(AREA_SIZE, MAP_WIDTH - baseX);

      for (let dy = 0; dy < areaH; dy++) {
        for (let dx = 0; dx < areaW; dx++) {
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
