'use strict';
/*
 * editor.js -- o editor de mapa no navegador.
 *
 * Desenha as tres camadas a partir do atlas de tiles, poe a grade isometrica
 * por cima e deixa editar a altura de cada celula.
 *
 *
 * A PROJECAO E A MESMA DO JOGO
 *
 * Celula de 32x16, deslocamento de 16x8 (client/src/client/const.h):
 *
 *   sx = OX + (col - row) * 16
 *   sy = OY + (col + row) * 8
 *
 * E a inversa, para saber em que celula o mouse esta:
 *
 *   col = floor(((sx-OX)/16 + (sy-OY)/8) / 2)
 *   row = floor(((sy-OY)/8 - (sx-OX)/16) / 2)
 *
 * O `floor` tem que ser em ponto flutuante. Divisao inteira trunca em
 * direcao a zero, e a esquerda/acima da origem as coordenadas sao negativas
 * -- ali o truncamento erra a celula por um. Esse bug ja custou tempo no
 * client e esta coberto por tools/asset-compiler/projecao.test.js.
 */

const HW = 16;   // meia largura da celula
const HH = 8;    // meia altura
const EL = 8;    // quanto um nivel de altura sobe na tela

/*
 * Onde a celula (0,0) do height map cai na arte.
 *
 * Obtido por busca: cobre 77,3% dos pixels opacos com zero transbordo. O
 * resto e a moldura de pedra das bordas, desenhada mas nao jogavel.
 *
 * Use o botao "medir encaixe" para conferir depois de mexer no offset: ele
 * mede cobertura e transbordo na hora. Cobertura sozinha engana -- uma grade
 * enorme cobriria tudo; o alinhamento certo e o que cobre mais COM
 * transbordo zero.
 */
let OX = 208;
let OY = 44;

const tela = document.getElementById('tela');
const ctx = tela.getContext('2d');

let dados = null;      // { tileset, altura, ... }
let atlas = null;      // Image do tiles.png
let sel = null;        // { col, row }
let zoom = 2;

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ cores

/** Cor por nivel: azul (baixo) -> verde -> amarelo -> vermelho (alto). */
function corDaAltura(h, min, max) {
  if (h === null || h === undefined) return [90, 90, 90];
  const t = max > min ? (h - min) / (max - min) : 0;
  if (t < 0.33) { const k = t / 0.33; return [0, 120 + 135 * k, 200 - 120 * k]; }
  if (t < 0.66) { const k = (t - 0.33) / 0.33; return [255 * k, 255, 80 - 80 * k]; }
  const k = (t - 0.66) / 0.34;
  return [255, 255 - 180 * k, 0];
}

function rgba(c, a) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

// -------------------------------------------------------------- projecao

/**
 * Onde a celula cai na tela.
 *
 * `h` e a altura: com o relevo ligado, cada nivel sobe EL px. E a mesma
 * conta que o jogo faz para posicionar o personagem -- o terreno nao se
 * move, porque a arte ja tem o relevo desenhado.
 */
function paraTela(col, row, h) {
  const sobe = (h !== null && h !== undefined && $('relevo').checked) ? h * EL : 0;
  return { x: OX + (col - row) * HW, y: OY + (col + row) * HH - sobe };
}

/*
 * A inversa nao tem como desfazer o relevo: dois pares (col,row) com alturas
 * diferentes podem cair no mesmo pixel. Com o relevo ligado o clique usa a
 * grade plana, e por isso a selecao pode divergir do que esta desenhado --
 * e limitacao da projecao, nao bug.
 */
function paraCelula(sx, sy) {
  const fx = (sx - OX) / HW;
  const fy = (sy - OY) / HH;
  return {
    col: Math.floor((fx + fy) / 2),
    row: Math.floor((fy - fx) / 2),
  };
}

// -------------------------------------------------------------- desenho

function desenharCamadas() {
  const ts = dados.tileset;
  const CELL = ts.celula;
  const COLS = ts.atlasColunas;
  const visiveis = [$('c1').checked, $('c2').checked, $('c3').checked];

  ts.camadas.forEach((camada, i) => {
    if (!visiveis[i]) return;
    for (let linha = 0; linha < camada.altura; linha++) {
      for (let coluna = 0; coluna < camada.largura; coluna++) {
        const id = camada.grade[linha][coluna];
        if (!id) continue;              // 0 = celula vazia
        const a = id - 1;
        ctx.drawImage(
          atlas,
          (a % COLS) * CELL, Math.floor(a / COLS) * CELL, CELL, CELL,
          coluna * CELL, linha * CELL, CELL, CELL);
      }
    }
  });
}

/** O losango de uma celula, como caminho no contexto. */
function caminhoLosango(col, row, h) {
  const p = paraTela(col, row, h);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);              // topo
  ctx.lineTo(p.x + HW, p.y + HH);    // direita
  ctx.lineTo(p.x, p.y + HH * 2);     // base
  ctx.lineTo(p.x - HW, p.y + HH);    // esquerda
  ctx.closePath();
}

function desenharGrade() {
  const alt = dados.altura;
  const mostrarCor = $('cores').checked;
  const mostrarNum = $('numeros').checked;

  ctx.lineWidth = 1;
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /*
   * Com o relevo ligado, desenha do fundo para a frente: a celula mais ao
   * sul (maior col+row) tapa a que esta atras dela, como no jogo. Sem essa
   * ordem uma celula alta ao norte cobriria as da frente.
   */
  const ordem = [];
  for (let row = 0; row < alt.altura; row++) {
    for (let col = 0; col < alt.largura; col++) ordem.push([col, row]);
  }
  if ($('relevo').checked) ordem.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));

  for (const [col, row] of ordem) {
    const h = alt.grade[row][col];
    caminhoLosango(col, row, h);

    if (mostrarCor) {
      ctx.fillStyle = rgba(corDaAltura(h, alt.min, alt.max), h === null ? 0.25 : 0.45);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (mostrarNum && h !== null) {
      const p = paraTela(col, row, h);
      ctx.fillStyle = '#000';
      ctx.fillText(String(h), p.x, p.y + HH + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(h), p.x, p.y + HH);
    }
  }

  if (sel) {
    caminhoLosango(sel.col, sel.row, alt.grade[sel.row][sel.col]);
    ctx.strokeStyle = '#6fb3e0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function desenhar() {
  const larg = dados.tileset.camadas[0].largura * dados.tileset.celula;
  const altu = dados.tileset.camadas[0].altura * dados.tileset.celula;

  tela.width = larg;
  tela.height = altu;
  tela.style.width = `${larg * zoom}px`;
  tela.style.height = `${altu * zoom}px`;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, larg, altu);

  desenharCamadas();
  if ($('grade').checked) desenharGrade();
}

// ------------------------------------------------------------- interacao

function celulaValida(c) {
  const a = dados.altura;
  return c && c.row >= 0 && c.row < a.altura && c.col >= 0 && c.col < a.largura;
}

function mostrarSelecao() {
  const campo = $('altura');
  if (!sel) {
    $('sel').textContent = 'nenhuma';
    campo.value = '';
    for (const b of ['altura', 'menos', 'mais', 'vazia']) $(b).disabled = true;
    return;
  }
  const h = dados.altura.grade[sel.row][sel.col];
  $('sel').innerHTML = `col <b>${sel.col}</b> &nbsp; row <b>${sel.row}</b>`;
  campo.value = h === null ? '' : h;
  for (const b of ['altura', 'menos', 'mais', 'vazia']) $(b).disabled = false;
}

async function gravar(col, row, valor) {
  const r = await fetch('/api/altura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indice: dados.indice, col, row, valor }),
  });
  const j = await r.json();
  if (j.erro) { $('status').textContent = `erro: ${j.erro}`; return false; }

  dados.altura.grade[row][col] = valor;
  dados.altura.min = j.min;
  dados.altura.max = j.max;
  atualizarEscala();
  $('status').textContent =
    `(${col},${row}) = ${valor === null ? 'vazia' : valor}   ·   gravado`;
  return true;
}

async function mudarAltura(delta) {
  if (!sel) return;
  const atual = dados.altura.grade[sel.row][sel.col];
  const base = atual === null ? 0 : atual;
  const novo = Math.max(0, Math.min(31, base + delta));
  if (novo === atual) return;
  if (await gravar(sel.col, sel.row, novo)) { mostrarSelecao(); desenhar(); }
}

function atualizarEscala() {
  const a = dados.altura;
  const esc = $('escala');
  esc.innerHTML = '';
  const n = Math.max(1, a.max - a.min + 1);
  for (let i = 0; i < n; i++) {
    const i2 = document.createElement('i');
    i2.style.background = rgba(corDaAltura(a.min + i, a.min, a.max), 1);
    i2.title = `altura ${a.min + i}`;
    esc.appendChild(i2);
  }
  $('emin').textContent = a.min;
  $('emax').textContent = a.max;
}

function posicaoNoCanvas(ev) {
  const r = tela.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) / zoom,
    y: (ev.clientY - r.top) / zoom,
  };
}

tela.addEventListener('click', (ev) => {
  const p = posicaoNoCanvas(ev);
  const c = paraCelula(p.x, p.y);
  sel = celulaValida(c) ? c : null;
  mostrarSelecao();
  desenhar();
});

tela.addEventListener('wheel', (ev) => {
  if (!sel) return;
  ev.preventDefault();
  mudarAltura(ev.deltaY < 0 ? 1 : -1);
}, { passive: false });

$('altura').addEventListener('change', async () => {
  if (!sel) return;
  const v = $('altura').value === '' ? null : parseInt($('altura').value, 10);
  if (v !== null && (Number.isNaN(v) || v < 0 || v > 31)) { mostrarSelecao(); return; }
  if (await gravar(sel.col, sel.row, v)) desenhar();
});

$('mais').addEventListener('click', () => mudarAltura(1));
$('menos').addEventListener('click', () => mudarAltura(-1));
$('vazia').addEventListener('click', async () => {
  if (!sel) return;
  if (await gravar(sel.col, sel.row, null)) { mostrarSelecao(); desenhar(); }
});

for (const id of ['c1', 'c2', 'c3', 'grade', 'cores', 'numeros', 'relevo']) {
  $(id).addEventListener('change', desenhar);
}

for (const id of ['ox', 'oy']) {
  $(id).addEventListener('change', () => {
    OX = parseInt($('ox').value, 10) || 0;
    OY = parseInt($('oy').value, 10) || 0;
    desenhar();
  });
}

/*
 * Mede o encaixe da grade sobre a arte.
 *
 * Duas medidas, e as duas importam:
 *
 *   cobertura  quantos pixels OPACOS da camada 1 caem dentro de algum
 *              losango da grade. Alto = a grade cobre o terreno.
 *   transbordo quantos pixels da grade caem no VAZIO. Alto = a grade e
 *              maior que o mapa, ou esta deslocada.
 *
 * Cobertura sozinha engana: uma grade enorme cobriria 100% e nao provaria
 * nada. O alinhamento certo e o que maximiza cobertura com transbordo zero.
 *
 * O teste roda no canvas fora da tela, sem tocar no desenho visivel.
 */
$('medir').addEventListener('click', () => {
  const ts = dados.tileset;
  const alt = dados.altura;
  const L = ts.camadas[0].largura * ts.celula;
  const A = ts.camadas[0].altura * ts.celula;

  // 1. quais pixels da camada 1 sao opacos
  const c1 = document.createElement('canvas');
  c1.width = L; c1.height = A;
  const x1 = c1.getContext('2d');
  const camada = ts.camadas[0];
  for (let linha = 0; linha < camada.altura; linha++) {
    for (let coluna = 0; coluna < camada.largura; coluna++) {
      const id = camada.grade[linha][coluna];
      if (!id) continue;
      const a = id - 1;
      x1.drawImage(atlas, (a % ts.atlasColunas) * ts.celula,
        Math.floor(a / ts.atlasColunas) * ts.celula, ts.celula, ts.celula,
        coluna * ts.celula, linha * ts.celula, ts.celula, ts.celula);
    }
  }
  const arte = x1.getImageData(0, 0, L, A).data;

  // 2. quais pixels a grade cobre
  const c2 = document.createElement('canvas');
  c2.width = L; c2.height = A;
  const x2 = c2.getContext('2d');
  x2.fillStyle = '#fff';
  const relevo = $('relevo').checked;
  for (let row = 0; row < alt.altura; row++) {
    for (let col = 0; col < alt.largura; col++) {
      const h = alt.grade[row][col];
      if (h === null) continue;
      const sobe = relevo ? h * EL : 0;
      const px = OX + (col - row) * HW, py = OY + (col + row) * HH - sobe;
      x2.beginPath();
      x2.moveTo(px, py);
      x2.lineTo(px + HW, py + HH);
      x2.lineTo(px, py + HH * 2);
      x2.lineTo(px - HW, py + HH);
      x2.closePath();
      x2.fill();
    }
  }
  const grade = x2.getImageData(0, 0, L, A).data;

  let opacos = 0, cobertos = 0, transbordo = 0;
  for (let i = 0; i < L * A; i++) {
    const temArte = arte[i * 4 + 3] > 0;
    const temGrade = grade[i * 4 + 3] > 0;
    if (temArte) { opacos++; if (temGrade) cobertos++; }
    else if (temGrade) transbordo++;
  }

  $('status').innerHTML =
    `offset (${OX},${OY})${relevo ? ' com relevo' : ''}<br>` +
    `cobre <b>${(100 * cobertos / opacos).toFixed(1)}%</b> da arte<br>` +
    `transborda <b>${transbordo}</b> px`;
});
$('zoom').addEventListener('change', () => {
  zoom = Math.max(1, Math.min(4, parseInt($('zoom').value, 10) || 2));
  $('zoom').value = zoom;
  desenhar();
});

// ---------------------------------------------------------------- inicio

async function iniciar() {
  const r = await fetch('/api/mapa?nome=aizenfield&indice=150');
  dados = await r.json();
  if (dados.erro) { $('titulo').textContent = `erro: ${dados.erro}`; return; }

  atlas = new Image();
  atlas.src = '/assets/ffta/tilesets/aizenfield/tiles.png';
  await atlas.decode();

  const a = dados.altura;
  $('titulo').textContent =
    `${dados.nome} · mapa ${dados.indice} · grade ${a.largura}×${a.altura} · ` +
    `${dados.tileset.tiles} tiles`;

  atualizarEscala();
  mostrarSelecao();
  desenhar();
}

iniciar();
