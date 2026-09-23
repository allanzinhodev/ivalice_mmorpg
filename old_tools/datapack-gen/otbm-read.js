'use strict';
/*
 * Le de volta um world.otbm -- a inversa de gen-map-ffta.js.
 *
 * Existe para render-world.js poder desenhar o mapa a partir do arquivo que o
 * SERVER de fato carrega, em vez do JSON que o gerou. A diferenca e o ponto
 * todo: um erro no gerador nao aparece em quem le a entrada dele.
 *
 * Formato (server/src/iomap.cpp e fileloader.cpp): arvore de nos
 *
 *   FE <tipo> <propriedades escapadas> <filhos...> FF
 *
 * com 0xFD/0xFE/0xFF dentro das propriedades precedidos de 0xFD. O arquivo
 * comeca com 4 bytes de identificador (zerados nos nossos).
 */

const NODE_ESCAPE = 0xfd;
const NODE_START = 0xfe;
const NODE_END = 0xff;

const OTBM_MAP_DATA = 2;
const OTBM_TILE_AREA = 4;
const OTBM_TILE = 5;
const OTBM_ITEM = 6;
const OTBM_TOWNS = 12;
const OTBM_TOWN = 13;

/**
 * Le um no a partir de `pos`, que tem que apontar para o 0xFE.
 * Devolve { node, next }.
 */
function readNode(buf, pos) {
  if (buf[pos] !== NODE_START) {
    throw new Error(`esperava 0xFE em 0x${pos.toString(16)}, veio 0x${buf[pos].toString(16)}`);
  }
  pos++;
  const type = buf[pos++];

  // As propriedades vao ate o proximo 0xFE (filho) ou 0xFF (fim), ambos NAO
  // escapados. Desescapamos aqui mesmo.
  const props = [];
  while (pos < buf.length) {
    const b = buf[pos];
    if (b === NODE_ESCAPE) { props.push(buf[pos + 1]); pos += 2; continue; }
    if (b === NODE_START || b === NODE_END) break;
    props.push(b);
    pos++;
  }

  const children = [];
  while (pos < buf.length && buf[pos] === NODE_START) {
    const r = readNode(buf, pos);
    children.push(r.node);
    pos = r.next;
  }

  if (buf[pos] !== NODE_END) {
    throw new Error(`no tipo ${type} sem 0xFF de fechamento em 0x${pos.toString(16)}`);
  }
  pos++;

  return { node: { type, props: Buffer.from(props), children }, next: pos };
}

/** Le o mapa inteiro e devolve os tiles achatados, com os itens em ordem. */
function readOtbm(buf) {
  // 4 bytes de identificador antes da raiz.
  const { node: root } = readNode(buf, 4);

  const header = {
    version: root.props.readUInt32LE(0),
    width: root.props.readUInt16LE(4),
    height: root.props.readUInt16LE(6),
    majorItems: root.props.readUInt32LE(8),
    minorItems: root.props.readUInt32LE(12),
  };

  const mapData = root.children.find((c) => c.type === OTBM_MAP_DATA);
  if (!mapData) throw new Error('sem no OTBM_MAP_DATA');

  const tiles = [];
  const towns = [];

  for (const child of mapData.children) {
    if (child.type === OTBM_TILE_AREA) {
      const baseX = child.props.readUInt16LE(0);
      const baseY = child.props.readUInt16LE(2);
      const z = child.props.readUInt8(4);

      for (const t of child.children) {
        if (t.type !== OTBM_TILE) continue;
        // Os offsets dentro da area sao u8 -- a area cobre 256x256.
        const x = baseX + t.props.readUInt8(0);
        const y = baseY + t.props.readUInt8(1);

        const items = [];
        for (const it of t.children) {
          if (it.type !== OTBM_ITEM) continue;
          items.push(it.props.readUInt16LE(0));
        }
        tiles.push({ x, y, z, items });
      }
    } else if (child.type === OTBM_TOWNS) {
      for (const t of child.children) {
        if (t.type !== OTBM_TOWN) continue;
        const id = t.props.readUInt32LE(0);
        const len = t.props.readUInt16LE(4);
        const name = t.props.subarray(6, 6 + len).toString('latin1');
        const o = 6 + len;
        towns.push({
          id, name,
          x: t.props.readUInt16LE(o),
          y: t.props.readUInt16LE(o + 2),
          z: t.props.readUInt8(o + 4),
        });
      }
    }
  }

  return { header, tiles, towns };
}

module.exports = { readOtbm, readNode };
