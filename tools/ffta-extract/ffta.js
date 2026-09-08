'use strict';
/*
 * ffta.js — biblioteca de leitura da ROM de Final Fantasy Tactics Advance (US, AFXE).
 *
 * Offsets e layouts vindos de Data Crystal (datacrystal.tcrf.net):
 *   /wiki/Final_Fantasy_Tactics_Advance/ROM_map
 *   /wiki/Final_Fantasy_Tactics_Advance/Items
 *   /wiki/Final_Fantasy_Tactics_Advance/Abilities
 *   /wiki/Final_Fantasy_Tactics_Advance/Jobs
 *   /wiki/Final_Fantasy_Tactics_Advance/String_Tables
 * As tabelas de ponteiro extras (missoes, nomes, clas, areas) foram localizadas
 * por varredura e confirmadas por decodificacao.
 */
const fs = require('fs');

const GBA_BASE = 0x08000000;
const EXPECT = { gameCode: 'AFXE', md5: 'cd99cdde3d45554c1b36fbeb8863b7bd' };

// ---- tabelas de ponteiro de texto (offset de arquivo) ----
const STRTAB = {
  universal:      { ptr: 0x005567F0, count: 767, note: 'termos de menu, nomes de habilidades/magias, buffs' },
  itemLocNames:   { ptr: 0x00526680, count: 753, note: 'nomes de itens, jobs, monstros, areas e meses' },
  missionNames:   { ptr: 0x0055A64C, count: 512, note: 'nomes de missoes' },
  unitNames:      { ptr: 0x005680DC, count: 725, note: 'pool de nomes de unidades + personagens nomeados' },
  storyChars:     { ptr: 0x005516D0, count: 107, note: 'nomes de personagens de historia / especiais' },
  clanNames:      { ptr: 0x00565F14, count: 128, note: 'nomes de clas (proprio e inimigos)' },
  areaTypeNames:  { ptr: 0x005668B0, count:  84, note: 'tipos de local no mapa (Pub, Shop, Prison, ...)' },
  clanTitles:     { ptr: 0x00569034, count:  52, note: 'titulos/prefixos de cla' },
  dummyTable:     { ptr: 0x00557E98, count:  92, note: 'quase tudo "dummy" (nao usado)' },
};

// ---- estruturas de dados ----
const ITEMS   = { ptr: 0x0051D1A0, count: 0x177, size: 0x20 }; // 374
const ABIL    = { ptr: 0x0055187C, count: 0x15B, size: 0x1C }; // 347
const JOBS    = { ptr: 0x00521A14, count: 0x74,  size: 0x34 }; // 116 (0x00..0x73)
const JOBREQ  = { ptr: 0x005231A4, size: 0x04 };
const EQUIP_MASK_TABLE = 0x0051D0F4; // word por indice: bitmask de tipos equipaveis

function loadRom(p) {
  const d = fs.readFileSync(p);
  const code = d.slice(0xAC, 0xB0).toString('latin1');
  if (code !== EXPECT.gameCode) {
    throw new Error(`ROM inesperada: gamecode=${code} (esperado ${EXPECT.gameCode})`);
  }
  return d;
}

// =====================================================================
// Decodificador de texto FFTA
// =====================================================================
// Ha duas "fontes": strings prefixadas por 0x01 (dialogo) e por 0x80
// (menu, um deslocamento de -1 em relacao a fonte 0x01). Alfabeto:
//   fonte 0x80: 'A'=0xB0.., 'a'=0xCA.., '0'=0xA6..
//   fonte 0x01: 'A'=0xB1.., 'a'=0xCB..   (digitos idem via wrapper)
// Bytes de controle conhecidos sao traduzidos; desconhecidos viram \xHH.
// glifos especiais confirmados por decodificacao cruzada com a wiki
// Pontuacao. A maior parte fica num bloco alto compartilhado pelas duas fontes
// e e emitida como byte simples (sem prefixo). O ponto final difere: 0xE4 na
// fonte de menu (0x80), 0xE5 na fonte de dialogo (0x01) -- 0xE4 la e a letra 'z'.
const PUNCT_COMMON = {
  0x07: '%', 0x08: '&',
  0xE8: ':', 0xEA: '?', 0xEB: '?', 0xEC: '!', 0xEE: ':',
  0xF1: '&', 0xF2: '/', 0xF4: "'", 0xF7: '"', 0xF8: '"', 0xFD: '+', 0xFE: '-',
  0x02: '<', 0x03: '>',
};

function decodeStringAt(d, off) {
  let out = '';
  let p = off;
  let guard = 0;
  let font = 0x01;                                // fonte corrente (0x01 dialogo / 0x80 menu)
  const unknown = new Set();
  while (guard++ < 2000) {
    const b = d[p++];
    if (b === undefined || b === 0x00) break;
    if (b === 0x01) { font = 0x01; continue; }     // marcador de inicio / fonte de dialogo
    if (b === 0xFF) { out += '-'; continue; }      // traco (entrada vazia)
    if (b === 0x80 || b === 0x81) {                // fonte de menu (1 arg)
      font = 0x80;
      const c = d[p++];
      out += glyph(c, 0x80, unknown);
      continue;
    }
    if (b === 0x40) {                              // pontuacao / kerning (1 arg; as vezes +1 byte de largura)
      const c = d[p++];
      if (c === 0x73) { out += ' '; }
      else if (c === 0x3e) { out += ' '; if (d[p] < 0x20) p++; }   // quebra de palavra = espaco
      else if (c === 0x3c) { if (d[p] < 0x20) p++; }               // par de kerning, sem espaco
      else if (PUNCT[c] !== undefined) { out += PUNCT[c]; }
      else { out += '\\x40' + c.toString(16); }
      continue;
    }
    if (b >= 0x50 && b <= 0x53) { p++; continue; } // codigos de cor/tamanho (1 arg) -> ignora
    if (b === 0xFC || b === 0xF9 || b === 0xFB || b === 0xF0) { continue; } // wrappers / quebra interna
    out += glyph(b, font, unknown);               // byte simples na fonte corrente
  }
  return { text: out, unknown: [...unknown] };
}

function glyph(b, font, unknown) {
  if (b === 0x73) return ' ';
  if (PUNCT_COMMON[b] !== undefined) return PUNCT_COMMON[b];
  if (font === 0x80) {
    if (b >= 0xB0 && b <= 0xC9) return String.fromCharCode(65 + (b - 0xB0));
    if (b >= 0xCA && b <= 0xE3) return String.fromCharCode(97 + (b - 0xCA));
    if (b >= 0xA6 && b <= 0xAF) return String.fromCharCode(48 + (b - 0xA6));
    if (b === 0xE4) return '.';
  } else {
    if (b >= 0xB1 && b <= 0xCA) return String.fromCharCode(65 + (b - 0xB1));
    if (b >= 0xCB && b <= 0xE4) return String.fromCharCode(97 + (b - 0xCB));
    if (b >= 0xA7 && b <= 0xB0) return String.fromCharCode(48 + (b - 0xA7));
    if (b === 0xE5) return '.';
  }
  unknown.add('0x' + b.toString(16).padStart(2, '0'));
  return '\\x' + b.toString(16).padStart(2, '0');
}

function readStringTable(d, def) {
  const rows = [];
  const unknownAll = {};
  for (let i = 0; i < def.count; i++) {
    const ptr = d.readUInt32LE(def.ptr + i * 4);
    if (ptr < GBA_BASE || ptr >= GBA_BASE + d.length) { rows.push({ index: i, ptr: ptr >>> 0, text: null }); continue; }
    const off = ptr - GBA_BASE;
    const { text, unknown } = decodeStringAt(d, off);
    for (const u of unknown) unknownAll[u] = (unknownAll[u] || 0) + 1;
    rows.push({ index: i, text });
  }
  return { rows, unknownAll };
}

// =====================================================================
// Leitura das tabelas de dados
// =====================================================================
const JOB_ABIL_PTRS = 0x0051BA84; // + Race*4 -> tabela de habilidades aprendiveis (8 bytes/entrada)

function str(d, table, idx) {
  if (idx == null) return null;
  const base = STRTAB[table].ptr;
  const ptr = d.readUInt32LE(base + idx * 4);
  if (ptr < GBA_BASE || ptr >= GBA_BASE + d.length) return null;
  return decodeStringAt(d, ptr - GBA_BASE).text;
}

function readItems(d) {
  const out = [];
  for (let i = 0; i < ITEMS.count; i++) {
    const o = ITEMS.ptr + i * ITEMS.size;
    const nameId = d.readUInt16LE(o + 0x00);
    out.push({
      index: i,
      nameId,
      name: str(d, 'itemLocNames', nameId),
      descriptionId: d.readUInt16LE(o + 0x02),
      buyValue: d.readUInt16LE(o + 0x04),
      sellValue: d.readUInt16LE(o + 0x06),
      typeId: d[o + 0x08],
      elementId: d[o + 0x09],
      range: (d[o + 0x0A] << 24) >> 24,
      wornId: d[o + 0x0B],
      attack: d[o + 0x10],
      defense: d[o + 0x11],
      power: d[o + 0x12],
      resistance: d[o + 0x13],
      speed: (d[o + 0x14] << 24) >> 24,
      evade: (d[o + 0x15] << 24) >> 24,
      move: (d[o + 0x16] << 24) >> 24,
      jump: (d[o + 0x17] << 24) >> 24,
      effectIds: [d[o + 0x1A], d[o + 0x1B], d[o + 0x1C]],
      teachesAbilityByte: d[o + 0x1D],
      raw: d.slice(o, o + ITEMS.size).toString('hex'),
    });
  }
  return out;
}

function readAbilities(d) {
  const out = [];
  for (let i = 0; i < ABIL.count; i++) {
    const o = ABIL.ptr + i * ABIL.size;
    const nameId = d.readUInt16LE(o + 0x00);
    out.push({
      index: i,
      nameId,
      name: str(d, 'universal', nameId),
      elementId: d[o + 0x02],
      apCost: d[o + 0x03] * 10,
      mpCost: d[o + 0x04],
      weaponRequiredId: d[o + 0x05],
      horizontalRange: d[o + 0x06],
      verticalRange: d[o + 0x07],
      targetingId: d[o + 0x08],
      horizontalAoE: d[o + 0x09],
      verticalAoE: d[o + 0x0A],
      power: d[o + 0x0B],
      effectIds: [d[o + 0x0C], d[o + 0x0D], d[o + 0x0E], d[o + 0x0F]],
      properties: d.readUInt32LE(o + 0x10) >>> 0,
      animationId: d.readUInt16LE(o + 0x14),
      descriptionId: d.readUInt16LE(o + 0x16),
      aiConditionId: d[o + 0x18],
      aiBehaviorId: d[o + 0x19],
      aiPriority: d[o + 0x1A],
      raw: d.slice(o, o + ABIL.size).toString('hex'),
    });
  }
  return out;
}

// job.Elements: 32 bits -> 00 000 DDD HHH LLL III WWW EEE AAA FFF 000
function decodeElementResist(word) {
  const order = ['Dark', 'Holy', 'Lightning', 'Ice', 'Water', 'Earth', 'Wind', 'Fire'];
  const res = {};
  for (let k = 0; k < 8; k++) {
    const v = (word >>> (3 + k * 3)) & 0x7;
    res[order[7 - k]] = v; // preenche Fire..Dark
  }
  // reordena Fire->Dark
  const ordered = {};
  for (const el of ['Fire', 'Wind', 'Earth', 'Water', 'Ice', 'Lightning', 'Holy', 'Dark']) ordered[el] = res[el];
  return ordered;
}

function readJobLearnset(d, race, start, end) {
  const tp = d.readUInt32LE(JOB_ABIL_PTRS + race * 4);
  if (tp < GBA_BASE) return [];
  const base = tp - GBA_BASE;
  const list = [];
  for (let i = start; i < end; i++) {
    const o = base + i * 8;
    if (o + 8 > d.length) break;
    list.push({
      slot: i,
      nameId: d.readUInt16LE(o + 0x00),
      name: str(d, 'universal', d.readUInt16LE(o + 0x00)),
      descriptionId: d.readUInt16LE(o + 0x02),
      abilityId: d.readUInt16LE(o + 0x04),
      typeId: d[o + 0x06],
      apCost: d[o + 0x07] * 10,
    });
  }
  return list;
}

function readJobs(d) {
  const out = [];
  for (let i = 0; i < JOBS.count; i++) {
    const o = JOBS.ptr + i * JOBS.size;
    const nameId = d.readUInt16LE(o + 0x00);
    const race = d[o + 0x04];
    const reqIdx = d[o + 0x30];
    const rq = JOBREQ.ptr + reqIdx * JOBREQ.size;
    const start = d[o + 0x2E], end = d[o + 0x2F];
    out.push({
      index: i,
      nameId,
      name: str(d, 'itemLocNames', nameId),
      raceId: race,
      spriteIndex: d.readUInt16LE(o + 0x07),
      aAbilityIndex: d[o + 0x10],
      elementResistWord: d.readUInt32LE(o + 0x12) >>> 0,
      elementResist: decodeElementResist(d.readUInt32LE(o + 0x12) >>> 0),
      statusDefense: d[o + 0x16],
      baseHp: d[o + 0x17],
      baseMp: d[o + 0x18],
      baseSpeed: d[o + 0x19],
      hpGrowth: d[o + 0x20],
      mpGrowth: d[o + 0x21],
      speedGrowth: d[o + 0x22],
      attackGrowth: d[o + 0x23],
      defenseGrowth: d[o + 0x24],
      powerGrowth: d[o + 0x25],
      resistGrowth: d[o + 0x26],
      move: d[o + 0x28],
      jump: d[o + 0x29],
      evade: d[o + 0x2A],
      movementStyleByte: d[o + 0x2B],
      equipMaskIndex: d[o + 0x2D],
      equipMask: d.readUInt32LE(EQUIP_MASK_TABLE + d[o + 0x2D] * 4) >>> 0,
      abilitySlotStart: start,
      abilitySlotEnd: end,
      jobRequirementIndex: reqIdx,
      requirements: [
        { jobId: d[rq + 0], abilitiesNeeded: d[rq + 1] },
        { jobId: d[rq + 2], abilitiesNeeded: d[rq + 3] },
      ].filter((r) => r.abilitiesNeeded > 0),
      learnset: readJobLearnset(d, race, start, end),
      raw: d.slice(o, o + JOBS.size).toString('hex'),
    });
  }
  return out;
}

module.exports = {
  GBA_BASE, EXPECT, STRTAB, ITEMS, ABIL, JOBS, JOBREQ, EQUIP_MASK_TABLE, JOB_ABIL_PTRS,
  loadRom, decodeStringAt, readStringTable, str,
  readItems, readAbilities, readJobs, decodeElementResist,
};
