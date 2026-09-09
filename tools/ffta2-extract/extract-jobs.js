'use strict';
/*
 * Extrai a tabela de Jobs do FFTA2 para tools/extracted-ffta2/jobs.json,
 * na mesma linha do jobs.json do FFTA1.
 *
 *
 * OS OFFSETS DESTA ROM
 *
 * O ROM map publicado do FFTA2 e da versao AMERICANA. Esta ROM e a EUROPEIA
 * (FFTA2-EU, gameCode A6FP) e no endereco publicado nao ha dado nenhum -- so
 * 5-30% dos campos caiam no dominio documentado, o que e ruido.
 *
 * As tabelas existem, deslocadas de exatamente +0x200. O delta foi ACHADO, nao
 * chutado: find-tables.js varre a ROM inteira procurando a assinatura da
 * estrutura de Job Data (8 bytes de afinidade elemental que so podem valer
 * 0..4, mais move/stand/gender com dominio estreito) e exige conteudo real --
 * as 7 racas jogaveis presentes, os 3 generos, afinidade que varia. De 111
 * candidatos por dominio, sobrou UM: 0x053D6A64, que e exatamente o endereco
 * publicado (0x053D6864) + 0x200.
 *
 * A validacao no endereco novo fecha: Race, MoveType, Gender e as 1304
 * afinidades dao 100% dentro do dominio; as 11 primeiras entradas sao todas
 * Hume com ability set numerado 1,2,3...11 em sequencia; e a contagem por raca
 * bate com o jogo real -- Seeq e Gria tem 4 jobs cada, que e o numero certo.
 *
 * O mesmo delta vale para as outras seis tabelas (Ability Data da 100% em
 * Element, Ability Sets 100% em primeira<=ultima, Ability Table 100% em MaxAP).
 *
 * Tudo aqui e leitura: a ROM nao e modificada nem versionada.
 */

const fs = require('fs');
const path = require('path');

const ROM = path.resolve(__dirname, '../ffta2.nds');
const OUT = path.resolve(__dirname, '../extracted-ffta2');

/** Deslocamento da versao europeia em relacao ao ROM map americano. */
const DELTA_EU = 0x200;

/** Tabelas do ROM map (enderecos da versao americana). */
const TABELAS = {
  specialUnitGraphics: { us: 0x053d5bec, entrada: 0x1c, entradas: 114 },
  jobData: { us: 0x053d6864, entrada: 0x48, entradas: 163 },
  abilitySets: { us: 0x053d963c, entrada: 0x0c, entradas: 96 },
  abilityTable: { us: 0x053d9abc, entrada: 0x0c, entradas: 722 },
  abilityData: { us: 0x053dbc94, entrada: 0x34, entradas: 822 },
  abilityAnimations: { us: 0x053e638c, entrada: 0x18, entradas: 822 },
  equipmentData: { us: 0x053fb748, entrada: 0x28, entradas: 412 },
};

const RACAS = ['None', 'Hume', 'Bangaa', 'Nu Mou', 'Viera', 'Moogle', 'Seeq', 'Gria'];
const MOVE_TYPE = ['Null', 'Walk', 'Fly', 'Teleport'];
const STAND_TYPE = ['Null', 'Short', 'Normal', 'Crawl', 'Float'];
const GENERO = ['Ambiguo', 'Feminino', 'Masculino'];
const AFINIDADE = ['Weak', 'Neutral', 'Resist', 'Nullify', 'Absorb'];
const ELEMENTOS = ['fire', 'air', 'earth', 'water', 'ice', 'thunder', 'holy', 'dark'];

// Tipos de equipamento, indexados pelo bit (ver "Notes on Equipment").
const EQUIP = [
  'None', 'Knives', 'Swords', 'Blades', 'Sabers', 'Knightswords', 'Rapiers',
  'Greatswords', 'Broadswords', 'Katana', 'Spears', 'Rods', 'Staves', 'Poles',
  'Knuckles', 'Bows', 'Greatbows', 'Guns', 'Instruments', 'Cannons', '?',
  'Axes', 'Hammers', 'Maces', 'Cards', 'Books', 'Shields', 'Helmets', 'Ribbons',
  'Hats', 'Heavy Armor', 'Light Armor', 'Cloth Armor', 'Shoes', 'Armguards',
  'Accessories',
];

/**
 * Array de bits do campo Equipment.
 *
 * O ROM map chama de "big-endian binary array", mas o exemplo dele mostra
 * outra coisa: `84 00 00 EC 0E` e escrito como
 * `00100001 00000000 00000000 00110111 01110000`, e 0x84 e 10000100, nao
 * 00100001. Cada byte aparece com os bits INVERTIDOS -- ou seja a ordem e
 * LSB-first dentro do byte, e nao MSB-first.
 *
 * Conferindo pelo proprio exemplo: com LSB-first, 0x84 acende os bits 2 e 7 =
 * Swords e Greatswords; 0xEC acende 26,27,29,30,31 = Shields, Helmets, Hats,
 * Heavy e Light Armor; 0x0E acende 33,34,35 = Shoes, Armguards, Accessories.
 * Isso e um guerreiro coerente. Com MSB-first sairia Cards e Books num
 * Soldier, que foi como o erro apareceu.
 */
function bitsEquip(buf, off, nBytes, rotulos) {
  const out = [];
  for (let i = 0; i < nBytes * 8; i++) {
    const byte = buf[off + (i >> 3)];
    if ((byte >> (i & 7)) & 1) out.push(rotulos[i] || `bit${i}`);
  }
  return out;
}

function lerJob(buf, base, indice) {
  const u8 = (o) => buf[base + o];
  const u16 = (o) => buf.readUInt16LE(base + o);

  const stats = {};
  const nomes = ['hp', 'mp', 'speed', 'attack', 'defense', 'magick', 'resistance'];
  for (let i = 0; i < nomes.length; i++) {
    stats[nomes[i]] = { base: u8(0x13 + i * 2), growth: u8(0x13 + i * 2 + 1) };
  }
  // "Base speed is 50 + [value]" -- ver notas sobre stats no ROM map.
  stats.speed.realBase = 50 + stats.speed.base;

  const afinidades = {};
  for (let i = 0; i < 8; i++) {
    const v = u8(0x21 + i);
    afinidades[ELEMENTOS[i]] = AFINIDADE[v] !== undefined ? AFINIDADE[v] : v;
  }

  const raca = u8(0x0e);
  return {
    index: indice,
    offset: base,
    portrait: u16(0x00),
    enemyPortrait: u16(0x02),
    sprite: u16(0x04),
    enemySprite: u16(0x08),
    palette: u8(0x0c),
    enemyPalette: u8(0x0d),
    race: raca,
    raceName: RACAS[raca] || `Monstro 0x${raca.toString(16)}`,
    playable: raca >= 1 && raca <= 7,
    moveType: MOVE_TYPE[u8(0x0f)] ?? u8(0x0f),
    standType: STAND_TYPE[u8(0x10)] ?? u8(0x10),
    move: u8(0x11),
    jump: u8(0x12),
    stats,
    affinities: afinidades,
    // "Evasion = 100% - [Value]" e o mesmo para Resilience.
    evasion: 100 - u8(0x29),
    resilience: 100 - u8(0x2d),
    abilitySet: u16(0x2e),
    unarmedBonus: u8(0x30),
    gender: GENERO[u8(0x33)] ?? u8(0x33),
    topScreenSprite: u8(0x3a),
    enemyTopScreenSprite: u8(0x40),
    equipment: bitsEquip(buf, base + 0x43, 5, EQUIP),
  };
}

/**
 * Acha a tabela de nomes de job e a le em ordem.
 *
 * A tabela e localizada procurando "Soldier" JA CODIFICADO no alfabeto do
 * FFTA2 (ver extract-strings.js: 0x01 espaco, 0x02-0x1B A-Z, 0x1C-0x35 a-z),
 * e nao por offset fixo -- assim funciona em qualquer versao da ROM.
 *
 * O casamento com o Job Data e `nome[i] -> jobs[i+1]`, porque a entrada 0 do
 * Job Data e o placeholder "None", zerado. Isso foi confirmado em TODAS as
 * fronteiras de raca: Bangaa comeca em Warrior, Nu Mou em White Mage, Viera em
 * Fencer, Moogle em Animist, Seeq em Berserker e Gria em Hunter -- que sao os
 * primeiros jobs de cada raca no jogo. Os monstros seguem na mesma tabela
 * (Baknamy, Sprite, Lamia, Wolf...).
 */
function lerNomesDeJob(buf, quantos) {
  const { decodeString, ehLetra } = require('./extract-strings');

  const codificar = (s) => Buffer.from([...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if (ch === ' ') return 0x01;
    if (c >= 65 && c <= 90) return 0x02 + c - 65;
    return 0x1c + c - 97;
  }));

  const inicio = buf.indexOf(codificar('Soldier'));
  if (inicio < 0) return { inicio: -1, nomes: [] };

  const nomes = [];
  for (let o = inicio; o < buf.length && nomes.length < quantos; o++) {
    if (!ehLetra(buf[o])) continue;
    const r = decodeString(buf, o, 3);
    if (!r || r.texto.length < 3) continue;
    nomes.push(r.texto);
    o = r.fim - 1;
  }
  return { inicio, nomes };
}

function main() {
  if (!fs.existsSync(ROM)) {
    console.error(`nao encontrei ${ROM} (a ROM nao e versionada)`);
    process.exit(1);
  }
  const buf = fs.readFileSync(ROM);

  const t = TABELAS.jobData;
  const inicio = t.us + DELTA_EU;
  const jobs = [];
  for (let i = 0; i < t.entradas; i++) jobs.push(lerJob(buf, inicio + i * t.entrada, i));

  // --- nomes
  const { inicio: iniNomes, nomes } = lerNomesDeJob(buf, jobs.length);
  for (let i = 0; i < jobs.length; i++) {
    jobs[i].name = i === 0 ? 'None' : (nomes[i - 1] || null);
  }

  // --- nome do conjunto de habilidades de cada job.
  // "Arts of War" e ancora: e o primeiro nome do bloco e o set 1 do jogo.
  const { decodeString, ehLetra } = require('./extract-strings');
  const codificar = (s) => Buffer.from([...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if (ch === ' ') return 0x01;
    if (c >= 65 && c <= 90) return 0x02 + c - 65;
    return 0x1c + c - 97;
  }));
  const iniSets = buf.indexOf(codificar('Arts of War'));
  const nomesSets = [];
  if (iniSets >= 0) {
    for (let o = iniSets; o < buf.length && nomesSets.length < 128; o++) {
      if (!ehLetra(buf[o])) continue;
      const r = decodeString(buf, o, 2);
      if (!r || r.texto.length < 1) continue;
      nomesSets.push(r.texto);
      o = r.fim - 1;
    }
  }
  for (const j of jobs) {
    j.abilitySetName = j.abilitySet > 0 ? (nomesSets[j.abilitySet - 1] || null) : null;
  }

  const porRaca = {};
  for (const j of jobs) porRaca[j.raceName] = (porRaca[j.raceName] || 0) + 1;

  fs.mkdirSync(OUT, { recursive: true });

  // Manifesto das tabelas, com o endereco JA corrigido para esta ROM.
  const tabelas = {};
  for (const [nome, v] of Object.entries(TABELAS)) {
    tabelas[nome] = {
      publishedUS: `0x${v.us.toString(16)}`,
      thisRom: `0x${(v.us + DELTA_EU).toString(16)}`,
      entrySize: v.entrada,
      entryCount: v.entradas,
      bytes: v.entrada * v.entradas,
    };
  }
  fs.writeFileSync(path.join(OUT, 'tables.json'), JSON.stringify({
    rom: 'ffta2.nds', region: 'Europa', gameCode: 'A6FP',
    note: 'O ROM map publicado e da versao americana. Nesta ROM as tabelas estao em publishedUS + delta.',
    delta: `0x${DELTA_EU.toString(16)}`,
    tables: tabelas,
    generatedAt: new Date().toISOString(),
  }, null, 2));

  fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify({
    source: `ffta2.nds @ 0x${inicio.toString(16)} (ROM map US + 0x${DELTA_EU.toString(16)})`,
    count: jobs.length,
    byRace: porRaca,
    generatedAt: new Date().toISOString(),
    jobs,
  }, null, 2));

  console.log(`jobs.json   ${jobs.length} entradas de 0x${inicio.toString(16)}`);
  console.log(`tables.json ${Object.keys(TABELAS).length} tabelas, delta +0x${DELTA_EU.toString(16)}`);
  console.log('');
  console.log('por raca:');
  for (const [r, n] of Object.entries(porRaca).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}x  ${r}`);
  }
}

if (require.main === module) main();
module.exports = { TABELAS, DELTA_EU, lerJob };
