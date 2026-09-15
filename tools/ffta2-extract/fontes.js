'use strict';
/*
 * fontes.js -- onde estao a ROM extraida e as sprites exportadas.
 *
 * O editor extrai a ROM para uma pasta temporaria de nome gerado
 * (`FFTA2-ORIGINAL.nds<numero>`), que ele APAGA ao sair. Scripts que
 * apontavam para la pararam de funcionar sozinhos.
 *
 * Aqui a extracao vive num lugar estavel e e refeita se faltar. Defina
 * IVALICE_FFTA2_ROM / IVALICE_FFTA2_SPRITES para apontar para outro lugar.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = process.env.IVALICE_FFTA2_DADOS
  || path.join(__dirname, '..', '..', '.ffta2');

const ROM = process.env.IVALICE_FFTA2_ROM
  || 'C:/Users/aradantas/Downloads/ffta2-rom-backup/FFTA2-ORIGINAL.nds';

const NDSTOOL = process.env.IVALICE_NDSTOOL
  || 'C:/Users/aradantas/Downloads/ffta2-editor/ffta2-editor/ndstool.exe';

const SPRITES = process.env.IVALICE_FFTA2_SPRITES
  || 'C:/Users/aradantas/Downloads/ffta2-editor/ffta2-editor/units/Unit Sprites';

/** A pasta `master` da ROM extraida, extraindo-a se ainda nao existir. */
function master() {
  const dir = path.join(RAIZ, 'data', 'master');
  if (fs.existsSync(path.join(dir, 'pc.idx'))) return dir;

  if (!fs.existsSync(ROM)) {
    throw new Error(
      `ROM nao encontrada em ${ROM}.\n` +
      `Defina IVALICE_FFTA2_ROM, ou IVALICE_FFTA2_DADOS apontando para uma ` +
      `extracao que ja tenha data/master/pc.idx.`
    );
  }

  fs.mkdirSync(RAIZ, { recursive: true });
  execFileSync(NDSTOOL, ['-x', ROM, '-d', 'data'], { cwd: RAIZ, stdio: 'pipe' });

  if (!fs.existsSync(path.join(dir, 'pc.idx'))) {
    throw new Error(`a extracao rodou mas nao produziu ${dir}/pc.idx`);
  }
  return dir;
}

/** O Archive do pc.idx/pc.bin, pronto para uso. */
function archive() {
  const { Archive } = require('./archive.js');
  const m = master();
  return new Archive(path.join(m, 'pc.idx'), path.join(m, 'pc.bin'));
}

/** O IdxAndPak das animacoes de unidade. */
function unitSsts() {
  const { IdxAndPak } = require('./idx-pak.js');
  const ar = archive();
  return new IdxAndPak(
    'unitSsts',
    ar.porNome('char/rom/rom_idx/UnitSst.rom_idx', 0),
    ar.porNome('char/rom/pak/UnitSst.pak', 0)
  );
}

module.exports = { RAIZ, ROM, SPRITES, master, archive, unitSsts };
