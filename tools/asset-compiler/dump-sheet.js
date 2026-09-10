'use strict';
/*
 * Exporta uma folha de conferencia com os frames JA CONVERTIDOS, do jeito
 * exato que o compilador os monta.
 *
 *   node tools/asset-compiler/dump-sheet.js [arquivo.png]
 *
 * Saida: assets/debug/<nome>-converted.png
 *
 * Layout da saida: uma LINHA por frame da spritesheet (na ordem dos frame
 * groups) e uma COLUNA por combinacao direcao x patternZ, na mesma ordem em
 * que os sprites entram no .dat:
 *
 *   seco:  Norte  Leste  Sul  Oeste
 *   agua:  Norte  Leste  Sul  Oeste
 *
 * Cada celula e o frame 32x64 final. As linhas de grade separam as celulas e
 * a linha vermelha marca onde termina o primeiro sprite de 32x32 -- com
 * height=2 cada frame vira DOIS sprites, e e util ver o corte.
 */

const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, Image } = require('./png.js');
const { SHEET_ROWS, DIRECTIONS, extractFrame, findSheetBaseline, TOTAL_ROWS } = require('./compile.js');
const { FRAME_GROUP_NAMES } = require('./dat.js');

const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'assets/debug');

const OUT_W = 32, OUT_H = 64;
const PAD = 4;          // espaco entre celulas
const LABEL_W = 0;      // sem texto: e um PNG cru, sem fonte

const COL_SOUTH = 0, COL_WEST = 1;
const WATER_COL = { [COL_SOUTH]: 2, [COL_WEST]: 3 };

function drawLine(img, x0, y0, x1, y1, rgba) {
  for (let y = y0; y <= y1 && y < img.height; y++) {
    for (let x = x0; x <= x1 && x < img.width; x++) {
      if (x < 0 || y < 0) continue;
      const o = img.offset(x, y);
      img.pixels[o] = rgba[0];
      img.pixels[o + 1] = rgba[1];
      img.pixels[o + 2] = rgba[2];
      img.pixels[o + 3] = rgba[3];
    }
  }
}

function dump(file) {
  const sheet = readPNG(file);
  const name = path.basename(file, '.png');
  const baseline = findSheetBaseline(sheet, TOTAL_ROWS);

  // total de frames = soma das fases de todos os grupos
  const totalFrames = SHEET_ROWS.reduce((a, [, n]) => a + n, 0);
  const cols = DIRECTIONS.length * 2;   // 4 direcoes x seco/agua

  const cellW = OUT_W + PAD;
  const cellH = OUT_H + PAD;
  const out = Image.blank(LABEL_W + cols * cellW + PAD, totalFrames * cellH + PAD);

  // fundo cinza escuro, para enxergar os limites de cada frame
  for (let i = 0; i < out.pixels.length; i += 4) {
    out.pixels[i] = 24; out.pixels[i + 1] = 24; out.pixels[i + 2] = 32; out.pixels[i + 3] = 255;
  }

  const lines = [];
  let outRow = 0;
  let srcRow = 0;

  for (const [groupType, phases] of SHEET_ROWS) {
    for (let phase = 0; phase < phases; phase++) {
      let col = 0;
      for (let z = 0; z < 2; z++) {
        for (const dir of DIRECTIONS) {
          const srcCol = z === 0 ? dir.col : WATER_COL[dir.col];
          const frame = extractFrame(sheet, srcCol, srcRow, dir.mirror, baseline);

          const x = LABEL_W + col * cellW + PAD;
          const y = outRow * cellH + PAD;
          out.blit(frame, x, y);

          // corte entre os dois sprites de 32x32
          drawLine(out, x, y + 32, x + OUT_W - 1, y + 32, [200, 40, 40, 255]);
          col++;
        }
      }
      lines.push(`  linha ${String(outRow).padStart(2)}: ${FRAME_GROUP_NAMES[groupType]} fase ${phase}  (linha ${srcRow} da folha)`);
      outRow++;
      srcRow++;
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${name}-converted.png`);
  writePNG(outFile, out);

  console.log(`${name}: ${sheet.width}x${sheet.height} -> ${out.width}x${out.height}  (baseline y=${baseline})`);
  console.log('colunas: seco[Norte Leste Sul Oeste] agua[Norte Leste Sul Oeste]');
  console.log(lines.join('\n'));
  console.log(`-> ${path.relative(ROOT, outFile)}`);
}

function main() {
  const arg = process.argv[2];
  if (arg) { dump(path.resolve(arg)); return; }

  const dir = path.join(ROOT, 'assets/outfits');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.png'))) {
    dump(path.join(dir, f));
    console.log();
  }
}

if (require.main === module) main();
