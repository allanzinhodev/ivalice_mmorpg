'use strict';
/*
 * extract-map-tiles.js — recorta os tiles de um mapa do FFTA a partir da
 * imagem de referencia, e emite os ground items + a grade do mapa.
 *
 *   node tools/asset-compiler/extract-map-tiles.js [--map=150] [--calib]
 *
 * ENTRADA
 *   assets/mapref/aisenfield.png   o mapa renderizado (veio do jogo)
 *   tools/rom.gba                  para o height map (altura por celula)
 *
 * SAIDA
 *   assets/items/NNN-<mapa>-<n>.png   tiles unicos, 32x32
 *   assets/mapdata/<mapa>.json        grade: por celula { tile, altura, z }
 *   assets/debug/<mapa>-calib.png     com --calib: grade sobre a referencia
 *
 * POR QUE A IMAGEM E NAO A ROM
 *
 * O arrangement da ROM nao foi decodificado por completo: os indices nao
 * casam com a referencia (38/202 na melhor tentativa). Ja a imagem casa
 * 1008 tiles contra o tileset. Ver .claude/skills/ffta-map/SKILL.md.
 *
 * O DESVIO ISOMETRICO E OS ANDARES
 *
 * Este e o ponto que mais confunde. O TFS/OTBM tem a sua propria convencao
 * de andar, em Position::coveredUp: subir um andar e (x+1, y+1, z-1).
 * Nosso client desenha com levantamento vertical (- dz * FLOOR_LIFT).
 *
 * As duas descrevem A MESMA geometria:
 *
 *   coveredUp:  ((col+1)-(row+1))*16 = (col-row)*16   -> X nao muda
 *               ((col+1)+(row+1))*8  = (col+row)*8+16 -> Y desloca 16
 *   lift:       (col+row)*8 - dz*16                   -> Y desloca 16
 *
 * O deslocamento diagonal do coveredUp CANCELA em X no losango e sobra
 * exatamente 16px em Y -- que e o FLOOR_LIFT. Nao e coincidencia:
 * FLOOR_LIFT = 2 * TILE_HALF_H e o que faz o client concordar com o OTBM.
 *
 * Por isso aqui usamos a mesma formula do client
 * (MapView::transformPositionTo2D), e o OTBM gerado depois bate sozinho.
 */

const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, Image } = require('./png.js');
const G = require('../ffta-extract/gfx.js');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'assets');

// Tem que bater com Otc::TILE_HALF_W/H e FLOOR_LIFT em client/src/client/const.h
const TILE_HALF_W = 16;
const TILE_HALF_H = 8;
const FLOOR_LIFT = 16;

// Sprite do Tibia. O losango tem 32x16, mas recortamos 32x32 para pegar
// tambem a face lateral do bloco -- e o que da o visual do FFTA.
const SPRITE = 32;

// Quanto UMA unidade de altura do FFTA vale em pixels na tela.
//
// Medido, nao chutado: recortando o Aisenfield com varios valores e contando
// os tiles unicos por conteudo RGBA, k=8 e o unico que deixa as 208 celulas
// inteiramente dentro da arte (208/208 opacas) e o que mais deduplica:
//
//   k=0 -> 29 tiles unicos, 202/208 opacas
//   k=4 -> 25 tiles unicos, 205/208 opacas
//   k=8 -> 22 tiles unicos, 208/208 opacas
//
// E TILE_HALF_H, o que faz sentido: no losango 32x16 um degrau de altura
// desloca meio tile em Y.
const PX_PER_HEIGHT = TILE_HALF_H;

// Altura do FFTA -> andar. Ver gen-map-ffta.js, que usa a mesma constante.
const HEIGHT_PER_FLOOR = 3;

// Height map: stride 16.
//
// Em ALGUNS mapas as ultimas colunas nao sao terreno e sim enderecos -- no
// mapa 0 a coluna 14 vai 32,64,96,128... de 32 em 32, e o RenderHeightMap.cs
// do FFTAUtils pula essas colunas ("it's addresses, not values").
//
// Mas isso NAO vale para todos: no mapa 150 as 16 colunas tem terreno de
// verdade (valores 2..7, sem a progressao de endereco), e 16+13 = 29 casa
// exatamente com a largura da referencia (464/16 = 29). Por isso detectamos
// em vez de fixar em 14.
const HM_STRIDE = 16;

const BASE = 0x569104, REC = 0x58;

function loadHeightMap(rom, mapIndex) {
  const ptr = (o) => (rom.readUInt32LE(o) + BASE) >>> 0;
  const out = G.decompress(rom, ptr(BASE + mapIndex * REC + 0x10));
  if (!out || !out.data) throw new Error(`mapa ${mapIndex}: heightmap nao descomprimiu`);

  const data = out.data;
  const rows = Math.floor(((data.length - 4) / 2) / HM_STRIDE);
  const at = (r, c) => data[4 + (r * HM_STRIDE + c) * 2];

  // Descobre quantas colunas sao terreno: uma coluna de ENDERECO cresce de 32
  // em 32 a cada linha (mod 256). Terreno nao faz isso.
  let cols = HM_STRIDE;
  if (rows > 2) {
    for (let c = HM_STRIDE - 1; c >= 8; c--) {
      let isAddr = true;
      for (let r = 1; r < rows; r++) {
        if (((at(r - 1, c) + 32) & 0xff) !== at(r, c)) { isAddr = false; break; }
      }
      if (isAddr) cols = c; else break;
    }
  }

  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(at(r, c));
    grid.push(row);
  }
  grid.cols = cols;
  return grid;
}

/**
 * Projecao identica a MapView::transformPositionTo2D do client, mas com a
 * altura CRUA em vez do andar quantizado.
 *
 * Antes isto recebia z (= altura/3) e multiplicava por FLOOR_LIFT. Isso
 * achatava tudo dentro do andar: no Aisenfield as alturas 3, 4 e 5 caem todas
 * em z=1 e eram recortadas da MESMA linha da imagem -- o relevo interno
 * simplesmente sumia.
 *
 * Com a altura crua x PX_PER_HEIGHT o recorte segue a arte pixel a pixel. O
 * andar continua saindo de HEIGHT_PER_FLOOR, e a diferenca dentro do andar
 * vira elevation (itens empilhados), nao z.
 */
function project(col, row, height, origin) {
  return {
    x: origin.x + (col - row) * TILE_HALF_W,
    y: origin.y + (col + row) * TILE_HALF_H - height * PX_PER_HEIGHT,
  };
}

/**
 * Quantos itens com hasHeight a celula precisa empilhar.
 *
 * O server conta ITENS, nao pixels: Tile::hasHeight(n) percorre o stack e
 * conta os que tem CONST_PROP_HASHEIGHT (server/src/tile.cpp:127). O
 * Game::internalMoveCreature usa esse mesmo contador para decidir subir ou
 * descer de andar (game.cpp:1676).
 *
 * Entao a altura DENTRO do andar (0, 1 ou 2, com HEIGHT_PER_FLOOR=3) vira
 * exatamente essa quantidade de itens empilhados.
 */
function elevationFor(height) {
  return height % HEIGHT_PER_FLOOR;
}

/**
 * Calcula a origem da grade GEOMETRICAMENTE.
 *
 * Forca bruta nao serve aqui: qualquer origem que caia numa regiao densa
 * pontua alto, e a "melhor" acabava empurrando a grade para a direita,
 * cobrindo so parte do mapa. Com 208/208 celulas "com conteudo" o resultado
 * parecia perfeito e estava deslocado 11px.
 *
 * A conta e direta. Na projecao isometrica:
 *   screenX = origin.x + (col - row) * TILE_HALF_W
 *   screenY = origin.y + (col + row) * TILE_HALF_H - z * FLOOR_LIFT
 *
 * O ponto mais a ESQUERDA do desenho e a celula (col=0, row=rowMax), e o mais
 * ALTO e aquele que minimiza (col+row)*HH - z*LIFT. Igualando esses extremos
 * ao bounding box do conteudo da imagem, a origem sai fechada.
 */
function calibrate(ref, hm) {
  const rows = hm.length, cols = hm[0].length;

  // bounding box do conteudo
  let bx0 = ref.width, by0 = ref.height;
  for (let y = 0; y < ref.height; y++) {
    for (let x = 0; x < ref.width; x++) {
      if (ref.alphaAt(x, y) !== 0) { if (x < bx0) bx0 = x; if (y < by0) by0 = y; }
    }
  }

  // extremos da grade, em coordenadas relativas (origin = 0)
  let relMinX = Infinity, relMinY = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - r) * TILE_HALF_W;
      // o topo do bloco e o proprio topo do losango (o sprite comeca ali)
      const y = (c + r) * TILE_HALF_H - hm[r][c] * PX_PER_HEIGHT;
      if (x < relMinX) relMinX = x;
      if (y < relMinY) relMinY = y;
    }
  }

  return { x: bx0 - relMinX, y: by0 - relMinY };
}

/**
 * Recorta a celula 32x32, mascarando o que esta FORA do losango.
 *
 * Sem a mascara o recorte quadrado leva junto pedacos das celulas vizinhas,
 * e praticamente nada deduplica -- 197 tiles unicos para 208 celulas. Com a
 * mascara, duas celulas de chao igual viram o MESMO tile.
 *
 * A mascara e o losango de 32x16 no TOPO do sprite, mais a face lateral que
 * desce dele ate a base -- o bloco isometrico do FFTA.
 */
function cutCell(ref, col, row, height, origin) {
  const p = project(col, row, height, origin);
  // project() devolve o canto ESQUERDO do losango, e o losango e o topo do
  // sprite. Entao o recorte comeca exatamente ali: nada de deslocar em Y.
  //
  // Isto ja esteve deslocado -(SPRITE - 2*TILE_HALF_H) por assumir o losango
  // na base. Com a mascara no topo, aquele shift recortava 16px acima da
  // celula -- pegando o vizinho de tras em vez da propria face.
  const cell = ref.crop(p.x, p.y, SPRITE, SPRITE);

  const out = Image.blank(SPRITE, SPRITE);

  // A mascara e o BLOCO isometrico: o losango do TOPO mais as duas faces
  // laterais que descem dele ate a base do sprite.
  //
  // O losango de 32x16 fica na METADE DE CIMA do sprite (y 0..15) -- e o
  // topo do bloco, onde a criatura pisa. Os 16px de baixo (y 16..31) sao a
  // face lateral, que e o que da o visual de bloco do FFTA.
  //
  // Duas tentativas anteriores falharam aqui:
  //   - "faixa vertical estreitando para cima" saiu em forma de cone e
  //     cortava a face lateral;
  //   - a versao seguinte centrava o losango em y=24, invertendo a geometria:
  //     a largura ficava NEGATIVA acima de y=16 e a face era descartada. So
  //     376 dos 1024 pixels sobreviviam, e a deduplicacao ia para 151 tiles.
  for (let y = 0; y < SPRITE; y++) {
    for (let x = 0; x < SPRITE; x++) {
      const dx = Math.abs(x - TILE_HALF_W + 0.5);
      let inside;
      if (y < TILE_HALF_H) {
        // Metade DE CIMA do losango: a meia-largura cresce 2px por linha,
        // de 2 (na ponta) ate 32 (na linha do meio).
        //
        // Antes isto usava min(y, 15-y), o que fazia o losango INTEIRO em
        // 16px e depois estreitava de volta ate 6px de largura. O resultado
        // foi o padrao de buracos em losango no render-demo: cada celula
        // cobria menos area do que o passo da grade.
        inside = dx <= (y + 1) * 2;
      } else {
        // Da linha do meio do losango para baixo e a FACE LATERAL do
        // bloco: largura cheia ate a base do sprite. E o que encosta na
        // celula da frente e fecha o mosaico.
        inside = dx <= TILE_HALF_W - 0.5;
      }
      if (!inside) continue;
      const o = cell.offset(x, y);
      cell.pixels.copy(out.pixels, out.offset(x, y), o, o + 4);
    }
  }
  return out;
}

class TileTable {
  constructor() { this.tiles = []; this.byHash = new Map(); }
  add(img) {
    if (img.isEmpty()) return null;
    const key = img.pixels.toString('latin1');
    if (this.byHash.has(key)) return this.byHash.get(key);
    const id = this.tiles.length;
    this.tiles.push(img);
    this.byHash.set(key, id);
    return id;
  }
}

function drawGridOverlay(ref, hm, origin) {
  const out = Image.blank(ref.width, ref.height);
  out.blit(ref, 0, 0);
  const mark = (x, y, rgba) => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
    const o = out.offset(x, y);
    out.pixels[o] = rgba[0]; out.pixels[o + 1] = rgba[1];
    out.pixels[o + 2] = rgba[2]; out.pixels[o + 3] = 255;
  };
  for (let r = 0; r < hm.length; r++) {
    for (let c = 0; c < hm[0].length; c++) {
      const p = project(c, r, hm[r][c], origin);
      // desenha o losango da celula
      for (let i = 0; i < TILE_HALF_W; i++) {
        const dy = Math.floor(i / 2);
        mark(p.x + i, p.y + TILE_HALF_H - dy, [255, 0, 0]);
        mark(p.x + TILE_HALF_W * 2 - i, p.y + TILE_HALF_H - dy, [255, 0, 0]);
        mark(p.x + i, p.y + TILE_HALF_H + dy, [255, 0, 0]);
        mark(p.x + TILE_HALF_W * 2 - i, p.y + TILE_HALF_H + dy, [255, 0, 0]);
      }
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const mapIndex = parseInt((args.find((a) => a.startsWith('--map=')) || '--map=150').slice(6), 10);
  const calib = args.includes('--calib');

  const refPath = path.join(ASSETS, 'mapref/aisenfield.png');
  if (!fs.existsSync(refPath)) throw new Error(`nao achei ${refPath}`);
  const ref = readPNG(refPath);

  const rom = fs.readFileSync(path.join(ROOT, 'tools/rom.gba'));
  const hm = loadHeightMap(rom, mapIndex);

  console.log(`mapa ${mapIndex}: ${hm[0].length}x${hm.length} celulas`);
  console.log(`referencia: ${ref.width}x${ref.height}`);

  const origin = calibrate(ref, hm);
  console.log(`origem: (${origin.x},${origin.y})  calculada pelo bounding box do conteudo`);

  if (calib) {
    const dbg = path.join(ASSETS, 'debug');
    if (!fs.existsSync(dbg)) fs.mkdirSync(dbg, { recursive: true });
    const out = path.join(dbg, `map${mapIndex}-calib.png`);
    writePNG(out, drawGridOverlay(ref, hm, origin));
    console.log(`-> ${path.relative(ROOT, out)}`);
    return;
  }

  const table = new TileTable();
  const grid = [];
  for (let r = 0; r < hm.length; r++) {
    const row = [];
    for (let c = 0; c < hm[0].length; c++) {
      const h = hm[r][c];
      const z = Math.floor(h / HEIGHT_PER_FLOOR);
      const cell = cutCell(ref, c, r, h, origin);
      row.push({ tile: table.add(cell), height: h, z, elevation: elevationFor(h) });
    }
    grid.push(row);
  }

  const itemsDir = path.join(ASSETS, 'items');
  const dataDir = path.join(ASSETS, 'mapdata');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  table.tiles.forEach((img, i) => {
    const name = `${String(200 + i).padStart(3, '0')}-map${mapIndex}-${i}.png`;
    writePNG(path.join(itemsDir, name), img);
  });

  fs.writeFileSync(
    path.join(dataDir, `map${mapIndex}.json`),
    JSON.stringify({ map: mapIndex, cols: hm[0].length, rows: hm.length, origin, grid }, null, 1)
  );

  console.log(`tiles unicos: ${table.tiles.length}`);
  console.log(`-> assets/items/ e assets/mapdata/map${mapIndex}.json`);
}

if (require.main === module) main();

module.exports = { project, elevationFor, loadHeightMap, TILE_HALF_W, TILE_HALF_H, FLOOR_LIFT, HEIGHT_PER_FLOOR, PX_PER_HEIGHT };
