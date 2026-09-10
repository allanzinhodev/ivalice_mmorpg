'use strict';
/*
 * Compila assets/ -> client/data/things/860/Tibia.dat + Tibia.spr
 *
 *   node tools/asset-compiler/compile.js
 *
 * assets/ e a fonte da verdade. Nao editar os binarios a mao: rode isto.
 * Substitui o Object Builder (que precisa do Adobe AIR SDK) e os scripts de
 * remendo fix-dat.js / add-frame-groups.js, que corrigiam depois o que o
 * editor gerava errado.
 *
 * ENTRADA
 *   assets/items/NN-nome.png       32x32, um ground tile cada
 *   assets/outfits/NN-nome.png     96x808, spritesheet conforme
 *                                  tools/prompts/Playable character Spritesheet.txt
 *
 * SAIDA
 *   client/data/things/860/Tibia.dat
 *   client/data/things/860/Tibia.spr
 *   assets/facesets/NN-nome.png    recortados, ainda NAO usados no jogo
 */

const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, Image } = require('./png.js');
const { buildSpr, SPRITE_SIZE } = require('./spr.js');
const { buildDat, FrameGroup, FRAME_GROUP_NAMES } = require('./dat.js');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'assets');
const OUT_DIR = path.join(ROOT, 'client/data/things/860');

// Assinaturas: mantidas iguais as atuais para nao invalidar caches do client.
const DAT_SIGNATURE = 0x4c2c7993;
const SPR_SIGNATURE = 0x4c220594;

// --- spritesheet de entrada (ver a spec em tools/prompts/) ---
const SRC_FRAME_W = 24;
const SRC_FRAME_H = 48;
const OUT_FRAME_W = 32;
const OUT_FRAME_H = 64;   // = 2 sprites de 32x32 empilhados

// Colunas: 0=Sul, 1=Oeste, 2=Agua-Sul, 3=Agua-Oeste
const COL_SOUTH = 0, COL_WEST = 1, COL_WATER_SOUTH = 2, COL_WATER_WEST = 3;

// Ordem das linhas na folha. Cada entrada e [grupo, quantidade de frames].
const SHEET_ROWS = [
  [FrameGroup.IDLE, 2],
  [FrameGroup.WALK, 2],
  [FrameGroup.EVADE, 1],
  [FrameGroup.JUMP, 2],
  [FrameGroup.HIT, 1],
  [FrameGroup.DEAD, 2],
  [FrameGroup.ATTACK, 3],
  [FrameGroup.WEAK, 2],
];

const TOTAL_ROWS = SHEET_ROWS.reduce((a, [, n]) => a + n, 0); // 15
const FACESET_Y = TOTAL_ROWS * SRC_FRAME_H;                   // 720
const FACESET_SIZE = 96;

const FRAME_DURATION_MS = 300;

/**
 * Direcoes na ordem que o client espera (patternX = 4):
 *   0 = Norte, 1 = Leste, 2 = Sul, 3 = Oeste
 *
 * A folha so tras Sul e Oeste; Norte e o Oeste espelhado e Leste e o Sul
 * espelhado (spec). Por isso `mirror`.
 */
const DIRECTIONS = [
  { name: 'norte', col: COL_WEST, mirror: true },
  { name: 'leste', col: COL_SOUTH, mirror: true },
  { name: 'sul', col: COL_SOUTH, mirror: false },
  { name: 'oeste', col: COL_WEST, mirror: false },
];

const WATER_COL = { [COL_SOUTH]: COL_WATER_SOUTH, [COL_WEST]: COL_WATER_WEST };

/** Coleta os sprites 32x32 e devolve ids, deduplicando os repetidos. */
class SpriteTable {
  constructor() {
    this.sprites = [null];   // indice 0 nao e usado pelo formato
    this.byHash = new Map();
    this.emptyId = 0;        // sprite vazio = id 0
  }

  add(img) {
    if (img.isEmpty()) return this.emptyId;
    const key = img.pixels.toString('latin1');
    const found = this.byHash.get(key);
    if (found !== undefined) return found;
    const id = this.sprites.length;
    this.sprites.push(img);
    this.byHash.set(key, id);
    return id;
  }
}

/**
 * Descobre a BASE da folha: o maior y com pixel opaco em qualquer celula.
 *
 * O alinhamento "embaixo" da spec tem que ser feito pelo CONTEUDO, nao pela
 * celula: dentro dos 48px de cada celula sobra uma margem transparente (5-6px
 * no soldier), e blitar a celula inteira faz o personagem flutuar acima do
 * chao e o corte de 32px cair no meio do corpo.
 *
 * A base e UMA SO para a folha inteira, de proposito. Alinhar cada frame pelo
 * seu proprio conteudo faria o personagem "pular" entre frames de alturas
 * diferentes -- e, pior, destruiria uma diferenca que e INTENCIONAL na arte:
 * as colunas de agua terminam ~7px mais alto que as de terra, porque o
 * personagem esta submerso. Com base unica esse deslocamento e preservado.
 */
function findSheetBaseline(sheet, rows) {
  let baseline = -1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 4; col++) {
      const cell = sheet.crop(col * SRC_FRAME_W, row * SRC_FRAME_H, SRC_FRAME_W, SRC_FRAME_H);
      for (let y = SRC_FRAME_H - 1; y > baseline; y--) {
        let has = false;
        for (let x = 0; x < SRC_FRAME_W; x++) {
          if (cell.alphaAt(x, y) !== 0) { has = true; break; }
        }
        if (has) { baseline = y; break; }
      }
    }
  }
  return baseline < 0 ? SRC_FRAME_H - 1 : baseline;
}

/**
 * Recorta um frame da folha e converte 24x48 -> 32x64.
 * A spec manda alinhar a ESQUERDA e EMBAIXO -- ver findSheetBaseline para o
 * que "embaixo" significa aqui.
 */
function extractFrame(sheet, col, row, mirror, baseline) {
  const src = sheet.crop(col * SRC_FRAME_W, row * SRC_FRAME_H, SRC_FRAME_W, SRC_FRAME_H);

  // Limites horizontais do conteudo dentro da celula.
  //
  // O desenho NAO esta centrado na celula de 24px: no soldier ele ocupa
  // x 9..23, colado na borda direita. Espelhar a celula inteira jogaria o
  // personagem para a borda ESQUERDA, e ele "pularia" 9px de lado ao trocar
  // de direcao. Por isso recortamos o conteudo antes de espelhar.
  let x0 = SRC_FRAME_W, x1 = -1;
  for (let y = 0; y < SRC_FRAME_H; y++) {
    for (let x = 0; x < SRC_FRAME_W; x++) {
      if (src.alphaAt(x, y) !== 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }

  const out = Image.blank(OUT_FRAME_W, OUT_FRAME_H);
  if (x1 < 0) return out; // celula vazia (ex.: attack nao tem versao na agua)

  const contentW = x1 - x0 + 1;
  const content = src.crop(x0, 0, contentW, SRC_FRAME_H);
  const shaped = mirror ? content.flipX() : content;

  // Centraliza na horizontal e encosta a base do conteudo na base do frame:
  // a linha `baseline` da celula vai para a ultima linha do frame de saida.
  const base = baseline === undefined ? SRC_FRAME_H - 1 : baseline;
  const dx = Math.floor((OUT_FRAME_W - contentW) / 2);
  out.blit(shaped, dx, OUT_FRAME_H - 1 - base);
  return out;
}

/**
 * Fatia o frame 32x64 nos dois sprites de 32x32 que o .dat espera.
 *
 * Com height=2 o client percorre h de 0 a 1 e o indice do sprite cresce com
 * h -- ou seja, a ordem e de CIMA para baixo.
 */
function sliceFrame(frame, table) {
  const top = frame.crop(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const bottom = frame.crop(0, SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE);
  return [table.add(top), table.add(bottom)];
}

/**
 * Monta um frame group do outfit.
 *
 * A ordem dos sprites tem que casar com ThingType::getSpriteIndex:
 *   ((((((fase * patZ + z) * patY + y) * patX + x) * layers + l) * h + hh) * w + ww)
 * ou seja, o indice mais rapido e a largura, depois altura, layer, patternX,
 * patternY, patternZ, e o mais lento e a fase.
 */
function buildOutfitGroup(sheet, table, groupType, firstRow, phases, baseline) {
  const sprites = [];

  for (let phase = 0; phase < phases; phase++) {
    const row = firstRow + phase;
    for (let z = 0; z < 2; z++) {            // patternZ: 0 = seco, 1 = agua
      for (const dir of DIRECTIONS) {         // patternX: as 4 direcoes
        const col = z === 0 ? dir.col : WATER_COL[dir.col];
        const frame = extractFrame(sheet, col, row, dir.mirror, baseline);
        const [top, bottom] = sliceFrame(frame, table);
        // width=1, height=2, layers=1 -> por frame saem 2 sprites, de cima
        // para baixo.
        sprites.push(top, bottom);
      }
    }
  }

  return {
    type: groupType,
    width: 1,
    height: 2,
    exactSize: 32,
    layers: 1,
    patternX: 4,
    patternY: 1,
    patternZ: 2,
    phases,
    durationMs: FRAME_DURATION_MS,
    sprites,
  };
}

function listAssets(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
}

function compileItems(table) {
  const dir = path.join(ASSETS, 'items');
  const files = listAssets(dir);
  const items = [];

  for (const file of files) {
    const img = readPNG(path.join(dir, file));
    if (img.width !== SPRITE_SIZE || img.height !== SPRITE_SIZE) {
      throw new Error(`${file}: item tem que ser ${SPRITE_SIZE}x${SPRITE_SIZE}, veio ${img.width}x${img.height}`);
    }
    const id = table.add(img);
    items.push({
      name: file,
      attrs: {
        // ThingAttrGround e obrigatorio: sem ele Tile::drawGround para na
        // primeira iteracao e o chao nao aparece.
        ground: 110,
        // Sobe o tile meio losango. Negativo de proposito -- o client
        // reinterpreta o u16 como int16.
        displacement: [0, -16],
        fullGround: true,
      },
      groups: [{
        type: 0,
        width: 1, height: 1, layers: 1,
        patternX: 1, patternY: 1, patternZ: 1,
        phases: 1,
        sprites: [id],
      }],
    });
  }

  return items;
}

function compileOutfits(table) {
  const dir = path.join(ASSETS, 'outfits');
  const files = listAssets(dir);
  const outfits = [];
  const facesets = [];

  for (const file of files) {
    const sheet = readPNG(path.join(dir, file));

    const expectedW = 4 * SRC_FRAME_W;
    if (sheet.width !== expectedW) {
      throw new Error(`${file}: largura ${sheet.width}, esperado ${expectedW} (4 colunas de ${SRC_FRAME_W})`);
    }
    if (sheet.height < FACESET_Y) {
      throw new Error(`${file}: altura ${sheet.height}, precisa de ao menos ${FACESET_Y} (${TOTAL_ROWS} linhas de ${SRC_FRAME_H})`);
    }

    const baseline = findSheetBaseline(sheet, TOTAL_ROWS);

    const groups = [];
    let row = 0;
    for (const [groupType, phases] of SHEET_ROWS) {
      groups.push(buildOutfitGroup(sheet, table, groupType, row, phases, baseline));
      row += phases;
    }

    outfits.push({ name: file, attrs: { displacement: [8, 4] }, groups });

    // Faceset: recortado e exportado, mas ainda NAO usado no jogo.
    facesets.push({ name: file, image: sheet.crop(0, FACESET_Y, FACESET_SIZE, FACESET_SIZE) });
  }

  return { outfits, facesets };
}

/** Effect e missile minimos -- o formato exige ao menos um de cada. */
function stubThing() {
  return {
    attrs: {},
    groups: [{
      type: 0,
      width: 1, height: 1, layers: 1,
      patternX: 1, patternY: 1, patternZ: 1,
      phases: 1,
      sprites: [0],
    }],
  };
}

function main() {
  const table = new SpriteTable();

  const items = compileItems(table);
  const { outfits, facesets } = compileOutfits(table);

  const effects = [stubThing()];
  const missiles = [{
    attrs: {},
    groups: [{
      type: 0,
      width: 1, height: 1, layers: 1,
      patternX: 3, patternY: 3, patternZ: 1,
      phases: 1,
      sprites: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    }],
  }];

  const dat = buildDat({ signature: DAT_SIGNATURE, items, outfits, effects, missiles });
  const spr = buildSpr(table.sprites, SPR_SIGNATURE);

  // Backup antes de sobrescrever.
  for (const f of ['Tibia.dat', 'Tibia.spr']) {
    const p = path.join(OUT_DIR, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'Tibia.dat'), dat);
  fs.writeFileSync(path.join(OUT_DIR, 'Tibia.spr'), spr);

  const faceDir = path.join(ASSETS, 'facesets');
  if (!fs.existsSync(faceDir)) fs.mkdirSync(faceDir, { recursive: true });
  for (const f of facesets) writePNG(path.join(faceDir, f.name), f.image);

  console.log(`items    ${items.length}  (ids 100..${99 + items.length})`);
  console.log(`outfits  ${outfits.length}  x ${SHEET_ROWS.length} frame groups`);
  for (const [type, phases] of SHEET_ROWS) {
    console.log(`           ${String(type).padStart(2)} ${FRAME_GROUP_NAMES[type].padEnd(7)} ${phases} fase(s)`);
  }
  console.log(`sprites  ${table.sprites.length - 1} unicos`);
  console.log(`facesets ${facesets.length} -> assets/facesets/ (nao usados no jogo ainda)`);
  console.log(`Tibia.dat ${dat.length} bytes`);
  console.log(`Tibia.spr ${spr.length} bytes`);
}

if (require.main === module) main();

module.exports = { SHEET_ROWS, DIRECTIONS, extractFrame, findSheetBaseline, TOTAL_ROWS };
