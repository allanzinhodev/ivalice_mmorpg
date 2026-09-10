'use strict';
/*
 * Compara DUAS compilacoes de datapack pelo que elas colocam na TELA.
 *
 *   node tools/asset-compiler/render-check.js <dirA> <dirB>
 *   node tools/asset-compiler/render-check.js <dirA> <dirB> --dump
 *
 * Cada diretorio tem um Tibia.dat e um Tibia.spr ou Tibia.cwm.
 *
 *
 * POR QUE ISTO EXISTE
 *
 * Comparar os binarios nao serve para nada: mudar o tamanho da celula muda
 * todo id de sprite, toda contagem e todo displacement. Dois arquivos
 * completamente diferentes podem -- e devem -- desenhar exatamente a mesma
 * coisa no mesmo lugar.
 *
 * O que interessa e o resultado observavel: para cada thing e cada frame,
 * QUAIS PIXELS caem em QUAL posicao relativa a `dest`. E isso que este script
 * compara.
 *
 * Sem ele, a migracao de 32x32 para o mosaico 8x8 seria um salto no escuro:
 * um erro na ordem das celulas ou no displacement produz um arquivo valido,
 * que carrega sem erro, e so aparece como arte torta no jogo.
 *
 *
 * O MODELO
 *
 * Reimplementa o caminho de desenho do client, das duas partes que importam:
 *
 *   ThingType::getTexture  -- monta o quadro a partir das celulas
 *     spritePos = Point(W - w - 1, H - h - 1) * cell
 *
 *   ThingType::draw        -- coloca o quadro na tela
 *     boxTopLeft = dest - displacement * (cell/32) - (W-1, H-1) * cell
 *
 * O `textureOffset` do client nao entra na conta porque ele so reposiciona o
 * recorte opaco DENTRO do quadro; a soma com textureRect devolve o mesmo
 * pixel. Comparando o quadro inteiro, ele se cancela.
 */

const fs = require('fs');
const path = require('path');
const { Image, decodePNG, writePNG } = require('./png.js');
const { decodeSprite } = require('./spr.js');
const { readCwm } = require('./cwm.js');
const { readDat } = require('./dat-read.js');
const { FRAME_GROUP_NAMES } = require('./dat.js');

// ---------------------------------------------------------------- sprites

/** Abre o .cwm ou o .spr do diretorio, na MESMA ordem de preferencia que o
 *  client usa em SpriteManager::loadSpr -- cwm primeiro. */
function abrirSprites(dir) {
  const cwm = path.join(dir, 'Tibia.cwm');
  if (fs.existsSync(cwm)) {
    const { spriteSize, sprites } = readCwm(fs.readFileSync(cwm));
    return {
      formato: 'cwm',
      cell: spriteSize,
      get: (id) => {
        const png = sprites.get(id);
        return png ? decodePNG(png) : null;
      },
    };
  }

  const spr = path.join(dir, 'Tibia.spr');
  if (!fs.existsSync(spr)) throw new Error(`${dir}: nem Tibia.cwm nem Tibia.spr`);

  const buf = fs.readFileSync(spr);
  const count = buf.readUInt32LE(4);
  return {
    formato: 'spr',
    cell: 32,
    get: (id) => {
      if (id <= 0 || id > count) return null;
      const off = buf.readUInt32LE(8 + (id - 1) * 4);
      if (off === 0) return null;
      const size = buf.readUInt16LE(off + 3);
      const { pixels } = decodeSprite(buf.subarray(off + 5, off + 5 + size));
      return new Image(32, 32, pixels);
    },
  };
}

// ---------------------------------------------------------------- desenho

/** Indice do sprite, transcrito de ThingType::getSpriteIndex. */
function spriteIndex(g, w, h, l, x, y, z, a) {
  return ((((((a % g.phases)
    * g.patternZ + z)
    * g.patternY + y)
    * g.patternX + x)
    * g.layers + l)
    * g.height + h)
    * g.width + w;
}

/**
 * Monta um quadro (uma combinacao de layer/pattern/fase) e devolve a imagem
 * junto com onde o canto superior-esquerdo dela cai em relacao a `dest`.
 */
function montarQuadro(thing, g, sprites, cell, { l = 0, x = 0, y = 0, z = 0, a = 0 } = {}) {
  const img = Image.blank(g.width * cell, g.height * cell);

  for (let h = 0; h < g.height; h++) {
    for (let w = 0; w < g.width; w++) {
      const id = g.sprites[spriteIndex(g, w, h, l, x, y, z, a)];
      const cel = sprites.get(id);
      if (!cel) continue;
      img.blit(cel, (g.width - w - 1) * cell, (g.height - h - 1) * cell);
    }
  }

  const disp = thing.attrs.displacement || [0, 0];
  const fator = cell / 32;
  const origem = [
    -Math.trunc(disp[0] * fator) - (g.width - 1) * cell,
    -Math.trunc(disp[1] * fator) - (g.height - 1) * cell,
  ];

  return { img, origem };
}

/**
 * Todos os quadros de um thing, achatados numa lista com chave estavel.
 * A chave nao depende do tamanho da celula -- e o que permite parear os dois
 * lados da comparacao.
 */
function quadrosDe(thing, sprites, cell) {
  const out = [];
  for (const g of thing.groups) {
    for (let z = 0; z < g.patternZ; z++) {
      for (let y = 0; y < g.patternY; y++) {
        for (let x = 0; x < g.patternX; x++) {
          for (let l = 0; l < g.layers; l++) {
            for (let a = 0; a < g.phases; a++) {
              const chave = `g${g.type}/z${z}/y${y}/x${x}/l${l}/f${a}`;
              out.push({ chave, ...montarQuadro(thing, g, sprites, cell, { l, x, y, z, a }) });
            }
          }
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ comparacao

/**
 * Compara dois quadros pelo que aparece na tela.
 *
 * Nao compara as imagens diretamente: elas podem ter tamanhos diferentes (o
 * mosaico so precisa cobrir multiplos da celula) e ainda assim pintar os
 * mesmos pixels nas mesmas coordenadas. Comparamos o conjunto de pixels
 * OPACOS em coordenadas absolutas de tela.
 */
function pixelsNaTela(quadro) {
  const { img, origem } = quadro;
  const mapa = new Map();
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      if (img.pixels[o + 3] === 0) continue;
      const chave = `${origem[0] + x},${origem[1] + y}`;
      mapa.set(chave, img.pixels.readUInt32LE(o));
    }
  }
  return mapa;
}

function compararQuadro(qa, qb) {
  const a = pixelsNaTela(qa);
  const b = pixelsNaTela(qb);

  let diferentes = 0;
  for (const [k, v] of a) {
    if (b.get(k) !== v) diferentes++;
  }
  for (const k of b.keys()) {
    if (!a.has(k)) diferentes++;
  }
  return { diferentes, pixelsA: a.size, pixelsB: b.size };
}

function compararThings(nome, listaA, listaB, sprA, sprB, relatorio) {
  if (listaA.length !== listaB.length) {
    relatorio.erros.push(`${nome}: ${listaA.length} de um lado, ${listaB.length} do outro`);
    return;
  }

  for (let i = 0; i < listaA.length; i++) {
    const qa = quadrosDe(listaA[i], sprA, sprA.cell);
    const qb = quadrosDe(listaB[i], sprB, sprB.cell);

    if (qa.length !== qb.length) {
      relatorio.erros.push(`${nome} ${listaA[i].id}: ${qa.length} quadros vs ${qb.length}`);
      continue;
    }

    for (let k = 0; k < qa.length; k++) {
      relatorio.quadros++;
      if (qa[k].chave !== qb[k].chave) {
        relatorio.erros.push(`${nome} ${listaA[i].id}: quadro ${qa[k].chave} vs ${qb[k].chave}`);
        continue;
      }
      const d = compararQuadro(qa[k], qb[k]);
      if (d.diferentes > 0) {
        relatorio.divergentes++;
        if (relatorio.exemplos.length < 10) {
          relatorio.exemplos.push({
            thing: `${nome} ${listaA[i].id}`,
            quadro: qa[k].chave,
            ...d,
            a: qa[k], b: qb[k],
          });
        }
      }
    }
  }
}

function carregar(dir) {
  const sprites = abrirSprites(dir);
  const dat = readDat(fs.readFileSync(path.join(dir, 'Tibia.dat')));
  return { sprites, dat };
}

function main() {
  const [dirA, dirB] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dump = process.argv.includes('--dump');
  if (!dirA || !dirB) {
    console.error('uso: node render-check.js <dirA> <dirB> [--dump]');
    process.exit(2);
  }

  const A = carregar(dirA);
  const B = carregar(dirB);

  console.log(`A: ${dirA}`);
  console.log(`   ${A.sprites.formato}, celula ${A.sprites.cell}px, ` +
    `${A.dat.items.length} itens, ${A.dat.outfits.length} outfits`);
  console.log(`B: ${dirB}`);
  console.log(`   ${B.sprites.formato}, celula ${B.sprites.cell}px, ` +
    `${B.dat.items.length} itens, ${B.dat.outfits.length} outfits`);
  console.log('');

  const relatorio = { quadros: 0, divergentes: 0, erros: [], exemplos: [] };
  compararThings('item', A.dat.items, B.dat.items, A.sprites, B.sprites, relatorio);
  compararThings('outfit', A.dat.outfits, B.dat.outfits, A.sprites, B.sprites, relatorio);

  for (const e of relatorio.erros) console.log(`ERRO  ${e}`);

  console.log(`quadros comparados: ${relatorio.quadros}`);
  console.log(`divergentes:        ${relatorio.divergentes}`);

  if (relatorio.exemplos.length) {
    console.log('\nprimeiras divergencias:');
    for (const x of relatorio.exemplos) {
      console.log(`  ${x.thing.padEnd(12)} ${x.quadro.padEnd(24)} ` +
        `${x.diferentes} px diferentes (A tem ${x.pixelsA} opacos, B tem ${x.pixelsB})`);
    }
    if (dump) {
      const out = path.resolve('assets/debug');
      fs.mkdirSync(out, { recursive: true });
      const x = relatorio.exemplos[0];
      writePNG(path.join(out, 'render-check-A.png'), x.a.img);
      writePNG(path.join(out, 'render-check-B.png'), x.b.img);
      console.log(`\ndespejado o primeiro caso em ${out}/render-check-{A,B}.png`);
      console.log(`  origem A ${JSON.stringify(x.a.origem)}  origem B ${JSON.stringify(x.b.origem)}`);
    }
  }

  const ok = relatorio.divergentes === 0 && relatorio.erros.length === 0;
  console.log(`\n${ok ? 'IGUAIS: as duas compilacoes desenham o mesmo na mesma posicao.'
    : 'DIFERENTES.'}`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { abrirSprites, quadrosDe, pixelsNaTela, montarQuadro };
