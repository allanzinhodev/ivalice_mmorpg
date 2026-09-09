'use strict';
/*
 * Procura blocos LZ77 (compressao padrao da Nintendo) dentro do pc.bin.
 *
 * POR QUE ESTE CAMINHO
 *
 * A varredura por magic mostrou que o FFTA2 NAO usa os formatos graficos
 * padrao: zero NCGR, NCLR, NCER, NANR, NSCR, BMD0 e BTX0 na ROM inteira. O
 * audio usa (214 SDAT), o grafico nao. Entao nao ha magic para procurar.
 *
 * E a tabela "Special Unit Graphics" do ROM map nao ajuda a localizar dado:
 * seus campos sao INDICES (190,191,192... e 61,62,63...), nao offsets --
 * resolver indice para dado depende do pc.idx, que segue sem ser quebrado.
 *
 * Sobra procurar pelo DADO em si. LZ77 e bom alvo porque se auto-valida: o
 * formato tem uma estrutura ritmica de flags e referencias para tras, e um
 * fluxo que descomprime ate o fim exato do tamanho declarado, sem estourar
 * limite nenhum, praticamente nao acontece por acaso.
 *
 * FORMATO (GBATEK, "LZ77UnCompVram")
 *   byte 0     : 0x10
 *   bytes 1..3 : tamanho descomprimido, u24 little-endian
 *   depois     : blocos de 1 byte de flags + 8 unidades, do bit mais alto
 *                para o mais baixo:
 *                  flag 0 -> 1 byte literal
 *                  flag 1 -> 2 bytes: tamanho (4 bits, +3) e distancia
 *                            (12 bits, +1), copiando de tras
 */

const fs = require('fs');
const path = require('path');

const ROM = path.resolve(__dirname, '../ffta2.nds');

/**
 * Descomprime LZ77 a partir de `off`. Devolve null a qualquer inconsistencia
 * -- e a rejeicao que faz a busca valer: fluxo invalido morre cedo.
 */
function descomprimir(buf, off, limiteSaida = 1 << 20) {
  if (buf[off] !== 0x10) return null;
  const tamanho = buf.readUIntLE(off + 1, 3);
  if (tamanho < 32 || tamanho > limiteSaida) return null;

  const out = Buffer.alloc(tamanho);
  let escrito = 0;
  let p = off + 4;

  while (escrito < tamanho) {
    if (p >= buf.length) return null;
    const flags = buf[p++];

    for (let bit = 7; bit >= 0 && escrito < tamanho; bit--) {
      if ((flags >> bit) & 1) {
        if (p + 1 >= buf.length) return null;
        const b0 = buf[p++], b1 = buf[p++];
        const len = (b0 >> 4) + 3;
        const dist = (((b0 & 0x0f) << 8) | b1) + 1;
        if (dist > escrito) return null;         // referencia antes do inicio
        if (escrito + len > tamanho) return null; // estoura o declarado
        for (let k = 0; k < len; k++) {
          out[escrito] = out[escrito - dist];
          escrito++;
        }
      } else {
        if (p >= buf.length) return null;
        out[escrito++] = buf[p++];
      }
    }
  }

  return { dados: out, consumido: p - off, tamanho };
}

function main() {
  const buf = fs.readFileSync(ROM);
  const info = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../extracted-ffta2/filelist.json')));
  const pcbin = info.files.find((f) => f.name === '/master/pc.bin');
  const ini = pcbin.offset, fim = pcbin.offset + pcbin.size;

  console.log(`varrendo pc.bin  0x${ini.toString(16)}..0x${fim.toString(16)}  (${pcbin.size} bytes)`);

  const achados = [];
  for (let off = ini; off < fim; off++) {
    if (buf[off] !== 0x10) continue;
    const r = descomprimir(buf, off);
    if (!r) continue;
    // Exigir taxa de compressao plausivel: dado real comprime, ruido nao.
    const taxa = r.tamanho / r.consumido;
    if (taxa < 1.05) continue;
    achados.push({ offset: off, comprimido: r.consumido, descomprimido: r.tamanho, taxa: +taxa.toFixed(2) });
    off += r.consumido - 1; // nao reportar sub-blocos dentro do que ja passou
  }

  const totalOut = achados.reduce((s, a) => s + a.descomprimido, 0);
  console.log(`\n${achados.length} blocos LZ77 validos, ${totalOut} bytes descomprimidos no total\n`);

  // distribuicao de tamanhos, que ajuda a reconhecer o que e o que
  const faixas = { '<1KB': 0, '1-4KB': 0, '4-16KB': 0, '16-64KB': 0, '>64KB': 0 };
  for (const a of achados) {
    const k = a.descomprimido;
    if (k < 1024) faixas['<1KB']++;
    else if (k < 4096) faixas['1-4KB']++;
    else if (k < 16384) faixas['4-16KB']++;
    else if (k < 65536) faixas['16-64KB']++;
    else faixas['>64KB']++;
  }
  console.log('por tamanho descomprimido:');
  for (const [k, v] of Object.entries(faixas)) console.log(`  ${k.padEnd(8)} ${v}`);

  console.log('\nmaiores blocos:');
  achados.sort((a, b) => b.descomprimido - a.descomprimido);
  for (const a of achados.slice(0, 12)) {
    console.log(`  0x${a.offset.toString(16)}  ${String(a.comprimido).padStart(8)} -> ${String(a.descomprimido).padStart(8)}  (${a.taxa}x)`);
  }

  return achados;
}

if (require.main === module) main();
module.exports = { descomprimir };
