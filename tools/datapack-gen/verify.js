'use strict';
/*
 * Le de volta os arquivos gerados e confere que batem com o que o server
 * espera. Vale mais que inspecao visual: reimplementa o desescape e as
 * validacoes de items.cpp:577-585 e iomap.cpp:253-284.
 */

const fs = require('fs');
const path = require('path');

const ESCAPE = 0xfd;
const START = 0xfe;
const END = 0xff;

/** Parser generico da arvore OTB/OTBM (espelha fileloader.cpp). */
function parse(buf) {
  if (buf.length <= 7) throw new Error('arquivo pequeno demais (fileloader.cpp:22-25)');
  const identifier = buf.subarray(0, 4);
  let pos = 4;
  if (buf[pos] !== START) throw new Error(`esperado NODE_START em ${pos}, achei 0x${buf[pos].toString(16)}`);
  pos++;

  function parseNode() {
    const type = buf[pos++];
    const props = [];
    const children = [];
    while (pos < buf.length) {
      const b = buf[pos];
      if (b === ESCAPE) {
        pos++;
        props.push(buf[pos++]);
      } else if (b === START) {
        pos++;
        children.push(parseNode());
      } else if (b === END) {
        pos++;
        return { type, props: Buffer.from(props), children };
      } else {
        props.push(b);
        pos++;
      }
    }
    throw new Error('EOF sem NODE_END');
  }

  const root = parseNode();
  return { identifier, root };
}

function checkItems(file) {
  const { root } = parse(fs.readFileSync(file));
  const p = root.props;
  let o = 0;
  const flags = p.readUInt32LE(o); o += 4;
  const attr = p.readUInt8(o); o += 1;
  const len = p.readUInt16LE(o); o += 2;
  if (attr !== 0x01) throw new Error('esperado ROOT_ATTR_VERSION');
  if (len !== 140) throw new Error(`VERSIONINFO deve ter 140 bytes, tem ${len}`);
  const major = p.readUInt32LE(o);
  const minor = p.readUInt32LE(o + 4);
  const build = p.readUInt32LE(o + 8);

  // items.cpp:577-585
  if (major !== 3) throw new Error(`major=${major}, o server exige exatamente 3`);
  if (minor < 19) throw new Error(`minor=${minor}, o server exige >= 19`);

  console.log(`  raiz: flags=${flags} major=${major} minor=${minor} build=${build}  OK`);
  console.log(`  itens: ${root.children.length}`);

  for (const c of root.children) {
    const cp = c.props;
    let q = 4; // pula flags u32
    let serverid = null, clientid = null, speed = null;
    while (q < cp.length) {
      const a = cp.readUInt8(q); q += 1;
      const dl = cp.readUInt16LE(q); q += 2;
      const payload = cp.subarray(q, q + dl); q += dl;
      if (a === 0x10) serverid = payload.readUInt16LE(0);
      else if (a === 0x11) clientid = payload.readUInt16LE(0);
      else if (a === 0x14) speed = payload.readUInt16LE(0);
    }
    const groupName = { 1: 'GROUND', 2: 'CONTAINER' }[c.type] || `grupo ${c.type}`;
    console.log(
      `    id=${clientid} group=${c.type} (${groupName}) ` +
      `serverid=${serverid} clientid=${clientid}${speed !== null ? ` speed=${speed}` : ''}` +
      `${serverid === clientid ? ' OK' : ' <<< PROBLEMA'}`
    );
    if (serverid !== clientid) {
      throw new Error(`serverid != clientid em id=${clientid}: o server indexa por clientid (items.cpp:705)`);
    }
  }

  // Pelo menos um ground tile precisa existir, senao o mapa fica sem chao.
  const grounds = root.children.filter((c) => c.type === 1).length;
  if (grounds === 0) throw new Error('nenhum ITEM_GROUP_GROUND definido');
  console.log(`  ground tiles: ${grounds}`);
}

function checkMap(file, expectedIds) {
  const { root } = parse(fs.readFileSync(file));
  const p = root.props;
  const version = p.readUInt32LE(0);
  const width = p.readUInt16LE(4);
  const height = p.readUInt16LE(6);
  const major = p.readUInt32LE(8);
  const minor = p.readUInt32LE(12);

  // iomap.cpp:253-284
  if (version === 0 || version > 2) throw new Error(`version=${version} invalida (1 ou 2)`);
  if (major < 3) throw new Error(`majorVersionItems=${major} < 3`);
  if (minor < 8) throw new Error(`minorVersionItems=${minor} < CLIENT_VERSION_810`);

  console.log(`  header: version=${version} ${width}x${height} itemsOtb=${major}.${minor}  OK`);

  const mapData = root.children.find((c) => c.type === 2);
  if (!mapData) throw new Error('OTBM_MAP_DATA ausente');

  const areas = mapData.children.filter((c) => c.type === 4);
  const townsNode = mapData.children.find((c) => c.type === 12);

  // iomap.cpp:305-321: so TILE_AREA(4)/TOWNS(12)/WAYPOINTS(15) sao aceitos
  for (const c of mapData.children) {
    if (![4, 12, 15].includes(c.type)) {
      throw new Error(`filho invalido em MAP_DATA: type=${c.type} (fatal em iomap.cpp:318-320)`);
    }
  }

  let tiles = 0;
  const idsUsed = new Set();
  const zSet = new Set();
  for (const area of areas) {
    zSet.add(area.props.readUInt8(4));
    for (const tile of area.children) {
      tiles++;
      for (const item of tile.children) {
        if (item.type === 6) idsUsed.add(item.props.readUInt16LE(0));
      }
    }
  }

  console.log(`  tile areas: ${areas.length}, tiles: ${tiles}, z: [${[...zSet].join(',')}]`);
  console.log(`  ids de chao usados: ${[...idsUsed].sort((a, b) => a - b).join(', ')}`);

  for (const id of idsUsed) {
    if (!expectedIds.includes(id)) {
      throw new Error(`id ${id} usado no mapa mas ausente do items.otb -> "Failed to create item." (iomap.cpp:579)`);
    }
  }

  if (!townsNode) throw new Error('OTBM_TOWNS ausente -- login falharia (iologindata.cpp:576-581)');
  const towns = townsNode.children.filter((c) => c.type === 13);
  let hasTown1 = false;
  for (const t of towns) {
    const tp = t.props;
    const id = tp.readUInt32LE(0);
    const nameLen = tp.readUInt16LE(4);
    const name = tp.subarray(6, 6 + nameLen).toString('latin1');
    let q = 6 + nameLen;
    const tx = tp.readUInt16LE(q), ty = tp.readUInt16LE(q + 2), tz = tp.readUInt8(q + 4);
    console.log(`  town id=${id} "${name}" temple=(${tx},${ty},${tz})`);
    if (id === 1) hasTown1 = true;
  }
  if (!hasTown1) throw new Error('nenhuma town com id=1 -- todo login falharia');
}

function main() {
  const base = path.resolve(__dirname, '../../server/data');
  console.log('== items.otb ==');
  checkItems(path.join(base, 'items/items.otb'));
  console.log('== world.otbm ==');
  const { ITEMS } = require('./gen-items');
  // o mapa so usa ground tiles; o store inbox nao aparece no OTBM
  const groundIds = ITEMS.filter((i) => i.group !== 'container').map((i) => i.id);
  checkMap(path.join(base, 'world/world.otbm'), groundIds);
  console.log('\nTudo consistente.');
}

if (require.main === module) main();
