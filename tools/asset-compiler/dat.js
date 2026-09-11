'use strict';
/*
 * Escrita do Tibia.dat no formato que o client le em ThingType::unserialize
 * (client/src/client/thingtype.cpp).
 *
 * Layout:
 *   [u32 signature]
 *   [u16 items] [u16 outfits] [u16 effects] [u16 missiles]
 *   ThingTypes: itens (ids 100..items), depois outfits, effects, missiles
 *
 * Cada ThingType:
 *   atributos, terminados por 0xFF
 *   [u8 groupCount]                    so para CRIATURAS com frame groups
 *   por grupo:
 *     [u8 tipo]                        so quando ha frame groups
 *     [u8 largura] [u8 altura]
 *     [u8 exactSize]                   so se largura>1 ou altura>1
 *     [u8 layers] [u8 patX] [u8 patY] [u8 patZ] [u8 fases]
 *     [animator]                       so se fases>1
 *     [u32 spriteId] * N               u32 porque GameSpritesU32 esta ligado
 *
 * Detalhes que ja custaram bug antes:
 * - ITENS COMECAM NO ID 100. Os ids 1..99 sao reservados e nao existem do lado
 *   do client (thingtypemanager.cpp usa firstId = 100).
 * - Chao PRECISA de ThingAttrGround (0). Sem ele Tile::drawGround faz break na
 *   primeira iteracao e nada e desenhado.
 * - Displacement e gravado como u16 mas o valor e COM SINAL (complemento de
 *   dois). O client reinterpreta como int16.
 */

// --- atributos (client/src/client/thingtype.h, ThingAttr) ---
const ATTR_GROUND = 0;
const ATTR_ELEVATION = 25;
const ATTR_DISPLACEMENT = 24;
const ATTR_DONT_HIDE = 22;
const ATTR_FULL_GROUND = 30;
/*
 * MERAMENTE VISUAL -- extensao nossa, ver ThingAttrVisualOnly em
 * client/src/client/thingtype.h.
 *
 * Nao tem carga: o `default` de ThingType::unserialize registra qualquer
 * atributo desconhecido como `true`, entao basta o byte. E por isso mesmo que
 * escrever um numero errado aqui NAO da erro -- o client aceita calado e
 * registra um atributo que ninguem le. O numero tem que casar com o enum.
 */
const ATTR_VISUAL_ONLY = 102;
const ATTR_LAST = 0xff;

// --- frame groups. TEM que bater com FrameGroupType no client e no
//     ObjectBuilder; mudar aqui sem mudar la corrompe a leitura. ---
const FrameGroup = {
  IDLE: 0,
  WALK: 1,
  EVADE: 2,
  JUMP: 3,
  HIT: 4,
  DEAD: 5,
  ATTACK: 6,
  WEAK: 7,
};

const FRAME_GROUP_NAMES = ['idle', 'walk', 'evade', 'jump', 'hit', 'dead', 'attack', 'weak'];

class Writer {
  constructor() { this.parts = []; }
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xff, 0); this.parts.push(b); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); this.parts.push(b); return this; }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v, 0); this.parts.push(b); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); this.parts.push(b); return this; }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); this.parts.push(b); return this; }
  bytes(b) { this.parts.push(Buffer.from(b)); return this; }
  toBuffer() { return Buffer.concat(this.parts); }
}

/**
 * Animator de um frame group (Animator::unserialize no client).
 *   [u8 async] [i32 loopCount] [u8 startPhase] [i32 min, i32 max] * fases
 *
 * async=0 + loopCount=0 = loop infinito, que e o que idle/walk querem.
 * Para animacao de acao (attack, dead) o natural e tocar uma vez, mas isso
 * depende de o client respeitar o loopCount -- por ora tudo em loop, e o
 * controle de "tocou e voltou" fica na camada de jogo.
 */
function writeAnimator(w, phases, durationMs) {
  w.u8(0);          // async: 0 = loop
  w.i32(0);         // loopCount: 0 = infinito
  w.u8(0);          // startPhase
  for (let i = 0; i < phases; i++) {
    w.i32(durationMs);
    w.i32(durationMs);
  }
}

/**
 * Um frame group: dimensoes, patterns e a lista de sprite ids.
 * `sprites` tem que ter exatamente w*h*layers*patX*patY*patZ*phases entradas.
 */
function writeFrameGroup(w, g, hasFrameGroups) {
  if (hasFrameGroups) w.u8(g.type);

  w.u8(g.width);
  w.u8(g.height);
  if (g.width > 1 || g.height > 1) {
    // exactSize: o client usa min(realSize, max(w,h)*32)
    w.u8(g.exactSize !== undefined ? g.exactSize : 32);
  }
  w.u8(g.layers);
  w.u8(g.patternX);
  w.u8(g.patternY);
  w.u8(g.patternZ);
  w.u8(g.phases);

  if (g.phases > 1) writeAnimator(w, g.phases, g.durationMs || 300);

  const expected = g.width * g.height * g.layers * g.patternX * g.patternY * g.patternZ * g.phases;
  if (g.sprites.length !== expected) {
    throw new Error(`frame group ${g.type}: ${g.sprites.length} sprites, esperado ${expected}`);
  }
  for (const id of g.sprites) w.u32(id);
}

/** Escreve os atributos e o 0xFF terminador. */
function writeAttributes(w, attrs) {
  if (attrs.ground !== undefined) { w.u8(ATTR_GROUND); w.u16(attrs.ground); }
  if (attrs.displacement) { w.u8(ATTR_DISPLACEMENT); w.i16(attrs.displacement[0]); w.i16(attrs.displacement[1]); }
  if (attrs.elevation !== undefined) { w.u8(ATTR_ELEVATION); w.u16(attrs.elevation); }
  if (attrs.dontHide) w.u8(ATTR_DONT_HIDE);
  if (attrs.fullGround) w.u8(ATTR_FULL_GROUND);
  if (attrs.visualOnly) w.u8(ATTR_VISUAL_ONLY);
  w.u8(ATTR_LAST);
}

function writeThing(w, thing, hasFrameGroups) {
  writeAttributes(w, thing.attrs || {});
  if (hasFrameGroups) w.u8(thing.groups.length);
  for (const g of thing.groups) writeFrameGroup(w, g, hasFrameGroups);
}

/**
 * Monta o .dat inteiro.
 *
 * `items` sao indexados a partir de 100 (o formato reserva 1..99).
 * Outfits levam frame groups; itens, efeitos e misseis nao.
 */
function buildDat({ signature, items, outfits, effects, missiles }) {
  const w = new Writer();

  w.u32(signature);
  // A contagem de itens e o ULTIMO id, nao a quantidade -- por isso 99 + n.
  w.u16(99 + items.length);
  w.u16(outfits.length);
  w.u16(effects.length);
  w.u16(missiles.length);

  for (const t of items) writeThing(w, t, false);
  for (const t of outfits) writeThing(w, t, true);
  for (const t of effects) writeThing(w, t, false);
  for (const t of missiles) writeThing(w, t, false);

  return w.toBuffer();
}

module.exports = {
  FrameGroup, FRAME_GROUP_NAMES,
  ATTR_GROUND, ATTR_DISPLACEMENT, ATTR_ELEVATION, ATTR_DONT_HIDE, ATTR_FULL_GROUND, ATTR_VISUAL_ONLY, ATTR_LAST,
  buildDat, Writer,
};
