'use strict';
/*
 * Leitura do NitroROM (cartucho de Nintendo DS) e dos containers NARC.
 *
 * E o equivalente, para o FFTA2, do que ffta.js faz para o FFTA1. A diferenca
 * de plataforma e grande: a ROM de GBA e um espaco de enderecos plano onde se
 * le por offset absoluto, enquanto a de DS tem SISTEMA DE ARQUIVOS -- FAT com
 * (inicio, fim) por arquivo e FNT com a arvore de nomes. Por isso aqui nao
 * existem "offsets magicos" como no FFTA1: primeiro se descobre a arvore, e so
 * depois se procura conteudo dentro dos arquivos.
 *
 * Referencia do layout: GBATEK, "DS Cartridge Header" e "DS Cartridge NitroROM
 * and NitroARC File Systems".
 */

const fs = require('fs');
const crypto = require('crypto');

// --- cabecalho do cartucho (GBATEK, DS Cartridge Header) -------------------

function readHeader(buf) {
  return {
    title: buf.toString('ascii', 0x00, 0x0c).replace(/\0/g, ''),
    gameCode: buf.toString('ascii', 0x0c, 0x10),
    makerCode: buf.toString('ascii', 0x10, 0x12),
    unitCode: buf[0x12],
    deviceCapacity: buf[0x14], // tamanho = 128KB << valor
    romVersion: buf[0x1e],
    arm9: { romOffset: buf.readUInt32LE(0x20), entry: buf.readUInt32LE(0x24), ram: buf.readUInt32LE(0x28), size: buf.readUInt32LE(0x2c) },
    arm7: { romOffset: buf.readUInt32LE(0x30), entry: buf.readUInt32LE(0x34), ram: buf.readUInt32LE(0x38), size: buf.readUInt32LE(0x3c) },
    fnt: { offset: buf.readUInt32LE(0x40), size: buf.readUInt32LE(0x44) },
    fat: { offset: buf.readUInt32LE(0x48), size: buf.readUInt32LE(0x4c) },
    arm9Overlay: { offset: buf.readUInt32LE(0x50), size: buf.readUInt32LE(0x54) },
    arm7Overlay: { offset: buf.readUInt32LE(0x58), size: buf.readUInt32LE(0x5c) },
    iconOffset: buf.readUInt32LE(0x68),
    usedRomSize: buf.readUInt32LE(0x80),
    headerSize: buf.readUInt32LE(0x84),
  };
}

/** Regiao pela 4a letra do gameCode (GBATEK). */
function regionOf(gameCode) {
  return ({ E: 'USA', P: 'Europa', J: 'Japao', K: 'Coreia', C: 'China' })[gameCode[3]] || 'desconhecida';
}

// --- FAT: pares (inicio, fim) absolutos na ROM ------------------------------

function readFAT(buf, header) {
  const { offset, size } = header.fat;
  const out = [];
  for (let o = offset; o + 8 <= offset + size; o += 8) {
    const start = buf.readUInt32LE(o);
    const end = buf.readUInt32LE(o + 4);
    out.push({ id: out.length, start, end, size: end - start });
  }
  return out;
}

// --- FNT: arvore de nomes ---------------------------------------------------

/**
 * Decodifica a File Name Table e devolve `id do arquivo -> caminho`.
 *
 * Layout (GBATEK): a FNT comeca com uma tabela de diretorios de 8 bytes cada:
 *   u32 offset da subtabela (relativo ao inicio da FNT)
 *   u16 id do primeiro arquivo do diretorio
 *   u16 id do diretorio pai -- no diretorio 0 este campo e a QUANTIDADE de
 *       diretorios, e nao um pai; e daqui que se descobre o tamanho da tabela.
 *
 * Cada subtabela e uma sequencia de entradas:
 *   0x00        fim da subtabela
 *   0x01..0x7F  arquivo, o valor e o tamanho do nome, seguido do nome
 *   0x81..0xFF  diretorio, tamanho = valor & 0x7F, seguido do nome e de um
 *               u16 com o id do diretorio (0xF000 | indice)
 */
function readFNT(buf, header) {
  const base = header.fnt.offset;
  if (!header.fnt.size) return { names: new Map(), dirCount: 0 };

  const dirCount = buf.readUInt16LE(base + 6);
  const nomes = new Map();

  const lerDir = (dirIndex, caminhoPai) => {
    const entrada = base + dirIndex * 8;
    let p = base + buf.readUInt32LE(entrada);
    let fileId = buf.readUInt16LE(entrada + 4);

    for (;;) {
      if (p >= base + header.fnt.size) break;
      const tipo = buf[p]; p += 1;
      if (tipo === 0x00) break;

      const ehDiretorio = (tipo & 0x80) !== 0;
      const len = tipo & 0x7f;
      const nome = buf.toString('latin1', p, p + len); p += len;

      if (ehDiretorio) {
        const subId = buf.readUInt16LE(p) & 0x0fff; p += 2;
        lerDir(subId, `${caminhoPai}${nome}/`);
      } else {
        nomes.set(fileId, `${caminhoPai}${nome}`);
        fileId += 1;
      }
    }
  };

  lerDir(0, '/');
  return { names: nomes, dirCount };
}

// --- classificacao por magic ------------------------------------------------

/*
 * Os formatos Nintendo gravam o magic INVERTIDO no arquivo: o container
 * chamado "NCGR" na documentacao aparece como "RGCN" nos bytes. Por isso
 * checamos as duas formas. Ver Tinke / NTR-Tools.
 */
const MAGICS = {
  NARC: 'container NARC (arquivo de arquivos)',
  SDAT: 'audio: Sound Data Archive',
  RGCN: 'grafico: NCGR (tiles)',
  RLCN: 'grafico: NCLR (paleta)',
  RECN: 'grafico: NCER (cells/OAM)',
  RNAN: 'grafico: NANR (animacao de cells)',
  RCSN: 'grafico: NSCR (screen/tilemap)',
  RNCN: 'grafico: NCEC',
  BMD0: '3D: modelo NSBMD',
  BTX0: '3D: textura NSBTX',
  BCA0: '3D: animacao NSBCA',
  SSEQ: 'audio: sequencia',
  SBNK: 'audio: banco de instrumentos',
  SWAR: 'audio: waveform archive',
  STRM: 'audio: stream',
  RIFF: 'RIFF/WAV',
};

function classify(buf, start, size) {
  if (size < 4) return { magic: null, guess: 'vazio ou muito pequeno' };
  const magic = buf.toString('ascii', start, start + 4);
  const limpo = /^[\x20-\x7e]{4}$/.test(magic) ? magic : null;
  if (limpo && MAGICS[limpo]) return { magic: limpo, guess: MAGICS[limpo] };

  // LZ77 do Nintendo: primeiro byte 0x10, seguido do tamanho descomprimido u24
  if (buf[start] === 0x10) {
    const descomp = buf.readUIntLE(start + 1, 3);
    if (descomp > 0 && descomp < 64 * 1024 * 1024) {
      return { magic: null, guess: `comprimido LZ77 (descomprime para ~${descomp} bytes)` };
    }
  }
  return { magic: limpo, guess: 'desconhecido' };
}

// --- NARC -------------------------------------------------------------------

/**
 * Le um container NARC a partir de um Buffer que comeca no magic.
 * Secoes: BTAF (alocacao), BTNF (nomes), GMIF (dados).
 *
 * Os offsets do BTAF sao relativos ao inicio dos DADOS do GMIF, isto e, 8
 * bytes depois do magic "GMIF" (4 do magic + 4 do tamanho da secao).
 */
function readNARC(buf) {
  if (buf.toString('ascii', 0, 4) !== 'NARC') throw new Error('nao e NARC');

  const headerSize = buf.readUInt16LE(0x0c);
  const secoes = buf.readUInt16LE(0x0e);

  let p = headerSize;
  let btaf = null, gmifDados = null;

  for (let i = 0; i < secoes; i++) {
    if (p + 8 > buf.length) break;
    const magic = buf.toString('ascii', p, p + 4);
    const tamanho = buf.readUInt32LE(p + 4);
    if (tamanho <= 0 || p + tamanho > buf.length) break;

    if (magic === 'BTAF') {
      const n = buf.readUInt32LE(p + 8);
      btaf = [];
      for (let k = 0; k < n; k++) {
        btaf.push({
          start: buf.readUInt32LE(p + 12 + k * 8),
          end: buf.readUInt32LE(p + 12 + k * 8 + 4),
        });
      }
    } else if (magic === 'GMIF') {
      gmifDados = p + 8;
    }
    p += tamanho;
  }

  if (!btaf || gmifDados === null) throw new Error('NARC sem BTAF ou GMIF');

  return btaf.map((e, i) => ({
    index: i,
    start: gmifDados + e.start,
    size: e.end - e.start,
  }));
}

function hashes(caminho) {
  const md5 = crypto.createHash('md5');
  const sha1 = crypto.createHash('sha1');
  const fd = fs.openSync(caminho, 'r');
  const pedaco = Buffer.alloc(1 << 20);
  for (;;) {
    const n = fs.readSync(fd, pedaco, 0, pedaco.length, null);
    if (n <= 0) break;
    md5.update(pedaco.subarray(0, n));
    sha1.update(pedaco.subarray(0, n));
  }
  fs.closeSync(fd);
  return { md5: md5.digest('hex'), sha1: sha1.digest('hex') };
}

module.exports = { readHeader, regionOf, readFAT, readFNT, classify, readNARC, hashes, MAGICS };
