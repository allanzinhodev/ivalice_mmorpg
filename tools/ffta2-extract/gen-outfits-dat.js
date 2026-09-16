'use strict';
/*
 * gen-outfits-dat.js -- gera o datapack das outfits do FFTA2.
 *
 *   node tools/ffta2-extract/gen-outfits-dat.js [--unidades=N] [--saida=DIR]
 *
 *
 * O QUE SAI
 *
 *   Tibia.dat     as outfits, uma por unidade, com um frame group por
 *                 animacao -- mais os tilesets que ja existiam
 *   Tibia.cwm     os blocos 8x8 deduplicados, como PNG empacotado
 *   paletas.json  as variantes de cor, para a troca de paleta futura
 *
 *
 * OS TILESETS SAO PRESERVADOS
 *
 * O .dat atual so tem a categoria tilesets (as celulas do Aizenfield), e
 * apaga-los deixaria o mapa sem arte. Como os sprites das outfits entram
 * DEPOIS no .cwm, os ids delas sao deslocados pelo total ja existente --
 * senao as duas categorias apontariam para os mesmos sprites.
 *
 *
 * INDEXADO VIRA RGBA AQUI, E SO AQUI
 *
 * Os blocos saem do PNG indexado carregando o indice de paleta, que e o dado
 * que a troca de cor em runtime vai querer. Mas o .cwm guarda cada sprite
 * como PNG RGBA (buildCwm chama encodePNG), entao a conversao acontece na
 * escrita.
 *
 * O indice nao se perde: fica em paletas.json, com as 1 a 12 variantes de
 * cada unidade. Quando o shader de paleta existir, a arte nao precisa ser
 * regerada -- so relida com outra tabela de cores.
 */

const fs = require('fs');
const path = require('path');
const { Image, encodePNG } = require('../asset-compiler/png.js');
const { buildDat } = require('../asset-compiler/dat.js');
const { readCwm, CWM_VERSION } = require('../asset-compiler/cwm.js');
const { readDat } = require('../asset-compiler/dat-read.js');
const { unitSsts, SPRITES } = require('./fontes.js');
const { todasAsPaletas } = require('./paletas.js');
const { lerPNGIndexado } = require('./png-indexado.js');
const {
  BancoDeBlocos, gruposDaUnidade, CELULA,
} = require('./compilar-outfits.js');

/** Um bloco de indices vira uma Image RGBA de 8x8. */
function blocoParaImagem(indices, paleta, trns) {
  const img = Image.blank(CELULA, CELULA);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx < trns.length && trns[idx] === 0) continue;   // deixa 0,0,0,0
    const o = i * 4;
    img.pixels[o] = paleta[idx * 3];
    img.pixels[o + 1] = paleta[idx * 3 + 1];
    img.pixels[o + 2] = paleta[idx * 3 + 2];
    img.pixels[o + 3] = 255;
  }
  return img;
}

/**
 * Junta os PNGs que ja estavam no .cwm com os novos.
 *
 * Os antigos sao copiados como bytes, sem redecodificar: o formato guarda
 * PNG empacotado, entao reencodar so gastaria tempo e arriscaria mudar o
 * resultado.
 */
function mesclarCwm(antigo, novos, deslocamento) {
  const entradas = [];

  for (const [id, png] of [...antigo.sprites].sort((a, b) => a[0] - b[0])) {
    entradas.push({ id, png });
  }
  for (let i = 0; i < novos.length; i++) {
    if (novos[i].isEmpty()) continue;
    entradas.push({ id: deslocamento + i + 1, png: encodePNG(novos[i]) });
  }

  const metadata = [];
  const bodies = [];
  let cursor = 0;

  for (const e of entradas) {
    const nome = Buffer.from(String(e.id), 'ascii');
    const head = Buffer.alloc(10 + nome.length);
    head.writeUInt32LE(cursor, 0);
    head.writeUInt32LE(e.png.length, 4);
    head.writeUInt16LE(nome.length, 8);
    nome.copy(head, 10);

    metadata.push(head);
    bodies.push(e.png);
    cursor += e.png.length;
  }

  const header = Buffer.alloc(7);
  header.writeUInt8(CWM_VERSION, 0);
  header.writeUInt16LE(antigo.spriteSize, 1);
  header.writeUInt32LE(metadata.length, 3);

  return Buffer.concat([header, ...metadata, ...bodies]);
}

function main() {
  const args = process.argv.slice(2);
  const arg = (nome, padrao) => {
    const a = args.find((x) => x.startsWith('--' + nome + '='));
    return a ? a.split('=')[1] : padrao;
  };

  const limite = parseInt(arg('unidades', '0'), 10);
  const dir = arg('saida',
    path.join(__dirname, '..', '..', 'client', 'data', 'things', '860'));

  /*
   * A base vem do .pre-outfits, nao da saida anterior.
   *
   * Ler o proprio Tibia.dat/.cwm faria cada execucao empilhar as outfits da
   * anterior: rodar duas vezes com 3 unidades ja deixou 625 blocos orfaos no
   * .cwm e inflou o .dat. A base fica congelada num arquivo separado, criado
   * na primeira execucao a partir do que existia.
   */
  const baseDat = path.join(dir, 'Tibia.dat.pre-outfits');
  const baseCwm = path.join(dir, 'Tibia.cwm.pre-outfits');

  if (!fs.existsSync(baseDat) || !fs.existsSync(baseCwm)) {
    fs.copyFileSync(path.join(dir, 'Tibia.dat'), baseDat);
    fs.copyFileSync(path.join(dir, 'Tibia.cwm'), baseCwm);
    console.log('base congelada em Tibia.{dat,cwm}.pre-outfits');
  }

  const datAntigo = readDat(fs.readFileSync(baseDat));
  const cwmAntigo = readCwm(fs.readFileSync(baseCwm));

  if (cwmAntigo.spriteSize !== CELULA) {
    throw new Error(
      `o .cwm existente tem sprite de ${cwmAntigo.spriteSize}px, esperava ${CELULA}`);
  }

  const maiorIdAntigo = Math.max(0, ...cwmAntigo.sprites.keys());
  console.log(`preservando ${datAntigo.tilesets.length} tilesets, ` +
              `${cwmAntigo.sprites.size} sprites (ids ate ${maiorIdAntigo})`);

  const sst = unitSsts();
  const total = limite > 0 ? Math.min(limite, sst.quantidade) : sst.quantidade;

  console.log(`compilando ${total} unidades...`);
  const banco = new BancoDeBlocos();
  const outfits = [];

  for (let i = 0; i < total; i++) {
    const grupos = gruposDaUnidade(i, banco);
    if (!grupos) continue;
    outfits.push({ groups: grupos });
  }

  // desloca os ids das outfits para depois dos sprites que ja existem
  for (const o of outfits) {
    for (const g of o.groups) {
      g.sprites = g.sprites.map((id) => (id === 0 ? 0 : id + maiorIdAntigo));
    }
  }

  const nGrupos = outfits.reduce((a, o) => a + o.groups.length, 0);
  console.log(`  ${outfits.length} outfits, ${nGrupos} frame groups`);
  console.log(`  ${banco.quantidade} blocos 8x8 unicos`);

  /*
   * A paleta de referencia.
   *
   * O dedup e por indice, nao por cor: dois blocos com os mesmos indices sao
   * o mesmo bloco, mesmo que unidades diferentes pintem aqueles indices com
   * cores diferentes. Por isso a conversao usa UMA paleta -- a da unidade 0,
   * paleta 0 -- e a variacao de cor fica para o shader.
   */
  const ref = lerPNGIndexado(path.join(SPRITES, '0', '0', '0.png'));

  console.log('montando os sprites...');
  const novos = banco.blocos.map((b) => blocoParaImagem(b, ref.paleta, ref.trns));

  console.log('escrevendo...');
  const dat = buildDat({
    signature: datAntigo.signature,
    items: [], outfits, effects: [], missiles: [],
    tilesets: datAntigo.tilesets,
  });
  fs.writeFileSync(path.join(dir, 'Tibia.dat'), dat);

  const cwm = mesclarCwm(cwmAntigo, novos, maiorIdAntigo);
  fs.writeFileSync(path.join(dir, 'Tibia.cwm'), cwm);

  const paletas = todasAsPaletas();
  fs.writeFileSync(
    path.join(dir, 'paletas.json'), JSON.stringify(paletas, null, 1));

  console.log();
  console.log(`Tibia.dat    ${(dat.length / 1024).toFixed(0)} KB`);
  console.log(`Tibia.cwm    ${(cwm.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`paletas.json ${Object.keys(paletas).length} unidades`);
  console.log(`em ${dir}`);
}

if (require.main === module) main();

module.exports = { blocoParaImagem, mesclarCwm };
