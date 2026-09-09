'use strict';
/*
 * PASSO 1 do pipeline do FFTA2: mapear o cartucho.
 *
 * Le tools/ffta2.nds e gera em tools/extracted-ffta2/:
 *   rom-info.json   cabecalho, hashes e identificacao da ROM
 *   filelist.json   todo arquivo da FAT com nome (da FNT), offset, tamanho,
 *                   magic detectado e palpite de conteudo; para os NARC, a
 *                   arvore de sub-arquivos tambem
 *
 * Este passo NAO decodifica nada -- e de proposito. A estrutura real so fica
 * clara depois de ver magics e tamanhos, e e o filelist que diz onde procurar
 * personagem, item, mapa e som.
 *
 * A ROM nao e versionada (.gitignore: *.nds) e nao e modificada: tudo aqui e
 * leitura.
 */

const fs = require('fs');
const path = require('path');
const nds = require('./nds');

const ROM = path.resolve(__dirname, '../ffta2.nds');
const OUT = path.resolve(__dirname, '../extracted-ffta2');

// Dumps conhecidos, para dizer se a ROM bate com um dump limpo.
const DUMPS_CONHECIDOS = {
  // preencher conforme conferirmos contra No-Intro
};

function main() {
  if (!fs.existsSync(ROM)) {
    console.error(`nao encontrei ${ROM}`);
    console.error('a ROM nao e versionada -- coloque o arquivo em tools/ffta2.nds');
    process.exit(1);
  }

  const buf = fs.readFileSync(ROM);
  const h = nds.readHeader(buf);
  const { names, dirCount } = nds.readFNT(buf, h);
  const fat = nds.readFAT(buf, h);

  const arquivos = [];
  const porTipo = new Map();
  let totalNarcSub = 0;

  for (const f of fat) {
    if (f.start >= buf.length || f.end > buf.length || f.size < 0) {
      arquivos.push({ ...f, name: names.get(f.id) || null, magic: null, guess: 'entrada invalida na FAT' });
      continue;
    }

    const { magic, guess } = nds.classify(buf, f.start, f.size);
    const reg = {
      id: f.id,
      name: names.get(f.id) || null,
      offset: f.start,
      offsetHex: '0x' + f.start.toString(16),
      size: f.size,
      magic,
      guess,
    };

    // NARC: abrir e listar os sub-arquivos, que e onde o conteudo real mora.
    if (magic === 'NARC') {
      try {
        const subs = nds.readNARC(buf.subarray(f.start, f.end));
        reg.subFileCount = subs.length;
        const resumo = new Map();
        reg.subFiles = subs.map((s) => {
          const abs = f.start + s.start;
          const c = s.size > 0 ? nds.classify(buf, abs, s.size) : { magic: null, guess: 'vazio' };
          resumo.set(c.guess, (resumo.get(c.guess) || 0) + 1);
          return { index: s.index, offset: abs, size: s.size, magic: c.magic, guess: c.guess };
        });
        reg.subFileSummary = Object.fromEntries([...resumo.entries()].sort((a, b) => b[1] - a[1]));
        totalNarcSub += subs.length;
      } catch (e) {
        reg.narcError = e.message;
      }
    }

    arquivos.push(reg);
    porTipo.set(guess, (porTipo.get(guess) || 0) + 1);
  }

  const hh = nds.hashes(ROM);
  const romInfo = {
    file: 'ffta2.nds',
    bytes: buf.length,
    internalTitle: h.title,
    gameCode: h.gameCode,
    makerCode: h.makerCode,
    romVersion: h.romVersion,
    region: nds.regionOf(h.gameCode),
    game: 'Final Fantasy Tactics A2: Grimoire of the Rift',
    platform: 'Nintendo DS',
    md5: hh.md5,
    sha1: hh.sha1,
    matchesKnownGoodDump: DUMPS_CONHECIDOS[hh.sha1] || null,
    arm9: h.arm9,
    arm7: h.arm7,
    fnt: h.fnt,
    fat: h.fat,
    fileCount: fat.length,
    dirCount,
    namedFiles: names.size,
    usedRomSize: h.usedRomSize,
    generatedAt: new Date().toISOString(),
    source: 'GBATEK (DS Cartridge Header / NitroROM e NitroARC File Systems)',
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'rom-info.json'), JSON.stringify(romInfo, null, 2));
  fs.writeFileSync(path.join(OUT, 'filelist.json'), JSON.stringify({
    generatedAt: romInfo.generatedAt,
    fileCount: arquivos.length,
    narcSubFileCount: totalNarcSub,
    byGuess: Object.fromEntries([...porTipo.entries()].sort((a, b) => b[1] - a[1])),
    files: arquivos,
  }, null, 2));

  // --- relatorio no console
  console.log(`${romInfo.game} (${romInfo.region})  ${h.title} / ${h.gameCode}`);
  console.log(`${buf.length} bytes  sha1=${hh.sha1}`);
  console.log(`FAT: ${fat.length} arquivos    FNT: ${dirCount} diretorios, ${names.size} nomeados`);
  console.log('');
  console.log('id  nome                                      tamanho  conteudo');
  console.log('-'.repeat(96));
  for (const a of arquivos) {
    const nome = (a.name || `(sem nome #${a.id})`).slice(0, 40).padEnd(40);
    const tam = String(a.size).padStart(10);
    const extra = a.subFileCount !== undefined ? `  [${a.subFileCount} sub-arquivos]` : '';
    console.log(`${String(a.id).padStart(3)} ${nome} ${tam}  ${a.guess}${extra}`);
  }
  console.log('');
  console.log(`escrito em ${OUT}: rom-info.json, filelist.json`);
}

if (require.main === module) main();
