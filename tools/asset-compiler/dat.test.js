'use strict';
/* Rodar:  node --test tools/asset-compiler/dat.test.js */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildDat, ATTR_VISUAL_ONLY, ATTR_WATER } = require('./dat.js');
const { readDat } = require('./dat-read.js');

const THINGTYPE_H = path.resolve(__dirname, '../../client/src/client/thingtype.h');

function coisaMinima(attrs) {
  return {
    attrs,
    groups: [{
      type: 0,
      width: 1, height: 1, layers: 1,
      patternX: 1, patternY: 1, patternZ: 1,
      phases: 1,
      sprites: [7],
    }],
  };
}

function ida_e_volta(attrs) {
  const buf = buildDat({
    signature: 1,
    items: [coisaMinima(attrs)],
    outfits: [],
    effects: [],
    missiles: [],
  });
  return readDat(buf).items[0].attrs;
}

test('atributos sobrevivem a ida e volta', () => {
  const attrs = {
    ground: 110,
    displacement: [-64, 48],
    elevation: 8,
    fullGround: true,
    visualOnly: true,
  };
  assert.deepStrictEqual(ida_e_volta(attrs), attrs);
});

test('displacement negativo continua negativo', () => {
  // Ele vai para o arquivo como u16; ler de volta como u16 daria 65472.
  assert.deepStrictEqual(ida_e_volta({ displacement: [-64, -160] }).displacement, [-64, -160]);
});

test('sem visualOnly o atributo nao e escrito', () => {
  assert.strictEqual(ida_e_volta({ ground: 110 }).visualOnly, undefined);
});

test('ATTR_WATER casa com ThingAttrWater do client', () => {
  /*
   * Este e o teste que importa numa flag sem carga.
   *
   * Atributo sem payload cai no `default` de ThingType::unserialize, que
   * registra QUALQUER numero desconhecido como true. Entao escrever o numero
   * errado nao produz erro em lugar nenhum: o .dat carrega, o client guarda um
   * atributo que ninguem consulta, e isWater() devolve false para sempre. O
   * sintoma seria "a flag nao faz nada", a quilometros da causa.
   *
   * Como o valor mora em duas linguagens, so um teste que le as DUAS pode
   * garantir que continuam iguais.
   */
  const fonte = fs.readFileSync(THINGTYPE_H, 'utf8');
  const m = fonte.match(/ThingAttrWater\s*=\s*(\d+)/);
  assert.ok(m, 'ThingAttrWater nao encontrado em thingtype.h');
  assert.strictEqual(Number(m[1]), ATTR_WATER,
    `o client usa ${m[1]} e o compilador usa ${ATTR_WATER}`);
});

test('o numero da flag nao colide com nenhum outro ThingAttr', () => {
  const fonte = fs.readFileSync(THINGTYPE_H, 'utf8');
  const enumBody = fonte.slice(fonte.indexOf('enum ThingAttr'));
  const usados = new Map();
  for (const linha of enumBody.slice(0, enumBody.indexOf('};')).split('\n')) {
    const m = linha.match(/(ThingAttr\w+)\s*=\s*(\d+)/);
    if (!m) continue;
    const valor = Number(m[2]);
    if (usados.has(valor)) {
      assert.fail(`${m[1]} e ${usados.get(valor)} usam ambos ${valor}`);
    }
    usados.set(valor, m[1]);
  }
  assert.strictEqual(usados.get(ATTR_WATER), 'ThingAttrWater');
});

test('102 continua reservado: nenhum ThingAttr do client o ocupa', () => {
  /*
   * O dat.js ainda emite ATTR_VISUAL_ONLY = 102, mas o client atual nao tem
   * ThingAttrVisualOnly -- o atributo caiu no reset de client/ e o numero
   * ficou reservado de proposito (ver o comentario no proprio thingtype.h).
   *
   * Reaproveitar o 102 para outra flag faria um datapack antigo ser lido como
   * essa outra coisa, calado: flag sem carga nao da erro de parse. Este teste
   * existe para que a reserva seja quebrada de propósito, nunca por descuido.
   */
  const fonte = fs.readFileSync(THINGTYPE_H, 'utf8');
  const enumBody = fonte.slice(fonte.indexOf('enum ThingAttr'));
  for (const linha of enumBody.slice(0, enumBody.indexOf('};')).split('\n')) {
    const m = linha.match(/(ThingAttr\w+)\s*=\s*(\d+)/);
    if (m && Number(m[2]) === ATTR_VISUAL_ONLY) {
      assert.fail(`${m[1]} ocupou o 102, que o dat.js ainda emite como visualOnly`);
    }
  }
});
