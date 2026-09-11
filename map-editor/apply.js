'use strict';
/*
 * apply.js -- aplica o mapdata editado direto no world.otbm e no items.otb.
 *
 *   node map-editor/apply.js [caminho/do/map150.json]
 *
 * Sem argumento usa assets/mapdata/map150.json. Com argumento, grava esse
 * arquivo por cima do oficial antes de gerar -- o fluxo normal e exportar do
 * editor para a pasta de downloads e apontar para la.
 *
 * POR QUE ESTE ARQUIVO EXISTE EM VEZ DO gen-map-ffta.js
 *
 * O gen-map-ffta.js le a ALTURA da ROM (tools/rom.gba, que nao e versionada).
 * Isso o torna inutil como destino do editor por dois motivos: quem clonar o
 * repo sem a ROM nao consegue gerar mapa, e -- pior -- ele ignoraria os
 * andares que voce acabou de editar, reimportando os originais do FFTA por
 * cima.
 *
 * Aqui a unica fonte e o mapdata. O que o editor grava e o que vai para o
 * jogo.
 *
 * O QUE CADA CAMPO VIRA
 *
 *   tile      -> id do item de terreno (camada 1)
 *   tile2     -> id do item de decoracao (camada 2, onTop)
 *   terreno   -> flag no items.otb: `block` vira FLAG_BLOCK_SOLID
 *   andar     -> altura da celula; hoje NAO entra no OTBM (ver abaixo)
 *
 * O ANDAR NAO VIRA z, E ISSO E DE PROPOSITO
 *
 * Tres mecanismos ja foram tentados e descartados (ver HANDOFF.md):
 * altura como z do OTBM, HEIGHT_PER_FLOOR, e pilha de itens com elevation.
 * O mapa inteiro fica num z so. O andar e gravado no mapdata, que E
 * versionado, e sera consumido quando a forma de expressar altura for
 * decidida -- o dado nao se perde.
 */

const fs = require('fs');
const path = require('path');
const { Node, buildFile } = require('../tools/datapack-gen/otb-common.js');
const { isDecoration, isMapTile } = require('../tools/asset-compiler/map-assets.js');

const ROOT = path.resolve(__dirname, '..');
const MAPDATA = path.join(ROOT, 'assets/mapdata/map150.json');
const WORLD_DIR = path.join(ROOT, 'server/data/world');
const ITEMS_DIR = path.join(ROOT, 'server/data/items');
const ITEMS_ASSETS = path.join(ROOT, 'assets/items');

// --- OTBM (server/src/iomap.cpp) ---
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

// Um andar so. Ver a nota no cabecalho.
const BASE_Z = 7;

// --- items.otb (server/src/itemloader.h) ---
const ROOT_ATTR_VERSION = 0x01;
const ITEM_GROUP_NONE = 0;
const ITEM_GROUP_GROUND = 1;
const ITEM_ATTR_SERVERID = 0x10;
const ITEM_ATTR_CLIENTID = 0x11;
const ITEM_ATTR_SPEED = 0x14;
const FLAG_BLOCK_SOLID = 1 << 0;
const FLAG_BLOCK_PATHFIND = 1 << 2;
const FLAG_HAS_HEIGHT = 1 << 3;
const FLAG_ALWAYSONTOP = 1 << 13;
const OTB_MAJOR = 3, OTB_MINOR = 20, OTB_BUILD = 1;
const OTB_DESCRIPTION = 'OTB 3.20.1-8.60';

const FIRST_ITEM_ID = 100;

/** Os itens saem de assets/items/, na ordem alfabetica que o compile.js usa. */
function listarItens() {
  return fs.readdirSync(ITEMS_ASSETS)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f, i) => ({
      file: f,
      id: FIRST_ITEM_ID + i,
      name: f.replace(/\.png$/i, '').replace(/^\d+-/, ''),
      decoration: isDecoration(f),
      mapTile: isMapTile(f),
    }));
}

/** Mapa do numero do tile -> id do item, por camada. */
function idsPorTile(itens, mapIndex, camada) {
  const suf = '-map' + mapIndex + (camada === 2 ? 'L2' : '') + '-';
  const out = new Map();
  for (const it of itens) {
    const at = it.file.indexOf(suf);
    if (at < 0) continue;
    // A camada 1 nao pode casar com o sufixo da 2: "-map150-" e prefixo de
    // nada, mas "-map150L2-" contem "-map150" -- por isso o teste e no
    // sufixo inteiro e a camada 1 exige que o proximo char seja digito.
    const resto = it.file.slice(at + suf.length);
    const n = parseInt(resto, 10);
    if (!isNaN(n)) out.set(n, it.id);
  }
  return out;
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

/**
 * items.otb com as flags de terreno vindas do mapdata.
 *
 * O group (byte de tipo do no) e o que faz um item ser chao: items.cpp:707
 * le `iType.group = itemNode.type`. Nao existe forma de declarar isso pelo
 * items.xml.
 */
function construirOtb(itens, terrenoPorId) {
  const root = new Node(0);
  root.props.u32(0);

  const version = new Node(0).props;
  version.u32(OTB_MAJOR).u32(OTB_MINOR).u32(OTB_BUILD);
  const csd = Buffer.alloc(128);
  csd.write(OTB_DESCRIPTION, 'latin1');
  version.bytes(csd);
  const versionBuf = version.toBuffer();
  if (versionBuf.length !== 140) {
    throw new Error(`VERSIONINFO deve ter 140 bytes, tem ${versionBuf.length}`);
  }
  root.props.attr(ROOT_ATTR_VERSION, versionBuf);

  let bloqueados = 0;
  for (const item of itens) {
    const group = item.decoration ? ITEM_GROUP_NONE : ITEM_GROUP_GROUND;
    const n = root.child(group);

    let flags = 0;
    // A camada 2 fica ACIMA da criatura na pilha. A flag precisa existir aqui
    // E como ThingAttrOnTop no .dat: o client ordena por uma fonte, o server
    // pela outra, e se divergirem o stackpos que o server manda no
    // parseCreatureMove nao corresponde ao do client -- o movimento morre com
    // "no creature found to move".
    if (item.decoration) flags |= FLAG_ALWAYSONTOP;

    // Altura so nos tiles DE MAPA que nao sao decoracao. Os tres chaos
    // desenhados a mao (grass/sand/stone, ids 100-102) ficam de fora: eles nao
    // vem do recorte da referencia e nunca carregaram altura.
    if (item.mapTile && !item.decoration) flags |= FLAG_HAS_HEIGHT;

    // Terreno bloqueado: o personagem nao entra nem o pathfind atravessa.
    if (terrenoPorId.get(item.id) === 'block') {
      flags |= FLAG_BLOCK_SOLID | FLAG_BLOCK_PATHFIND;
      bloqueados++;
    }
    n.props.u32(flags);

    // Este fork indexa por CLIENT ID e descarta o server id (items.cpp:619 e
    // :705), entao os dois saem com o mesmo valor.
    n.props.attr(ITEM_ATTR_SERVERID, u16(item.id));
    n.props.attr(ITEM_ATTR_CLIENTID, u16(item.id));
    // Speed em TODOS, inclusive na decoracao -- e o que o gen-items.js sempre
    // fez, e sair disso mudaria a velocidade de andar sem ninguem pedir.
    n.props.attr(ITEM_ATTR_SPEED, u16(110));
  }

  return { buffer: buildFile(root), bloqueados };
}

function construirXml(itens) {
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<items>',
    ...itens.map((i) => `\t<item id="${i.id}" name="${i.name}" />`),
    '</items>', ''].join('\n');
}

function construirOtbm(md, ids1, ids2) {
  const root = new Node(0);
  root.props.u32(OTBM_VERSION).u16(md.cols).u16(md.rows)
    .u32(MAJOR_ITEMS).u32(MINOR_ITEMS);

  const mapData = root.child(OTBM_MAP_DATA);
  mapData.props.u8(OTBM_ATTR_EXT_SPAWN_FILE).string(SPAWN_FILE);
  mapData.props.u8(OTBM_ATTR_EXT_HOUSE_FILE).string(HOUSE_FILE);

  // Um TILE_AREA e de UM z so (iomap.cpp: a area declara u16 x, u16 y, u8 z).
  // Como tudo fica em BASE_Z, uma area basta.
  const area = mapData.child(OTBM_TILE_AREA);
  area.props.u16(0).u16(0).u8(BASE_Z);

  let nTiles = 0, nDeco = 0, semArte = 0;
  for (let r = 0; r < md.rows; r++) {
    for (let c = 0; c < md.cols; c++) {
      const cel = md.grid[r] && md.grid[r][c];
      if (!cel) continue;

      const ground = cel.tile !== null && cel.tile !== undefined
        ? ids1.get(cel.tile) : undefined;
      if (ground === undefined) { semArte++; continue; }

      const tile = area.child(OTBM_TILE);
      tile.props.u8(c).u8(r);
      tile.child(OTBM_ITEM).props.u16(ground);
      nTiles++;

      // Camada 2, depois do chao na mesma pilha.
      if (cel.tile2 !== null && cel.tile2 !== undefined && ids2.has(cel.tile2)) {
        tile.child(OTBM_ITEM).props.u16(ids2.get(cel.tile2));
        nDeco++;
      }
    }
  }

  /*
   * A temple TEM que cair num tile que existe, senao loadPlayer falha e
   * ninguem loga. Escolhe uma celula andavel proxima ao centro.
   */
  let temple = null;
  const cx = Math.floor(md.cols / 2), cy = Math.floor(md.rows / 2);
  let melhor = Infinity;
  for (let r = 0; r < md.rows; r++) {
    for (let c = 0; c < md.cols; c++) {
      const cel = md.grid[r] && md.grid[r][c];
      if (!cel || cel.tile === null || cel.tile === undefined) continue;
      if ((cel.terreno || 'walk') !== 'walk') continue;
      const d = Math.abs(c - cx) + Math.abs(r - cy);
      if (d < melhor) { melhor = d; temple = { x: c, y: r, z: BASE_Z }; }
    }
  }
  if (!temple) throw new Error('nenhuma celula andavel para a temple');

  const towns = mapData.child(OTBM_TOWNS);
  const town = towns.child(OTBM_TOWN);
  town.props.u32(1).string('Temple').u16(temple.x).u16(temple.y).u8(temple.z);

  return { buffer: buildFile(root), nTiles, nDeco, semArte, temple };
}

function main() {
  const arg = process.argv[2];
  if (arg) {
    const origem = path.resolve(arg);
    if (!fs.existsSync(origem)) throw new Error(`nao achei ${origem}`);
    // Valida antes de sobrescrever: um JSON truncado aqui apagaria o mapa.
    const teste = JSON.parse(fs.readFileSync(origem, 'utf8'));
    if (!teste.grid || !teste.cols || !teste.rows) {
      throw new Error(`${origem} nao parece um mapdata (falta grid/cols/rows)`);
    }
    fs.copyFileSync(origem, MAPDATA);
    console.log(`mapdata <- ${path.relative(ROOT, origem)}`);
  }

  const md = JSON.parse(fs.readFileSync(MAPDATA, 'utf8'));
  const itens = listarItens();
  const ids1 = idsPorTile(itens, md.map, 1);
  const ids2 = idsPorTile(itens, md.map, 2);

  // Terreno por id de item: a flag vale para o ITEM, e o mesmo tile pode
  // aparecer em varias celulas. Se duas celulas do mesmo tile discordarem, a
  // mais restritiva ganha -- e o erro seguro, e o aviso diz onde olhar.
  const terrenoPorId = new Map();
  const conflitos = [];
  for (let r = 0; r < md.rows; r++) {
    for (let c = 0; c < md.cols; c++) {
      const cel = md.grid[r] && md.grid[r][c];
      if (!cel || cel.tile === null || cel.tile === undefined) continue;
      const id = ids1.get(cel.tile);
      if (id === undefined) continue;
      const t = cel.terreno || 'walk';
      const antes = terrenoPorId.get(id);
      if (antes === undefined) { terrenoPorId.set(id, t); continue; }
      if (antes !== t) {
        conflitos.push(`(${c},${r}) tile ${cel.tile}: ${antes} vs ${t}`);
        const ordem = { walk: 0, water: 1, block: 2 };
        if (ordem[t] > ordem[antes]) terrenoPorId.set(id, t);
      }
    }
  }

  const otb = construirOtb(itens, terrenoPorId);
  const otbm = construirOtbm(md, ids1, ids2);

  fs.writeFileSync(path.join(ITEMS_DIR, 'items.otb'), otb.buffer);
  fs.writeFileSync(path.join(ITEMS_DIR, 'items.xml'), construirXml(itens), 'latin1');
  fs.writeFileSync(path.join(WORLD_DIR, 'world.otbm'), otbm.buffer);

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  fs.writeFileSync(path.join(WORLD_DIR, SPAWN_FILE), `${xml}<spawns/>\n`);
  fs.writeFileSync(path.join(WORLD_DIR, HOUSE_FILE), `${xml}<houses/>\n`);

  const conta = { walk: 0, water: 0, block: 0 };
  for (let r = 0; r < md.rows; r++) {
    for (let c = 0; c < md.cols; c++) {
      const cel = md.grid[r] && md.grid[r][c];
      if (cel) conta[cel.terreno || 'walk']++;
    }
  }

  console.log(`items.otb   ${itens.length} itens, ${otb.bloqueados} bloqueados`);
  console.log(`world.otbm  ${otbm.nTiles} tiles, ${otbm.nDeco} com camada 2`);
  console.log(`terreno     ${conta.walk} andavel, ${conta.water} agua, ${conta.block} bloqueado`);
  console.log(`temple      (${otbm.temple.x},${otbm.temple.y},${otbm.temple.z})`);
  if (otbm.semArte) console.log(`AVISO: ${otbm.semArte} celulas sem item de terreno`);
  if (conflitos.length) {
    console.log(`AVISO: ${conflitos.length} celulas compartilham tile com terreno diferente:`);
    for (const c of conflitos.slice(0, 5)) console.log(`  ${c}`);
    if (conflitos.length > 5) console.log(`  ... e mais ${conflitos.length - 5}`);
  }
  console.log('\nO server le de server/build/data/ -- copie para la antes de subir:');
  console.log('  cp server/data/world/world.otbm server/data/items/items.* server/build/data/...');
}

if (require.main === module) main();

module.exports = { construirOtbm, construirOtb, listarItens, idsPorTile };
