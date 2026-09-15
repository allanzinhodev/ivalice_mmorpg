'use strict';
/*
 * archive.js -- leitor do pc.idx / pc.bin do Final Fantasy Tactics A2 (NDS).
 *
 * Porte do org.ruru.ffta2editor.utility.Archive, lido do bytecode do
 * ffta2-editor. Nao e adivinhacao: cada formula abaixo veio do desmonte da
 * classe, e a secao "conferencia" no fim do arquivo diz como validar.
 *
 *
 * O FORMATO
 *
 * pc.idx:
 *   u32  count           quantas entradas na tabela de cima (1024 no jogo)
 *   u32  ignorado
 *   count x 9 bytes:
 *     u32 a
 *     u32 b
 *     u8  c
 *   ... e depois a "tabela de baixo" (extra), com os arquivos agrupados.
 *
 * A entrada e CODIFICADA -- offset e tamanho sao empacotados nos campos a/b:
 *
 *   offset = (a & 0x03FFFFFF) * 2
 *   size   = ((a >>> 26) + (b & 0xFFFF) * 64) * 4
 *
 * Conferido: as 1024 entradas caem dentro do pc.bin, nenhuma fora. Com uma
 * formula errada isso nao aconteceria.
 *
 *
 * O NOME VIRA INDICE POR HASH
 *
 *   h = bytes[0]
 *   para i >= 1:  h = h * 37 + bytes[i]
 *   indice = h & 1023
 *
 * Os bytes sao interpretados com SINAL (Java `byte`), e o produto satura em
 * 32 bits com sinal -- por isso Math.imul e a conversao `(b<<24)>>24`. Usar
 * byte sem sinal da outro hash e nao acha arquivo nenhum.
 */

const fs = require('fs');

const TABELA_TOPO = 1024;

/** Hash de nome de arquivo, byte a byte com sinal, como no Java. */
function hashDoNome(nome) {
  const b = Buffer.from(nome, 'utf8');
  let h = (b[0] << 24) >> 24;
  for (let i = 1; i < b.length; i++) {
    h = (Math.imul(h, 37) + ((b[i] << 24) >> 24)) | 0;
  }
  return h & 1023;
}

/** offset e tamanho, desempacotados dos campos a/b da entrada. */
function decodificar(a, b) {
  return {
    offset: (a & 0x03ffffff) * 2,
    size: (((a >>> 26) + (b & 0xffff) * 64) * 4),
  };
}

class Archive {
  constructor(caminhoIdx, caminhoBin) {
    this.idx = fs.readFileSync(caminhoIdx);
    this.binPath = caminhoBin;
    this.binSize = fs.statSync(caminhoBin).size;

    const count = this.idx.readUInt32LE(0);
    if (count !== TABELA_TOPO) {
      // Nao e erro fatal -- so vale saber, porque o hash usa & 1023 e assume
      // uma tabela de 1024.
      console.warn(`aviso: tabela de topo tem ${count} entradas, esperado ${TABELA_TOPO}`);
    }

    this.topo = [];
    for (let i = 0; i < count; i++) {
      const o = 8 + i * 9;
      const a = this.idx.readUInt32LE(o);
      const b = this.idx.readUInt32LE(o + 4);
      const d = decodificar(a, b);
      this.topo.push({ ...d, a, b, c: this.idx[o + 8] });
    }

    /*
     * `extraStart` e a posicao em BYTES onde a tabela extra comeca, e o
     * `extra` do Java e uma SLICE a partir dali -- entao as posicoes dentro
     * dele sao relativas ao inicio da slice, nao ao arquivo.
     *
     * A chave do grupo vem de `offset/4 - extraStart`, misturando as duas
     * unidades de proposito: o offset decodificado esta em bytes, dividido
     * por 4 vira indice de u32 dentro do idx, e extraStart desconta o
     * cabecalho. Ler isso errado foi o que fez os baldes virem vazios.
     */
    this.extraInicio = 8 + count * 9;
    this.extra = this._lerTabelaExtra();
  }

  /*
   * A tabela de baixo agrupa os arquivos que compartilham o mesmo indice de
   * hash -- colisao e esperada, com 1024 baldes.
   *
   * Cada grupo:
   *   u8   n            quantos arquivos no grupo; 0 encerra a tabela
   *   n x:
   *     u32  posicao    * 4
   *     u32  tamanho    * 4   (so a partir do segundo; o primeiro e 0)
   *     u32  ignorado         (idem)
   *     u8   flag
   *     u8   id
   *     u8   ignorado
   */
  _lerTabelaExtra() {
    const grupos = new Map();
    let p = this.extraInicio;

    while (p < this.idx.length) {
      /*
       * A chave do grupo e a POSICAO no buffer onde ele comeca -- nao um
       * contador sequencial. E o `extra.position()` lido antes do byte de
       * contagem, no bytecode.
       *
       * Usar um contador parecia funcionar (374 grupos saiam), mas os campos
       * vinham desalinhados: flags com valor 97, 101, 109 -- que sao 'a',
       * 'e', 'm' em ASCII, ou seja, texto lido como estrutura.
       */
      const chave = p - this.extraInicio;
      const n = this.idx[p]; p += 1;
      if (n === 0) break;

      const lista = [];
      for (let k = 0; k < n; k++) {
        const posicao = this.idx.readUInt32LE(p) * 4; p += 4;
        let tamanho = 0;
        if (k !== 0) {
          tamanho = this.idx.readUInt32LE(p) * 4; p += 4;
          p += 4;                                   // campo ignorado
        }
        const flag = this.idx[p]; p += 1;
        const id = this.idx[p]; p += 1;
        p += 1;                                     // campo ignorado
        lista.push({ posicao, tamanho, flag, id });
      }
      grupos.set(chave, lista);
    }

    return grupos;
  }

  /** Lê `tam` bytes do pc.bin a partir de `off`. */
  _lerBin(off, tam) {
    if (off < 0 || tam <= 0 || off + tam > this.binSize) return null;
    const buf = Buffer.alloc(tam);
    const fd = fs.openSync(this.binPath, 'r');
    try {
      fs.readSync(fd, buf, 0, tam, off);
    } finally {
      fs.closeSync(fd);
    }
    return buf;
  }

  /*
   * O arquivo no índice `i` da tabela de topo.
   *
   * O bit 0 do campo `a` diz o que a entrada é:
   *
   *   a % 2 == 1   a entrada aponta para um GRUPO na tabela extra -- varios
   *                arquivos que colidiram no mesmo hash. A chave do grupo e
   *                `offset / 4 - extraStart`.
   *   a % 2 == 0   arquivo unico, lido direto do offset.
   *
   * `pos` escolhe qual do grupo; sem ele, o primeiro.
   */
  porIndice(i, pos = 0) {
    const e = this.topo[i];
    if (!e || (e.a === 0 && e.b === 0)) return null;

    if ((e.a >>> 0) % 2 === 1) {
      const chave = Math.floor((e.offset >>> 0) / 4) - this.extraInicio;
      const grupo = this.extra.get(chave);
      if (!grupo || !grupo[pos]) return null;
      const g = grupo[pos];

      /*
       * O PRIMEIRO do grupo nao guarda tamanho proprio -- o campo so aparece
       * a partir do segundo, e por isso a leitura dele vinha null. O tamanho
       * dele e a distancia ate o proximo; se for o unico, o `size` da entrada
       * de topo.
       */
      const tam = g.tamanho > 0
        ? g.tamanho
        : (grupo.length > 1 ? grupo[1].posicao - g.posicao : e.size);

      return this._lerBin(g.posicao, tam);
    }

    return this._lerBin(e.offset, e.size);
  }

  /** Quantos arquivos há no balde deste índice. */
  quantosEm(i) {
    const e = this.topo[i];
    if (!e || (e.a === 0 && e.b === 0)) return 0;
    if ((e.a >>> 0) % 2 !== 1) return 1;
    const chave = Math.floor((e.offset >>> 0) / 4) - this.extraInicio;
    const grupo = this.extra.get(chave);
    return grupo ? grupo.length : 0;
  }

  /** O arquivo com este nome. */
  porNome(nome, pos = 0) {
    return this.porIndice(hashDoNome(nome), pos);
  }
}

module.exports = { Archive, hashDoNome, decodificar };
