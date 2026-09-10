'use strict';
/*
 * vram-rip.js -- monta as sprites de unidade do FFTA (GBA) a partir de
 * despejos de VRAM/paleta/OAM feitos num emulador.
 *
 *   node tools/ffta-vram/vram-rip.js <pasta-com-os-dumps> [saida] [--2d]
 *
 *
 * POR QUE ESTE CAMINHO
 *
 * As sprites de unidade do FFTA nao cederam a analise estatica da ROM. Fica
 * registrado o que JA foi descartado, para a proxima tentativa nao repetir:
 *
 *   - tabela de ponteiros: 2557 candidatas com >=120 ponteiros validos,
 *     NENHUMA com header de compressao uniforme nos alvos;
 *   - tabela de structs perto do job table (0x521A14): cai sempre no
 *     itemLocNames (0x526680), que e texto;
 *   - regioes com estatistica de 4bpp: as 4 maiores, renderizadas, sao dado
 *     comprimido, nao tiles;
 *   - streams LZ77 de tamanho uniforme: 204 streams de exatamente 4096 bytes
 *     (128 tiles) pareciam promissores -- 204 ~ 2x os ~102 spriteIndex --
 *     mas descomprimidos e renderizados dao ruido.
 *
 * O `spriteIndex` do job (ffta.js, offset 0x07 do registro) e valido e aponta
 * para ALGO; o que falta e a indirecao entre ele e o grafico.
 *
 * A saida e a mesma do FFTA2 (tools/ffta2-extract/DUMP-VRAM.md): o hardware
 * do GBA nao entende formato proprietario. Para desenhar na tela o jogo E
 * OBRIGADO a converter para tile 4bpp e paleta RGB555 na VRAM. O
 * decodificador que falta ja esta dentro do jogo -- basta rodar e ler.
 *
 * O preco: a VRAM so tem o que esta na cena. A extracao vira incremental,
 * uma batalha por vez, em troca de ser deterministica.
 *
 *
 * O QUE DESPEJAR (GBA -- os enderecos NAO sao os do DS)
 *
 *   paleta OBJ  0x05000200     512 bytes   16 paletas de 16 cores
 *   OBJ VRAM    0x06010000   32768 bytes   personagens e monstros
 *   OAM         0x07000000    1024 bytes   como os sprites se montam
 *
 * ATENCAO ao tamanho da OBJ VRAM: no GBA a regiao de OBJ comeca em
 * 0x06010000 e tem 32 KB (0x8000), nao 256 KB como no DS.
 */

const fs = require('fs');
const path = require('path');
const G = require('../ffta-extract/gfx.js');

// --- paleta -----------------------------------------------------------------

/*
 * Palette RAM do GBA (GBATEK, "GBA Video"):
 *   0x05000000  BG   256 cores
 *   0x05000200  OBJ  256 cores  <- as unidades estao aqui
 *
 * Cada cor e u16 RGB555: bits 0-4 R, 5-9 G, 10-14 B.
 */
function lerPaleta(buf, base, cores) {
  const out = [];
  // 5 -> 8 bits. O <<3 sozinho nunca chega a 255; o >>2 preenche os bits
  // baixos e faz o branco sair branco de verdade.
  const f = (v) => (v << 3) | (v >> 2);
  for (let i = 0; i < cores; i++) {
    const o = base + i * 2;
    if (o + 1 >= buf.length) break;
    const c = buf.readUInt16LE(o);
    out.push([f(c & 31), f((c >> 5) & 31), f((c >> 10) & 31)]);
  }
  return out;
}

// --- OAM --------------------------------------------------------------------

/*
 * Tamanho do sprite pela combinacao shape (attr0 bits 14-15) e size
 * (attr1 bits 14-15). GBATEK, "GBA OBJs". Identico ao do DS.
 */
const TAMANHOS = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],   // quadrado
  [[16, 8], [32, 8], [32, 16], [64, 32]],   // horizontal
  [[8, 16], [8, 32], [16, 32], [32, 64]],   // vertical
];

function lerOAM(buf, base = 0) {
  const sprites = [];
  // O GBA tem 128 slots de OBJ, 8 bytes cada (6 usados + 2 de rot/scale).
  for (let i = 0; i < 128; i++) {
    const o = base + i * 8;
    if (o + 6 > buf.length) break;
    const a0 = buf.readUInt16LE(o), a1 = buf.readUInt16LE(o + 2), a2 = buf.readUInt16LE(o + 4);

    const rotScale = (a0 >> 8) & 1;
    // Sem rot/scale, o bit 9 desliga o OBJ. Com rot/scale, o mesmo bit quer
    // dizer "double size" -- e NAO desligado. Confundir os dois some com
    // metade dos sprites da cena.
    const desabilitado = !rotScale && !!((a0 >> 9) & 1);
    const shape = (a0 >> 14) & 3;
    const size = (a1 >> 14) & 3;
    if (shape > 2) continue;               // 3 e proibido
    const [w, h] = TAMANHOS[shape][size];

    sprites.push({
      index: i,
      y: a0 & 0xff,
      x: a1 & 0x1ff,
      disabled: desabilitado,
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

// --- tiles ------------------------------------------------------------------

/** Um pixel de um tile 4bpp: 32 bytes por tile, 2 pixels por byte. */
function pixel4(vram, tile, x, y) {
  const o = tile * 32 + y * 4 + (x >> 1);
  if (o >= vram.length) return 0;
  const b = vram[o];
  return (x & 1) ? (b >> 4) : (b & 15);
}

/** Um pixel de um tile 8bpp: 64 bytes por tile. */
function pixel8(vram, tile, x, y) {
  const o = tile * 64 + y * 8 + x;
  return o < vram.length ? vram[o] : 0;
}

/**
 * Recorta um sprite da OBJ VRAM.
 *
 * O modo de mapeamento (1D ou 2D) vem do bit 6 do DISPCNT, que NAO esta nos
 * despejos. Por isso e um parametro:
 *
 *   1D  os tiles do sprite sao consecutivos (o normal em jogos com muitos
 *       sprites, e o que o FFTA deve usar);
 *   2D  a OBJ VRAM e uma folha de 32 tiles de largura e cada linha do sprite
 *       avanca 32 tiles.
 *
 * Se as sprites sairem fatiadas ou embaralhadas, e este o parametro a trocar
 * (--2d na linha de comando).
 */
function recortarSprite(vram, s, paleta, mapping2d) {
  const tw = s.width / 8, th = s.height / 8;
  const rgba = Buffer.alloc(s.width * s.height * 4);   // zerado = transparente
  const px = s.bpp === 4 ? pixel4 : pixel8;
  // Em 4bpp o numero do tile conta em unidades de 32 bytes; em 8bpp o indice
  // da OAM ainda conta em 32 bytes, entao vira metade.
  const tileBase = s.bpp === 4 ? s.tile : s.tile >> 1;

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const t = mapping2d ? tileBase + ty * 32 + tx : tileBase + ty * tw + tx;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const c = px(vram, t, x, y);
          if (c === 0) continue;              // indice 0 e transparente
          // Em 4bpp a paleta e um banco de 16 cores escolhido pela OAM.
          const cor = paleta[s.bpp === 4 ? s.palette * 16 + c : c];
          if (!cor) continue;
          const dx = s.hflip ? s.width - 1 - (tx * 8 + x) : tx * 8 + x;
          const dy = s.vflip ? s.height - 1 - (ty * 8 + y) : ty * 8 + y;
          const o = (dy * s.width + dx) * 4;
          rgba[o] = cor[0]; rgba[o + 1] = cor[1]; rgba[o + 2] = cor[2]; rgba[o + 3] = 255;
        }
      }
    }
  }
  return { width: s.width, height: s.height, pixels: rgba };
}

/**
 * A folha inteira da OBJ VRAM, sem depender da OAM.
 *
 * Vale sempre gerar: se a OAM do despejo pegou a cena errada (menu, tela de
 * transicao), a folha ainda mostra o que esta carregado, e da para conferir
 * se a batalha certa estava na tela na hora do despejo.
 */
function folhaDeTiles(vram, paleta, banco, bpp) {
  const porLinha = 32;
  const tiles = Math.floor(vram.length / (bpp === 4 ? 32 : 64));
  const linhas = Math.ceil(tiles / porLinha);
  const W = porLinha * 8, H = linhas * 8;
  const rgba = Buffer.alloc(W * H * 4);
  const px = bpp === 4 ? pixel4 : pixel8;

  for (let t = 0; t < tiles; t++) {
    const bx = (t % porLinha) * 8, by = Math.floor(t / porLinha) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const c = px(vram, t, x, y);
        if (c === 0) continue;
        const cor = paleta[bpp === 4 ? banco * 16 + c : c];
        if (!cor) continue;
        const o = ((by + y) * W + bx + x) * 4;
        rgba[o] = cor[0]; rgba[o + 1] = cor[1]; rgba[o + 2] = cor[2]; rgba[o + 3] = 255;
      }
    }
  }
  return { width: W, height: H, pixels: rgba };
}

// --- agrupamento por unidade ------------------------------------------------

/** A coordenada do GBA da a volta: y e u8 e x e u9. */
function telaX(s) { return s.x >= 240 ? s.x - 512 : s.x; }
function telaY(s) { return s.y >= 160 ? s.y - 256 : s.y; }

/**
 * Junta os OBJs da OAM em UNIDADES.
 *
 * Um personagem do FFTA nao e um OBJ: e varios OBJs vizinhos que o hardware
 * desenha juntos. Agrupamos por proximidade na tela -- OBJs que se tocam (ou
 * quase) pertencem ao mesmo boneco.
 *
 * Isto e heuristica, nao formato. O agrupamento erra quando duas unidades
 * estao encostadas na tela; por isso o oam.json sai junto, com os OBJs crus,
 * para dar para conferir e reagrupar a mao se precisar.
 */
function agruparUnidades(sprites, folga = 8) {
  const grupos = [];

  for (const s of sprites) {
    const sx = telaX(s), sy = telaY(s);
    const cx = { x0: sx, y0: sy, x1: sx + s.width, y1: sy + s.height, objs: [s] };

    let alvo = null;
    for (const g of grupos) {
      const perto = cx.x0 < g.x1 + folga && cx.x1 > g.x0 - folga &&
                    cx.y0 < g.y1 + folga && cx.y1 > g.y0 - folga;
      if (perto) { alvo = g; break; }
    }
    if (alvo) {
      alvo.x0 = Math.min(alvo.x0, cx.x0); alvo.y0 = Math.min(alvo.y0, cx.y0);
      alvo.x1 = Math.max(alvo.x1, cx.x1); alvo.y1 = Math.max(alvo.y1, cx.y1);
      alvo.objs.push(s);
    } else {
      grupos.push(cx);
    }
  }
  return grupos;
}

/** Compoe um grupo de OBJs numa imagem so, respeitando a posicao de cada um. */
function montarUnidade(vram, grupo, paleta, mapping2d) {
  const W = grupo.x1 - grupo.x0, H = grupo.y1 - grupo.y0;
  const rgba = Buffer.alloc(W * H * 4);

  // Prioridade maior desenha primeiro (fica atras).
  const ordem = [...grupo.objs].sort((a, b) => b.priority - a.priority);
  for (const s of ordem) {
    const img = recortarSprite(vram, s, paleta, mapping2d);
    const sx = telaX(s) - grupo.x0;
    const sy = telaY(s) - grupo.y0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const so = (y * img.width + x) * 4;
        if (img.pixels[so + 3] === 0) continue;      // nao apaga o que ja tem
        const tx = sx + x, ty = sy + y;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        img.pixels.copy(rgba, (ty * W + tx) * 4, so, so + 4);
      }
    }
  }
  return { width: W, height: H, pixels: rgba };
}

// --- main -------------------------------------------------------------------

function acharArquivo(dir, ...nomes) {
  for (const n of nomes) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return null;
}

function temPixel(img) {
  for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i]) return true;
  return false;
}

function main() {
  const argv = process.argv.slice(2);
  const mapping2d = argv.includes('--2d');
  const args = argv.filter((a) => !a.startsWith('--'));
  const dir = args[0];
  if (!dir) {
    console.error('uso: node tools/ffta-vram/vram-rip.js <pasta-com-os-dumps> [saida] [--2d]');
    console.error('veja tools/ffta-vram/DUMP-VRAM.md para o que despejar');
    process.exit(1);
  }
  const saida = args[1] || path.join(dir, 'out');

  const pal = acharArquivo(dir, 'palette.bin', 'pal.bin', '05000000.bin', '05000200.bin');
  const obj = acharArquivo(dir, 'objvram.bin', 'obj.bin', '06010000.bin');
  const oam = acharArquivo(dir, 'oam.bin', '07000000.bin');

  if (!pal) { console.error('falta a paleta (palette.bin / 05000000.bin)'); process.exit(1); }
  if (!obj) { console.error('falta a OBJ VRAM (objvram.bin / 06010000.bin)'); process.exit(1); }

  // Se o despejo comecou em 0x05000000, a paleta de OBJ esta 0x200 adiante.
  // Se comecou ja em 0x05000200, esta no inicio.
  const baseObjPal = pal.length >= 0x400 ? 0x200 : 0;
  const paleta = lerPaleta(pal, baseObjPal, 256);

  fs.mkdirSync(saida, { recursive: true });
  console.log(`paleta     ${pal.length} bytes (OBJ em +0x${baseObjPal.toString(16)})`);
  console.log(`obj vram   ${obj.length} bytes`);
  console.log(`mapeamento ${mapping2d ? '2D' : '1D'}`);

  // Folha inteira, um PNG por banco de paleta. Nao depende da OAM.
  const folhas = path.join(saida, 'folhas');
  fs.mkdirSync(folhas, { recursive: true });
  let nFolhas = 0;
  for (let banco = 0; banco < 16; banco++) {
    const img = folhaDeTiles(obj, paleta, banco, 4);
    if (!temPixel(img)) continue;
    fs.writeFileSync(path.join(folhas, `banco${String(banco).padStart(2, '0')}.png`),
                     G.encodePNG(img.width, img.height, img.pixels));
    nFolhas++;
  }
  console.log(`folhas/    ${nFolhas} bancos de paleta com conteudo`);

  if (!oam) {
    console.log('sem oam.bin -- so as folhas. Despeje a OAM para separar as unidades.');
    return;
  }

  const sprites = lerOAM(oam, 0);
  const ativos = sprites.filter((s) => !s.disabled);
  fs.writeFileSync(path.join(saida, 'oam.json'), JSON.stringify(sprites, null, 2));

  // OBJs soltos
  const objs = path.join(saida, 'objs');
  fs.mkdirSync(objs, { recursive: true });
  for (const s of ativos) {
    const img = recortarSprite(obj, s, paleta, mapping2d);
    const nome = `obj${String(s.index).padStart(3, '0')}_${s.width}x${s.height}_t${s.tile}_p${s.palette}.png`;
    fs.writeFileSync(path.join(objs, nome), G.encodePNG(img.width, img.height, img.pixels));
  }

  // Unidades montadas
  const unidades = agruparUnidades(ativos);
  const uDir = path.join(saida, 'unidades');
  fs.mkdirSync(uDir, { recursive: true });
  const resumo = [];
  unidades.forEach((g, i) => {
    const img = montarUnidade(obj, g, paleta, mapping2d);
    const nome = `unidade${String(i).padStart(2, '0')}_${img.width}x${img.height}.png`;
    fs.writeFileSync(path.join(uDir, nome), G.encodePNG(img.width, img.height, img.pixels));
    resumo.push({
      arquivo: nome, x: g.x0, y: g.y0, width: img.width, height: img.height,
      objs: g.objs.length,
      paletas: [...new Set(g.objs.map((o) => o.palette))],
      tiles: g.objs.map((o) => o.tile),
    });
  });
  fs.writeFileSync(path.join(uDir, 'unidades.json'), JSON.stringify(resumo, null, 2));

  console.log(`objs/      ${ativos.length} OBJs ativos (de 128 slots)`);
  console.log(`unidades/  ${unidades.length} unidades montadas + unidades.json`);
  console.log(`-> ${saida}`);
}

if (require.main === module) main();

module.exports = {
  lerPaleta, lerOAM, recortarSprite, folhaDeTiles,
  agruparUnidades, montarUnidade, TAMANHOS,
};
