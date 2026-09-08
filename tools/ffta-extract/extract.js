'use strict';
/*
 * extract.js — le tools/rom.gba e gera JSON estruturado em tools/extracted/.
 *
 *   node tools/ffta-extract/extract.js [caminho/para/rom.gba]
 *
 * Nao modifica a ROM. Tudo que sai daqui vem de tabelas documentadas em
 * datacrystal.tcrf.net/wiki/Final_Fantasy_Tactics_Advance (US, gamecode AFXE).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const F = require('./ffta');
const L = require('./labels');

const ROM = process.argv[2] || path.join(__dirname, '..', 'rom.gba');
const OUT = path.join(__dirname, '..', 'extracted');

function w(rel, obj) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  const n = Array.isArray(obj) ? obj.length : (obj.entries ? obj.entries.length : '');
  console.log('  ' + rel + (n !== '' ? '  (' + n + ')' : ''));
}

function bitsToList(mask, names) {
  const r = [];
  for (let i = 0; i < 32; i++) if (mask & (1 << i)) r.push(names[i] || ('bit' + i));
  return r;
}

const d = F.loadRom(ROM);
const md5 = crypto.createHash('md5').update(d).digest('hex');
const sha1 = crypto.createHash('sha1').update(d).digest('hex');
console.log('ROM ok:', d.slice(0xA0, 0xAC).toString('latin1').replace(/\0/g, ''), md5);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- rom-info
w('rom-info.json', {
  file: path.basename(ROM),
  bytes: d.length,
  internalTitle: d.slice(0xA0, 0xAC).toString('latin1').replace(/\0/g, ''),
  gameCode: d.slice(0xAC, 0xB0).toString('latin1'),
  makerCode: d.slice(0xB0, 0xB2).toString('latin1'),
  softwareVersion: d[0xBC],
  md5, sha1,
  region: 'USA',
  game: 'Final Fantasy Tactics Advance',
  matchesKnownGoodDump: md5 === F.EXPECT.md5,
  generatedAt: new Date().toISOString(),
  source: 'Data Crystal ROM map / Items / Abilities / Jobs / String Tables',
});

// ---------------------------------------------------------------- strings
console.log('strings:');
const strOut = {};
for (const key of Object.keys(F.STRTAB)) {
  const def = F.STRTAB[key];
  const { rows } = F.readStringTable(d, def);
  strOut[key] = rows;
  w('strings/' + key + '.json', {
    table: key,
    note: def.note,
    pointerTableOffset: '0x' + def.ptr.toString(16).toUpperCase(),
    entryCount: def.count,
    entries: rows.map((r) => ({ index: r.index, text: r.text })),
  });
}

// ---------------------------------------------------------------- items
console.log('items:');
const items = F.readItems(d).map((it) => ({
  index: it.index,
  name: it.name,
  type: L.ITEM_TYPE[it.typeId] ?? ('type_' + it.typeId),
  slot: L.WORN[it.wornId] ?? ('worn_' + it.wornId),
  element: L.ELEMENT[it.elementId] ?? ('elem_' + it.elementId),
  buy: it.buyValue,
  sell: it.sellValue,
  range: it.range,
  stats: {
    attack: it.attack, defense: it.defense, power: it.power, resistance: it.resistance,
    speed: it.speed, evade: it.evade, move: it.move, jump: it.jump,
  },
  effectIds: it.effectIds.filter((x) => x !== 0),
  teachesAbilityByte: it.teachesAbilityByte,
  ids: { nameId: it.nameId, descriptionId: it.descriptionId },
  raw: it.raw,
}));
w('items.json', items);

// ---------------------------------------------------------------- abilities
console.log('abilities:');
const abilities = F.readAbilities(d).map((a) => ({
  index: a.index,
  name: a.name,
  element: L.ELEMENT[a.elementId] ?? ('elem_' + a.elementId),
  apToLearn: a.apCost,
  mpCost: a.mpCost,
  power: a.power,
  weaponRequirement: L.WEAPON_REQ[a.weaponRequiredId] ?? ('req_' + a.weaponRequiredId),
  targeting: L.TARGETING[a.targetingId] ?? ('target_' + a.targetingId),
  range: { horizontal: a.horizontalRange, vertical: a.verticalRange },
  areaOfEffect: { horizontal: a.horizontalAoE, vertical: a.verticalAoE },
  effectIds: a.effectIds.filter((x) => x !== 0),
  propertiesFlags: '0x' + a.properties.toString(16).padStart(8, '0'),
  ai: {
    conditionId: a.aiConditionId,
    behavior: L.AI_BEHAVIOR[a.aiBehaviorId] ?? ('ai_' + a.aiBehaviorId),
    priority: a.aiPriority,
  },
  ids: { nameId: a.nameId, descriptionId: a.descriptionId, animationId: a.animationId },
  raw: a.raw,
}));
w('abilities.json', abilities);

// ---------------------------------------------------------------- jobs
console.log('jobs:');
const jobsRaw = F.readJobs(d);
const jobs = jobsRaw.map((j) => ({
  index: j.index,
  name: j.name,
  race: L.RACE[j.raceId] ?? ('race_' + j.raceId),
  playable: j.raceId >= 1 && j.raceId <= 5,
  base: { hp: j.baseHp, mp: j.baseMp, speed: j.baseSpeed },
  growth: {
    hp: j.hpGrowth, mp: j.mpGrowth, speed: j.speedGrowth, attack: j.attackGrowth,
    defense: j.defenseGrowth, power: j.powerGrowth, resistance: j.resistGrowth,
  },
  movement: { move: j.move, jump: j.jump, evade: j.evade },
  elementResist: Object.fromEntries(
    Object.entries(j.elementResist).map(([k, v]) => [k, L.resistName(v)])),
  statusDefense: j.statusDefense,
  equippable: bitsToList(j.equipMask, L.EQUIP_SLOT_BITS),
  unlockRequirements: j.requirements.map((r) => ({
    job: (jobsRaw[r.jobId] && jobsRaw[r.jobId].name) || null,
    jobId: r.jobId,
    abilitiesToMaster: r.abilitiesNeeded,
  })),
  jobRequirementIndex: j.jobRequirementIndex,
  learnset: j.learnset.map((s) => ({
    ability: s.name,
    abilityId: s.abilityId,
    kind: L.ABILITY_TYPE[s.typeId] ?? ('type_' + s.typeId),
    apToMaster: s.apCost,
  })),
  ids: { nameId: j.nameId, spriteIndex: j.spriteIndex, aAbilityIndex: j.aAbilityIndex },
  raw: j.raw,
}));
w('jobs.json', jobs);

// ---------------------------------------------------------------- map index
console.log('maps:');
const MAP_BASE = 0x569104, MAP_COUNT = 163, MAP_REC = 88;
const maps = [];
for (let i = 0; i < MAP_COUNT; i++) {
  const o = MAP_BASE + i * MAP_REC;
  const g = d.readUInt32LE(o + 0) + MAP_BASE;
  const a = d.readUInt32LE(o + 4) + MAP_BASE;
  const h = d.readUInt32LE(o + 16) + MAP_BASE;
  maps.push({
    index: i,
    graphicsOffset: '0x' + (g >>> 0).toString(16).toUpperCase(),
    arrangementOffset: '0x' + (a >>> 0).toString(16).toUpperCase(),
    heightMapOffset: '0x' + (h >>> 0).toString(16).toUpperCase(),
    note: 'dados comprimidos (formato GBAmdc). Ver tools/FFTAUtils.',
  });
}
w('maps-index.json', {
  note: 'Tabela de registros de mapa. base=0x569104, 163 registros de 88 bytes. '
      + 'Offsets sao diffs somados a base. Graphics/Arrangement/Height sao streams comprimidos.',
  pointerTableOffset: '0x569104',
  recordSize: 88,
  count: MAP_COUNT,
  maps,
});

console.log('OK ->', OUT);
