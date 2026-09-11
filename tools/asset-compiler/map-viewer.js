'use strict';
/*
 * map-viewer.js -- gera um visualizador HTML do que esta REALMENTE no mapa.
 *
 *   node tools/asset-compiler/map-viewer.js
 *   -> assets/debug/map-viewer.html   (abra no navegador)
 *
 * POR QUE ISTO EXISTE
 *
 * render-world.js produz UMA imagem achatada. Quando algo esta errado, ela
 * mostra que esta errado mas nao mostra ONDE nem POR QUE -- nao da para
 * separar as camadas, nem saber que item ocupa cada celula.
 *
 * Este visualizador le as MESMAS fontes que o jogo carrega:
 *
 *   client/data/things/860/Tibia.dat   os thingtypes e seus atributos
 *   client/data/things/860/Tibia.cwm   os sprites
 *   server/data/world/world.otbm       o que esta em cada tile
 *
 * e monta uma pagina onde da para ligar/desligar cada camada, ver o
 * personagem entre elas, e clicar num tile para saber exatamente o que ha
 * ali. E a diferenca entre "o mapa esta esquisito" e "o tile (4,7) tem o item
 * 310 na camada errada".
 */

const fs = require('fs');
const path = require('path');
const { readDat } = require('./dat-read.js');
// Reusa o mesmo abrirSprites do render-check: ele ja escolhe entre .cwm e
// .spr e devolve um acessor por id, com o tamanho de celula junto.
const { abrirSprites } = require('./render-check.js');
const { readOtbm } = require('../datapack-gen/otbm-read.js');
const { Image, writePNG } = require('./png.js');

const ROOT = path.resolve(__dirname, '../..');
const DATAPACK = path.join(ROOT, 'client/data/things/860');
const WORLD = path.join(ROOT, 'server/data/world/world.otbm');
const OUT = path.join(ROOT, 'assets/debug');

const TILE_HALF_W = 16;
const TILE_HALF_H = 8;
const FLOOR_LIFT = 16;

/** O mesmo corte de quadro que o render-world usa. */
function quadroDe(thing, sprites, cell) {
  const g = thing.groups[0];
  const img = Image.blank(g.width * cell, g.height * cell);
  for (let h = 0; h < g.height; h++) {
    for (let w = 0; w < g.width; w++) {
      // A ordem dos sprites no .dat e de tras para frente, nos dois eixos:
      // o indice 0 e a celula inferior-direita (ver mosaic.js).
      const cel = sprites.get(g.sprites[h * g.width + w]);
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

/** Compoe respeitando alpha -- Image.blit copia ate os pixels transparentes. */
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

function main() {
  const sprites = abrirSprites(DATAPACK);
  const dat = readDat(fs.readFileSync(path.join(DATAPACK, 'Tibia.dat')));
  const mundo = readOtbm(fs.readFileSync(WORLD));
  const cell = sprites.cell;

  const porId = new Map();
  for (const it of dat.items) porId.set(it.id, it);

  const cache = new Map();
  const quadro = (id) => {
    if (!cache.has(id)) {
      const t = porId.get(id);
      cache.set(id, t ? quadroDe(t, sprites, cell) : null);
    }
    return cache.get(id);
  };

  const zs = [...new Set(mundo.tiles.map((t) => t.z))].sort((a, b) => a - b);
  const zBase = Math.max(...zs);

  const posDe = (t) => ({
    x: (t.x - t.y) * TILE_HALF_W,
    y: (t.x + t.y) * TILE_HALF_H - (zBase - t.z) * FLOOR_LIFT,
  });

  // Limites, para a imagem sair justa.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of mundo.tiles) {
    const p = posDe(t);
    for (const id of t.items) {
      const q = quadro(id);
      if (!q) continue;
      const x = p.x + q.origem[0], y = p.y + q.origem[1];
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + q.img.width); maxY = Math.max(maxY, y + q.img.height);
    }
  }
  const W = maxX - minX, H = maxY - minY;

  /*
   * Ordem igual a do client: andar mais baixo primeiro (z maior), e dentro
   * do andar por anti-diagonal (x + y) crescente.
   */
  const ordem = [...mundo.tiles].sort((a, b) =>
    (b.z - a.z) || ((a.x + a.y) - (b.x + b.y)) || (a.x - b.x));

  // Uma imagem por camada, para poder ligar e desligar cada uma.
  const camadas = { 1: Image.blank(W, H), 2: Image.blank(W, H) };
  const tiles = [];
  let nL1 = 0, nL2 = 0;

  for (const t of ordem) {
    const p = posDe(t);
    const info = { x: t.x, y: t.y, z: t.z, itens: [] };

    for (const id of t.items) {
      const thing = porId.get(id);
      const q = quadro(id);
      // A camada e o atributo onTop do .dat -- a MESMA fonte que o client usa
      // em Tile::addThing para ordenar a pilha.
      const camada = thing && thing.attrs.onTop ? 2 : 1;
      info.itens.push({
        id, camada,
        onTop: !!(thing && thing.attrs.onTop),
        ground: !!(thing && thing.attrs.ground !== undefined),
        visualOnly: !!(thing && thing.attrs.visualOnly),
      });
      if (!q) continue;
      blitOver(camadas[camada], q.img, p.x + q.origem[0] - minX, p.y + q.origem[1] - minY);
      if (camada === 1) nL1++; else nL2++;
    }
    tiles.push(info);
  }

  fs.mkdirSync(OUT, { recursive: true });
  writePNG(path.join(OUT, 'camada1.png'), camadas[1]);
  writePNG(path.join(OUT, 'camada2.png'), camadas[2]);

  // A posicao de tela de cada tile, para o HTML saber onde desenhar a grade.
  const grade = tiles.map((t) => {
    const p = posDe(t);
    return { ...t, sx: p.x - minX, sy: p.y - minY };
  });

  const dados = {
    largura: W, altura: H,
    origem: { x: minX, y: minY },
    tileHalfW: TILE_HALF_W, tileHalfH: TILE_HALF_H,
    tiles: grade,
    celula: cell,
    totalItens: { camada1: nL1, camada2: nL2 },
  };

  const b64 = (f) => fs.readFileSync(path.join(OUT, f)).toString('base64');
  const html = paginaHtml(dados, b64('camada1.png'), b64('camada2.png'));
  fs.writeFileSync(path.join(OUT, 'map-viewer.html'), html);

  console.log(`datapack: celula ${cell}px, ${dat.items.length} itens`);
  console.log(`mundo:    ${mundo.tiles.length} tiles, z ${zs.join(',')}`);
  console.log(`camada 1: ${nL1} itens desenhados (terreno)`);
  console.log(`camada 2: ${nL2} itens desenhados (por cima do personagem)`);
  console.log(`-> assets/debug/map-viewer.html  (${W}x${H})`);
}

function paginaHtml(d, png1, png2) {
  return `<!doctype html>
<meta charset="utf-8">
<title>ivalice - visualizador do mapa</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#14161a; color:#e6e6e6;
         font:13px/1.5 ui-monospace, Consolas, monospace; }
  header { padding:10px 14px; border-bottom:1px solid #2a2f38; display:flex;
           gap:18px; align-items:center; flex-wrap:wrap; }
  label { display:flex; gap:6px; align-items:center; cursor:pointer;
          user-select:none; white-space:nowrap; }
  .wrap { display:flex; gap:14px; padding:14px; align-items:flex-start;
          flex-wrap:wrap; }
  .palco { position:relative; image-rendering:pixelated;
           background:#0b0d10 repeating-conic-gradient(#1a1d22 0% 25%, #0b0d10 0% 50%) 0 0/16px 16px;
           border:1px solid #2a2f38; flex:0 0 auto; }
  .palco img, .palco canvas { position:absolute; left:0; top:0;
           image-rendering:pixelated; }
  aside { flex:1 1 260px; min-width:240px; }
  h2 { font-size:13px; margin:0 0 6px; color:#9aa4b2; font-weight:600; }
  .box { border:1px solid #2a2f38; padding:10px; border-radius:4px;
         background:#1a1d22; margin-bottom:10px; }
  .c1 { color:#7fd1a0; } .c2 { color:#ffb454; }
  code { background:#22262e; padding:1px 5px; border-radius:3px; }
  table { border-collapse:collapse; width:100%; }
  td { padding:2px 6px 2px 0; vertical-align:top; }
  .dim { color:#7d8794; }
</style>

<header>
  <strong>ivalice · mapa</strong>
  <label><input type="checkbox" id="l1" checked> <span class="c1">camada 1 — terreno</span></label>
  <label><input type="checkbox" id="p" checked> personagem</label>
  <label><input type="checkbox" id="l2" checked> <span class="c2">camada 2 — por cima</span></label>
  <label><input type="checkbox" id="g"> grade</label>
  <label>zoom <input type="range" id="z" min="1" max="4" step="1" value="2"></label>
</header>

<div class="wrap">
  <div class="palco" id="palco">
    <img id="img1" src="data:image/png;base64,${png1}">
    <canvas id="boneco"></canvas>
    <img id="img2" src="data:image/png;base64,${png2}">
    <canvas id="grade"></canvas>
  </div>

  <aside>
    <div class="box">
      <h2>ordem de desenho</h2>
      <div><span class="c1">1.</span> camada 1 (terreno) — <b>${d.totalItens.camada1}</b> itens</div>
      <div><span class="dim">2.</span> personagem</div>
      <div><span class="c2">3.</span> camada 2 (por cima) — <b>${d.totalItens.camada2}</b> itens</div>
      <p class="dim">Arraste o quadrado rosa para pôr o personagem entre as
      camadas e ver o que passa na frente dele.</p>
    </div>
    <div class="box">
      <h2>tile</h2>
      <div id="info" class="dim">clique num tile</div>
    </div>
    <div class="box">
      <h2>resumo</h2>
      <table>
        <tr><td>tiles</td><td><b>${d.tiles.length}</b></td></tr>
        <tr><td>tamanho</td><td>${d.largura}×${d.altura}</td></tr>
        <tr><td>célula</td><td>${d.celula}px</td></tr>
      </table>
    </div>
  </aside>
</div>

<script>
const D = ${JSON.stringify(d)};
const palco = document.getElementById('palco');
const img1 = document.getElementById('img1'), img2 = document.getElementById('img2');
const cg = document.getElementById('grade'), cb = document.getElementById('boneco');

for (const c of [cg, cb]) { c.width = D.largura; c.height = D.altura; }

let zoom = 2;
function aplicarZoom() {
  palco.style.width = (D.largura * zoom) + 'px';
  palco.style.height = (D.altura * zoom) + 'px';
  for (const el of [img1, img2, cg, cb]) {
    el.style.width = (D.largura * zoom) + 'px';
    el.style.height = (D.altura * zoom) + 'px';
  }
}
aplicarZoom();

// --- grade dos tiles (losango 32x16) ---
function desenharGrade(on) {
  const g = cg.getContext('2d');
  g.clearRect(0, 0, cg.width, cg.height);
  if (!on) return;
  g.strokeStyle = 'rgba(120,200,255,.35)';
  g.lineWidth = 1;
  for (const t of D.tiles) {
    const x = t.sx, y = t.sy;
    g.beginPath();
    g.moveTo(x + D.tileHalfW, y);
    g.lineTo(x + D.tileHalfW * 2, y + D.tileHalfH);
    g.lineTo(x + D.tileHalfW, y + D.tileHalfH * 2);
    g.lineTo(x, y + D.tileHalfH);
    g.closePath();
    g.stroke();
  }
}

// --- personagem: um marcador arrastavel, para testar a oclusao ---
let bx = Math.floor(D.largura / 2), by = Math.floor(D.altura / 2);
function desenharBoneco(on) {
  const g = cb.getContext('2d');
  g.clearRect(0, 0, cb.width, cb.height);
  if (!on) return;
  // 32x64 e o tamanho do frame de personagem; a base fica no centro do tile.
  g.fillStyle = 'rgba(255,80,180,.85)';
  g.fillRect(bx - 16, by - 56, 32, 56);
  g.strokeStyle = '#fff'; g.lineWidth = 1;
  g.strokeRect(bx - 16.5, by - 56.5, 33, 57);
}

palco.addEventListener('mousedown', (e) => {
  const r = palco.getBoundingClientRect();
  bx = Math.round((e.clientX - r.left) / zoom);
  by = Math.round((e.clientY - r.top) / zoom);
  desenharBoneco(document.getElementById('p').checked);
  mostrarTile(bx, by);
});

// --- qual tile esta sob o ponto: a inversa da projecao isometrica ---
function mostrarTile(px, py) {
  let melhor = null, dist = 1e9;
  for (const t of D.tiles) {
    const cx = t.sx + D.tileHalfW, cy = t.sy + D.tileHalfH;
    // distancia no espaco do losango, para o mais proximo ganhar
    const dx = Math.abs(px - cx) / D.tileHalfW, dy = Math.abs(py - cy) / D.tileHalfH;
    const dd = dx + dy;
    if (dd < dist) { dist = dd; melhor = t; }
  }
  const el = document.getElementById('info');
  if (!melhor || dist > 1.6) { el.innerHTML = '<span class="dim">fora do mapa</span>'; return; }
  const linhas = melhor.itens.map((i) => {
    const cor = i.camada === 2 ? 'c2' : 'c1';
    const tags = [];
    if (i.ground) tags.push('ground');
    if (i.onTop) tags.push('onTop');
    if (i.visualOnly) tags.push('visualOnly');
    return '<div><span class="' + cor + '">camada ' + i.camada + '</span> · id <code>'
         + i.id + '</code> <span class="dim">' + tags.join(' ') + '</span></div>';
  }).join('');
  el.innerHTML = '<div><b>(' + melhor.x + ', ' + melhor.y + ', ' + melhor.z + ')</b></div>'
               + (linhas || '<span class="dim">vazio</span>');
}

function sync() {
  img1.style.display = document.getElementById('l1').checked ? '' : 'none';
  img2.style.display = document.getElementById('l2').checked ? '' : 'none';
  desenharBoneco(document.getElementById('p').checked);
  desenharGrade(document.getElementById('g').checked);
}
for (const id of ['l1', 'l2', 'p', 'g']) {
  document.getElementById(id).addEventListener('change', sync);
}
document.getElementById('z').addEventListener('input', (e) => {
  zoom = +e.target.value; aplicarZoom();
});
sync();
</script>
`;
}

if (require.main === module) main();

module.exports = { quadroDe, blitOver };
