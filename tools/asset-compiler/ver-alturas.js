'use strict';
/*
 * ver-alturas.js -- desenha o height map de um mapa do FFTA sobre a arte.
 *
 *   node tools/asset-compiler/ver-alturas.js <indice> [nome-do-tileset]
 *
 * Exemplo:
 *   node tools/asset-compiler/ver-alturas.js 150 aizenfield
 *
 *
 * PARA QUE SERVE
 *
 * O height map e um JSON de numeros. Saber que a celula (3,4) tem altura 5
 * nao diz nada sobre o mapa; ver o relevo desenhado, sim.
 *
 * Gera tres imagens:
 *
 *   alturas-mapa.png     so o height map, em cores por nivel
 *   alturas-sobre.png    a arte da camada 1 com o height map por cima
 *   alturas-relevo.png   cada celula deslocada -8px por nivel
 *
 *
 * O QUE AS TRES IMAGENS MOSTRARAM (Aizenfield, mapa 150)
 *
 * A segunda e a util. A grade cobre o terreno jogavel e para na moldura de
 * pedra -- 77,3% dos pixels opacos, com zero transbordo. O resto e a borda,
 * que aparece no desenho e nao e celula.
 *
 * A terceira prova um ponto que vale para o motor: com o deslocamento
 * aplicado, as celulas altas do norte SOEM da moldura e flutuam acima da
 * arte. Ou seja, **a arte ja tem o relevo desenhado**. O -8px por nivel
 * serve para posicionar o PERSONAGEM sobre a celula, nao para mover o
 * terreno -- aplica-lo ao chao soma o relevo duas vezes.
 */

const fs = require('fs');
const path = require('path');
const { Image, readPNG, writePNG } = require('./png.js');

// Projecao isometrica do jogo (client/src/client/const.h).
const TILE_HALF_W = 16;
const TILE_HALF_H = 8;
const ELEVATION_STEP = 8;

/*
 * Cor por nivel de altura. Escala de terreno: baixo = agua/vale, alto =
 * pico. Nao e decorativa -- ler 32 tons de cinza e impossivel, e a diferenca
 * entre altura 4 e 5 e o que decide se o JUMP passa.
 */
function corDaAltura(h, min, max) {
  if (h === null) return [60, 60, 60, 255];         // celula sem dado
  const t = max > min ? (h - min) / (max - min) : 0;
  // azul -> verde -> amarelo -> vermelho
  if (t < 0.33) { const k = t / 0.33; return [0, Math.round(120 + 135 * k), Math.round(200 - 120 * k), 255]; }
  if (t < 0.66) { const k = (t - 0.33) / 0.33; return [Math.round(255 * k), 255, Math.round(80 - 80 * k), 255]; }
  const k = (t - 0.66) / 0.34;
  return [255, Math.round(255 - 180 * k), 0, 255];
}

function preencher(img, x0, y0, w, h, cor) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x0 + x, py = y0 + y;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const o = (py * img.width + px) * 4;
      img.pixels[o] = cor[0]; img.pixels[o + 1] = cor[1];
      img.pixels[o + 2] = cor[2]; img.pixels[o + 3] = cor[3];
    }
  }
}

/** Desenha o losango de uma celula, com o vertice superior em (cx, cy). */
function losango(img, cx, cy, cor, alpha) {
  for (let dy = 0; dy < TILE_HALF_H * 2; dy++) {
    // Meia-largura cresce ate o meio e decresce depois.
    const meio = dy < TILE_HALF_H ? dy : (TILE_HALF_H * 2 - 1 - dy);
    const larg = (meio + 1) * 2;
    for (let dx = -larg; dx < larg; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const o = (py * img.width + px) * 4;
      const a = alpha / 255;
      img.pixels[o] = Math.round(img.pixels[o] * (1 - a) + cor[0] * a);
      img.pixels[o + 1] = Math.round(img.pixels[o + 1] * (1 - a) + cor[1] * a);
      img.pixels[o + 2] = Math.round(img.pixels[o + 2] * (1 - a) + cor[2] * a);
      img.pixels[o + 3] = 255;
    }
  }
}

function main() {
  const indice = parseInt(process.argv[2] || '150', 10);
  const nome = process.argv[3] || 'aizenfield';

  const RAIZ = path.resolve(__dirname, '..', '..');
  const hm = JSON.parse(fs.readFileSync(
    path.join(RAIZ, 'assets', 'ffta', 'maps', 'heightmaps.json'), 'utf8'));

  const mapa = hm.mapas.find((m) => m.index === indice);
  if (!mapa || !mapa.decodificado) {
    console.error(`mapa ${indice} nao tem height map decodificado`);
    process.exit(1);
  }

  const saida = path.join(RAIZ, 'assets', 'ffta', 'tilesets', nome);
  fs.mkdirSync(saida, { recursive: true });

  console.log(`mapa ${indice}: ${mapa.largura}x${mapa.altura}, alturas ${mapa.min}..${mapa.max}`);

  // --- 1. so o height map, em celulas quadradas (leitura direta) -----------
  const ESC = 24;
  const grade = Image.blank(mapa.largura * ESC, mapa.altura * ESC);
  for (let y = 0; y < mapa.altura; y++) {
    for (let x = 0; x < mapa.largura; x++) {
      preencher(grade, x * ESC, y * ESC, ESC - 1, ESC - 1,
        corDaAltura(mapa.grade[y][x], mapa.min, mapa.max));
    }
  }
  writePNG(path.join(saida, 'alturas-mapa.png'), grade);
  console.log(`  alturas-mapa.png     ${grade.width}x${grade.height}  grade quadrada, cor por nivel`);

  // --- 2 e 3. sobre a arte, e com o relevo aplicado -----------------------
  const arte = path.join(RAIZ, 'tools', `${nome}.png`);
  if (!fs.existsSync(arte)) {
    console.log(`  (${nome}.png nao encontrado -- pulando as vistas sobre a arte)`);
    return;
  }

  const base = readPNG(arte);

  /*
   * Onde fica a celula (col,row) na arte?
   *
   * Obtido por busca: para cada (OX,OY), quantos pixels opacos da arte caem
   * dentro de algum losango da grade, penalizando o que transborda para o
   * vazio. O otimo cobre 77,3% com ZERO transbordo; o resto e a moldura de
   * pedra das bordas, que esta desenhada e nao e celula.
   *
   * Foi assim que o corte de colunas do height map se revelou errado: com as
   * 14 colunas antigas o melhor encaixe dava 67,7%, e uma grade de 15x14
   * cobria 78% -- ou seja, FALTAVAM colunas. Ver o comentario em
   * tools/ffta-extract/to-assets.js.
   */
  const OX = 208;
  const OY = 28;

  for (const comRelevo of [false, true]) {
    const img = Image.blank(base.width, base.height);
    base.pixels.copy(img.pixels);

    for (let row = 0; row < mapa.altura; row++) {
      for (let col = 0; col < mapa.largura; col++) {
        const h = mapa.grade[row][col];
        if (h === null) continue;

        const sx = OX + (col - row) * TILE_HALF_W;
        const sy = OY + (col + row) * TILE_HALF_H - (comRelevo ? h * ELEVATION_STEP : 0);

        losango(img, sx - TILE_HALF_W, sy, corDaAltura(h, mapa.min, mapa.max), 120);
      }
    }

    const arquivo = comRelevo ? 'alturas-relevo.png' : 'alturas-sobre.png';
    writePNG(path.join(saida, arquivo), img);
    console.log(`  ${arquivo.padEnd(20)} ${img.width}x${img.height}  ` +
      (comRelevo ? `cada celula sobe ${ELEVATION_STEP}px por nivel` : 'sem relevo, so a grade'));
  }
}

main();
