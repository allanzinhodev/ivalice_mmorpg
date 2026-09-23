'use strict';
/*
 * remontar.js -- reconstroi as camadas a partir do tileset e compara.
 *
 *   node tools/asset-compiler/remontar.js <nome> <camada1.png> [camada2.png ...]
 *
 * Exemplo:
 *   node tools/asset-compiler/remontar.js aizenfield \
 *     tools/aizenfield.png tools/aizenfield2.png tools/aizenfield3.png
 *
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * O tileset.js deduplicou 5916 tiles em 351. Isso pode estar certo ou pode
 * ter perdido arte -- um bug de indice, um recorte deslocado, uma celula
 * classificada como vazia por engano. Nenhum desses aparece olhando o atlas:
 * ele fica bonito do mesmo jeito.
 *
 * O unico teste que decide e refazer o caminho inverso e comparar PIXEL A
 * PIXEL com o original. Se der zero diferenca, o tileset representa as
 * camadas sem perda. Se nao der, o numero de pixels errados e onde eles
 * estao dizem qual e o bug.
 *
 * Em caso de diferenca, grava um PNG de diff com os pixels errados em
 * magenta -- olhar onde eles caem costuma resolver mais rapido que ler o
 * codigo.
 */

const fs = require('fs');
const path = require('path');
const { Image, readPNG, writePNG } = require('./png.js');

function main() {
  const nome = process.argv[2];
  const entradas = process.argv.slice(3);

  if (!nome || !entradas.length) {
    console.error('uso: node tools/asset-compiler/remontar.js <nome> <camada.png...>');
    process.exit(1);
  }

  const dir = path.resolve(__dirname, '..', '..', 'assets', 'ffta', 'tilesets', nome);
  const mapa = JSON.parse(fs.readFileSync(path.join(dir, 'mapa.json'), 'utf8'));
  const atlas = readPNG(path.join(dir, 'tiles.png'));

  const CELL = mapa.celula;
  const COLS = mapa.atlasColunas;

  /** Recorta o tile `id` do atlas. id 0 = celula vazia. */
  function tileDoAtlas(id) {
    if (id === 0) return null;
    const i = id - 1;
    return atlas.crop((i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
  }

  let falhou = false;

  for (let c = 0; c < mapa.camadas.length; c++) {
    const camada = mapa.camadas[c];
    const original = readPNG(entradas[c]);

    const refeita = Image.blank(camada.largura * CELL, camada.altura * CELL);
    for (let linha = 0; linha < camada.altura; linha++) {
      for (let coluna = 0; coluna < camada.largura; coluna++) {
        const t = tileDoAtlas(camada.grade[linha][coluna]);
        if (t) refeita.blit(t, coluna * CELL, linha * CELL);
      }
    }

    /*
     * Compara RGB so onde o pixel e OPACO.
     *
     * Debaixo do alpha zero as camadas guardam lixo do ripper: verde-chave
     * (0,255,0) em 54 mil pixels da camada 1, e preto em outros 1856 -- as
     * duas coisas invisiveis, e nenhuma delas reproduzivel por um buffer
     * zerado. Exigir os quatro canais acusava 40% da imagem como errada e
     * escondia um eventual erro de verdade no meio do ruido.
     *
     * O que importa e: o pixel e transparente nos dois? Se sim, igual. Se
     * nao, o RGB tem que bater exatamente.
     */
    let errados = 0;
    const diff = Image.blank(refeita.width, refeita.height);
    for (let i = 0; i < original.width * original.height; i++) {
      const aOrig = original.pixels[i * 4 + 3];
      const aNovo = refeita.pixels[i * 4 + 3];

      const igual = (aOrig === 0 && aNovo === 0) || (
        aOrig === aNovo
        && original.pixels[i * 4] === refeita.pixels[i * 4]
        && original.pixels[i * 4 + 1] === refeita.pixels[i * 4 + 1]
        && original.pixels[i * 4 + 2] === refeita.pixels[i * 4 + 2]);
      if (igual) continue;
      errados++;
      diff.pixels[i * 4] = 255; diff.pixels[i * 4 + 1] = 0;
      diff.pixels[i * 4 + 2] = 255; diff.pixels[i * 4 + 3] = 255;
    }

    const total = original.width * original.height;
    const nome1 = path.basename(entradas[c]);

    if (errados === 0) {
      console.log(`  ${nome1.padEnd(20)} IDENTICA  (${total} pixels)`);
    } else {
      falhou = true;
      const saidaDiff = path.join(dir, `diff-${nome1}`);
      writePNG(saidaDiff, diff);
      console.log(`  ${nome1.padEnd(20)} ${errados} pixels diferentes ` +
        `(${(100 * errados / total).toFixed(3)}%)  -> ${saidaDiff}`);
    }
  }

  console.log();
  if (falhou) {
    console.log('FALHOU -- o tileset nao representa as camadas sem perda.');
    process.exit(1);
  }
  console.log('OK -- as camadas reconstroem pixel a pixel a partir do tileset.');
}

main();
