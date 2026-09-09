'use strict';
/*
 * Extrai as tabelas de habilidades do FFTA2 para tools/extracted-ffta2/.
 *
 * Sao tres tabelas que se referenciam:
 *   Ability Sets  (96 x 0x0C)   faixa [primeira, ultima] de cada conjunto,
 *                               que e o que o Job Data aponta em abilitySet
 *   Ability Table (722 x 0x0C)  indice da habilidade + AP para dominar
 *   Ability Data  (822 x 0x34)  a habilidade em si: elemento, MP, alcance,
 *                               alvo, efeitos, propriedades
 *
 * Enderecos: ROM map americano + 0x200, o delta desta ROM europeia, achado e
 * validado em find-tables.js / extract-jobs.js.
 *
 * Leitura apenas -- a ROM nao e modificada.
 */

const fs = require('fs');
const path = require('path');
const { TABELAS, DELTA_EU } = require('./extract-jobs');

const ROM = path.resolve(__dirname, '../ffta2.nds');
const OUT = path.resolve(__dirname, '../extracted-ffta2');

const ELEMENTOS = ['Neutral', 'Fire', 'Air', 'Earth', 'Water', 'Ice', 'Thunder', 'Holy', 'Dark'];

const ALVO = {
  0: 'Normal', 1: 'Linear ambos os lados', 2: 'Linear', 4: '4 tiles ao redor',
  5: 'Todas as unidades', 6: 'Leque', 7: 'Pela arma', 8: 'Proprio',
};

const REQUISITO = {
  0: 'Nenhum', 1: 'Na agua', 2: 'Tile natural', 3: 'Tile artificial',
  4: 'Tile com grama', 5: 'Tile arido', 6: 'Tempo limpo', 7: 'Chuva',
  8: 'Neve', 9: 'Neblina', 0x0a: 'Em Chocobo', 0x0b: 'Prime (Flintlock)',
};

const COMANDO = {
  0: 'Normal', 1: 'Ressurreicao', 2: 'Magick Frenzy', 3: 'Natural Selection',
  4: 'Nao usado', 6: 'Weapon Toss', 7: 'Gil Toss', 8: 'Mirror Items',
  9: 'Doublecast', 0x0a: 'Beastmaster',
};

/*
 * Propriedades: 16 bits em 0x20. O ROM map chama de "big endian binary array",
 * mas ele usa esse mesmo termo para o campo Equipment do Job Data -- onde o
 * proprio exemplo dele mostra os bits INVERTIDOS dentro do byte (0x84 escrito
 * como 00100001). Ou seja, LSB-first. Assumimos o mesmo aqui e VALIDAMOS: o
 * bit 3 e "0 = fisico, 1 = magico", entao habilidade que custa MP tem que
 * acender esse bit muito mais que habilidade sem custo. main() checa isso e
 * avisa se a ordem estiver trocada.
 */
const PROPRIEDADES = [
  'bit0', 'podeAlvejarSiMesmo', 'efeitoInvertidoEmUndead', 'magico',
  'aprendivelPorBlueMagick', 'contra-atacavel', 'ignoraHabilidadesR',
  'refletivel', 'bit8', 'bit9', 'bit10', 'causaDano',
  'bit12', 'roubavelPorStickyFingers', 'bit14', 'bit15',
];

function bitsLSB(buf, off, nBytes, rotulos) {
  const out = [];
  for (let i = 0; i < nBytes * 8; i++) {
    if ((buf[off + (i >> 3)] >> (i & 7)) & 1) out.push(rotulos[i] || `bit${i}`);
  }
  return out;
}

function lerAbilityData(buf, base, indice) {
  const u8 = (o) => buf[base + o];
  const u16 = (o) => buf.readUInt16LE(base + o);

  // Quatro slots de efeito, 4 bytes cada: indicador u16 + dois modificadores.
  const efeitos = [];
  for (let i = 0; i < 4; i++) {
    const o = 0x10 + i * 4;
    const ind = u16(o);
    if (ind === 0 && u8(o + 2) === 0 && u8(o + 3) === 0) continue; // slot vazio
    efeitos.push({ indicator: ind, mod1: u8(o + 2), mod2: u8(o + 3) });
  }

  // Oito slots de (raca, indice do AP na RAM). Vazios sao zerados.
  const apPorRaca = [];
  for (let i = 0; i < 8; i++) {
    const raca = u8(0x24 + i * 2), idx = u8(0x24 + i * 2 + 1);
    if (raca === 0 && idx === 0) continue;
    apPorRaca.push({ race: raca, apIndex: idx });
  }

  const el = u8(0x02);
  return {
    index: indice,
    offset: base,
    element: ELEMENTOS[el] ?? el,
    mpCost: u8(0x03),
    damageBonus: u16(0x06),
    weaponRequired: u16(0x08),
    otherRequirement: REQUISITO[u8(0x0a)] ?? `0x${u8(0x0a).toString(16)}`,
    targetType: ALVO[u8(0x0b)] ?? `0x${u8(0x0b).toString(16)}`,
    range: u8(0x0c),
    radius: u8(0x0d),
    extraCommand: COMANDO[u8(0x0f)] ?? `0x${u8(0x0f).toString(16)}`,
    effects: efeitos,
    properties: bitsLSB(buf, base + 0x20, 2, PROPRIEDADES),
    apByRace: apPorRaca,
  };
}

const { decodeString, ehLetra } = require('./extract-strings');

function codificar(s) {
  return Buffer.from([...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if (ch === ' ') return 0x01;
    if (c >= 65 && c <= 90) return 0x02 + c - 65;
    return 0x1c + c - 97;
  }));
}

/** Le strings em sequencia a partir de `off`, parando apos `quantas`. */
function lerTabelaDeTexto(buf, off, quantas, minLetras = 2) {
  const out = [];
  for (let o = off; o < buf.length && out.length < quantas; o++) {
    if (!ehLetra(buf[o])) continue;
    const r = decodeString(buf, o, minLetras);
    if (!r || r.texto.length < 1) continue;
    out.push(r.texto);
    o = r.fim - 1;
  }
  return out;
}

/**
 * Nomes de habilidade.
 *
 * Ficam num bloco que comeca com nomes de ITEM ("Potion", "Ether", ...) e so
 * depois entra nas habilidades, entao o indice do nome nao e o indice da
 * habilidade -- ha um deslocamento.
 *
 * O deslocamento nao e chutado: usamos os ability SETS como ancora. O set 1 e
 * "Arts of War", e o ROM map diz que ele cobre as habilidades
 * [firstAbility..lastAbility]. Localizando "First Aid" -- a primeira habilidade
 * de Arts of War -- dentro do bloco, o deslocamento sai por subtracao.
 *
 * A conferencia fecha nos conjuntos seguintes: Thievery cai exatamente em
 * Steal Items/Steal Gil/Loot Lv..., White Magick em Cure/Cura/Curaga/Esuna...,
 * e Black Magick em Fire/Fira/Firaga/Thunder... -- cada um com a contagem certa.
 */
function lerNomesDeHabilidade(buf, sets, quantidade) {
  // "First Aid" e ancora porque e UNICA na ROM inteira. Ancorar em "Potion",
  // que era o comeco natural do bloco, nao funciona: ela aparece 7 vezes e o
  // indexOf pega a errada.
  const posFirstAid = buf.indexOf(codificar('First Aid'));
  const setArtsOfWar = sets[1];
  if (posFirstAid < 0 || !setArtsOfWar) return { nomes: [], primeiro: null, pos: -1 };

  // First Aid E a primeira habilidade de Arts of War, entao o indice dela e
  // conhecido e a leitura segue em ordem a partir dai.
  const nomes = lerTabelaDeTexto(buf, posFirstAid, quantidade);
  return { nomes, primeiro: setArtsOfWar.firstAbility, pos: posFirstAid };
}

function main() {
  const buf = fs.readFileSync(ROM);

  // --- Ability Data
  const td = TABELAS.abilityData;
  const iniD = td.us + DELTA_EU;
  const abilities = [];
  for (let i = 0; i < td.entradas; i++) abilities.push(lerAbilityData(buf, iniD + i * td.entrada, i));

  // --- validacao da ordem dos bits de propriedade (ver comentario acima)
  const comMP = abilities.filter((a) => a.mpCost > 0);
  const semMP = abilities.filter((a) => a.mpCost === 0);
  const taxa = (arr) => (arr.length ? arr.filter((a) => a.properties.includes('magico')).length / arr.length : 0);
  const tMP = taxa(comMP), tSem = taxa(semMP);

  // --- Ability Table
  const tt = TABELAS.abilityTable;
  const iniT = tt.us + DELTA_EU;
  const tabela = [];
  for (let i = 0; i < tt.entradas; i++) {
    const o = iniT + i * tt.entrada;
    tabela.push({ index: i, ability: buf.readUInt16LE(o), maxAP: buf[o + 0x09] });
  }

  // --- Ability Sets
  const ts = TABELAS.abilitySets;
  const iniS = ts.us + DELTA_EU;
  const sets = [];
  for (let i = 0; i < ts.entradas; i++) {
    const o = iniS + i * ts.entrada;
    const first = buf.readUInt16LE(o), last = buf.readUInt16LE(o + 2);
    sets.push({ index: i, firstAbility: first, lastAbility: last, count: last >= first ? last - first + 1 : 0 });
  }

  /*
   * As tres tabelas formam uma INDIRECAO, e ignorar isso produz dado errado.
   *
   * O Ability Set nao aponta para a Ability Data: ele aponta para a Ability
   * TABLE, e e a Table que traduz para o indice da Data. Ou seja:
   *
   *   Set [first..last]  ->  Table[i].ability  ->  Data[j]
   *
   * Como isso apareceu: casando nome com Data direto, "Fire" saia com elemento
   * Neutral e MP 0, e "Cure" com elemento Thunder -- nomes certos, mecanica
   * errada. A trinca Fire/Fira/Firaga (elemento Fire, MP 8/14/18, raio 5) esta
   * na Data em 63/64/65, e o set Black Magick diz 76..84. A Table fecha a
   * conta: Table[76].ability == 63.
   *
   * Confirmado tambem pelo AP, que so a Table tem: Fire 10, Fira 25, Firaga 35
   * -- os valores do jogo. E Cure sai como elemento Holy, que e o correto no
   * FFTA2.
   *
   * Por isso o registro exportado e indexado pela TABLE (que e o "id" que os
   * conjuntos usam) e traz a mecanica da Data ja resolvida.
   */
  const { nomes: nomesHab, primeiro } = lerNomesDeHabilidade(buf, sets, tabela.length);
  const resolvidas = tabela.map((e) => {
    const dado = abilities[e.ability] || null;
    const rel = primeiro === null ? -1 : e.index - primeiro;
    return {
      id: e.index,                    // indice usado pelos ability sets
      name: rel >= 0 && rel < nomesHab.length ? nomesHab[rel] : null,
      maxAP: e.maxAP,
      dataIndex: e.ability,
      ...(dado ? {
        element: dado.element, mpCost: dado.mpCost, damageBonus: dado.damageBonus,
        weaponRequired: dado.weaponRequired, otherRequirement: dado.otherRequirement,
        targetType: dado.targetType, range: dado.range, radius: dado.radius,
        extraCommand: dado.extraCommand, effects: dado.effects,
        properties: dado.properties, apByRace: dado.apByRace,
      } : {}),
    };
  });

  // Nomes dos ability sets: bloco proprio, ancorado em "Arts of War".
  const iniSets = buf.indexOf(codificar('Arts of War'));
  const nomesSets = iniSets >= 0 ? lerTabelaDeTexto(buf, iniSets, sets.length) : [];
  for (const s of sets) {
    // set 0 e o placeholder vazio; o 1 e o primeiro nome do bloco
    s.name = s.index === 0 ? 'None' : (nomesSets[s.index - 1] || null);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const meta = { generatedAt: new Date().toISOString(), delta: `0x${DELTA_EU.toString(16)}` };
  fs.writeFileSync(path.join(OUT, 'abilities.json'), JSON.stringify({
    ...meta,
    source: `ffta2.nds: Ability Table @ 0x${iniT.toString(16)} -> Ability Data @ 0x${iniD.toString(16)}`,
    note: 'Indexado por `id`, que e o indice que os ability sets usam. A mecanica vem da Ability Data, resolvida pela Ability Table (ver a indirecao no corpo do extrator). `rawData` traz a Ability Data crua, na indexacao dela.',
    count: resolvidas.length,
    abilities: resolvidas,
    rawData: abilities,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'ability-table.json'), JSON.stringify({
    ...meta, source: `ffta2.nds @ 0x${iniT.toString(16)}`, count: tabela.length, entries: tabela,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'ability-sets.json'), JSON.stringify({
    ...meta, source: `ffta2.nds @ 0x${iniS.toString(16)}`, count: sets.length, sets,
  }, null, 2));

  console.log(`abilities.json     ${abilities.length} de 0x${iniD.toString(16)}`);
  console.log(`ability-table.json ${tabela.length} de 0x${iniT.toString(16)}`);
  console.log(`ability-sets.json  ${sets.length} de 0x${iniS.toString(16)}`);
  console.log('');
  console.log('--- validacao ---');
  console.log(`  bit "magico" aceso em ${(tMP * 100).toFixed(0)}% das que custam MP e ${(tSem * 100).toFixed(0)}% das que nao custam`);
  console.log(`  ${tMP > tSem + 0.3 ? 'OK: ordem LSB-first confirmada' : 'ATENCAO: ordem dos bits suspeita, conferir'}`);
  const elementos = {};
  for (const a of abilities) elementos[a.element] = (elementos[a.element] || 0) + 1;
  console.log('  elementos:', JSON.stringify(elementos));
  const mpMax = Math.max(...abilities.map((a) => a.mpCost));
  console.log(`  MP maximo: ${mpMax}   habilidades com MP: ${comMP.length}`);
  const setsValidos = sets.filter((s) => s.count > 0).length;
  console.log(`  ability sets nao vazios: ${setsValidos}/${sets.length}`);
}

if (require.main === module) main();
