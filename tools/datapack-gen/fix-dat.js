'use strict';
/*
 * Aplica no client/data/things/860/Tibia.dat as duas correcoes descritas em
 * FIX-DAT.md. Idempotente: rodar duas vezes nao duplica nada.
 *
 *   1. insere ThingAttrGround (0) nos itens de chao, se faltar
 *   2. zera displacements absurdos (65520 = -16 lido como unsigned)
 *
 * O .dat nao e versionado (client/.gitignore ignora data/things/*), entao
 * este script existe para nao perder as correcoes se o arquivo for regerado.
 */

const fs = require('fs');
const path = require('path');

const DAT = path.resolve(__dirname, '../../client/data/things/860/Tibia.dat');

const ATTR_GROUND = 0;
const ATTR_DISPLACEMENT = 24;
const ATTR_LAST = 0xff;

const GROUND_SPEED = 110;
const GROUND_ITEM_COUNT = 3; // ids 100, 101, 102

/** Percorre os atributos de um ThingType a partir de `o`. */
function scanAttrs(b, o) {
  const attrs = [];
  while (o < b.length) {
    const a = b[o];
    if (a === ATTR_LAST) {
      o++;
      break;
    }
    attrs.push({ id: a, offset: o });
    if (a === ATTR_GROUND) o += 3; // u16 speed
    else if (a === ATTR_DISPLACEMENT) o += 5; // 2x u16
    else o += 1;
  }
  return { attrs, end: o };
}

/** Pula os dados de sprite e devolve o offset do proximo ThingType. */
function skipSprites(b, o) {
  const w = b[o], h = b[o + 1];
  o += 2;
  if (w > 1 || h > 1) o += 1; // exactSize
  const layers = b[o], px = b[o + 1], py = b[o + 2], pz = b[o + 3], phases = b[o + 4];
  o += 5;
  const n = w * h * layers * px * py * pz * phases;
  return o + n * 4; // extended: u32 por sprite
}

function main() {
  if (!fs.existsSync(DAT)) {
    console.error(`nao encontrei ${DAT}`);
    process.exit(1);
  }

  let b = fs.readFileSync(DAT);
  let addedGround = 0;
  let fixedDisp = 0;

  // --- passo 1: displacements absurdos (edicao in-place, nao muda o tamanho)
  {
    let o = 12;
    for (let i = 0; i < GROUND_ITEM_COUNT; i++) {
      const { attrs, end } = scanAttrs(b, o);
      for (const a of attrs) {
        if (a.id === ATTR_DISPLACEMENT) {
          const dx = b.readUInt16LE(a.offset + 1);
          const dy = b.readUInt16LE(a.offset + 3);
          if (dx > 1000 || dy > 1000) {
            b.writeUInt16LE(0, a.offset + 1);
            b.writeUInt16LE(0, a.offset + 3);
            console.log(`  id ${100 + i}: displacement ${dx},${dy} -> 0,0`);
            fixedDisp++;
          }
        }
      }
      o = skipSprites(b, end);
    }
  }

  // --- passo 2: ThingAttrGround ausente (muda o tamanho, reconstroi o buffer)
  {
    const out = [];
    for (let i = 0; i < 12; i++) out.push(b[i]);
    let o = 12;
    for (let i = 0; i < GROUND_ITEM_COUNT; i++) {
      const { attrs, end } = scanAttrs(b, o);
      if (!attrs.some((a) => a.id === ATTR_GROUND)) {
        out.push(ATTR_GROUND, GROUND_SPEED & 0xff, (GROUND_SPEED >> 8) & 0xff);
        console.log(`  id ${100 + i}: ThingAttrGround adicionado (speed=${GROUND_SPEED})`);
        addedGround++;
      }
      for (let k = o; k < end; k++) out.push(b[k]);
      const next = skipSprites(b, end);
      for (let k = end; k < next; k++) out.push(b[k]);
      o = next;
    }
    while (o < b.length) out.push(b[o++]);
    b = Buffer.from(out);
  }

  if (addedGround === 0 && fixedDisp === 0) {
    console.log('Tibia.dat ja esta correto, nada a fazer.');
    return;
  }

  fs.writeFileSync(DAT, b);
  console.log(`Tibia.dat atualizado: ${addedGround} ground, ${fixedDisp} displacement.`);
}

if (require.main === module) main();
