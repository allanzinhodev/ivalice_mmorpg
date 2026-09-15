'use strict';
/*
 * unit-sst.js -- le as animacoes de unidade do FFTA2.
 *
 * Porte de UnitSst + BinaryTree + BinaryTreeNode + SstHeaderNode + LZSS do
 * ffta2-editor, lido do bytecode.
 *
 *
 * A CADEIA
 *
 *   pc.bin -> UnitSst.pak -> BinaryTree -> bloco LZSS -> UnitAnimation
 *
 * O bloco do .pak NAO e comprimido: a arvore esta nele, crua, a partir do
 * byte 0. O que e comprimido e o VALOR de cada no.
 *
 * Um bloco do .pak comeca com 0x10 e passa no teste de cabecalho LZ77, mas
 * nao e um -- e o primeiro no da arvore. Descomprimi-lo produz lixo que
 * nao denuncia o erro: a "raiz" resultante tem key 0 e filhos que nao levam
 * a lugar nenhum, entao a leitura termina com uma arvore de um no so em vez
 * de estourar.
 *
 *
 * A ARVORE
 *
 * Nos de 8 bytes, todos no inicio do bloco, acessados por `indice * 8`.
 * A raiz e o indice 0.
 *
 *   s16  key
 *   u16  offset       -- EM UNIDADES DE 16 BYTES, nao em bytes
 *   s16  leftIndex    -- -1 = sem filho
 *   s16  rightIndex   -- -1 = sem filho
 *
 * A `key` e composta de dois bytes (SstHeaderNode):
 *
 *   dataType    = key & 0xFF          byte baixo
 *   animationId = (key >> 8) & 0xFF   byte alto
 *
 * `dataType` diz o que o no guarda; `animationId` enumera as animacoes
 * dentro de um mesmo tipo. E essa numeracao que o jogo usa, e e ela que os
 * frame groups do .dat tem que espelhar.
 *
 * `dataType` 240 (0xF0) e a paleta, nao uma animacao.
 *
 *
 * O VALOR DE UM NO
 *
 * Em `offset * 16` ha 4 bytes de cabecalho; o bloco LZSS comeca em
 * `offset * 16 + 4`. Descomprimido, ele e:
 *
 *   s16  frameCount
 *   s16  unknown
 *   frameCount x 16 bytes:
 *     0x00 s16  ?
 *     0x02 s16  duration      -- IGNORADO: o ivalice usa 200ms fixo
 *     0x04 s16  ?
 *     0x06 u8   propertyFlags -- bit 1 = isMirrored
 *     0x07 u8   spriteIndex   -- qual <n>.png
 *     0x08 s16  ?
 *     0x0a s16  ?
 *     0x0c s16  ?
 *     0x0e s16  ?
 */

const PALETA_DATATYPE = 240;

/*
 * LZ77 do NDS (o "LZSS" do editor).
 *
 * Cabecalho: u32 little-endian. O nibble 4-7 tem que ser 1, e os 24 bits
 * altos sao o tamanho descomprimido -- o que da o familiar 0x10 no primeiro
 * byte. Depois, blocos de 8 itens governados por um byte de flags, lido do
 * bit 7 para o bit 0: 0 = literal, 1 = referencia de 2 bytes.
 *
 * Devolve tambem `tamanhoComprimido`, porque quem chama precisa saber onde o
 * bloco acabou para recortar o valor do no.
 */
function descomprimir(buf, inicio = 0) {
  if (inicio + 4 > buf.length) return null;

  const cab = buf.readUInt32LE(inicio);
  if (((cab >>> 4) & 0xf) !== 1) return null;

  const tamanho = cab >>> 8;
  if (tamanho <= 0) return null;

  const saida = Buffer.alloc(tamanho);
  let entrada = inicio + 4;
  let pos = 0;

  while (pos < tamanho && entrada < buf.length) {
    const flags = buf[entrada++];
    for (let bit = 7; bit >= 0 && pos < tamanho; bit--) {
      if (entrada >= buf.length) break;

      if ((flags >> bit) & 1) {
        if (entrada + 2 > buf.length) break;
        const b1 = buf[entrada++], b2 = buf[entrada++];
        const comprimento = ((b1 >> 4) & 0xf) + 3;
        const distancia = (((b1 & 0xf) << 8) | b2) + 1;
        for (let k = 0; k < comprimento && pos < tamanho; k++) {
          saida[pos] = pos >= distancia ? saida[pos - distancia] : 0;
          pos++;
        }
      } else {
        saida[pos++] = buf[entrada++];
      }
    }
  }

  saida.tamanhoComprimido = entrada - inicio;
  return saida;
}

/**
 * Percorre a arvore e devolve os nos, por chave.
 *
 * O percurso e iterativo com marcacao de visitados: um indice corrompido
 * pode apontar de volta para um no ja visto e criar ciclo, e recursao pura
 * estouraria a pilha.
 */
function lerArvore(dados) {
  const nos = new Map();
  const visitados = new Set();
  const pilha = [0];

  while (pilha.length) {
    const i = pilha.pop();
    if (i < 0 || visitados.has(i)) continue;
    visitados.add(i);

    const o = i * 8;
    if (o + 8 > dados.length) continue;

    const key = dados.readInt16LE(o);
    const n = {
      indice: i,
      key,
      dataType: key & 0xff,
      animationId: (key >> 8) & 0xff,
      offset: dados.readUInt16LE(o + 2) * 16,
      left: dados.readInt16LE(o + 4),
      right: dados.readInt16LE(o + 6),
    };
    nos.set(key, n);

    if (n.left >= 0) pilha.push(n.left);
    if (n.right >= 0) pilha.push(n.right);
  }

  return nos;
}

/** Le o registro de animacao apontado por um no. */
function lerAnimacao(dados, no) {
  const corpo = descomprimir(dados, no.offset + 4);
  if (!corpo || corpo.length < 4) return null;

  const frameCount = corpo.readInt16LE(0);
  if (frameCount <= 0) return null;
  if (4 + frameCount * 16 > corpo.length) return null;

  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const o = 4 + i * 16;
    frames.push({
      sprite: corpo[o + 7],
      espelhado: ((corpo[o + 6] >> 1) & 1) === 1,
      duracao: corpo.readInt16LE(o + 2),
    });
  }
  return frames;
}

/**
 * Todas as animacoes de uma unidade, a partir do bloco cru do .pak.
 *
 * Devolve `{ animacoes, paleta }`. As animacoes vem ordenadas por
 * (dataType, animationId) -- a mesma ordem que o jogo enumera.
 */
function lerUnidade(dados) {
  if (!dados || dados.length < 8) return null;

  const nos = lerArvore(dados);
  const animacoes = [];
  let paleta = null;

  for (const n of nos.values()) {
    if (n.dataType === PALETA_DATATYPE) {
      paleta = { offset: n.offset, dados: descomprimir(dados, n.offset + 4) };
      continue;
    }
    const frames = lerAnimacao(dados, n);
    if (!frames) continue;
    animacoes.push({
      key: n.key,
      dataType: n.dataType,
      animationId: n.animationId,
      frames,
    });
  }

  animacoes.sort(
    (a, b) => a.dataType - b.dataType || a.animationId - b.animationId
  );
  return { animacoes, paleta, totalNos: nos.size };
}

module.exports = {
  descomprimir,
  lerArvore,
  lerAnimacao,
  lerUnidade,
  PALETA_DATATYPE,
};
