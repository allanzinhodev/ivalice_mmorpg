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

// --- lado do client: Tibia.dat + Tibia.spr --------------------------------

// Atributos COM payload na versao 860 (o switch de ThingType::unserialize,
// client/src/client/thingtype.cpp:232-290). Os que nao estao aqui caem no
// `default` e nao consomem bytes.
const ATTR_PAYLOAD = {
  0: 2,   // Ground (speed)
  8: 2,   // Writable
  9: 2,   // WritableOnce
  21: 4,  // Light
  24: 4,  // Displacement
  25: 2,  // Elevation
  28: 2,  // MinimapColor
  29: 2,  // LensHelp
  32: 2,  // Cloth
  34: 2,  // Usable
  38: 16, // Bones
};
const ATTR_GROUND = 0;
const ATTR_DISPLACEMENT = 24;
const ATTR_MARKET = 33;
const ATTR_LAST = 0xff;

/** Le um ThingType do .dat exatamente como o client le. */
function readThing(b, o, hasFrameGroups) {
  const attrs = new Map();
  for (;;) {
    if (o >= b.length) throw new Error('EOF no meio dos atributos');
    const a = b.readUInt8(o); o += 1;
    if (a === ATTR_LAST) break;
    if (a === ATTR_MARKET) {
      o += 6;                                // category, tradeAs, showAs
      const len = b.readUInt16LE(o); o += 2;  // name
      o += len + 4;                           // restrictVocation, requiredLevel
      attrs.set(a, true);
      continue;
    }
    const size = ATTR_PAYLOAD[a] || 0;
    // Displacement e int16 logico, gravado em complemento de dois.
    if (a === ATTR_DISPLACEMENT) attrs.set(a, [b.readInt16LE(o), b.readInt16LE(o + 2)]);
    else if (size === 2) attrs.set(a, b.readUInt16LE(o));
    else attrs.set(a, true);
    o += size;
  }

  let groups = 1;
  if (hasFrameGroups) {
    groups = b.readUInt8(o); o += 1;
  }

  const sprites = [];
  for (let g = 0; g < groups; g++) {
    if (hasFrameGroups) o += 1; // frameGroupType
    const w = b.readUInt8(o), h = b.readUInt8(o + 1); o += 2;
    if (w > 1 || h > 1) o += 1; // realSize
    const layers = b.readUInt8(o);
    const px = b.readUInt8(o + 1), py = b.readUInt8(o + 2), pz = b.readUInt8(o + 3);
    const phases = b.readUInt8(o + 4);
    o += 5;
    if (phases > 1) o += 1 + 4 + 1 + phases * 8; // Animator::unserialize
    const n = w * h * layers * px * py * pz * phases;
    for (let k = 0; k < n; k++) { sprites.push(b.readUInt32LE(o)); o += 4; }
  }

  return { attrs, sprites, end: o };
}

function checkDat(file) {
  const b = fs.readFileSync(file);
  let o = 0;
  const signature = b.readUInt32LE(o); o += 4;
  const maxItem = b.readUInt16LE(o); o += 2;
  const maxOutfit = b.readUInt16LE(o); o += 2;
  const maxEffect = b.readUInt16LE(o); o += 2;
  const maxMissile = b.readUInt16LE(o); o += 2;

  console.log(
    `  header: sig=0x${signature.toString(16)} itens<=${maxItem} outfits<=${maxOutfit} ` +
    `effects<=${maxEffect} missiles<=${maxMissile}`
  );

  const things = { items: new Map(), outfits: new Map() };
  const spritesUsed = new Set();

  // thingtypemanager.cpp:291-293: itens comecam em 100, o resto em 1.
  const ranges = [
    ['items', 100, maxItem, false],
    ['outfits', 1, maxOutfit, true], // frame groups: o .otfi declara frame-groups
    ['effects', 1, maxEffect, false],
    ['missiles', 1, maxMissile, false],
  ];

  for (const [name, first, last, frameGroups] of ranges) {
    for (let id = first; id <= last; id++) {
      const t = readThing(b, o, frameGroups);
      o = t.end;
      for (const s of t.sprites) if (s !== 0) spritesUsed.add(s);
      if (things[name]) things[name].set(id, t);
    }
  }

  // Sobra de bytes significa que a leitura dessincronizou -- o client
  // abortaria com "corrupt data" num id qualquer, longe da causa real.
  if (o !== b.length) {
    throw new Error(`o parse terminou em ${o} mas o arquivo tem ${b.length} bytes`);
  }
  console.log(`  parse consumiu o arquivo inteiro (${b.length} bytes)  OK`);

  return { things, spritesUsed };
}

/**
 * Decodifica o .spr como SpriteManager::getSpriteImageCasual
 * (client/src/client/spritemanager.cpp:604-644) com useAlpha = true.
 * O erro que isso pega e o mesmo que deixou os sprites invisiveis: se os
 * pixels forem gravados em RGB, o stream dessincroniza e writePos nao fecha.
 */
function checkSpr(file, spritesUsed) {
  const b = fs.readFileSync(file);
  const signature = b.readUInt32LE(0);
  const count = b.readUInt32LE(4); // GameSpritesU32
  const offset = 8;
  const pixelBytes = 32 * 32 * 4;

  console.log(`  header: sig=0x${signature.toString(16)} sprites=${count}`);

  for (let id = 1; id <= count; id++) {
    const address = b.readUInt32LE(offset + (id - 1) * 4);
    if (address === 0) continue; // sprite vazio e legitimo
    const size = b.readUInt16LE(address + 3); // 3 bytes de color key antes
    let p = address + 5;
    const endOfData = p + size;
    let writePos = 0;
    while (p < endOfData) {
      const transparent = b.readUInt16LE(p); p += 2;
      const colored = b.readUInt16LE(p); p += 2;
      writePos += transparent * 4;
      if (writePos + colored * 4 > pixelBytes) {
        throw new Error(`sprite ${id}: run estoura o sprite (writePos=${writePos}, colored=${colored})`);
      }
      writePos += colored * 4;
      p += colored * 4;
    }
    if (p !== endOfData) throw new Error(`sprite ${id}: os runs nao fecham em pixelDataSize`);
    if (writePos > pixelBytes) throw new Error(`sprite ${id}: escreveu ${writePos} de ${pixelBytes}`);
  }
  console.log(`  ${count} sprites decodificam sem estourar 32x32 RGBA  OK`);

  for (const id of spritesUsed) {
    if (id > count) throw new Error(`o .dat referencia o sprite ${id}, mas o .spr so tem ${count}`);
  }
  console.log(`  todos os ${spritesUsed.size} sprites referenciados pelo .dat existem  OK`);
}

/**
 * O erro do commit 796a29f: o server aceita qualquer id (o items.otb e a fonte
 * da verdade dele), mas sem ThingType no .dat o chao some -- e parece bug da
 * projecao. Este cruzamento pega isso na hora de gerar.
 *
 * Faltar ThingAttrGround e um caso mais sutil, entao e AVISO e nao erro: o
 * item continua aparecendo na tela, desenhado como item comum na passada
 * reversa de Tile::drawBottom (tile.cpp:89-107) -- Tile::drawGround da break,
 * mas nao e ele que decide se algo e desenhado. O que quebra e o resto:
 * Tile::getGround() exige isGround() (tile.cpp:515-523) e devolve null, logo
 * Tile::isWalkable() e false para TODO tile (tile.cpp:757-760) e o
 * click-to-walk nao acha caminho nenhum. Tambem some o groundSpeed e o
 * setFieldBrightness do LightView.
 */
function checkGroundsHaveThingTypes(groundIds, things) {
  let avisos = 0;
  for (const id of groundIds) {
    const t = things.items.get(id);
    if (!t) {
      throw new Error(`id ${id} existe no items.otb mas nao tem ThingType no Tibia.dat -> chao invisivel`);
    }
    const d = t.attrs.get(ATTR_DISPLACEMENT) || [0, 0];
    const temGround = t.attrs.has(ATTR_GROUND);
    console.log(
      `    id=${id} ground=${temGround ? 'sim' : 'NAO'} displacement=(${d[0]},${d[1]})` +
      `  ${temGround ? 'OK' : '<<< AVISO'}`
    );
    if (!temGround) avisos++;
  }
  if (avisos > 0) {
    console.log(
      `\n  AVISO: ${avisos} chao(s) sem ThingAttrGround. Renderizam (via drawBottom),\n` +
      '  mas Tile::getGround() devolve null -> isWalkable() falso -> click-to-walk\n' +
      '  morto em todo tile. Corrigir com: node tools/datapack-gen/fix-dat.js'
    );
  }
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

  // O lado do client so e verificavel se o datapack ja foi gerado -- ele nao
  // e versionado (client/.gitignore:2). Ver gen-things.js.
  const things = path.resolve(__dirname, '../../client/data/things/860');
  if (!fs.existsSync(path.join(things, 'Tibia.dat'))) {
    console.log('\n== Tibia.dat/.spr ==\n  ausentes -- rode `node tools/datapack-gen/gen-things.js`');
    console.log('\nLado do server consistente.');
    return;
  }

  console.log('== Tibia.dat ==');
  const dat = checkDat(path.join(things, 'Tibia.dat'));
  console.log('== Tibia.spr ==');
  checkSpr(path.join(things, 'Tibia.spr'), dat.spritesUsed);
  console.log('== server x client ==');
  checkGroundsHaveThingTypes(groundIds, dat.things);

  console.log('\nTudo consistente.');
}

if (require.main === module) main();
