'use strict';
/*
 * Gera o world.otbm a partir do height map de UM mapa do Final Fantasy
 * Tactics Advance, extraido de tools/rom.gba.
 *
 *   node tools/datapack-gen/gen-map-ffta.js [indice]
 *
 * Por padrao usa o mapa 0, que e o unico com o layout totalmente decodificado
 * e conferido. Ver a analise em .claude/skills/ffta-map/SKILL.md.
 *
 * COMO O MAPA DO FFTA E MONTADO
 *
 * Cada um dos 163 mapas tem TRES streams comprimidos independentes
 * (tools/extracted/maps-index.json): Graphics, Arrangement e HeightMap.
 *
 * O visual e 2D achatado -- o arrangement e um grid retangular de 128x64 com
 * tiles de 4x8 px, desenhado a mao por mapa. NAO sao tiles isometricos
 * reutilizaveis, entao nao da para "importar a arte" do FFTA.
 *
 * O que E reaproveitavel e o HEIGHT MAP: altura logica por celula, que no
 * jogo original vira o losango isometrico (RenderHeightMap usa meias-extensoes
 * 16x8 -- os mesmos TILE_HALF_W/H que o nosso client usa, e a altura entra
 * como levantamento vertical puro, que e o nosso FLOOR_LIFT).
 *
 * FORMATO DO HEIGHT MAP (decodificado e verificado no mapa 0)
 *
 *   [u16 ?] [u16 ~28]           4 bytes de cabecalho
 *   por celula: [u8 altura] [u8 flag]
 *
 * O stride e 16 celulas por linha, mas as ULTIMAS COLUNAS nao sao terreno:
 * contem enderecos (no mapa 0 a coluna 14 vai 32, 64, 96, 128... de 32 em 32).
 * O proprio RenderHeightMap.cs tem o comentario "don't render first 2 lines of
 * dump. it's addresses, not values" e pula essas colunas.
 */

const fs = require('fs');
const path = require('path');
const { Node, buildFile } = require('./otb-common');
const { decompress } = require('../ffta-extract/gfx.js');
const { mapTileIds } = require('../asset-compiler/map-assets.js');


// --- OTBM (iomap.h) ---
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

// --- ground ids (ver tools/asset-compiler) ---
const GRASS = 100;
const SAND = 101;
const STONE = 102;

// --- height map ---
const HM_STRIDE = 16;      // celulas por linha no stream
const HM_TERRAIN_COLS = 14; // as 2 ultimas sao enderecos, nao terreno

/*
 * O mapa do FFTA e pequeno (14x14 no mapa 0). Cada celula vira um bloco
 * SCALE x SCALE de tiles do OTBM: sem isso o mundo inteiro caberia dentro da
 * area visivel do client (18x14) e nao daria para andar.
 */
// Isto ja foi 4. A escala fazia sentido quando o chao eram 3 texturas
// genericas e o mapa 16x13 cabia inteiro na area visivel do client (18x14):
// replicar cada celula num bloco 4x4 dava espaco para andar.
//
// Com os tiles recortados da referencia a escala passou a ATRAPALHAR. Cada
// celula tem a sua propria arte de 32x32, entao estampa-la em 16 tiles
// repete o desenho e destroi a correspondencia 1:1 com o Aisenfield -- na
// tela vira um descampado chapado, sem relevo e sem as bordas de pedra.
const SCALE = 1;

/*
 * O MAPA INTEIRO FICA NUM ANDAR SO.
 *
 * A altura do FFTA nao vira mais z. Ela vira pilha de itens com altura, um
 * item por unidade, e quem levanta na tela e o elevation de cada um
 * (Tile::drawGround no client).
 *
 * Antes a altura era repartida entre z e elevation. Nao funcionou, e os dois
 * motivos so aparecem com o jogo aberto:
 *
 * 1. O client desenha UM andar por vez e escolhe quais mostrar em
 *    MapView::calcFirstVisibleFloor. Aqui os andares sao relevo do MESMO
 *    terreno, nao pavimentos de um predio, entao a regra de corte apagava
 *    pedaco do mapa -- na tela o terreno saía chapado, so com o andar da
 *    camera visivel.
 * 2. FLOOR_LIFT (16px) e PX_PER_HEIGHT (8px) so fecham a conta com
 *    exatamente 2 unidades por andar, uma amarra geometrica que nada mais
 *    justificava.
 *
 * CONSEQUENCIA NO SERVER, e ela e de proposito: Game::internalMoveCreature so
 * troca de andar cruzando z (game.cpp:1676), e com um z so esse trecho fica
 * inerte -- nada bloqueia subir um barranco. Subir degrau deixa de ser regra
 * de mapa e passa a ser regra de jogo. Tile::hasHeight(n) continua contando a
 * pilha, que agora E a altura da celula, entao a primitiva para escrever essa
 * regra depois esta pronta.
 */
const BASE_Z = 7;

/** Escolhe o chao pela altura -- so para o relevo ficar legivel na tela. */
function groundForHeight(h) {
  if (h <= 2) return SAND;    // partes baixas
  if (h <= 6) return GRASS;   // meio
  return STONE;               // partes altas
}

/**
 * Carrega assets/mapdata/mapN.json, se existir.
 *
 * E o que o extract-map-tiles.js gera: por celula, o indice do tile
 * recortado da imagem de referencia. Com isso o mapa usa a ARTE do FFTA em
 * vez dos 3 chaos genericos.
 */
function loadMapData(mapIndex) {
  const f = path.resolve(__dirname, "../../assets/mapdata/map" + mapIndex + ".json");
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function loadHeightMap(mapIndex) {
  const romPath = path.resolve(__dirname, '../rom.gba');
  const idxPath = path.resolve(__dirname, '../extracted/maps-index.json');

  if (!fs.existsSync(romPath)) {
    throw new Error(`rom.gba nao encontrada em ${romPath}`);
  }

  const rom = fs.readFileSync(romPath);
  const index = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  const rec = index.maps[mapIndex];
  if (!rec) throw new Error(`mapa ${mapIndex} nao existe (0..${index.maps.length - 1})`);

  const out = decompress(rom, parseInt(rec.heightMapOffset, 16));
  if (!out || !out.data) {
    throw new Error(`mapa ${mapIndex}: heightmap nao descomprimiu (tipo 0x${(out && out.type || 0).toString(16)})`);
  }

  const data = out.data;
  const cells = (data.length - 4) / 2;
  const rows = Math.floor(cells / HM_STRIDE);

  // Quantas colunas sao terreno de verdade.
  //
  // Isto era fixo em 14 ("as 2 ultimas sao enderecos"), o que vale para o
  // mapa 0 mas NAO para todos: o mapa 150 tem terreno nas 16 colunas, e
  // cortar duas deixava o OTBM mais estreito que a arte extraida -- as duas
  // ultimas colunas do Aisenfield simplesmente nao existiam no mundo.
  //
  // Uma coluna de ENDERECO cresce de 32 em 32 a cada linha (mod 256).
  // Terreno nao faz isso. Mesma deteccao do extract-map-tiles.js.
  const at = (r, c) => data[4 + (r * HM_STRIDE + c) * 2];
  let cols = HM_STRIDE;
  if (rows > 2) {
    for (let c = HM_STRIDE - 1; c >= 8; c--) {
      let isAddr = true;
      for (let r = 1; r < rows; r++) {
        if (((at(r - 1, c) + 32) & 0xff) !== at(r, c)) { isAddr = false; break; }
      }
      if (isAddr) cols = c; else break;
    }
  }

  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(at(r, c));
    grid.push(row);
  }

  return { grid, rows, cols, offset: rec.heightMapOffset };
}

function buildOtbm(hm, refData, tileIds, deco2Ids) {
  const mapW = hm.cols * SCALE;
  const mapH = hm.rows * SCALE;

  // z de cada celula, ja convertido
  const zOf = [];
  let minZ = 15, maxZ = 0;
  for (let r = 0; r < hm.rows; r++) {
    const row = [];
    for (let c = 0; c < hm.cols; c++) {
      // Um andar so: a altura nao entra aqui, entra na pilha de itens.
      const z = BASE_Z;
      row.push(z);
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    zOf.push(row);
  }

  const root = new Node(0);
  root.props.u32(OTBM_VERSION).u16(mapW).u16(mapH).u32(MAJOR_ITEMS).u32(MINOR_ITEMS);

  const mapData = root.child(OTBM_MAP_DATA);
  mapData.props.u8(OTBM_ATTR_EXT_SPAWN_FILE).string(SPAWN_FILE);
  mapData.props.u8(OTBM_ATTR_EXT_HOUSE_FILE).string(HOUSE_FILE);

  /*
   * Um TILE_AREA do OTBM e de UM z so (iomap.cpp: a area declara u16 x, u16 y,
   * u8 z). Como aqui cada celula pode ter um z diferente, agrupamos os tiles
   * por z e emitimos uma area por andar.
   */
  const byZ = new Map();
  for (let r = 0; r < hm.rows; r++) {
    for (let c = 0; c < hm.cols; c++) {
      const z = zOf[r][c];
      // Usa o tile recortado da referencia quando existir; senao cai nos
      // 3 chaos genericos por faixa de altura.
      let ground = groundForHeight(hm.grid[r][c]);
      if (refData && tileIds && refData.grid[r] && refData.grid[r][c]) {
        const t = refData.grid[r][c].tile;
        if (t !== null && tileIds.has(t)) ground = tileIds.get(t);
      }
      /*
       * A altura da celula vira uma pilha de itens INVISIVEIS, antes do tile.
       *
       * O server conta ITENS, nao pixels: Tile::hasHeight(n) percorre a pilha
       * e conta os que tem CONST_PROP_HASHEIGHT (server/src/tile.cpp:127).
       *
       * Ja foram copias do proprio tile, e cada copia desenhava: com 48px de
       * face lateral e 8px de passo, a de baixo sobrava por baixo da de cima
       * -- face listrada e uma saia extra sob o mapa. Invisiveis, elas so
       * empurram o contador de elevacao, e o tile de verdade, que vai por
       * ultimo, e desenhado UMA vez na altura certa. Ver map-assets.js.
       */
      // Camada 2: decoracao, quando a celula tiver. Celula sem decoracao
      // simplesmente nao ganha item nenhum -- 117 das 208 no Aisenfield.
      let deco = null;
      if (refData && deco2Ids && refData.grid[r] && refData.grid[r][c]) {
        const t2 = refData.grid[r][c].tile2;
        if (t2 !== null && t2 !== undefined && deco2Ids.has(t2)) deco = deco2Ids.get(t2);
      }
      const stack = refData && refData.grid[r] && refData.grid[r][c]
        ? (refData.grid[r][c].elevation || 0)
        : 0;

      if (!byZ.has(z)) byZ.set(z, []);
      const list = byZ.get(z);
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          list.push({ x: c * SCALE + sx, y: r * SCALE + sy, ground, stack, deco });
        }
      }
    }
  }

  let tileCount = 0;
  for (const [z, tiles] of [...byZ.entries()].sort((a, b) => a[0] - b[0])) {
    // Os offsets de tile dentro da area sao u8, entao a area cobre 256x256.
    // Nossos mapas sao bem menores que isso, mas emitimos uma area por z.
    const area = mapData.child(OTBM_TILE_AREA);
    area.props.u16(0).u16(0).u8(z);
    for (const t of tiles) {
      const tile = area.child(OTBM_TILE);
      tile.props.u8(t.x).u8(t.y);
      const item = tile.child(OTBM_ITEM);
      item.props.u16(t.ground);
      // A decoracao vai por ultimo. No client ela e ThingAttrOnTop e sai em
      // Tile::drawTop, depois das criaturas.
      if (t.deco !== null && t.deco !== undefined) {
        const d = tile.child(OTBM_ITEM);
        d.props.u16(t.deco);
      }
      tileCount++;
    }
  }

  /*
   * A temple TEM que cair num tile que existe, senao loadPlayer falha e
   * ninguem loga. Escolhemos o centro e usamos o z real daquela celula.
   */
  const tr = Math.floor(hm.rows / 2);
  const tc = Math.floor(hm.cols / 2);
  const temple = {
    x: tc * SCALE + Math.floor(SCALE / 2),
    y: tr * SCALE + Math.floor(SCALE / 2),
    z: zOf[tr][tc],
  };

  const towns = mapData.child(OTBM_TOWNS);
  const town = towns.child(OTBM_TOWN);
  town.props.u32(1).string('Temple').u16(temple.x).u16(temple.y).u8(temple.z);

  return { buffer: buildFile(root), tileCount, mapW, mapH, temple, minZ, maxZ, floors: byZ.size };
}

function main() {
  const mapIndex = process.argv[2] ? parseInt(process.argv[2], 10) : 0;
  const hm = loadHeightMap(mapIndex);

  console.log(`mapa FFTA ${mapIndex} (heightmap ${hm.offset})`);
  console.log(`grade ${hm.cols}x${hm.rows} celulas, escala ${SCALE}x`);
  console.log('relevo (altura por celula):');
  for (const row of hm.grid) {
    console.log('  ' + row.map((h) => String(h).padStart(2)).join(' '));
  }

  const mapData = loadMapData(mapIndex);
  const tileIds = mapData ? mapTileIds(mapIndex, 1) : null;
  const deco2Ids = mapData ? mapTileIds(mapIndex, 2) : null;
  if (mapData) {
    console.log("mapdata: " + mapData.cols + "x" + mapData.rows + " celulas, " + tileIds.size + " tiles com id");
  } else {
    console.log("sem assets/mapdata -- usando os 3 chaos genericos");
  }

  const r = buildOtbm(hm, mapData, tileIds, deco2Ids);

  const outDir = path.resolve(__dirname, '../../server/data/world');
  fs.writeFileSync(path.join(outDir, 'world.otbm'), r.buffer);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  fs.writeFileSync(path.join(outDir, SPAWN_FILE), `${xml}<spawns/>\n`);
  fs.writeFileSync(path.join(outDir, HOUSE_FILE), `${xml}<houses/>\n`);

  console.log();
  console.log(`world.otbm ${(r.buffer.length / 1024).toFixed(1)} KB, ${r.tileCount} tiles, ${r.mapW}x${r.mapH}`);
  console.log(`andares: ${r.floors} (z ${r.minZ}..${r.maxZ})`);
  console.log(`temple (${r.temple.x},${r.temple.y},${r.temple.z})`);
}

if (require.main === module) main();

module.exports = { loadHeightMap, buildOtbm, SCALE, BASE_Z };
