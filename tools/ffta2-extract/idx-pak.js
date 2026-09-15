'use strict';
/*
 * idx-pak.js -- leitor dos pares .rom_idx / .pak do FFTA2.
 *
 * Porte de org.ruru.ffta2editor.utility.IdxAndPak, lido do bytecode.
 *
 *
 * O FORMATO DO ÍNDICE
 *
 *   u32           descartado (cabecalho)
 *   N x 6 bytes:
 *     u32  v
 *     u16  descartado
 *
 * O offset de cada arquivo sai de `v`, com uma conta que parece estranha mas
 * e so empacotamento:
 *
 *   offset_u32 = ((v << 5) & 0xFFFFFFFF) / 256      -- sem sinal
 *   offset_bytes = offset_u32 * 4
 *
 * O tamanho vem da DIFERENCA para o proximo offset -- por isso o ultimo
 * elemento do indice e um sentinela, nao um arquivo.
 *
 *
 * ENTRADA VAZIA
 *
 * Se `v & 7` for diferente de zero, aquela posicao nao tem arquivo (vira
 * null). A excecao e o ultimo elemento, que e o sentinela e simplesmente
 * encerra a lista.
 *
 * Isso importa: a numeracao das unidades depende dos nulls estarem no lugar
 * certo. Pular as entradas vazias em vez de gravar null desloca todos os
 * indices seguintes.
 */

class IdxAndPak {
  constructor(nome, idx, pak) {
    this.nome = nome;
    this.arquivos = [];

    const total = Math.floor((idx.length - 4) / 6);

    for (let i = 0; i < total; i++) {
      const p = 4 + i * 6;
      const v = idx.readUInt32LE(p);

      // `(v << 5) >>> 0` mantem 32 bits sem sinal antes de dividir.
      const inicioU32 = Math.floor(((v << 5) >>> 0) / 256);

      if ((v & 7) !== 0) {
        // Ultimo elemento e sentinela, nao arquivo ausente.
        if (i !== total - 1) this.arquivos.push(null);
        continue;
      }

      const pNext = 4 + (i + 1) * 6;
      if (pNext + 4 > idx.length) { this.arquivos.push(null); continue; }

      const vNext = idx.readUInt32LE(pNext);
      const fimU32 = Math.floor(((vNext << 5) >>> 0) / 256);

      const off = inicioU32 * 4;
      const tam = (fimU32 - inicioU32) * 4;

      if (tam <= 0 || off + tam > pak.length) { this.arquivos.push(null); continue; }
      this.arquivos.push(pak.subarray(off, off + tam));
    }
  }

  get quantidade() { return this.arquivos.length; }

  arquivo(i) { return this.arquivos[i] || null; }
}

module.exports = { IdxAndPak };
