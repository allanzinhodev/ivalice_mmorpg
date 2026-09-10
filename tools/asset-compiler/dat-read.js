'use strict';
/*
 * Le de volta um Tibia.dat produzido por dat.js.
 *
 * Nao e um parser do .dat do Tibia em geral -- e a INVERSA do nosso escritor,
 * e so entende os atributos que ele emite. Isso e proposital: um parser
 * permissivo aceitaria em silencio um arquivo que o client rejeita, e o valor
 * aqui e justamente falhar cedo.
 *
 * Serve a render-check.js, que compara duas compilacoes pixel a pixel.
 */

const {
  ATTR_GROUND, ATTR_DISPLACEMENT, ATTR_ELEVATION, ATTR_FULL_GROUND, ATTR_LAST,
} = require('./dat.js');

class Reader {
  constructor(buf) { this.buf = buf; this.p = 0; }
  u8() { return this.buf[this.p++]; }
  u16() { const v = this.buf.readUInt16LE(this.p); this.p += 2; return v; }
  i16() { const v = this.buf.readInt16LE(this.p); this.p += 2; return v; }
  u32() { const v = this.buf.readUInt32LE(this.p); this.p += 4; return v; }
  i32() { const v = this.buf.readInt32LE(this.p); this.p += 4; return v; }
}

function readAttributes(r) {
  const attrs = {};
  for (;;) {
    const a = r.u8();
    if (a === ATTR_LAST) return attrs;
    switch (a) {
      case ATTR_GROUND: attrs.ground = r.u16(); break;
      case ATTR_DISPLACEMENT: attrs.displacement = [r.i16(), r.i16()]; break;
      case ATTR_ELEVATION: attrs.elevation = r.u16(); break;
      case ATTR_FULL_GROUND: attrs.fullGround = true; break;
      default:
        throw new Error(`atributo ${a} inesperado em 0x${(r.p - 1).toString(16)} -- ` +
          'dat.js nao emite este, entao o arquivo ou o parser estao errados');
    }
  }
}

function readFrameGroup(r, hasFrameGroups) {
  const g = {};
  g.type = hasFrameGroups ? r.u8() : 0;
  g.width = r.u8();
  g.height = r.u8();
  if (g.width > 1 || g.height > 1) g.exactSize = r.u8();
  g.layers = r.u8();
  g.patternX = r.u8();
  g.patternY = r.u8();
  g.patternZ = r.u8();
  g.phases = r.u8();

  if (g.phases > 1) {
    r.u8();                                    // async
    r.i32();                                   // loopCount
    r.u8();                                    // startPhase
    for (let i = 0; i < g.phases; i++) { r.i32(); r.i32(); }
  }

  const n = g.width * g.height * g.layers * g.patternX * g.patternY * g.patternZ * g.phases;
  g.sprites = [];
  for (let i = 0; i < n; i++) g.sprites.push(r.u32());
  return g;
}

function readThing(r, hasFrameGroups) {
  const attrs = readAttributes(r);
  const groupCount = hasFrameGroups ? r.u8() : 1;
  const groups = [];
  for (let i = 0; i < groupCount; i++) groups.push(readFrameGroup(r, hasFrameGroups));
  return { attrs, groups };
}

function readDat(buf) {
  const r = new Reader(buf);
  const signature = r.u32();
  const lastItemId = r.u16();
  const nOutfits = r.u16();
  const nEffects = r.u16();
  const nMissiles = r.u16();

  const items = [];
  for (let id = 100; id <= lastItemId; id++) items.push({ id, ...readThing(r, false) });

  const outfits = [];
  for (let i = 1; i <= nOutfits; i++) outfits.push({ id: i, ...readThing(r, true) });

  const effects = [];
  for (let i = 1; i <= nEffects; i++) effects.push({ id: i, ...readThing(r, false) });

  const missiles = [];
  for (let i = 1; i <= nMissiles; i++) missiles.push({ id: i, ...readThing(r, false) });

  if (r.p !== buf.length) {
    throw new Error(`sobraram ${buf.length - r.p} bytes depois do ultimo thing`);
  }

  return { signature, items, outfits, effects, missiles };
}

module.exports = { readDat };
