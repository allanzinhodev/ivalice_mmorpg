'use strict';
/*
 * Troca dois slots de DIRECAO nas outfits do Tibia.dat.
 *
 * Uso:  node tools/datapack-gen/swap-outfit-dirs.js [dirA] [dirB]
 *       (padrao: east west)
 *
 * ATENCAO: NAO e idempotente -- rodar duas vezes desfaz a troca. E de
 * proposito: e uma permutacao, nao uma correcao com estado final fixo. O
 * backup fica ao lado do .dat como Tibia.dat.bak.
 *
 *
 * POR QUE ISTO EXISTE
 *
 * As 4 direcoes de uma outfit sao os patterns em X, na ordem de Otc::Direction
 * (const.h): 0=North, 1=East, 2=South, 3=West. Quem desenha costuma fazer 2
 * poses e espelhar cada uma -- e ai e facil colocar o espelho no slot errado,
 * porque qual direcao e o espelho de qual DEPENDE DA PROJECAO.
 *
 * Na projecao isometrica deste projeto (MapView::transformPositionTo2D) as
 * direcoes viram, na tela:
 *
 *     North -> cima-direita      East  -> baixo-direita
 *     South -> baixo-esquerda    West  -> cima-esquerda
 *
 * Espelhar na horizontal troca direita por esquerda. Logo o espelho do North
 * so pode ser o West, e o espelho do East so pode ser o South. Os pares
 * espelhados TEM que ser (North, West) e (East, South).
 *
 * Se os pares espelhados estiverem em (North, East) e (South, West) -- que foi
 * o caso aqui -- North e South estao certos e os dois trocados sao East e
 * West. Da para conferir sem abrir o editor: compare os sprites de cada par
 * procurando espelhamento exato (ver o diagnostico em SPRITES-DIRECAO.md).
 *
 * A troca leva junto TODAS as layers e TODAS as fases de animacao, em todos os
 * frame groups -- e o que o indice de getSpriteIndex garante ao variar so o x.
 */

const fs = require('fs');
const path = require('path');

const DAT = path.resolve(__dirname, '../../client/data/things/860/Tibia.dat');

// Otc::Direction (client/src/client/const.h)
const DIRECOES = { north: 0, east: 1, south: 2, west: 3 };

// Atributos COM payload na versao 860 (thingtype.cpp:232-290). Os que nao
// estao aqui caem no `default` do switch e nao consomem bytes.
const ATTR_PAYLOAD = {
  0: 2, 8: 2, 9: 2, 21: 4, 24: 4, 25: 2, 28: 2, 29: 2, 32: 2, 34: 2, 38: 16,
};
const ATTR_MARKET = 33;
const ATTR_LAST = 0xff;

/** Pula os atributos de um ThingType e devolve o offset seguinte. */
function skipAttrs(b, o) {
  for (;;) {
    if (o >= b.length) throw new Error('EOF no meio dos atributos');
    const a = b.readUInt8(o); o += 1;
    if (a === ATTR_LAST) return o;
    if (a === ATTR_MARKET) {
      o += 6;
      const len = b.readUInt16LE(o); o += 2;
      o += len + 4;
      continue;
    }
    o += ATTR_PAYLOAD[a] || 0;
  }
}

/**
 * Le a parte de sprites de um ThingType e devolve os frame groups com a
 * posicao de cada indice no arquivo, para dar para reescrever no lugar.
 */
function readSpriteSection(b, o, hasFrameGroups) {
  const groups = [];
  const groupCount = hasFrameGroups ? b.readUInt8(o++) : 1;

  for (let g = 0; g < groupCount; g++) {
    if (hasFrameGroups) o += 1; // frameGroupType
    const w = b.readUInt8(o), h = b.readUInt8(o + 1); o += 2;
    if (w > 1 || h > 1) o += 1; // realSize
    const layers = b.readUInt8(o);
    const px = b.readUInt8(o + 1), py = b.readUInt8(o + 2), pz = b.readUInt8(o + 3);
    const phases = b.readUInt8(o + 4);
    o += 5;
    // Animator::unserialize: async(u8) + loop(i32) + start(u8) + phases*(u32,u32)
    if (phases > 1) o += 1 + 4 + 1 + phases * 8;

    const n = w * h * layers * px * py * pz * phases;
    const base = o; // offset do primeiro indice (u32 cada)
    o += n * 4;

    groups.push({ w, h, layers, px, py, pz, phases, base, count: n });
  }

  return { groups, end: o };
}

/**
 * Posicao no vetor de sprites, espelhando ThingType::getSpriteIndex
 * (thingtype.cpp:882).
 */
function spriteIndex(gr, l, x, y, z, a, h, w) {
  return ((((((a % gr.phases) * gr.pz + z) * gr.py + y) * gr.px + x) * gr.layers + l) * gr.h + h) * gr.w + w;
}

function main() {
  const [argA = 'east', argB = 'west'] = process.argv.slice(2);
  const dirA = DIRECOES[argA.toLowerCase()];
  const dirB = DIRECOES[argB.toLowerCase()];
  if (dirA === undefined || dirB === undefined) {
    console.error(`direcao invalida. use: ${Object.keys(DIRECOES).join(', ')}`);
    process.exit(1);
  }
  if (dirA === dirB) {
    console.error('as duas direcoes sao a mesma, nada a trocar');
    process.exit(1);
  }

  if (!fs.existsSync(DAT)) {
    console.error(`nao encontrei ${DAT}`);
    process.exit(1);
  }

  const b = fs.readFileSync(DAT);
  fs.writeFileSync(`${DAT}.bak`, b);

  let o = 0;
  o += 4; // signature
  const maxItem = b.readUInt16LE(o); o += 2;
  const maxOutfit = b.readUInt16LE(o); o += 2;
  const maxEffect = b.readUInt16LE(o); o += 2;
  const maxMissile = b.readUInt16LE(o); o += 2;

  // Itens (100..maxItem) -- so pulamos, nao tem direcao.
  for (let id = 100; id <= maxItem; id++) {
    o = skipAttrs(b, o);
    o = readSpriteSection(b, o, false).end;
  }

  let trocados = 0;
  for (let id = 1; id <= maxOutfit; id++) {
    o = skipAttrs(b, o);
    // Creature + GameIdleAnimations (o .otfi declara frame-groups) -> tem grupos
    const { groups, end } = readSpriteSection(b, o, true);

    for (const gr of groups) {
      if (gr.px <= Math.max(dirA, dirB)) {
        console.log(`  outfit ${id}: grupo com patternX=${gr.px} nao tem as duas direcoes, pulado`);
        continue;
      }
      // Varre TODAS as fases, layers, patterns Y/Z e celulas -- so o x muda.
      for (let a = 0; a < gr.phases; a++) {
        for (let z = 0; z < gr.pz; z++) {
          for (let y = 0; y < gr.py; y++) {
            for (let l = 0; l < gr.layers; l++) {
              for (let h = 0; h < gr.h; h++) {
                for (let w = 0; w < gr.w; w++) {
                  const iA = spriteIndex(gr, l, dirA, y, z, a, h, w);
                  const iB = spriteIndex(gr, l, dirB, y, z, a, h, w);
                  const pA = gr.base + iA * 4;
                  const pB = gr.base + iB * 4;
                  const vA = b.readUInt32LE(pA);
                  const vB = b.readUInt32LE(pB);
                  b.writeUInt32LE(vB, pA);
                  b.writeUInt32LE(vA, pB);
                  trocados++;
                }
              }
            }
          }
        }
      }
    }
    o = end;
  }

  // Efeitos e missiles ficam intactos -- nao tem direcao em pattern X.
  fs.writeFileSync(DAT, b);

  console.log(`${argA} <-> ${argB}: ${trocados} pares de sprite trocados em ${maxOutfit} outfit(s).`);
  console.log(`backup em ${path.basename(DAT)}.bak`);
  console.log('NAO e idempotente: rodar de novo desfaz.');
}

if (require.main === module) main();
