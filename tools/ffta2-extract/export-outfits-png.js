'use strict';
/*
 * export-outfits-png.js -- exporta as outfits ja compiladas (Tibia.dat +
 * Tibia.cwm) como PNGs simples, um por (outfit, frame group, direcao, fase,
 * z), para o pipeline de import do mvp/ (C++) consumir sem precisar
 * entender o formato .dat/.cwm nem a ordem invertida de blocos 8x8.
 *
 *   node tools/ffta2-extract/export-outfits-png.js [--saida=DIR] [--unidades=N]
 *
 * Reaproveita os leitores ja existentes (readDat, readCwm) -- nao reimplementa
 * nada do parsing binario. So remonta cada frame group em uma imagem RGBA
 * normal (32x48 por frame) e grava um outfits.json com os metadados
 * (frameGroupType, direcoes, z, fases) que o C++ precisa pra montar o novo
 * .dat/.spr do mvp/.
 */

const fs = require('fs');
const path = require('path');
const { Image, writePNG, decodePNG } = require('../asset-compiler/png.js');
const { readDat } = require('../asset-compiler/dat-read.js');
const { readCwm } = require('../asset-compiler/cwm.js');

const CELULA = 8;
const COLS = 4, ROWS = 6; // 32x48 -> 4x6 blocos de 8x8

function main() {
  const args = process.argv.slice(2);
  const arg = (nome, padrao) => {
    const a = args.find((x) => x.startsWith('--' + nome + '='));
    return a ? a.split('=')[1] : padrao;
  };

  const datDir = path.join(__dirname, '..', '..', 'client', 'data', 'things', '860');
  const outDir = arg('saida', path.join(__dirname, '..', '..', 'mvp', 'build', 'outfits_export'));
  const limite = parseInt(arg('unidades', '0'), 10);

  fs.mkdirSync(outDir, { recursive: true });

  console.log('lendo Tibia.dat e Tibia.cwm...');
  const dat = readDat(fs.readFileSync(path.join(datDir, 'Tibia.dat')));
  const cwm = readCwm(fs.readFileSync(path.join(datDir, 'Tibia.cwm')));

  if (cwm.spriteSize !== CELULA) {
    throw new Error(`Tibia.cwm tem sprite de ${cwm.spriteSize}px, esperava ${CELULA}`);
  }

  // cache: sprite id (bloco 8x8) -> Image decodificada, pra nao redecodificar
  // o mesmo bloco repetidas vezes entre outfits/direcoes/fases
  const blocoCache = new Map();
  function blocoImagem(id) {
    if (id === 0) return null; // vazio
    if (blocoCache.has(id)) return blocoCache.get(id);
    const png = cwm.sprites.get(id);
    if (!png) return null;
    const img = decodePNG(png, `sprite ${id}`);
    blocoCache.set(id, img);
    return img;
  }

  /*
   * Remonta um frame 32x48 a partir dos 24 ids de bloco na ordem que
   * compilar-outfits.js:fatiar gravou -- ele fatia de tras para frente
   * (canto inferior direito primeiro) porque ThingType::getTexture blita
   * assim. Aqui fazemos o inverso: colocamos cada bloco na posicao (w,h) que
   * gerou aquele id, desfazendo a inversao.
   */
  function remontarFrame(spriteIds) {
    const img = Image.blank(COLS * CELULA, ROWS * CELULA);
    let i = 0;
    for (let h = 0; h < ROWS; h++) {
      for (let w = 0; w < COLS; w++) {
        const id = spriteIds[i++];
        const bloco = blocoImagem(id);
        if (bloco) {
          const destX = (COLS - w - 1) * CELULA;
          const destY = (ROWS - h - 1) * CELULA;
          img.blit(bloco, destX, destY);
        }
      }
    }
    return img;
  }

  const total = limite > 0 ? Math.min(limite, dat.outfits.length) : dat.outfits.length;
  console.log(`compilando ${total} outfits...`);
  const manifest = [];

  for (let oi = 0; oi < total; oi++) {
    const outfit = dat.outfits[oi];
    const unitDir = path.join(outDir, String(outfit.id));
    let anyFrame = false;

    const groupsMeta = [];
    for (const group of outfit.groups) {
      // sprites index order (compilar-outfits.js:gruposDaUnidade):
      // fase -> z (0=terra,1=agua) -> x (0=Sul,1=Oeste) -> 24 blocos
      const perFrame = COLS * ROWS;
      const perDirection = perFrame;
      const perZ = group.patternX * perDirection;
      const frames = [];

      for (let f = 0; f < group.phases; f++) {
        const frameEntry = { phase: f, dry: {}, wet: {} };
        for (let z = 0; z < group.patternZ; z++) {
          for (let x = 0; x < group.patternX; x++) {
            const base = (f * group.patternZ + z) * group.patternX * perDirection + x * perDirection;
            const ids = group.sprites.slice(base, base + perFrame);
            const img = remontarFrame(ids);
            const direction = x === 0 ? 'south' : 'west';
            const waterKey = z === 0 ? 'dry' : 'wet';
            if (!fs.existsSync(unitDir)) fs.mkdirSync(unitDir, { recursive: true });
            const fileName = `${group.type}_${waterKey}_${direction}_f${f}.png`;
            writePNG(path.join(unitDir, fileName), img);
            frameEntry[waterKey][direction] = fileName;
            anyFrame = true;
          }
        }
        frames.push(frameEntry);
      }

      groupsMeta.push({ type: group.type, phases: group.phases, frames });
    }

    if (anyFrame) {
      manifest.push({ id: outfit.id, groups: groupsMeta });
    }
  }

  fs.writeFileSync(path.join(outDir, 'outfits.json'), JSON.stringify(manifest, null, 1));
  console.log(`${manifest.length} outfits exportadas em ${outDir}`);
}

if (require.main === module) main();

module.exports = { main };
