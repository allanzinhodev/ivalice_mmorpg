'use strict';
/*
 * render-demo.js -- redesenha o mapa a partir dos tiles JA recortados,
 * usando o MESMO algoritmo do client. Serve para conferir a extracao sem
 * precisar subir o server.
 *
 *   node tools/asset-compiler/render-demo.js [--map=150]
 *
 * ENTRADA   assets/items/NNN-map<N>-*.png  +  assets/mapdata/map<N>.json
 * SAIDA     assets/debug/map<N>-demo.png        so o resultado
 *           assets/debug/map<N>-compare.png     referencia | demo | diff
 *
 * POR QUE ISTO EXISTE
 *
 * O overlay de grade (--calib) mostra ONDE a grade cai, mas nao mostra o que
 * o jogo vai desenhar. Um recorte pode estar alinhado e ainda assim levar
 * pedaco do vizinho, ou perder a face lateral do bloco -- e nada disso
 * aparece no overlay. Redesenhando de verdade, qualquer erro de recorte vira
 * um artefato visivel no diff.
 *
 * O ALGORITMO (client/src/client/mapview.cpp e tile.cpp)
 *
 * 1. Painter's algorithm: as celulas sao desenhadas em ordem crescente de
 *    (col + row) -- a anti-diagonal. Quem esta atras e desenhado primeiro e
 *    quem esta na frente cobre. Nao ha depth buffer.
 * 2. Dentro da celula, os itens empilhados sobem m_drawElevation pixels
 *    (Tile::drawGround, client/src/client/tile.cpp:62-63).
 * 3. A projecao e MapView::transformPositionTo2D.
 *
 * O que este script NAO simula: o displacement [0,-16] que o compile.js poe
 * no ground item. Ele desloca a arte na tela, mas desloca TODAS as celulas
 * igualmente, entao nao muda o alinhamento relativo -- que e o que estamos
 * conferindo aqui.
 */

const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, Image } = require('./png.js');
const E = require('./extract-map-tiles.js');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'assets');

const SPRITE = 32;

/** Carrega os tiles do mapa, indexados pelo numero no nome do arquivo. */
function loadTiles(mapIndex) {
  const dir = path.join(ASSETS, 'items');
  const suffix = `-map${mapIndex}-`;
  const tiles = new Map();
  for (const f of fs.readdirSync(dir)) {
    const at = f.indexOf(suffix);
    if (at < 0 || !f.toLowerCase().endsWith('.png')) continue;
    const n = parseInt(f.slice(at + suffix.length), 10);
    if (!isNaN(n)) tiles.set(n, readPNG(path.join(dir, f)));
  }
  return tiles;
}

/**
 * Compoe respeitando o alpha -- ao contrario de Image.blit, que COPIA todos
 * os pixels, inclusive os transparentes.
 *
 * Isso importa muito aqui. Os sprites vizinhos se sobrepoem bastante (o passo
 * da grade e 16px em X para um sprite de 32px), entao um blit que copia os
 * cantos transparentes do losango APAGA o vizinho ja desenhado embaixo. O
 * sintoma e um mosaico de buracos triangulares -- que foi exatamente o que
 * apareceu na primeira versao deste script, e nao era erro de recorte nem de
 * altura: os tiles estavam certos, 166 dos 201 completamente opacos.
 *
 * O client nao tem esse problema porque desenha via OpenGL com blending.
 */
function blitOver(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const so = src.offset(x, y);
      if (src.pixels[so + 3] === 0) continue;   // transparente: nao apaga
      src.pixels.copy(dst.pixels, dst.offset(tx, ty), so, so + 4);
    }
  }
}
/**
 * Desenha o mapa. `origin` e o mesmo da extracao, entao o resultado fica
 * pixel a pixel em cima da referencia.
 */
function render(data, tiles, width, height, modoJogo) {
  const out = Image.blank(width, height);

  // Painter's algorithm: ordena por (col + row). Empate nao importa -- duas
  // celulas na mesma anti-diagonal nunca se sobrepoem.
  const cells = [];
  for (let r = 0; r < data.rows; r++) {
    for (let c = 0; c < data.cols; c++) {
      const cell = data.grid[r] && data.grid[r][c];
      if (cell && cell.tile !== null && cell.tile !== undefined) cells.push({ c, r, cell });
    }
  }
  cells.sort((a, b) => (a.c + a.r) - (b.c + b.r));

  for (const { c, r, cell } of cells) {
    const img = tiles.get(cell.tile);
    if (!img) continue;

    if (!modoJogo) {
      // Projecao IDEAL: um blit na altura crua. Serve para conferir o
      // recorte, que e o que este script sempre fez.
      const p = E.project(c, r, cell.height, data.origin);
      blitOver(out, img, p.x, p.y);
      continue;
    }

    /*
     * Projecao DO JOGO: a altura chega partida em duas metades que so se
     * somam na tela.
     *
     *   z         -> FLOOR_LIFT por andar, em MapView::transformPositionTo2D
     *   elevation -> itens empilhados, cada um somando o proprio elevation
     *                do .dat em Tile::drawGround
     *
     * Vale simular isso, e nao so a projecao ideal, porque as duas metades
     * podem fechar a conta no topo e ainda assim divergir da referencia: cada
     * item empilhado e desenhado, e o de baixo aparece como uma faixa sob o
     * de cima. O demo ideal desenha UM tile e nunca mostraria essa faixa.
     */
    const andar = Math.floor(cell.height / E.HEIGHT_PER_FLOOR);
    const degraus = cell.height % E.HEIGHT_PER_FLOOR;

    const x = data.origin.x + (c - r) * E.TILE_HALF_W;
    const yBase = data.origin.y + (c + r) * E.TILE_HALF_H - andar * E.FLOOR_LIFT;

    // O ground primeiro, depois os itens de altura, cada um PX_PER_HEIGHT
    // acima -- a mesma ordem do client, para quem cobre quem sair igual.
    for (let i = 0; i <= degraus; i++) {
      blitOver(out, img, x, yBase - i * E.PX_PER_HEIGHT);
    }
  }
  return out;
}

/** Painel referencia | demo | diff, com uma faixa escura separando. */
function compare(ref, demo) {
  const GAP = 8;
  const w = ref.width * 3 + GAP * 2;
  const out = Image.blank(w, ref.height);

  out.blit(ref, 0, 0);
  out.blit(demo, ref.width + GAP, 0);

  // diff: verde = so na referencia (faltou desenhar), vermelho = so no demo
  // (desenhou onde nao devia), cinza = igual nos dois.
  const dx = (ref.width + GAP) * 2;
  for (let y = 0; y < ref.height; y++) {
    for (let x = 0; x < ref.width; x++) {
      const a = ref.alphaAt(x, y) !== 0;
      const b = x < demo.width && y < demo.height && demo.alphaAt(x, y) !== 0;
      let rgba = null;
      if (a && !b) rgba = [0, 220, 0, 255];
      else if (!a && b) rgba = [220, 0, 0, 255];
      else if (a && b) rgba = [60, 60, 60, 255];
      if (!rgba) continue;
      const o = out.offset(dx + x, y);
      out.pixels[o] = rgba[0]; out.pixels[o + 1] = rgba[1];
      out.pixels[o + 2] = rgba[2]; out.pixels[o + 3] = rgba[3];
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const mapIndex = parseInt((args.find((a) => a.startsWith('--map=')) || '--map=150').slice(6), 10);

  const dataPath = path.join(ASSETS, `mapdata/map${mapIndex}.json`);
  if (!fs.existsSync(dataPath)) throw new Error(`nao achei ${dataPath} -- rode o extract-map-tiles.js antes`);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const modoJogo = args.includes('--game');
  const tiles = loadTiles(mapIndex);
  console.log(`mapa ${mapIndex}: ${data.cols}x${data.rows} celulas, ${tiles.size} tiles` + (modoJogo ? '  [modo jogo: z + pilha]' : '  [projecao ideal]'));

  const ref = readPNG(path.join(ASSETS, 'mapref/aisenfield.png'));
  const demo = render(data, tiles, ref.width, ref.height, modoJogo);

  const dbg = path.join(ASSETS, 'debug');
  if (!fs.existsSync(dbg)) fs.mkdirSync(dbg, { recursive: true });

  writePNG(path.join(dbg, `map${mapIndex}${modoJogo?"-game":""}-demo.png`), demo);
  writePNG(path.join(dbg, `map${mapIndex}${modoJogo?"-game":""}-compare.png`), compare(ref, demo));

  // Metrica objetiva: quantos pixels batem.
  let both = 0, onlyRef = 0, onlyDemo = 0;
  for (let y = 0; y < ref.height; y++) {
    for (let x = 0; x < ref.width; x++) {
      const a = ref.alphaAt(x, y) !== 0;
      const b = demo.alphaAt(x, y) !== 0;
      if (a && b) both++; else if (a) onlyRef++; else if (b) onlyDemo++;
    }
  }
  const cov = (100 * both / (both + onlyRef)).toFixed(1);
  console.log(`cobertura: ${cov}%  (faltando ${onlyRef}px, sobrando ${onlyDemo}px)`);
  console.log(`-> assets/debug/map${mapIndex}${modoJogo?"-game":""}-demo.png`);
  console.log(`-> assets/debug/map${mapIndex}${modoJogo?"-game":""}-compare.png`);
}

if (require.main === module) main();

module.exports = { render, loadTiles };
