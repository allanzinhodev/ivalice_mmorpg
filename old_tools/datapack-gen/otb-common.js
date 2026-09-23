'use strict';
/*
 * Primitivas binarias compartilhadas pelos geradores de items.otb e world.otbm.
 *
 * A regra de escape e a mesma nos dois formatos e esta portada verbatim de
 * server/src/iomap.cpp:60-76 (appendEscapedProperties):
 *
 *     for (const unsigned char byte : properties.view()) {
 *         if (byte == ESCAPE || byte == START || byte == END) {
 *             output.emplace_back(ESCAPE);
 *         }
 *         output.emplace_back(byte);
 *     }
 *
 * Ou seja: todo 0xFD/0xFE/0xFF dentro de um payload de propriedade e precedido
 * de 0xFD. Isso vale para TUDO -- ids de item, offsets de tile, strings.
 */

const NODE_ESCAPE = 0xfd;
const NODE_START = 0xfe;
const NODE_END = 0xff;

/** Escapa 0xFD/0xFE/0xFF conforme iomap.cpp:60-76. */
function escapeBytes(buf) {
  const out = [];
  for (const byte of buf) {
    if (byte === NODE_ESCAPE || byte === NODE_START || byte === NODE_END) {
      out.push(NODE_ESCAPE);
    }
    out.push(byte);
  }
  return Buffer.from(out);
}

/**
 * Acumulador de bytes NAO escapados (o payload cru de propriedades de um no).
 * O escape e aplicado uma unica vez, na serializacao, por Node.toBuffer().
 */
class Props {
  constructor() {
    this.chunks = [];
  }
  u8(v) {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff, 0);
    this.chunks.push(b);
    return this;
  }
  u16(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v & 0xffff, 0);
    this.chunks.push(b);
    return this;
  }
  u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.chunks.push(b);
    return this;
  }
  bytes(buf) {
    this.chunks.push(Buffer.from(buf));
    return this;
  }
  /** String precedida de uint16 com o comprimento (formato usado por OTBM). */
  string(str) {
    const b = Buffer.from(str, 'latin1');
    this.u16(b.length);
    this.chunks.push(b);
    return this;
  }
  /** Atributo OTB: <u8 attr> <u16 datalen> <payload>. */
  attr(id, payload) {
    const b = Buffer.from(payload);
    this.u8(id);
    this.u16(b.length);
    this.chunks.push(b);
    return this;
  }
  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

/** Um no da arvore OTB/OTBM: FE <type> <props escapadas> <filhos> FF. */
class Node {
  constructor(type) {
    this.type = type;
    this.props = new Props();
    this.children = [];
  }
  child(type) {
    const n = new Node(type);
    this.children.push(n);
    return n;
  }
  add(node) {
    this.children.push(node);
    return node;
  }
  toBuffer() {
    const parts = [
      Buffer.from([NODE_START, this.type & 0xff]),
      escapeBytes(this.props.toBuffer()),
    ];
    for (const c of this.children) parts.push(c.toBuffer());
    parts.push(Buffer.from([NODE_END]));
    return Buffer.concat(parts);
  }
}

/**
 * Arquivo completo: <identificador 4 bytes> + no raiz.
 *
 * O identificador de 4 bytes zerados e o "wildcard" aceito por
 * fileloader.cpp:12,27-31 -- e exatamente o que os arquivos originais
 * (items.otb e world.otbm) usam.
 */
function buildFile(rootNode, identifier = Buffer.from([0, 0, 0, 0])) {
  return Buffer.concat([Buffer.from(identifier), rootNode.toBuffer()]);
}

module.exports = {
  NODE_ESCAPE,
  NODE_START,
  NODE_END,
  escapeBytes,
  Props,
  Node,
  buildFile,
};
