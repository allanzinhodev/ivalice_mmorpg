'use strict';
/*
 * Compara a folha que o CLIENT exportou com a que o compilador diz que
 * deveria sair.
 *
 *   node tools/asset-compiler/export-check.js <folha.png> <cat> <id> [dir]
 *
 *   cat: 0 = item, 1 = criatura
 *   dir: diretorio do datapack (padrao client/data/things/860)
 *
 *
 * O QUE ISTO FECHA
 *
 * render-check.js compara duas compilacoes -- um modelo em JS contra outro
 * modelo em JS. Prova que o compilador e coerente, nao que o client concorda
 * com ele.
 *
 * Aqui o lado A e um PNG produzido DENTRO do client, por
 * ThingType::exportImage, depois de passar por SpriteManager::loadCwmSpr e
 * pela tabela de ids do .dat. Se este PNG bate pixel a pixel com o modelo, a
 * cadeia inteira esta provada: compilador -> .cwm -> loader -> ids -> ordem
 * das celulas.
 *
 * Para gerar o lado do client, ver client/mods/client_assetcheck/.
 *
 *
 * O LAYOUT
 *
 * Transcrito de ThingType::exportImage:
 *
 *   largura = ss * W * layers * patX
 *   altura  = ss * H * fases * patY * patZ
 *   posicao = ss * (W - w - 1 + W*x + W*patX*l),
 *             ss * (H - h - 1 + H*y + H*patY*a + H*patY*fases*z)
 *
 * Duas particularidades do client que precisam ser reproduzidas, e que so
 * aparecem lendo ThingType::unserialize:
 *
 *   - `fases` e o TOTAL somado de todos os frame groups, nao o de um grupo.
 *     Os grupos sao concatenados num unico eixo de fase, e e assim que
 *     getSpriteIndex os enxerga.
 *   - `m_size` e sobrescrito a cada grupo no laco de leitura, entao o que
 *     sobra e o tamanho do ULTIMO grupo. So funciona porque todos os nossos
 *     grupos tem o mesmo tamanho -- conferimos isso explicitamente abaixo.
 */

const fs = require('fs');
const path = require('path');
const { Image, readPNG, writePNG } = require('./png.js');
const { readDat } = require('./dat-read.js');
const { abrirSprites } = require('./render-check.js');

function montarFolha(thing, sprites, cell) {
  const g0 = thing.groups[0];
  for (const g of thing.groups) {
    if (g.width !== g0.width || g.height !== g0.height) {
      throw new Error('frame groups de tamanhos diferentes: exportImage usa o ' +
        'tamanho do ultimo grupo para a folha inteira, entao a comparacao nao valeria');
    }
    if (g.layers !== g0.layers || g.patternX !== g0.patternX ||
        g.patternY !== g0.patternY || g.patternZ !== g0.patternZ) {
      throw new Error('frame groups com patterns diferentes');
    }
  }

  const W = g0.width, H = g0.height;
  const { layers, patternX: patX, patternY: patY, patternZ: patZ } = g0;
  const fases = thing.groups.reduce((s, g) => s + g.phases, 0);

  // Os grupos sao concatenados no eixo de fase; e o que getSpriteIndex ve.
  const ids = [].concat(...thing.groups.map((g) => g.sprites));

  const indice = (w, h, l, x, y, z, a) =>
    ((((((a % fases) * patZ + z) * patY + y) * patX + x) * layers + l) * H + h) * W + w;

  const img = Image.blank(cell * W * layers * patX, cell * H * fases * patY * patZ);

  for (let z = 0; z < patZ; z++) {
    for (let y = 0; y < patY; y++) {
      for (let x = 0; x < patX; x++) {
        for (let l = 0; l < layers; l++) {
          for (let a = 0; a < fases; a++) {
            for (let w = 0; w < W; w++) {
              for (let h = 0; h < H; h++) {
                const cel = sprites.get(ids[indice(w, h, l, x, y, z, a)]);
                if (!cel) continue;
                img.blit(cel,
                  cell * (W - w - 1 + W * x + W * patX * l),
                  cell * (H - h - 1 + H * y + H * patY * a + H * patY * fases * z));
              }
            }
          }
        }
      }
    }
  }

  return img;
}

function main() {
  const [folha, catStr, idStr, dir = 'client/data/things/860'] = process.argv.slice(2);
  if (!folha || catStr === undefined || idStr === undefined) {
    console.error('uso: node export-check.js <folha.png> <cat 0|1> <id> [dir]');
    process.exit(2);
  }
  const cat = Number(catStr), id = Number(idStr);

  const sprites = abrirSprites(dir);
  const dat = readDat(fs.readFileSync(path.join(dir, 'Tibia.dat')));
  const lista = cat === 1 ? dat.outfits : dat.items;
  const thing = lista.find((t) => t.id === id);
  if (!thing) {
    console.error(`thing cat=${cat} id=${id} nao existe no .dat`);
    process.exit(2);
  }

  const doCliente = readPNG(folha);
  const doModelo = montarFolha(thing, sprites, sprites.cell);

  console.log(`client: ${doCliente.width}x${doCliente.height}`);
  console.log(`modelo: ${doModelo.width}x${doModelo.height}`);

  if (doCliente.width !== doModelo.width || doCliente.height !== doModelo.height) {
    console.log('\nDIFERENTES: as dimensoes nao batem.');
    process.exit(1);
  }

  let diferentes = 0;
  let primeiro = null;
  for (let i = 0; i < doCliente.pixels.length; i += 4) {
    // Pixel transparente: so a opacidade importa, a cor sob alpha 0 e livre.
    const aA = doCliente.pixels[i + 3], aB = doModelo.pixels[i + 3];
    const igual = (aA === 0 && aB === 0) ||
      doCliente.pixels.readUInt32LE(i) === doModelo.pixels.readUInt32LE(i);
    if (!igual) {
      diferentes++;
      if (!primeiro) {
        const p = i / 4;
        primeiro = { x: p % doCliente.width, y: Math.floor(p / doCliente.width) };
      }
    }
  }

  const total = doCliente.width * doCliente.height;
  console.log(`pixels diferentes: ${diferentes} de ${total}`);
  if (diferentes) {
    console.log(`primeiro em (${primeiro.x}, ${primeiro.y})`);
    const out = path.resolve('assets/debug');
    fs.mkdirSync(out, { recursive: true });
    writePNG(path.join(out, 'export-check-modelo.png'), doModelo);
    console.log(`modelo despejado em ${out}/export-check-modelo.png`);
  }

  console.log(`\n${diferentes === 0
    ? 'IGUAIS: o client remontou exatamente o que o compilador escreveu.'
    : 'DIFERENTES.'}`);
  process.exit(diferentes === 0 ? 0 : 1);
}

if (require.main === module) main();
