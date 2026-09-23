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

// Sprite do Tibia. O losango tem 32x16, mas recortamos mais alto para pegar
// tambem a face lateral do bloco -- e o que da o visual do FFTA.
const SPRITE = 32;

/*
 * ALTURA do recorte: quanto de face lateral cada tile carrega.
 *
 * Era 32 (quadrado), e sobrava parede: a saia externa do mapa, onde o bloco
 * desce mais do que meia celula, ficava sem cobertura. Medido no Aisenfield,
 * contando os pixels da referencia que nenhum tile alcanca:
 *
 *   32 -> 2054 buracos   97.0% dos pixels iguais ao original
 *   40 -> 1721           97.5%
 *   48 -> 1649           97.6%
 *   56 -> 1649           97.6%   (estabiliza)
 *   64 -> 1649           97.6%
 *
 * Estabiliza em 48 porque dali em diante a face ja desce mais do que a arte
 * tem. Os 1649 que restam NAO sao face faltando: sao o contorno de ~1px que
 * a propria imagem de referencia desenha em volta do mapa, fora da grade
 * isometrica. Nao ha tile que os cubra, e o jogo tambem nao os quer -- o
 * mundo simplesmente acaba ali.
 *
 * Em pixels de sprite 8x8 isto vira 4x6 celulas, e o mosaico lida com isso
 * sem nada especial.
 */
const SPRITE_H = 48;

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

/*
 * NAO HA MAIS DIVISAO EM ANDARES.
 *
 * Havia um HEIGHT_PER_FLOOR aqui, que repartia a altura entre z e elevation.
 * Duas coisas derrubaram a ideia, e as duas so aparecem com o jogo rodando:
 *
 * 1. O client desenha um andar por vez e escolhe quais mostrar em
 *    MapView::calcFirstVisibleFloor. Aqui os andares sao relevo do MESMO
 *    terreno, nao pavimentos de um predio, entao a regra de corte apagava
 *    pedaco do mapa -- na tela, terreno chapado.
 * 2. FLOOR_LIFT (16px) e PX_PER_HEIGHT (8px) so fecham a conta com
 *    exatamente 2 unidades por andar. Qualquer outro valor comprime o
 *    relevo, e o erro cresce com a altura.
 *
 * Com tudo num z so a altura vira pilha, cada item sobe PX_PER_HEIGHT, e o
 * desenho bate com a referencia por construcao.
 */

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
 * Com a altura crua x PX_PER_HEIGHT o recorte segue a arte pixel a pixel, e
 * e essa mesma altura que vira a pilha de itens no OTBM.
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
 * TODA a altura vira pilha. Nao ha mais divisao em andares.
 *
 * A versao anterior repartia a altura entre z (andar) e elevation (resto), e
 * isso nao funcionou por dois motivos que so aparecem no jogo:
 *
 * 1. O client desenha UM andar de cada vez e decide quais mostrar em
 *    MapView::calcFirstVisibleFloor. Como aqui os "andares" sao relevo do
 *    mesmo terreno e nao pavimentos de um predio, qualquer regra de corte
 *    apaga pedaco de mapa. Na tela o efeito era o terreno chapado: so o
 *    andar da camera aparecia.
 * 2. FLOOR_LIFT (16px) nao e multiplo livre de PX_PER_HEIGHT (8px). So
 *    fechava a conta com exatamente 2 unidades por andar, o que amarrava a
 *    geometria a uma constante que nada mais justificava.
 *
 * Com tudo num z so, a altura e puramente a pilha: cada item sobe
 * PX_PER_HEIGHT na tela (ver elevationOffset em client/src/client/tile.h) e
 * o desenho fica identico a referencia por construcao.
 *
 * O lado do server continua valendo: Tile::hasHeight(n) conta os itens com
 * CONST_PROP_HASHEIGHT (server/src/tile.cpp:127), entao a pilha passa a ser
 * a ALTURA da celula em unidades do FFTA -- que e a primitiva certa para a
 * regra de pulo, mesmo que hoje nenhum z mude.
 *
 * A subtracao pelo minimo e o que evita empilhar por nada: no Aisenfield
 * toda celula tem altura >= 2, e sem isso o mapa inteiro carregaria 2 itens
 * a mais sem nenhuma diferenca visivel.
 */
function elevationFor(height, minHeight) {
  return height - minHeight;
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
  /*
   * RECORTE RETANGULAR, SEM MASCARA.
   *
   * Havia aqui uma mascara em forma de bloco isometrico -- o losango do topo
   * mais as faces laterais. A ideia era que o tile so carregasse a sua
   * propria celula, e que assim duas celulas de chao igual virassem o mesmo
   * tile.
   *
   * Medido contra a referencia, ela ATRAPALHAVA. No miolo do mapa a imagem e
   * 100% opaca em toda a largura, inclusive nas linhas de cima onde o losango
   * afina: a mascara descartava pixels que existem, e o vizinho de tras nem
   * sempre os repunha -- onde a altura mudava, ficava buraco.
   *
   *   com mascara    97.6% dos pixels iguais ao original, 1649 buracos
   *   retangulo      99.2%                                 555
   *
   * E o retangulo e correto por construcao: cada celula e recortada da MESMA
   * posicao em que sera desenhada (project() e a formula de
   * transformPositionTo2D), e o desenho e de tras para a frente. Entao cada
   * pixel da tela recebe o valor da ultima celula que o cobre, que e
   * exatamente a celula de onde aquele pixel foi cortado.
   *
   * O custo e que o tile leva pedaco dos vizinhos na sobreposicao -- o que
   * derruba a deduplicacao exata. Quem cuida disso agora e o rebuild-map.js,
   * comparando tiles por SEMELHANCA em vez de igualdade.
   *
   * A transparencia que sobra (so nas bordas do mapa) nao custa nada: no
   * mosaico 8x8 as celulas vazias viram sprite id 0, que o client nao
   * desenha.
   */
  return ref.crop(p.x, p.y, SPRITE, SPRITE_H);
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

  // A altura minima do mapa e o "chao" -- a pilha conta a partir dela.
  let minHeight = Infinity;
  for (let r = 0; r < hm.length; r++) {
    for (let c = 0; c < hm[0].length; c++) minHeight = Math.min(minHeight, hm[r][c]);
  }

  const table = new TileTable();
  const grid = [];
  for (let r = 0; r < hm.length; r++) {
    const row = [];
    for (let c = 0; c < hm[0].length; c++) {
      const h = hm[r][c];
      const cell = cutCell(ref, c, r, h, origin);
      row.push({ tile: table.add(cell), height: h, elevation: elevationFor(h, minHeight) });
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
    JSON.stringify({ map: mapIndex, cols: hm[0].length, rows: hm.length, origin, minHeight, grid }, null, 1)
  );

  console.log(`tiles unicos: ${table.tiles.length}`);
  console.log(`-> assets/items/ e assets/mapdata/map${mapIndex}.json`);
}

if (require.main === module) main();

module.exports = { project, cutCell, calibrate, SPRITE_H, elevationFor, loadHeightMap, TILE_HALF_W, TILE_HALF_H, FLOOR_LIFT, PX_PER_HEIGHT, SPRITE };
