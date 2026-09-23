'use strict';
/*
 * Adiciona frame groups de acao aos outfits do Tibia.dat.
 *
 * Existe para destravar a validacao sem depender do Object Builder compilado
 * (que precisa do Adobe AIR SDK). Ver .claude/skills/frame-groups/SKILL.md.
 *
 * Por padrao os grupos novos REUSAM os sprites do grupo de andar -- o objetivo
 * e validar o caminho (formato -> client -> rede -> desenho), nao a arte. Com
 * a arte pronta, basta trocar os sprite ids.
 *
 * O formato e o mesmo que ThingType::unserialize le no client:
 *   <u8 groupCount>
 *   por grupo: <u8 type> <u8 w> <u8 h> [<u8 exactSize> se w>1 ou h>1]
 *              <u8 layers> <u8 patX> <u8 patY> <u8 patZ> <u8 phases>
 *              [animator se phases>1] <u32 spriteId> * N
 */

const fs = require('fs');
const path = require('path');

const DAT = path.resolve(__dirname, '../../client/data/things/860/Tibia.dat');

// Tem que bater com FrameGroupType no client e no Object Builder.
const GROUP_IDLE = 0;
const GROUP_MOVING = 1;
const GROUP_ATTACKING = 2;
const GROUP_CASTING = 3;

const ATTR_LAST = 0xff;

/** Atributos com payload, no formato 8.60 deste projeto. */
const ATTR_PAYLOAD = { 0: 2, 8: 2, 9: 2, 16: 4, 19: 2, 24: 4, 27: 2, 28: 2, 29: 2 };

class Reader {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  slice(n) { const s = this.b.subarray(this.o, this.o + n); this.o += n; return s; }
}

/** Le um ThingType e devolve seus pedacos, para reescrever depois. */
function readThing(r, hasFrameGroups) {
  const attrsStart = r.o;
  while (r.o < r.b.length) {
    const a = r.u8();
    if (a === ATTR_LAST) break;
    const payload = ATTR_PAYLOAD[a];
    if (payload) r.o += payload;
  }
  const attrs = r.b.subarray(attrsStart, r.o); // inclui o 0xFF final

  const groupCount = hasFrameGroups ? r.u8() : 1;
  const groups = [];
  for (let g = 0; g < groupCount; g++) {
    const type = hasFrameGroups ? r.u8() : GROUP_IDLE;
    const w = r.u8(), h = r.u8();
    const exactSize = (w > 1 || h > 1) ? r.u8() : null;
    const layers = r.u8(), patX = r.u8(), patY = r.u8(), patZ = r.u8();
    const phases = r.u8();

    // Animator: async(u8) + loopCount(i32) + startPhase(u8) + phases*(min,max u32)
    let animator = null;
    if (phases > 1) animator = r.slice(1 + 4 + 1 + phases * 8);

    const n = w * h * layers * patX * patY * patZ * phases;
    const sprites = [];
    for (let i = 0; i < n; i++) sprites.push(r.u32());

    groups.push({ type, w, h, exactSize, layers, patX, patY, patZ, phases, animator, sprites });
  }
  return { attrs, groups };
}

function writeThing(thing, hasFrameGroups) {
  const out = [Buffer.from(thing.attrs)];
  if (hasFrameGroups) out.push(Buffer.from([thing.groups.length]));

  for (const g of thing.groups) {
    const head = [];
    if (hasFrameGroups) head.push(g.type);
    head.push(g.w, g.h);
    if (g.w > 1 || g.h > 1) head.push(g.exactSize);
    head.push(g.layers, g.patX, g.patY, g.patZ, g.phases);
    out.push(Buffer.from(head));

    if (g.phases > 1) {
      out.push(g.animator ? Buffer.from(g.animator) : buildAnimator(g.phases));
    }
    const sp = Buffer.alloc(g.sprites.length * 4);
    g.sprites.forEach((id, i) => sp.writeUInt32LE(id, i * 4));
    out.push(sp);
  }
  return Buffer.concat(out);
}

/** Animator novo: loop infinito, 200ms por fase. */
function buildAnimator(phases) {
  const b = Buffer.alloc(1 + 4 + 1 + phases * 8);
  let o = 0;
  b.writeUInt8(0, o); o += 1;        // async = 0 (loop)
  b.writeInt32LE(0, o); o += 4;      // loopCount = 0 (infinito)
  b.writeUInt8(0, o); o += 1;        // startPhase
  for (let i = 0; i < phases; i++) {
    b.writeUInt32LE(200, o); o += 4; // min
    b.writeUInt32LE(200, o); o += 4; // max
  }
  return b;
}

function main() {
  const buf = fs.readFileSync(DAT);
  const r = new Reader(buf);

  const header = r.slice(12);
  const nItems = header.readUInt16LE(4);
  const nOutfits = header.readUInt16LE(6);
  const nEffects = header.readUInt16LE(8);
  const nMissiles = header.readUInt16LE(10);

  const out = [Buffer.from(header)];

  // Itens: sem frame groups, copiados como estao.
  for (let i = 100; i <= nItems; i++) {
    out.push(writeThing(readThing(r, false), false));
  }

  // Outfits: e aqui que entram os grupos de acao.
  let changed = 0;
  for (let i = 1; i <= nOutfits; i++) {
    const thing = readThing(r, true);
    const has = (t) => thing.groups.some((g) => g.type === t);

    if (!has(GROUP_ATTACKING)) {
      const base = thing.groups.find((g) => g.type === GROUP_MOVING) || thing.groups[0];
      // Reusa os sprites do grupo de andar: valida o caminho, nao a arte.
      thing.groups.push({ ...base, type: GROUP_ATTACKING, animator: null,
                          sprites: base.sprites.slice() });
      changed++;
    }
    if (!has(GROUP_CASTING)) {
      const base = thing.groups.find((g) => g.type === GROUP_IDLE) || thing.groups[0];
      thing.groups.push({ ...base, type: GROUP_CASTING, animator: null,
                          sprites: base.sprites.slice() });
      changed++;
    }

    thing.groups.sort((a, b) => a.type - b.type);
    out.push(writeThing(thing, true));
    console.log(`  outfit ${i}: ${thing.groups.length} grupos [${thing.groups.map((g) => g.type).join(',')}]`);
  }

  for (let i = 1; i <= nEffects; i++) out.push(writeThing(readThing(r, false), false));
  for (let i = 1; i <= nMissiles; i++) out.push(writeThing(readThing(r, false), false));

  if (r.o !== buf.length) {
    throw new Error(`parse incompleto: parei em ${r.o} de ${buf.length}`);
  }

  const result = Buffer.concat(out);
  fs.writeFileSync(DAT, result);
  console.log(`Tibia.dat: ${buf.length} -> ${result.length} bytes, ${changed} grupos adicionados`);
}

if (require.main === module) main();
