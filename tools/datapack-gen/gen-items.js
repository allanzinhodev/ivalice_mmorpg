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
const { isMapTile, isDecoration } = require('../asset-compiler/map-assets.js');
const { classificarArquivo } = require('../asset-compiler/tile-spec.js');
const { Props, Node, buildFile } = require('./otb-common');

// --- constantes do formato (server/src/itemloader.h) ---
const ROOT_ATTR_VERSION = 0x01;

const ITEM_GROUP_NONE = 0;   // itemloader.h:9-29
const ITEM_GROUP_GROUND = 1;
const ITEM_GROUP_CONTAINER = 2;

// itemloader.h:104-108. O server so sabe que um item tem altura por este
// bit; nao existe forma de declarar isso pelo items.xml.
const FLAG_HAS_HEIGHT = 1 << 3;

// itemloader.h:105-107. O bit 0 barra o passo; o 2 barra o pathfind.
const FLAG_BLOCK_SOLID = 1 << 0;
const FLAG_BLOCK_PATHFIND = 1 << 2;

// itemloader.h:118. O server so sabe que um item fica ACIMA da criatura
// na pilha por este bit (items.cpp:744 -> iType.alwaysOnTop).
const FLAG_ALWAYSONTOP = 1 << 13;

const ITEM_ATTR_SERVERID = 0x10; // itemloader.h:62+
const ITEM_ATTR_CLIENTID = 0x11;
const ITEM_ATTR_SPEED = 0x14;

// Validado em items.cpp:577-585: major TEM que ser 3, minor >= 19.
const OTB_MAJOR = 3;
const OTB_MINOR = 20; // CLIENT_VERSION_860
const OTB_BUILD = 1;
const OTB_DESCRIPTION = 'OTB 3.20.1-8.60';

// Os 3 tiles de chao. id = serverid = clientid (ver nota acima).
//
// POR QUE 100/101/102 E NAO 1/2/3:
// No formato .dat os itens comecam no id 100 -- os ids 1..99 sao
// reservados e nao existem do lado do client. Ver
// client/src/client/thingtypemanager.cpp:290-293, onde o loop de leitura
// faz `firstId = 100` para ThingCategoryItem.
// O Tibia.dat deste projeto declara 3 itens, que sao portanto 100, 101 e 102.
// Usar 1/2/3 daria chao invisivel: o server aceitaria, mas o client nao teria
// ThingType para esses ids.
/**
 * Os itens saem de assets/items/, na MESMA ordem que o compile.js usa para
 * atribuir os ids do .dat: nome de arquivo, alfabetico, comecando em 100.
 *
 * Antes os 3 chaos eram fixos aqui. Quando o extract-map-tiles.js passou a
 * gerar ~200 tiles, o client tinha todos e o SERVER so tres -- e o mapa
 * referenciava ids que o items.otb nao conhecia. O sintoma no server e
 * "Failed to create item." e o mapa nem carrega.
 *
 * Lendo o mesmo diretorio, os dois lados nao tem como divergir.
 */
function loadItems() {
  const dir = path.resolve(__dirname, "../../assets/items");
  const files = fs.readdirSync(dir).filter(function (f) {
    return f.toLowerCase().slice(-4) === ".png";
  }).sort();

  const itens = files.map(function (f, i) {
    // Classificacao do terreno (tile_NNN.png). null para os outros arquivos.
    // Mesmo modulo que o compile.js le -- manter a classificacao em dois
    // lugares e como o hasHeight divergiu antes.
    const spec = classificarArquivo(f);

    return {
      id: 100 + i,
      name: spec ? `${spec.tipo}_${f.replace(/\.png$/i, '').replace(/^tile_/, '')}`
                 : f.replace(/\.png$/i, '').replace(/^\d+-/, ''),
      speed: 110,
      // A decoracao da camada 2 NAO e chao: nao se anda sobre ela e ela nao
      // carrega altura. Precisa de group != GROUND, senao Item::isGroundTile()
      // e verdadeiro no server e IOMap a trata como o chao da tile.
      decoration: isDecoration(f),
      // Altura: e o que Tile::hasHeight(n) CONTA (server/src/tile.cpp:127), e
      // e contra esse contador que o JUMP do personagem e comparado. Sem a
      // flag o contador fica em zero e nada e transponivel.
      //
      // Para os tiles classificados quem manda e o `displacement` da spec:
      // planta e pedra baixa sao pisaveis/atravessaveis mas nao sao degrau.
      hasHeight: spec ? spec.displacement : (isMapTile(f) && !isDecoration(f)),
      // Nao andavel -> bloqueia o passo E o pathfind.
      blocking: spec ? !spec.walkable : false,
    };
  });

  return itens;
}

const ITEMS = loadItems();

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
    // O byte de tipo do no E o itemgroup_t (items.cpp:707).
    const group = item.group === 'container' ? ITEM_GROUP_CONTAINER
      : item.decoration ? ITEM_GROUP_NONE
      : ITEM_GROUP_GROUND;
    const n = root.child(group);
    // Sem FLAG_BLOCK_SOLID -> chao andavel. FLAG_HAS_HEIGHT entra nos tiles
    // de mapa para o server poder contar o empilhamento.
    //
    // A CAMADA 2 PRECISA DE FLAG_ALWAYSONTOP, senao o server e o client
    // discordam de ONDE a criatura entra na pilha do tile:
    //
    //   client  Tile::addThing ordena por isOnTop(), lido do .dat
    //   server  Tile::addThing ordena por alwaysOnTop, lido do .otb
    //
    // Com a flag so no .dat, o client punha a criatura ANTES da decoracao e
    // o server DEPOIS. Ai o server mandava parseCreatureMove com um stackpos
    // que no client era outra coisa, e o movimento morria com
    // "no creature found to move" / "no thing at pos" -- que na tela e o
    // personagem nao andando direito.
    let flags = 0;
    if (item.hasHeight) flags |= FLAG_HAS_HEIGHT;
    if (item.decoration) flags |= FLAG_ALWAYSONTOP;
    // Nao andavel: bloqueia o passo e tambem o pathfind. Sem o segundo, o
    // autowalk tenta rotas por cima da pedra e o personagem trava no caminho
    // em vez de contornar.
    if (item.blocking) flags |= FLAG_BLOCK_SOLID | FLAG_BLOCK_PATHFIND;
    n.props.u32(flags);
    const u16 = (v) => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(v, 0);
      return b;
    };
    n.props.attr(ITEM_ATTR_SERVERID, u16(item.id));
    n.props.attr(ITEM_ATTR_CLIENTID, u16(item.id)); // igual ao serverid!
    if (item.speed !== undefined) {
      n.props.attr(ITEM_ATTR_SPEED, u16(item.speed));
    }
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
