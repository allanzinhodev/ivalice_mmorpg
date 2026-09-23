'use strict';
/*
 * Gera client/data/things/860/{Tibia.dat,Tibia.spr,Tibia.otfi} -- o datapack
 * minimo do lado do CLIENT: 3 chaos (100/101/102), 4 outfits (looktypes 1-4),
 * 1 efeito e 1 missile. E o par de gen-items.js/gen-map.js, que geram o lado
 * do server.
 *
 * POR QUE ISTO EXISTE
 *
 * Esses tres arquivos nao sao versionados (client/.gitignore:2 ignora
 * data/things/*), entao um clone novo nao tem datapack nenhum e o client sobe
 * sem nada para desenhar. Antes eles eram feitos a mao no Object Builder, o
 * que transformava o displacement de cada thing num chute -- exatamente o que
 * custou caro na projecao isometrica (ver FIX-DAT.md). Aqui o displacement e
 * DERIVADO da geometria, nao escolhido.
 *
 *
 * GEOMETRIA -- de onde sai o displacement
 *
 * Para uma thing 1x1, ThingType::draw (client/src/client/thingtype.cpp:~547)
 * calcula:
 *
 *     screenRect.topLeft = dest + textureOffset - displacement
 *
 * onde textureOffset e o canto superior-esquerdo da caixa dos pixels NAO
 * transparentes dentro do sprite -- ThingType::getTexture (thingtype.cpp:823)
 * varre o frame e calcula esse bbox. Como a textura desenhada e exatamente
 * esse bbox (textureRect = drawRect), o pixel (cx,cy) do canvas cai em:
 *
 *     dest + textureOffset - displacement + (cx,cy) - textureOffset
 *   = dest + (cx,cy) - displacement
 *
 * O textureOffset se cancela. Ou seja:
 *
 *     >>> o displacement E o ponto do canvas que cai em `dest` <<<
 *
 * Nao importa onde o desenho esta dentro do sprite. Chamamos esse ponto de
 * ANCORA, e cada thing aqui declara a sua.
 *
 *
 * E ONDE FICA `dest`?
 *
 * `dest` vem de MapView::transformPositionTo2D. Quem define o que ele
 * significa e a INVERSA, MapView::getPosition (mapview.cpp:541), usada no
 * picking: ela atribui ao tile todo ponto (sx,sy) relativo a `dest` tal que
 *
 *     0 <= sx + 2*sy < 32     e     0 <= 2*sy - sx < 32
 *
 * Esse conjunto e o losango cujo VERTICE SUPERIOR esta em `dest`, descendo
 * 16px e abrindo +-16px. Logo o chao tem ancora (16, 0) quando desenhado com
 * o vertice no topo do canvas.
 *
 * O rasterizador do chao usa a MESMA inequacao. Isso nao e detalhe de estilo:
 * garante que o que e desenhado e o que e clicado sao o mesmo conjunto de
 * pixels, sem folga nem sobreposicao entre tiles vizinhos -- a tesselacao sai
 * correta por construcao, e nao por tentativa e erro de offset.
 *
 *
 * DISPLACEMENT NEGATIVO
 *
 * O .dat grava displacement como u16, mas o valor e logicamente COM SINAL
 * (ThingType::unserialize reinterpreta como int16 desde o commit 837d061).
 * Uma ancora negativa significa "o ponto `dest` fica FORA do canvas, acima /
 * a esquerda dele" -- isto e, o sprite inteiro e desenhado abaixo e a direita
 * de `dest`. Nenhuma thing deste datapack precisa disso (todas as ancoras sao
 * positivas), mas o gerador aceita e grava em complemento de dois, entao da
 * para testar offsets negativos so mudando a ancora aqui.
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '../../client/data/things/860');

// --- constantes do formato -------------------------------------------------

const SPRITE_SIZE = 32; // SpriteManager::m_baseSpriteSize (spritemanager.h:83)

// Meias-extensoes da celula (Otc::TILE_HALF_W/H, client/src/client/const.h)
const TILE_HALF_W = 16;
const TILE_HALF_H = 8;

// ThingAttr (client/src/client/thingtype.h:62). Para a versao 860 os bytes do
// .dat sao usados como estao, sem remapeamento (thingtype.cpp:175-179).
const ATTR_GROUND = 0;
const ATTR_DISPLACEMENT = 24;
const ATTR_FULL_GROUND = 30;
const ATTR_LAST = 0xff;

// FrameGroupType (thingtype.h:47)
const FRAME_GROUP_IDLE = 0;

// O client so guarda a assinatura para comparar com a gravada em .otbm
// (mapio.cpp:420) e nao valida contra o .spr. Fixamos um valor qualquer, igual
// nos dois arquivos, para que um .otbm salvo pelo proprio client bata.
const SIGNATURE = 0x41465441; // "AFTA" -- Advance / FFTA

// --- canvas ----------------------------------------------------------------

function newCanvas() {
  return Buffer.alloc(SPRITE_SIZE * SPRITE_SIZE * 4, 0); // RGBA, tudo transparente
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= SPRITE_SIZE || y >= SPRITE_SIZE) return;
  const o = (y * SPRITE_SIZE + x) * 4;
  canvas[o] = color[0];
  canvas[o + 1] = color[1];
  canvas[o + 2] = color[2];
  canvas[o + 3] = color.length > 3 ? color[3] : 255;
}

function fillRect(canvas, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(canvas, x, y, color);
  }
}

function shade(color, factor) {
  return [
    Math.max(0, Math.min(255, Math.round(color[0] * factor))),
    Math.max(0, Math.min(255, Math.round(color[1] * factor))),
    Math.max(0, Math.min(255, Math.round(color[2] * factor))),
  ];
}

// --- rasterizacao do losango ----------------------------------------------

/**
 * Predicado de pertinencia da celula, copiado de MapView::getPosition
 * (mapview.cpp:558-566). (sx,sy) e relativo a `dest`.
 */
function inCell(sx, sy) {
  const a = sx + 2 * sy;
  const b = 2 * sy - sx;
  return a >= 0 && a < 2 * TILE_HALF_W && b >= 0 && b < 2 * TILE_HALF_W;
}

/**
 * Desenha o losango de um tile com o vertice superior na ancora.
 * A borda (1px na fronteira da celula) sai num tom mais escuro: com ela da
 * para ver a olho nu se a tesselacao tem folga ou sobreposicao.
 */
function drawGroundDiamond(color, anchor) {
  const canvas = newCanvas();
  const edge = shade(color, 0.72);
  for (let sy = 0; sy < 2 * TILE_HALF_H; sy++) {
    for (let sx = -TILE_HALF_W; sx <= TILE_HALF_W; sx++) {
      if (!inCell(sx, sy)) continue;
      const isEdge =
        !inCell(sx - 1, sy) || !inCell(sx + 1, sy) ||
        !inCell(sx, sy - 1) || !inCell(sx, sy + 1);
      setPixel(canvas, sx + anchor.x, sy + anchor.y, isEdge ? edge : color);
    }
  }
  return canvas;
}

/**
 * Boneco simples de 4 direcoes. Os pes ficam em canvas (16, 24); a ancora e
 * escolhida em OUTFITS para que os pes caiam no CENTRO da celula.
 */
function drawOutfit(color, direction) {
  const canvas = newCanvas();
  const dark = shade(color, 0.6);
  const skin = [232, 200, 168];

  fillRect(canvas, 12, 15, 8, 9, color); // tronco
  fillRect(canvas, 12, 24, 3, 2, dark);  // pe esquerdo
  fillRect(canvas, 17, 24, 3, 2, dark);  // pe direito
  fillRect(canvas, 12, 8, 8, 7, skin);   // cabeca

  // Marcador de direcao: onde ficam os olhos (ou a nuca, no norte).
  const eye = [24, 24, 32];
  if (direction === 'south') {
    fillRect(canvas, 13, 11, 2, 2, eye);
    fillRect(canvas, 17, 11, 2, 2, eye);
  } else if (direction === 'east') {
    fillRect(canvas, 17, 11, 2, 2, eye);
    fillRect(canvas, 19, 15, 1, 7, dark); // braco a direita
  } else if (direction === 'west') {
    fillRect(canvas, 13, 11, 2, 2, eye);
    fillRect(canvas, 12, 15, 1, 7, dark); // braco a esquerda
  } else {
    fillRect(canvas, 12, 8, 8, 4, dark); // norte: cabelo, sem olhos
  }

  return canvas;
}

/** Estrela simples, centrada no canvas. Usada como efeito. */
function drawEffect(color) {
  const canvas = newCanvas();
  const cx = 16, cy = 16;
  for (let r = 0; r <= 7; r++) {
    const c = shade(color, 1 - r * 0.06);
    setPixel(canvas, cx + r, cy, c);
    setPixel(canvas, cx - r, cy, c);
    setPixel(canvas, cx, cy + r, c);
    setPixel(canvas, cx, cy - r, c);
    if (r <= 5) {
      setPixel(canvas, cx + r, cy + r, c);
      setPixel(canvas, cx - r, cy + r, c);
      setPixel(canvas, cx + r, cy - r, c);
      setPixel(canvas, cx - r, cy - r, c);
    }
  }
  fillRect(canvas, cx - 1, cy - 1, 3, 3, color);
  return canvas;
}

/**
 * Ponta de flecha apontando para (dx,dy), centrada no canvas.
 * Missile::draw (missile.cpp:38-65) mapeia as 8 direcoes numa grade 3x3 de
 * patterns, entao geramos os 9 sprites (o do meio, 1,1, e o caso "sem
 * direcao").
 */
function drawMissile(color, dx, dy) {
  const canvas = newCanvas();
  const cx = 16, cy = 16;
  const len = 6;
  // corpo
  for (let i = -len; i <= len; i++) {
    setPixel(canvas, cx + Math.round((dx * i) / 2), cy + Math.round((dy * i) / 2), color);
  }
  // ponta
  const tipX = cx + dx * 4, tipY = cy + dy * 4;
  fillRect(canvas, tipX - 1, tipY - 1, 3, 3, shade(color, 1.2));
  if (dx === 0 && dy === 0) fillRect(canvas, cx - 2, cy - 2, 5, 5, color);
  return canvas;
}

// --- codificacao do .spr ---------------------------------------------------

/**
 * Comprime um canvas no formato do .spr: pares (transparentes, coloridos)
 * seguidos dos pixels RGBA. Espelha SpriteManager::getSpriteImageCasual
 * (spritemanager.cpp:604-640) com useAlpha = true -- que e o que a flag
 * `transparency: true` do .otfi liga (GameSpritesAlphaChannel).
 */
function encodeSprite(canvas) {
  const chunks = [];
  const total = SPRITE_SIZE * SPRITE_SIZE;
  let i = 0;
  while (i < total) {
    let transparent = 0;
    while (i < total && canvas[i * 4 + 3] === 0) { transparent++; i++; }
    if (i >= total) break; // cauda transparente: o leitor para sozinho
    const start = i;
    while (i < total && canvas[i * 4 + 3] !== 0) i++;
    const colored = i - start;

    const head = Buffer.alloc(4);
    head.writeUInt16LE(transparent, 0);
    head.writeUInt16LE(colored, 2);
    chunks.push(head, canvas.subarray(start * 4, i * 4));
  }
  return Buffer.concat(chunks);
}

function buildSpr(sprites) {
  const bodies = sprites.map(encodeSprite);

  const header = Buffer.alloc(8);
  header.writeUInt32LE(SIGNATURE, 0);
  // GameSpritesU32 esta ligado (o .otfi declara frame-groups), entao o contador
  // e u32 -- spritemanager.cpp:487.
  header.writeUInt32LE(sprites.length, 4);

  const addressTable = Buffer.alloc(sprites.length * 4);
  const parts = [header, addressTable];

  // Endereco do primeiro sprite: depois do header e da tabela.
  let address = header.length + addressTable.length;
  bodies.forEach((body, idx) => {
    addressTable.writeUInt32LE(address, idx * 4);
    // 3 bytes de color key (ignorados na leitura) + u16 com o tamanho
    const head = Buffer.alloc(5);
    head.writeUInt16LE(body.length, 3);
    parts.push(head, body);
    address += head.length + body.length;
  });

  return Buffer.concat(parts);
}

// --- codificacao do .dat ---------------------------------------------------

class DatWriter {
  constructor() { this.parts = []; }
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v, 0); this.parts.push(b); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); this.parts.push(b); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); this.parts.push(b); return this; }
  // Displacement e int16 logico gravado em complemento de dois (ver o cabecalho).
  i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v, 0); this.parts.push(b); return this; }
  toBuffer() { return Buffer.concat(this.parts); }
}

/**
 * Escreve um ThingType. `thing`:
 *   attrs       lista de {id, write(w)}
 *   anchor      {x,y} -- vira o displacement (ver cabecalho)
 *   patternX/Y  quantos patterns em cada eixo (default 1)
 *   sprites     ids de sprite, na ordem de ThingType::getSpriteIndex
 *   frameGroups true para creatures quando GameIdleAnimations esta ligado
 */
function writeThing(w, thing) {
  for (const attr of thing.attrs || []) {
    w.u8(attr.id);
    if (attr.write) attr.write(w);
  }
  // Displacement e sempre escrito: e o que posiciona a thing na projecao.
  w.u8(ATTR_DISPLACEMENT).i16(thing.anchor.x).i16(thing.anchor.y);
  w.u8(ATTR_LAST);

  if (thing.frameGroups) {
    w.u8(1); // um unico frame group
    w.u8(FRAME_GROUP_IDLE);
  }

  w.u8(1); // width
  w.u8(1); // height
  // sem byte de realSize: so existe quando width > 1 || height > 1
  w.u8(1); // layers
  w.u8(thing.patternX || 1);
  w.u8(thing.patternY || 1);
  w.u8(1); // patternZ (lido a partir da versao 755)
  w.u8(1); // animation phases -- 1 evita o bloco do Animator

  // GameSpritesU32 ligado: indices em u32 (thingtype.cpp:374).
  for (const id of thing.sprites) w.u32(id);
}

// --- definicao do datapack -------------------------------------------------

// Os 3 chaos. Ids 100+ porque o .dat reserva 1..99
// (thingtypemanager.cpp:292). Batem com gen-items.js.
const GROUNDS = [
  { id: 100, name: 'grass', color: [ 96, 148,  72] },
  { id: 101, name: 'sand',  color: [214, 190, 130] },
  { id: 102, name: 'stone', color: [140, 140, 148] },
];

// Vertice superior do losango -- e onde `dest` cai (ver cabecalho).
const GROUND_ANCHOR = { x: TILE_HALF_W, y: 0 };

// Os pes do boneco estao em canvas y=24 e queremos que caiam no CENTRO da
// celula, que fica em dest + (0, TILE_HALF_H). Logo anchor.y = 24 - 8 = 16.
const OUTFIT_ANCHOR = { x: 16, y: 24 - TILE_HALF_H };

// Efeito e missile sao desenhados centrados em canvas (16,16) e queremos que
// o centro do desenho caia no centro da celula.
const CENTERED_ANCHOR = { x: 16, y: 16 - TILE_HALF_H };

const OUTFITS = [
  { look: 1, color: [ 88, 120, 200] },
  { look: 2, color: [200,  88,  88] },
  { look: 3, color: [ 96, 176, 112] },
  { look: 4, color: [184, 152,  72] },
];

const DIRECTIONS = ['north', 'east', 'south', 'west'];

function main() {
  const sprites = []; // sprites[i] -> id i+1 (id 0 = "sem sprite")
  const addSprite = (canvas) => { sprites.push(canvas); return sprites.length; };

  const w = new DatWriter();
  w.u32(SIGNATURE);

  // Contadores do cabecalho: thingtypemanager.cpp:284 faz `count = getU16()+1`
  // e o loop vai de firstId ate count-1. Ou seja, o valor gravado e o MAIOR
  // id, nao a quantidade.
  w.u16(GROUNDS[GROUNDS.length - 1].id); // itens: maior id (102)
  w.u16(OUTFITS.length);                 // outfits: 1..4
  w.u16(1);                              // effects: 1
  w.u16(1);                              // missiles: 1

  // --- itens (ids 100..102)
  for (const g of GROUNDS) {
    const sprite = addSprite(drawGroundDiamond(g.color, GROUND_ANCHOR));
    writeThing(w, {
      attrs: [
        // Sem ThingAttrGround, Tile::drawGround da break na primeira iteracao
        // e nenhum chao e desenhado (ver FIX-DAT.md).
        { id: ATTR_GROUND, write: (x) => x.u16(110) }, // speed
        { id: ATTR_FULL_GROUND },
      ],
      anchor: GROUND_ANCHOR,
      sprites: [sprite],
    });
  }

  // --- outfits (looktypes 1..4)
  // getSpriteIndex varre na ordem (patternZ, patternY, patternX, layer, h, w),
  // entao com 1 layer e patternY=1 basta listar as 4 direcoes em ordem de
  // patternX. A ordem de Otc::Direction e North, East, South, West.
  for (const o of OUTFITS) {
    const ids = DIRECTIONS.map((d) => addSprite(drawOutfit(o.color, d)));
    writeThing(w, {
      anchor: OUTFIT_ANCHOR,
      patternX: DIRECTIONS.length,
      frameGroups: true, // o .otfi declara frame-groups -> GameIdleAnimations
      sprites: ids,
    });
  }

  // --- efeito
  writeThing(w, {
    anchor: CENTERED_ANCHOR,
    sprites: [addSprite(drawEffect([255, 232, 128]))],
  });

  // --- missile: grade 3x3 de direcoes (missile.cpp:38-65)
  const missileIds = [];
  for (let py = 0; py < 3; py++) {
    for (let px = 0; px < 3; px++) {
      missileIds.push(addSprite(drawMissile([240, 228, 176], px - 1, py - 1)));
    }
  }
  writeThing(w, {
    anchor: CENTERED_ANCHOR,
    patternX: 3,
    patternY: 3,
    sprites: missileIds,
  });

  // --- grava
  //
  // ATENCAO: o datapack em client/data/things/860/ e VERSIONADO e foi
  // autorado a mao (Object Builder). Este gerador escreve nos mesmos
  // caminhos, entao rodar sem querer apagaria o material bom. So sobrescreve
  // com --force, e ai a recuperacao e `git checkout -- client/data/things`.
  const force = process.argv.includes('--force');
  const existentes = ['Tibia.dat', 'Tibia.spr', 'Tibia.otfi']
    .filter((f) => fs.existsSync(path.join(OUT_DIR, f)));
  if (existentes.length > 0 && !force) {
    console.error(`Ja existe datapack em ${OUT_DIR}: ${existentes.join(', ')}`);
    console.error('Este gerador SOBRESCREVE esses arquivos. O datapack versionado');
    console.error('foi feito a mao -- se e ele que esta ai, nao rode isto.');
    console.error('Para gerar mesmo assim: node tools/datapack-gen/gen-things.js --force');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dat = w.toBuffer();
  const spr = buildSpr(sprites);

  // O .otfi liga as features que este datapack usa. Sem `transparency: true`
  // o SpriteManager le os pixels como RGB e o stream dessincroniza -- sprites
  // invisiveis (ver client/modules/game_things/things.lua).
  const otfi = [
    'DatSpr',
    '  extended: true',
    '  transparency: true',
    '  frame-durations: true',
    '  frame-groups: true',
    '  metadata-file: Tibia.dat',
    '  sprites-file: Tibia.spr',
    '  sprite-size: 32',
    '  sprite-data-size: 4096',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, 'Tibia.dat'), dat);
  fs.writeFileSync(path.join(OUT_DIR, 'Tibia.spr'), spr);
  fs.writeFileSync(path.join(OUT_DIR, 'Tibia.otfi'), otfi);

  console.log(`Tibia.dat  ${dat.length} bytes  (${GROUNDS.length} itens, ${OUTFITS.length} outfits, 1 efeito, 1 missile)`);
  console.log(`Tibia.spr  ${spr.length} bytes  (${sprites.length} sprites)`);
  console.log(`Tibia.otfi escrito em ${OUT_DIR}`);
  console.log(`displacement do chao = ancora = (${GROUND_ANCHOR.x}, ${GROUND_ANCHOR.y})`);
}

if (require.main === module) main();

module.exports = { inCell, GROUND_ANCHOR, TILE_HALF_W, TILE_HALF_H };
