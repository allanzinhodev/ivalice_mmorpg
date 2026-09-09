'use strict';
/*
 * Monta PNGs a partir de despejos de VRAM/paleta/OAM do DeSmuME.
 *
 *
 * POR QUE ESTE CAMINHO
 *
 * O FFTA2 guarda grafico em formato proprietario, dentro de um container
 * proprietario (/master/pc.bin indexado por pc.idx). Nenhum dos dois cedeu a
 * analise estatica: nao ha magic Nintendo na ROM, os blocos LZ77 nao sao
 * imagem em 4/8bpp nem em layout linear, e a tabela de graficos do ROM map so
 * guarda INDICES.
 *
 * A saida e nao decodificar. O hardware do DS nao entende formato proprietario:
 * para desenhar na tela, o jogo E OBRIGADO a converter para tile 4bpp/8bpp e
 * paleta RGB555 na VRAM. Ou seja, o proprio FFTA2 carrega o decodificador que
 * falta -- basta rodar o jogo e ler o resultado.
 *
 * Isso contorna as duas barreiras de uma vez: o indice deixa de importar (o
 * jogo resolve) e o formato deixa de importar (o jogo converte).
 *
 * O preco e que a VRAM so tem o que esta carregado na cena. A extracao vira
 * incremental -- uma batalha por vez -- em troca de ser deterministica.
 *
 *
 * O QUE DESPEJAR NO DeSmuME (ver DUMP-VRAM.md)
 *
 *   paleta   0x05000000  2048 bytes
 *   BG VRAM  0x06000000  524288 bytes   -> tiles de mapa
 *   OBJ VRAM 0x06400000  262144 bytes   -> personagens e monstros
 *   OAM      0x07000000  2048 bytes     -> como os sprites se montam
 *
 * Uso:
 *   node vram-rip.js <pasta-com-os-dumps> [saida]
 */

const fs = require('fs');
const path = require('path');
const { escreverPNG } = require('./render-tiles');

// --- paleta -----------------------------------------------------------------

/*
 * Palette RAM do DS (GBATEK, "DS Video BG Modes"):
 *   0x05000000 BG  main   0x05000200 OBJ main
 *   0x05000400 BG  sub    0x05000600 OBJ sub
 * Cada cor e u16 RGB555: bit0-4 R, 5-9 G, 10-14 B. O bit 15 nao e usado, e foi
 * o que permitiu localizar bancos de paleta por assinatura.
 */
const BLOCOS_PALETA = {
  bgMain: 0x000, objMain: 0x200, bgSub: 0x400, objSub: 0x600,
};

function lerPaleta(buf, base, cores) {
  const out = [];
  for (let i = 0; i < cores; i++) {
    const c = buf.readUInt16LE(base + i * 2);
    // 5 bits -> 8 bits. O <<3 sozinho nunca chega a 255; o >>2 preenche os
    // bits baixos e faz o branco sair branco de verdade.
    out.push([
      ((c & 31) << 3) | ((c & 31) >> 2),
      (((c >> 5) & 31) << 3) | (((c >> 5) & 31) >> 2),
      (((c >> 10) & 31) << 3) | (((c >> 10) & 31) >> 2),
    ]);
  }
  return out;
}

// --- tiles ------------------------------------------------------------------

/** Tile 4bpp: 32 bytes, 2 pixels por byte, o da esquerda nos bits baixos. */
function pixel4(vram, tile, px, py) {
  const b = vram[tile * 32 + py * 4 + (px >> 1)];
  return px & 1 ? (b >> 4) & 0x0f : b & 0x0f;
}

/** Tile 8bpp: 64 bytes, 1 pixel por byte. */
function pixel8(vram, tile, px, py) {
  return vram[tile * 64 + py * 8 + px];
}

/**
 * Desenha a VRAM inteira como folha de tiles -- o entregavel mais confiavel,
 * porque nao depende de interpretar OAM.
 */
function folhaDeTiles(vram, paleta, bpp, tilesPorLinha) {
  const bytesPorTile = bpp === 4 ? 32 : 64;
  const nTiles = Math.floor(vram.length / bytesPorTile);
  const linhas = Math.ceil(nTiles / tilesPorLinha);
  const W = tilesPorLinha * 8, H = linhas * 8;
  const rgb = Buffer.alloc(W * H * 3);
  const px = bpp === 4 ? pixel4 : pixel8;

  for (let t = 0; t < nTiles; t++) {
    const tx = (t % tilesPorLinha) * 8, ty = Math.floor(t / tilesPorLinha) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const c = paleta[px(vram, t, x, y)] || [255, 0, 255];
        const o = ((ty + y) * W + tx + x) * 3;
        rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
      }
    }
  }
  return { rgb, W, H, nTiles };
}

// --- OAM --------------------------------------------------------------------

/*
 * Tamanho do sprite pela combinacao shape (attr0 bits 14-15) e size
 * (attr1 bits 14-15). GBATEK, "DS Video OBJs".
 */
const TAMANHOS = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],   // quadrado
  [[16, 8], [32, 8], [32, 16], [64, 32]],   // horizontal
  [[8, 16], [8, 32], [16, 32], [32, 64]],   // vertical
];

function lerOAM(buf, base = 0) {
  const sprites = [];
  for (let i = 0; i < 128; i++) {
    const o = base + i * 8;
    const a0 = buf.readUInt16LE(o), a1 = buf.readUInt16LE(o + 2), a2 = buf.readUInt16LE(o + 4);

    const rotScale = (a0 >> 8) & 1;
    const desabilitado = !rotScale && ((a0 >> 9) & 1); // sem rot/scale, bit 9 desliga
    const shape = (a0 >> 14) & 3;
    const size = (a1 >> 14) & 3;
    if (shape > 2) continue;
    const [w, h] = TAMANHOS[shape][size];

    sprites.push({
      index: i,
      y: a0 & 0xff,
      x: a1 & 0x1ff,
      disabled: !!desabilitado,
      bpp: ((a0 >> 13) & 1) ? 8 : 4,
      hflip: !rotScale && !!((a1 >> 12) & 1),
      vflip: !rotScale && !!((a1 >> 13) & 1),
      tile: a2 & 0x3ff,
      priority: (a2 >> 10) & 3,
      palette: (a2 >> 12) & 0x0f,
      width: w, height: h,
    });
  }
  return sprites;
}

/**
 * Recorta um sprite da OBJ VRAM.
 *
 * Assume mapeamento 1D (o normal no DS): os tiles de um sprite sao
 * consecutivos, linha de tiles apos linha de tiles. O modo 2D existe e mudaria
 * o passo entre linhas, mas depende do DISPCNT, que nao esta nestes despejos.
 */
function recortarSprite(vram, s, paleta) {
  const tw = s.width / 8, th = s.height / 8;
  const rgb = Buffer.alloc(s.width * s.height * 3);
  const px = s.bpp === 4 ? pixel4 : pixel8;
  // Em 4bpp o numero do tile conta em unidades de 32 bytes; em 8bpp o indice
  // da OAM ainda conta em 32 bytes, entao vira metade.
  const tileBase = s.bpp === 4 ? s.tile : s.tile >> 1;

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const t = tileBase + ty * tw + tx;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const c = px(vram, t, x, y);
          if (c === 0) continue; // indice 0 e transparente
          const cor = paleta[c] || [255, 0, 255];
          const dx = s.hflip ? s.width - 1 - (tx * 8 + x) : tx * 8 + x;
          const dy = s.vflip ? s.height - 1 - (ty * 8 + y) : ty * 8 + y;
          const o = (dy * s.width + dx) * 3;
          rgb[o] = cor[0]; rgb[o + 1] = cor[1]; rgb[o + 2] = cor[2];
        }
      }
    }
  }
  return rgb;
}

// --- principal --------------------------------------------------------------

function acharArquivo(dir, ...nomes) {
  for (const n of nomes) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return null;
}

function main() {
  const dir = process.argv[2];
  const saida = process.argv[3] || path.resolve(__dirname, '../extracted-ffta2/graphics');
  if (!dir) {
    console.error('uso: node vram-rip.js <pasta-com-os-dumps> [saida]');
    console.error('ver DUMP-VRAM.md para o que despejar no DeSmuME');
    process.exit(1);
  }

  const pal = acharArquivo(dir, 'palette.bin', 'pal.bin', '05000000.bin');
  const obj = acharArquivo(dir, 'objvram.bin', 'obj.bin', '06400000.bin');
  const bg = acharArquivo(dir, 'bgvram.bin', 'bg.bin', '06000000.bin');
  const oam = acharArquivo(dir, 'oam.bin', '07000000.bin');

  if (!pal) { console.error('faltou o despejo de paleta (palette.bin)'); process.exit(1); }
  fs.mkdirSync(saida, { recursive: true });

  const paletaObj = lerPaleta(pal, BLOCOS_PALETA.objMain, 256);
  const paletaBg = lerPaleta(pal, BLOCOS_PALETA.bgMain, 256);

  // --- folhas completas, que nao dependem de OAM
  if (obj) {
    for (const bpp of [4, 8]) {
      const f = folhaDeTiles(obj, bpp === 4 ? paletaObj.slice(0, 16) : paletaObj, bpp, 32);
      escreverPNG(path.join(saida, `objvram-${bpp}bpp.png`), f.W, f.H, f.rgb);
      console.log(`objvram-${bpp}bpp.png  ${f.nTiles} tiles  ${f.W}x${f.H}`);
    }
  }
  if (bg) {
    for (const bpp of [4, 8]) {
      const f = folhaDeTiles(bg, bpp === 4 ? paletaBg.slice(0, 16) : paletaBg, bpp, 32);
      escreverPNG(path.join(saida, `bgvram-${bpp}bpp.png`), f.W, f.H, f.rgb);
      console.log(`bgvram-${bpp}bpp.png   ${f.nTiles} tiles  ${f.W}x${f.H}`);
    }
  }

  // --- sprites montados pela OAM, um PNG por sprite ativo
  if (obj && oam) {
    const sprites = lerOAM(oam, 0);
    const ativos = sprites.filter((s) => !s.disabled);
    const pasta = path.join(saida, 'sprites');
    fs.mkdirSync(pasta, { recursive: true });

    for (const s of ativos) {
      // Em 4bpp cada sprite escolhe uma das 16 sub-paletas de 16 cores.
      const p = s.bpp === 4
        ? paletaObj.slice(s.palette * 16, s.palette * 16 + 16)
        : paletaObj;
      const rgb = recortarSprite(obj, s, p);
      const nome = `oam${String(s.index).padStart(3, '0')}_${s.width}x${s.height}_t${s.tile}_p${s.palette}.png`;
      escreverPNG(path.join(pasta, nome), s.width, s.height, rgb);
    }
    fs.writeFileSync(path.join(saida, 'oam.json'), JSON.stringify(sprites, null, 2));
    console.log(`sprites/  ${ativos.length} sprites ativos (de 128 slots)  + oam.json`);
  }

  console.log(`\nsaida em ${saida}`);
}

if (require.main === module) main();
module.exports = { lerPaleta, lerOAM, folhaDeTiles, recortarSprite, TAMANHOS };
