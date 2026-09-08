'use strict';
/*
 * Gera data/items/items.otb e data/items/items.xml com 3 ground tiles.
 *
 * ATENCAO -- este fork indexa os itens por CLIENT ID e DESCARTA o server id:
 *   server/src/items.cpp:619  -> le o serverid para `ignoredLegacyId` e joga fora
 *   server/src/items.cpp:705  -> ItemType& iType = items[clientId];
 * Por isso SERVERID e CLIENTID sao sempre escritos com o mesmo valor.
 *
 * E o `group` (o que faz um item ser chao) vem SO do byte de tipo do no:
 *   server/src/items.cpp:707  -> iType.group = static_cast<itemgroup_t>(itemNode.type);
 * Nao existe forma de declarar ground tile pelo items.xml.
 */

const fs = require('fs');
const path = require('path');
const { Props, Node, buildFile } = require('./otb-common');

// --- constantes do formato (server/src/itemloader.h) ---
const ROOT_ATTR_VERSION = 0x01;

const ITEM_GROUP_GROUND = 1; // itemloader.h:9-29

const ITEM_ATTR_SERVERID = 0x10; // itemloader.h:62+
const ITEM_ATTR_CLIENTID = 0x11;
const ITEM_ATTR_SPEED = 0x14;

// Validado em items.cpp:577-585: major TEM que ser 3, minor >= 19.
const OTB_MAJOR = 3;
const OTB_MINOR = 20; // CLIENT_VERSION_860
const OTB_BUILD = 1;
const OTB_DESCRIPTION = 'OTB 3.20.1-8.60';

// Os 3 tiles pedidos. id = serverid = clientid = indice do sprite no .spr.
const ITEMS = [
  { id: 1, name: 'grass', speed: 110 },
  { id: 2, name: 'sand', speed: 110 },
  { id: 3, name: 'stone', speed: 110 },
];

function buildOtb() {
  const root = new Node(0); // o no raiz do items.otb tem type byte 0

  // flags(u32) + ROOT_ATTR_VERSION + VERSIONINFO(140 bytes)
  root.props.u32(0);
  const version = new Props();
  version.u32(OTB_MAJOR).u32(OTB_MINOR).u32(OTB_BUILD);
  const csd = Buffer.alloc(128); // char CSDVersion[128], zero-padded
  csd.write(OTB_DESCRIPTION, 'latin1');
  version.bytes(csd);
  const versionBuf = version.toBuffer();
  if (versionBuf.length !== 140) {
    throw new Error(`VERSIONINFO deve ter 140 bytes, tem ${versionBuf.length}`);
  }
  root.props.attr(ROOT_ATTR_VERSION, versionBuf);

  for (const item of ITEMS) {
    // O byte de tipo do no E o itemgroup_t -> 1 = ITEM_GROUP_GROUND.
    const n = root.child(ITEM_GROUP_GROUND);
    // flags = 0: sem FLAG_BLOCK_SOLID -> andavel.
    n.props.u32(0);
    const u16 = (v) => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(v, 0);
      return b;
    };
    n.props.attr(ITEM_ATTR_SERVERID, u16(item.id));
    n.props.attr(ITEM_ATTR_CLIENTID, u16(item.id)); // igual ao serverid!
    n.props.attr(ITEM_ATTR_SPEED, u16(item.speed));
  }

  return buildFile(root);
}

function buildXml() {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<items>',
    ...ITEMS.map((i) => `\t<item id="${i.id}" name="${i.name}" />`),
    '</items>',
    '',
  ];
  return lines.join('\n');
}

function main() {
  const outDir = path.resolve(__dirname, '../../server/data/items');
  if (!fs.existsSync(outDir)) {
    throw new Error(`diretorio nao encontrado: ${outDir}`);
  }

  const otb = buildOtb();
  fs.writeFileSync(path.join(outDir, 'items.otb'), otb);
  fs.writeFileSync(path.join(outDir, 'items.xml'), buildXml(), 'latin1');

  console.log(`items.otb  ${otb.length} bytes, ${ITEMS.length} itens`);
  console.log(`items.xml  ${ITEMS.map((i) => `${i.id}=${i.name}`).join(', ')}`);
}

if (require.main === module) main();

module.exports = { ITEMS, buildOtb };
