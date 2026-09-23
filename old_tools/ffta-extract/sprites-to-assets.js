'use strict';
/*
 * sprites-to-assets.js -- leva as folhas de sprite de unidade para assets/.
 *
 *   node tools/ffta-extract/sprites-to-assets.js <pasta-com-os-png>
 *
 *
 * O QUE SAO ESSAS FOLHAS
 *
 * Um PNG por unidade, 64px de largura, altura multipla de 64: os frames de
 * 64x64 empilhados na vertical. 4bpp indexado (color type 3), que e o
 * formato nativo de sprite do GBA.
 *
 * O NOME DO ARQUIVO E O spriteIndex DO JOB. Conferido: os 60 jobs jogaveis
 * tem arquivo correspondente, 60 de 60. O 001.png e o Paladin, o 002.png o
 * Fighter, o 005.png o White Mage.
 *
 * Isso fecha a ligacao que a analise estatica da ROM nao deu -- ver
 * tools/ffta-vram/BECOS-SPRITE.md para as nove tentativas que falharam.
 *
 *
 * O 000.png E FALLBACK, NAO O SOLDIER
 *
 * Dezenove jobs apontam para o indice 0: o Soldier, entradas sem nome ("-"),
 * e NPCs que nao sao classe de verdade (Librarian, Nurse, Judgemaster, Box,
 * Statue). E o sprite padrao de quem nao tem um proprio.
 *
 * Tratar o 000 como "a arte do Soldier" seria errado, e o erro so apareceria
 * quando alguem estranhasse a Nurse parecendo um soldado.
 *
 *
 * POR QUE O png.js DO PROJETO NAO LE ESTES ARQUIVOS
 *
 * Ele exige bit depth 8 (png.js:112). Estas folhas sao 4bpp. Nao converto
 * aqui de proposito: o 4bpp indexado e a forma nativa, o compilador de
 * assets e quem deve decidir como quer a entrada. Este script so copia e
 * cataloga.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = path.join(RAIZ, 'assets', 'ffta', 'sprites');
const JOBS = path.join(RAIZ, 'assets', 'ffta', 'jobs.json');

const LADO = 64;

/** Le largura, altura, bit depth e color type do IHDR, sem decodificar. */
function cabecalhoPNG(buf) {
  if (buf.length < 26) return null;
  const assinatura = buf.readUInt32BE(0) === 0x89504e47;
  if (!assinatura) return null;
  return {
    largura: buf.readUInt32BE(16),
    altura: buf.readUInt32BE(20),
    bits: buf[24],
    tipoCor: buf[25],
  };
}

function main() {
  const origem = process.argv[2];
  if (!origem) {
    console.error('uso: node tools/ffta-extract/sprites-to-assets.js <pasta>');
    process.exit(1);
  }
  if (!fs.existsSync(origem)) {
    console.error(`pasta nao encontrada: ${origem}`);
    process.exit(1);
  }

  const arquivos = fs.readdirSync(origem)
    .filter((f) => /^\d+\.png$/i.test(f))
    .sort();

  if (!arquivos.length) {
    console.error(`nenhum PNG numerado em ${origem}`);
    process.exit(1);
  }

  fs.mkdirSync(SAIDA, { recursive: true });

  const jobs = JSON.parse(fs.readFileSync(JOBS, 'utf8'));
  const jobsPorSprite = new Map();
  for (const j of jobs) {
    if (!jobsPorSprite.has(j.spriteIndex)) jobsPorSprite.set(j.spriteIndex, []);
    jobsPorSprite.get(j.spriteIndex).push({ name: j.name, race: j.race });
  }

  const folhas = [];
  let irregulares = 0;

  for (const f of arquivos) {
    const buf = fs.readFileSync(path.join(origem, f));
    const h = cabecalhoPNG(buf);
    if (!h) {
      console.log(`  ${f}: nao e PNG valido, ignorado`);
      continue;
    }

    // Altura que nao fecha em frames inteiros denuncia arquivo truncado.
    const frames = h.altura / LADO;
    if (h.largura !== LADO || !Number.isInteger(frames)) {
      console.log(`  ${f}: ${h.largura}x${h.altura} nao fecha em frames de ${LADO}px`);
      irregulares++;
      continue;
    }

    fs.copyFileSync(path.join(origem, f), path.join(SAIDA, f));

    const indice = parseInt(f, 10);
    const usadoPor = jobsPorSprite.get(indice) || [];
    folhas.push({
      spriteIndex: indice,
      arquivo: f,
      frames,
      bits: h.bits,
      usadoPor: usadoPor.map((j) => j.name),
      // O 0 e o fallback de quem nao tem sprite proprio; dizer que ele "e" o
      // Soldier seria mentira, ainda que o Soldier use.
      fallback: indice === 0,
    });
  }

  const totalFrames = folhas.reduce((s, f) => s + f.frames, 0);
  const comJob = folhas.filter((f) => f.usadoPor.length > 0).length;

  const indice = {
    nota: 'Folhas de sprite de unidade do FFTA. Uma por unidade, 64px de largura, ' +
          'frames de 64x64 empilhados na vertical, 4bpp indexado (formato nativo do GBA). ' +
          'O numero do arquivo e o spriteIndex do job (assets/ffta/jobs.json). ' +
          'O 000.png e o sprite padrao de quem nao tem um proprio -- 19 jobs apontam ' +
          'para ele, incluindo NPCs que nao sao classe.',
    lado: LADO,
    folhas,
  };

  const destino = path.join(SAIDA, 'index.json');
  fs.writeFileSync(destino, JSON.stringify(indice, null, 1));

  console.log(`${folhas.length} folhas, ${totalFrames} frames de ${LADO}x${LADO}`);
  console.log(`${comJob} folhas ligadas a algum job jogavel`);
  if (irregulares) console.log(`${irregulares} arquivo(s) irregular(es), nao copiado(s)`);

  const semSprite = jobs.filter((j) => !folhas.some((f) => f.spriteIndex === j.spriteIndex));
  console.log(`jobs jogaveis sem folha: ${semSprite.length}`
    + (semSprite.length ? ' -> ' + semSprite.map((j) => j.name).join(', ') : ''));
}

main();
