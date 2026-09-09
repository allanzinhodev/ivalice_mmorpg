'use strict';
/*
 * Acha as tabelas de dados do FFTA2 nesta ROM procurando pela ASSINATURA da
 * estrutura, em vez de confiar em offset publicado.
 *
 * POR QUE
 *
 * O ROM map que circula para o FFTA2 (Job Data em 0x053D6864 etc) e da versao
 * AMERICANA. Esta ROM e a EUROPEIA (FFTA2-EU, gameCode A6FP) e os offsets nao
 * batem: no endereco publicado, so 5-30% dos campos caem no dominio
 * documentado, o que e ruido e nao dado.
 *
 * O que NAO muda entre versoes e o formato do registro. Entao procuramos por
 * ele.
 *
 * A ASSINATURA
 *
 * Job Data tem 0x48 bytes por entrada, e dentro dela ha campos com dominio
 * muito estreito:
 *
 *   0x21..0x28  Afinidades elementais, 8 bytes, cada um 0..4
 *   0x0F        Move Type, 0..3
 *   0x10        Stand Type, 0..4
 *   0x33        Gender, 0..2
 *   0x0E        Race, 0..0x28
 *
 * Os 8 bytes de afinidade sozinhos ja sao decisivos: a chance de um byte
 * aleatorio cair em 0..4 e 5/256, entao 8 bytes seguidos dao ~(5/256)^8, e
 * exigindo isso em varias entradas consecutivas o falso positivo fica
 * impossivel na pratica.
 *
 * ESTRATEGIA
 *
 * Varredura de 1 em 1 byte sobre o pc.bin com filtro barato primeiro (as
 * afinidades das primeiras entradas, com saida antecipada), e validacao
 * completa so nos sobreviventes. E forca bruta, mas o filtro mata quase todo
 * offset nos primeiros bytes.
 */

const fs = require('fs');
const path = require('path');

const ROM = path.resolve(__dirname, '../ffta2.nds');

// Estrutura do Job Data, conforme o ROM map (os offsets mudam entre versoes,
// o formato nao).
const ENTRADA = 0x48;
const CAMPOS = [
  // [offset no registro, minimo, maximo, quantidade de bytes seguidos]
  [0x21, 0, 4, 8], // afinidades -- o filtro forte
  [0x0f, 0, 3, 1], // move type
  [0x10, 0, 4, 1], // stand type
  [0x33, 0, 2, 1], // gender
  [0x0e, 0, 0x28, 1], // race
];

/** Quantas entradas consecutivas a partir de `off` respeitam todos os campos. */
function entradasValidas(buf, off, limite) {
  let n = 0;
  while (n < limite) {
    const base = off + n * ENTRADA;
    if (base + ENTRADA > buf.length) break;
    let ok = true;
    for (const [o, lo, hi, len] of CAMPOS) {
      for (let k = 0; k < len; k++) {
        const v = buf[base + o + k];
        if (v < lo || v > hi) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) break;
    n++;
  }
  return n;
}

/**
 * O dominio sozinho nao basta: uma regiao cheia de zeros passa em todos os
 * limites e nao e tabela nenhuma. Aqui exigimos que o bloco tenha CONTEUDO --
 * as sete racas jogaveis presentes, os tres generos, afinidade que varia (nem
 * tudo neutro) e HP base nao nulo. Foi isso que derrubou 111 candidatos para
 * um punhado.
 */
function pontuar(buf, off, n) {
  const racas = new Set(), generos = new Set();
  let afinVar = 0, hpOk = 0;
  for (let i = 0; i < n; i++) {
    const b = off + i * ENTRADA;
    racas.add(buf[b + 0x0e]);
    generos.add(buf[b + 0x33]);
    for (let k = 0; k < 8; k++) if (buf[b + 0x21 + k] > 1) { afinVar++; break; }
    if (buf[b + 0x13] > 0) hpOk++;
  }
  const jogaveis = [1, 2, 3, 4, 5, 6, 7].filter((r) => racas.has(r)).length;
  const gen = [0, 1, 2].filter((g) => generos.has(g)).length;

  // exigencias minimas para nem considerar
  if (jogaveis < 5 || gen < 2 || afinVar < n * 0.15 || hpOk < n * 0.5) return null;

  const score = (jogaveis / 7) + (gen / 3) + (afinVar / n) + (hpOk / n);
  return { racas: jogaveis, generos: gen, afinVar, hpOk, score };
}

function main() {
  const minEntradas = Number(process.argv[2] || 40);
  const buf = fs.readFileSync(ROM);
  console.log(`ROM ${buf.length} bytes. procurando blocos com >= ${minEntradas} entradas validas de ${ENTRADA} bytes...`);

  const achados = [];
  const limiteBusca = buf.length - ENTRADA * minEntradas;

  for (let off = 0; off < limiteBusca; off++) {
    // filtro barato: as 8 afinidades da PRIMEIRA entrada
    let ok = true;
    for (let k = 0; k < 8; k++) {
      if (buf[off + 0x21 + k] > 4) { ok = false; break; }
    }
    if (!ok) continue;
    // idem na segunda entrada, ainda barato
    for (let k = 0; k < 8; k++) {
      if (buf[off + ENTRADA + 0x21 + k] > 4) { ok = false; break; }
    }
    if (!ok) continue;

    const n = entradasValidas(buf, off, 1000);
    if (n >= minEntradas) {
      const s = pontuar(buf, off, n);
      if (s) achados.push({ offset: off, entradas: n, bytes: n * ENTRADA, ...s });
      off += n * ENTRADA - 1; // pula o bloco inteiro, nao reportar sub-janelas
    }
  }

  achados.sort((a, b) => b.score - a.score);
  console.log(`\n${achados.length} bloco(s) sobreviveram ao filtro de conteudo:\n`);
  console.log('  offset          entradas  racas 1-7  generos  afin>1  HP!=0  score');
  console.log('  ' + '-'.repeat(72));
  for (const a of achados.slice(0, 15)) {
    console.log(
      `  0x${a.offset.toString(16).padStart(8, '0')}  ${String(a.entradas).padStart(8)}` +
      `  ${String(a.racas).padStart(9)}  ${String(a.generos).padStart(7)}` +
      `  ${String(a.afinVar).padStart(6)}  ${String(a.hpOk).padStart(5)}  ${a.score.toFixed(2)}`
    );
  }
  return achados;
}

if (require.main === module) main();
module.exports = { entradasValidas, ENTRADA, CAMPOS };
