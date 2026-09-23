'use strict';
/*
 * Desenha o mundo a partir dos arquivos QUE O JOGO CARREGA.
 *
 *   node tools/asset-compiler/render-world.js
 *   node tools/asset-compiler/render-world.js --ref=assets/mapref/aisenfield.png
 *
 * SAIDA  assets/debug/world.png
 *        assets/debug/world-compare.png   com --ref
 *
 *
 * POR QUE ESTE E NAO O render-demo.js
 *
 * O render-demo le a ENTRADA do pipeline: assets/mapdata/map150.json e os
 * PNGs de assets/items/. Ele responde "o recorte dos tiles esta certo?", e
 * so isso. Tudo que acontece DEPOIS dele -- o compile.js escrevendo o .dat, o
 * gen-map-ffta.js escrevendo o .otbm -- fica fora do alcance, e um erro ali
 * nao aparece.
 *
 * Foi exatamente o que aconteceu: o demo marcava 97% enquanto a tela do jogo
 * mostrava outra coisa. Medida que nao cobre o caminho inteiro nao serve para
 * dizer que o caminho esta certo.
 *
 * Este script le a SAIDA:
 *
 *   client/data/things/860/Tibia.dat    metadados (tamanho, displacement,
 *                                       elevation) -- os mesmos bytes que o
 *                                       client le
 *   client/data/things/860/Tibia.cwm    os sprites, ja em mosaico 8x8
 *   server/data/world/world.otbm        os tiles e a pilha de cada um
 *
 * Se o displacement estiver errado, se a ordem das celulas do mosaico estiver
 * trocada, se a pilha do OTBM nao tiver o tamanho certo -- aparece aqui.
 *
 *
 * O QUE ELE REPRODUZ, e de onde veio cada linha
 *
 *   MapView::transformPositionTo2D   dest da celula, com o lift de andar
 *   Tile::drawGround                 percorre a pilha somando elevation
 *   elevationOffset (tile.h)         elevacao e vertical, so em Y
 *   ThingType::draw                  displacement e o tamanho em celulas
 *
 * O que ele NAO reproduz: iluminacao, criaturas, efeitos e o corte de
 * andares de calcFirstVisibleFloor (aqui todos os andares sao desenhados).
 */

const fs = require('fs');
const path = require('path');
const { Image, readPNG, writePNG } = require('./png.js');
const { readDat } = require('./dat-read.js');
const { abrirSprites } = require('./render-check.js');
const { readOtbm } = require('../datapack-gen/otbm-read.js');

const ROOT = path.resolve(__dirname, '../..');
const DATAPACK = path.join(ROOT, 'client/data/things/860');
const WORLD = path.join(ROOT, 'server/data/world/world.otbm');
const DEBUG = path.join(ROOT, 'assets/debug');

// Tem que bater com client/src/client/const.h
const TILE_HALF_W = 16;
const TILE_HALF_H = 8;
const FLOOR_LIFT = 16;
const MAX_ELEVATION = 248;

/** Compoe respeitando alpha. Image.blit copia ate os transparentes e apaga
 *  o vizinho -- o client desenha com blending, entao isto e que e fiel. */
function blitOver(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const so = src.offset(x, y);
      if (src.pixels[so + 3] === 0) continue;
      src.pixels.copy(dst.pixels, dst.offset(tx, ty), so, so + 4);
    }
  }
}

/**
 * Monta a imagem de um ThingType e diz onde o canto dela cai em relacao a
 * `dest`. Transcrito de ThingType::getTexture + ThingType::draw.
 */
function quadroDe(thing, sprites, cell) {
  const g = thing.groups[0];
  const img = Image.blank(g.width * cell, g.height * cell);

  for (let h = 0; h < g.height; h++) {
    for (let w = 0; w < g.width; w++) {
      // Um frame so: o indice se reduz a h * largura + w.
      const id = g.sprites[h * g.width + w];
      const cel = sprites.get(id);
      if (!cel) continue;
      img.blit(cel, (g.width - w - 1) * cell, (g.height - h - 1) * cell);
    }
  }

  const disp = thing.attrs.displacement || [0, 0];
  const fator = cell / 32;
  return {
    img,
    origem: [
      -Math.trunc(disp[0] * fator) - (g.width - 1) * cell,
      -Math.trunc(disp[1] * fator) - (g.height - 1) * cell,
    ],
  };
}

function main() {
  const refArg = process.argv.find((a) => a.startsWith('--ref='));

  const sprites = abrirSprites(DATAPACK);
  const dat = readDat(fs.readFileSync(path.join(DATAPACK, 'Tibia.dat')));
  const mundo = readOtbm(fs.readFileSync(WORLD));

  const porId = new Map();
  for (const it of dat.items) porId.set(it.id, it);

  // Cache: o mesmo item aparece centenas de vezes.
  const cache = new Map();
  const quadro = (id) => {
    if (!cache.has(id)) {
      const t = porId.get(id);
      cache.set(id, t ? quadroDe(t, sprites, sprites.cell) : null);
    }
    return cache.get(id);
  };

  console.log(`datapack: ${sprites.formato}, celula ${sprites.cell}px, ${dat.items.length} itens`);

  /*
   * A ANCORA, dita em voz alta.
   *
   * Esta comparacao alinha os dois lados pela caixa do conteudo, o que a
   * torna CEGA a deslocamento global: se o mapa inteiro sair 24px para o
   * lado, a silhueta e as cores continuam batendo e o numero nao muda. No
   * jogo, porem, o mapa desloca em relacao ao PERSONAGEM, e metade dele sai
   * da viewport.
   *
   * Foi assim que um displacement errado passou por aqui com 99,2%. Entao o
   * numero que a comparacao nao ve fica impresso.
   */
  const amostra = mundo.tiles.find((t) => t.items.length && quadro(t.items[t.items.length - 1]));
  if (amostra) {
    const q = quadro(amostra.items[amostra.items.length - 1]);
    const [ax, ay] = q.origem;
    console.log(`ancora do tile de mapa: (${ax}, ${ay}) relativo a dest`
      + `${ax === 0 && ay === 0 ? '' : '   <-- NAO e zero: o mapa sai deslocado do personagem'}`);
  }
  console.log(`mundo:    ${mundo.header.width}x${mundo.header.height}, ${mundo.tiles.length} tiles`);
  const zs = [...new Set(mundo.tiles.map((t) => t.z))].sort();
  console.log(`andares:  ${zs.length} (z ${zs[0]}..${zs[zs.length - 1]})`);

  /*
   * Ordem de desenho, igual a do client:
   *   - andares do mais BAIXO (z maior) para o mais alto, porque o de cima
   *     cobre o de baixo (MapView::draw, o laco de z decrescente);
   *   - dentro do andar, por anti-diagonal (x + y) crescente, que e a ordem
   *     em que updateVisibleTilesCache enfileira as celulas.
   */
  const zBase = Math.max(...zs);
  const ordem = [...mundo.tiles].sort((a, b) =>
    (b.z - a.z) || ((a.x + a.y) - (b.x + b.y)) || (a.x - b.x));

  // Primeira passada: descobre os limites, para a imagem sair justa.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const posDe = (t) => ({
    x: (t.x - t.y) * TILE_HALF_W,
    y: (t.x + t.y) * TILE_HALF_H - (zBase - t.z) * FLOOR_LIFT,
  });

  for (const t of ordem) {
    const p = posDe(t);
    let elev = 0;
    for (const id of t.items) {
      const q = quadro(id);
      if (!q) continue;
      const x = p.x + q.origem[0];
      const y = p.y - elev + q.origem[1];
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + q.img.width); maxY = Math.max(maxY, y + q.img.height);
      const tt = porId.get(id);
      elev = Math.min(elev + (tt && tt.attrs.elevation ? tt.attrs.elevation : 0), MAX_ELEVATION);
    }
  }

  const out = Image.blank(maxX - minX, maxY - minY);

  let desenhados = 0, semArte = 0;
  for (const t of ordem) {
    const p = posDe(t);
    /*
     * Tile::drawGround: desenha o thing com a elevacao ACUMULADA ATE AQUI e
     * so depois soma a dele. Por isso o primeiro item da pilha fica no chao
     * e cada seguinte sobe mais um degrau -- inverter as duas linhas achata
     * a pilha inteira.
     */
    let elev = 0;
    for (const id of t.items) {
      const tt = porId.get(id);
      // A camada 2 (onTop) nao sai aqui: o client a desenha em Tile::drawTop,
      // depois de TODOS os chaos do andar. Fica para a segunda passada.
      if (tt && tt.attrs.onTop) continue;
      const q = quadro(id);
      if (!q) { semArte++; continue; }
      blitOver(out, q.img, p.x + q.origem[0] - minX, p.y - elev + q.origem[1] - minY);
      desenhados++;
      elev = Math.min(elev + (tt && tt.attrs.elevation ? tt.attrs.elevation : 0), MAX_ELEVATION);
    }
  }

  /*
   * Segunda passada: a camada 2.
   *
   * O client faz drawGround para todos os tiles do andar e so depois entra no
   * laco por tile que chama drawTop (MapView::drawFloor). Entao a decoracao
   * de um tile de TRAS fica por cima do terreno de um tile da FRENTE -- e por
   * isso ela precisa de uma passada propria aqui, e nao pode ser desenhada
   * junto com o chao da sua tile.
   *
   * A elevacao usada e a mesma acumulada pelo chao: drawTop desenha com
   * m_drawElevation, que drawGround ja deixou no valor da celula.
   */
  for (const t of ordem) {
    const p = posDe(t);
    let elev = 0;
    for (const id of t.items) {
      const tt = porId.get(id);
      if (!tt) continue;
      if (tt.attrs.onTop) {
        const q = quadro(id);
        if (!q) { semArte++; continue; }
        blitOver(out, q.img, p.x + q.origem[0] - minX, p.y - elev + q.origem[1] - minY);
        desenhados++;
        continue;
      }
      elev = Math.min(elev + (tt.attrs.elevation ? tt.attrs.elevation : 0), MAX_ELEVATION);
    }
  }

  fs.mkdirSync(DEBUG, { recursive: true });
  writePNG(path.join(DEBUG, 'world.png'), out);
  console.log(`itens desenhados: ${desenhados}${semArte ? `  (${semArte} sem arte)` : ''}`);
  console.log(`-> assets/debug/world.png  (${out.width}x${out.height})`);

  if (!refArg) return;

  // --- comparacao com a referencia
  const ref = readPNG(path.resolve(ROOT, refArg.slice('--ref='.length)));

  /*
   * Alinha pelo canto do conteudo opaco dos dois lados.
   *
   * Alinhar pelo canto e o unico jeito honesto aqui: a pilha conta a partir
   * da altura minima do mapa, entao o nosso mundo inteiro fica um numero
   * constante de pixels abaixo da projecao por altura absoluta. Esse
   * deslocamento e invisivel no jogo (a camera segue o personagem) e nao diz
   * nada sobre a geometria -- o que interessa e a forma, nao onde ela cai.
   */
  const caixa = (img) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (img.alphaAt(x, y) === 0) continue;
        if (x < x0) x0 = x; if (y < y0) y0 = y;
        if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  const cRef = caixa(ref);
  const cOut = caixa(out);
  console.log(`caixa referencia: ${cRef.w}x${cRef.h}   nossa: ${cOut.w}x${cOut.h}`);

  const W = Math.max(cRef.w, cOut.w), H = Math.max(cRef.h, cOut.h);
  const recorta = (img, c) => {
    const r = Image.blank(W, H);
    blitOver(r, img.crop(c.x0, c.y0, Math.min(c.w, img.width - c.x0), Math.min(c.h, img.height - c.y0)), 0, 0);
    return r;
  };
  const a = recorta(ref, cRef), b = recorta(out, cOut);

  const GAP = 8;
  const painel = Image.blank(W * 3 + GAP * 2, H);
  painel.blit(a, 0, 0);
  painel.blit(b, W + GAP, 0);

  let iguais = 0, soRef = 0, soNosso = 0;
  const dx = (W + GAP) * 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pa = a.alphaAt(x, y) !== 0, pb = b.alphaAt(x, y) !== 0;
      let rgba = null;
      if (pa && !pb) { rgba = [0, 220, 0, 255]; soRef++; }
      else if (!pa && pb) { rgba = [220, 0, 0, 255]; soNosso++; }
      else if (pa && pb) { rgba = [60, 60, 60, 255]; iguais++; }
      if (!rgba) continue;
      const o = painel.offset(dx + x, y);
      painel.pixels[o] = rgba[0]; painel.pixels[o + 1] = rgba[1];
      painel.pixels[o + 2] = rgba[2]; painel.pixels[o + 3] = rgba[3];
    }
  }

  writePNG(path.join(DEBUG, 'world-compare.png'), painel);
  const cob = (100 * iguais / (iguais + soRef)).toFixed(1);
  console.log(`cobertura: ${cob}%  (faltando ${soRef}px, sobrando ${soNosso}px)`);
  console.log('-> assets/debug/world-compare.png   referencia | nosso | diff');
}

if (require.main === module) main();
