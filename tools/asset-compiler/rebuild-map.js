'use strict';
/*
 * Reconstroi o mapa a partir das imagens de referencia, reaproveitando tile
 * repetido, e mostra o quanto cada nivel de reaproveitamento se afasta do
 * original.
 *
 *   node tools/asset-compiler/rebuild-map.js                 # varre e so mostra
 *   node tools/asset-compiler/rebuild-map.js --tolerancia=6  # grava esse nivel
 *
 * ENTRADA
 *   assets/mapref/aisenfield.png    camada 1 -- o terreno
 *   assets/mapref/aisenfield2.png   camada 2 -- a decoracao
 *   assets/mapref/aisenfield3.png   as duas juntas, como deve ficar
 *   tools/rom.gba                   height map (altura por celula)
 *
 * SAIDA (so com --tolerancia)
 *   assets/items/NNN-map<N>-<n>.png     terreno
 *   assets/items/NNN-map<N>L2-<n>.png   decoracao
 *   assets/mapdata/map<N>.json
 *   assets/debug/rebuild-map<N>.png
 *
 *
 * AS DUAS CAMADAS
 *
 * A camada 2 e decoracao esparsa -- pedra, arbusto, tufo seco. Das 208
 * celulas do Aisenfield, so 91 tem alguma coisa; as outras 117 ficam de fora
 * e nao viram item nenhum.
 *
 * Ela vira ThingAttrOnTop no .dat, e Tile::drawTop desenha `onTop` DEPOIS das
 * criaturas. E o que faz a pedra passar na frente do personagem em vez de
 * sumir atras dele -- o item 1 do plano.
 *
 *
 * O PROBLEMA COM A DEDUPLICACAO EXATA
 *
 * Comparando os tiles byte a byte, 208 celulas davam 204 tiles distintos --
 * praticamente nenhuma repeticao. Nao e defeito do codigo: a arte e desenhada
 * a mao e quase nenhuma celula e pixel-identica a outra; o chao "igual" varia
 * dois ou tres tons de terra de uma celula para a vizinha. E o recorte
 * retangular ainda leva pedaco dos vizinhos na sobreposicao, o que reduz mais
 * a chance de duas celulas coincidirem.
 *
 * Ou seja, a igualdade exata mede a coisa errada. O que interessa nao e se
 * dois tiles sao identicos, e sim se trocar um pelo outro MUDA A TELA a ponto
 * de se notar.
 *
 * Para cada celula, procura entre os tiles ja aceitos o mais parecido; se a
 * diferenca media por pixel ficar dentro da tolerancia, reusa. E quantizacao
 * vetorial gulosa -- a ordem de visita influencia o resultado, e por isso a
 * varredura existe: em vez de eleger um numero, ela mostra a troca inteira e
 * deixa a escolha visivel.
 *
 *
 * A MEDIDA DE CHEGADA
 *
 * O erro e medido em COR contra aisenfield3.png, nao em silhueta. A cobertura
 * que o render-world reporta compara opaco contra transparente, entao um mapa
 * com a arte toda trocada, mas o contorno certo, pontua igual. Aqui interessa
 * justamente a arte.
 */

const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, Image } = require('./png.js');
const E = require('./extract-map-tiles.js');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'assets');

const VARREDURA = [0, 2, 4, 6, 8, 12, 16, 24, 32];

/*
 * O TAMANHO DO TILE.
 *
 * A largura e a da celula isometrica. A altura foi medida: e quanto de
 * imagem cada celula precisa carregar para que a uniao dos retangulos cubra
 * a referencia inteira.
 *
 *   48 -> 96,87% dos pixels iguais, 2187 buracos
 *   64 -> 99,90%,  73
 *   88 -> 99,90%,  73  (nao melhora, e so gera mais tile de decoracao)
 */
const LARGURA_TILE = 32;
const ALTURA_TILE = 64;

/** Compoe respeitando alpha (Image.blit copia ate transparente e apaga). */
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

/**
 * Distancia media por pixel entre dois tiles.
 *
 * Pixel transparente dos dois lados nao conta. Opaco de um lado so custa
 * PENA_ALFA, que e alto de proposito: e o que impede um tile de borda, meio
 * transparente, de casar com um tile cheio -- a media sobre poucos pixels
 * opacos ficaria baixa e o buraco na silhueta nao apareceria na conta.
 */
const PENA_ALFA = 255;
function distancia(a, b) {
  let soma = 0, n = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    const aa = a.pixels[i + 3], ab = b.pixels[i + 3];
    if (aa === 0 && ab === 0) continue;
    n++;
    if (aa === 0 || ab === 0) { soma += PENA_ALFA; continue; }
    soma += (Math.abs(a.pixels[i] - b.pixels[i])
      + Math.abs(a.pixels[i + 1] - b.pixels[i + 1])
      + Math.abs(a.pixels[i + 2] - b.pixels[i + 2])) / 3;
  }
  return n === 0 ? Infinity : soma / n;
}

/**
 * Quantizacao gulosa de uma camada.
 * Celula vazia nao vira tile: devolve null e nao e desenhada nem gravada.
 */
function quantizar(celulas, campo, tolerancia) {
  const tiles = [];
  const indice = [];

  for (const cel of celulas) {
    const img = cel[campo];
    if (!img || img.isEmpty()) { indice.push(null); continue; }

    const chave = img.pixels.toString('latin1');
    let achou = tiles.findIndex((t) => t.chave === chave);
    if (achou < 0) achou = null;

    if (achou === null && tolerancia > 0) {
      let melhor = Infinity;
      for (let i = 0; i < tiles.length; i++) {
        const d = distancia(img, tiles[i].img);
        if (d < melhor) { melhor = d; achou = i; }
        if (melhor === 0) break;
      }
      if (melhor > tolerancia) achou = null;
    }

    if (achou === null) {
      achou = tiles.length;
      tiles.push({ img, chave });
    }
    indice.push(achou);
  }

  return { tiles, indice };
}

/**
 * Redesenha o mapa com os conjuntos escolhidos.
 *
 * A ordem imita a do client: TODA a camada 1 primeiro, depois toda a camada
 * 2. O client faz drawGround para todos os tiles do andar e so depois entra
 * no laco por tile que chama drawTop (MapView::drawFloor), entao a decoracao
 * de um tile de tras fica por cima do terreno de um tile da frente.
 */
function desenhar(celulas, l1, l2, largura, altura) {
  const out = Image.blank(largura, altura);
  const ordem = celulas.map((_, i) => i)
    .sort((a, b) => (celulas[a].c + celulas[a].r) - (celulas[b].c + celulas[b].r));

  for (const i of ordem) {
    if (l1.indice[i] === null) continue;
    blitOver(out, l1.tiles[l1.indice[i]].img, celulas[i].p.x, celulas[i].p.y);
  }
  for (const i of ordem) {
    if (l2.indice[i] === null) continue;
    blitOver(out, l2.tiles[l2.indice[i]].img, celulas[i].p.x, celulas[i].p.y);
  }
  return out;
}

/** Erro de COR contra a referencia, sobre a area opaca dela. */
function medir(ref, out) {
  let opacos = 0, iguais = 0, soma = 0, buracos = 0;
  for (let y = 0; y < ref.height; y++) {
    for (let x = 0; x < ref.width; x++) {
      const o = ref.offset(x, y);
      if (ref.pixels[o + 3] === 0) continue;
      opacos++;
      if (x >= out.width || y >= out.height || out.pixels[out.offset(x, y) + 3] === 0) {
        buracos++;
        soma += PENA_ALFA;
        continue;
      }
      const q = out.offset(x, y);
      const d = Math.abs(ref.pixels[o] - out.pixels[q])
        + Math.abs(ref.pixels[o + 1] - out.pixels[q + 1])
        + Math.abs(ref.pixels[o + 2] - out.pixels[q + 2]);
      if (d === 0) iguais++;
      soma += d / 3;
    }
  }
  return { opacos, iguais, buracos, erro: soma / opacos, pct: 100 * iguais / opacos };
}

function gravarTiles(tiles, mapIndex, layer, primeiroPrefixo) {
  const marca = layer === 1 ? `-map${mapIndex}-` : `-map${mapIndex}L${layer}-`;
  tiles.forEach((t, i) => {
    const nome = `${String(primeiroPrefixo + i).padStart(3, '0')}${marca}${i}.png`;
    writePNG(path.join(ASSETS, 'items', nome), t.img);
  });
  return marca;
}

function main() {
  const args = process.argv.slice(2);
  const mapIndex = Number((args.find((a) => a.startsWith('--map=')) || '--map=150').slice(6));
  const tolArg = args.find((a) => a.startsWith('--tolerancia='));

  const rom = fs.readFileSync(path.join(ROOT, 'tools/rom.gba'));
  const hm = E.loadHeightMap(rom, mapIndex);

  const ref1 = readPNG(path.join(ASSETS, 'mapref/aisenfield.png'));
  const ref2 = readPNG(path.join(ASSETS, 'mapref/aisenfield2.png'));
  const alvoPath = path.join(ASSETS, 'mapref/aisenfield3.png');
  // aisenfield3 e as duas camadas juntas -- o resultado esperado. Sem ele,
  // comparar so contra a camada 1 diria que a decoracao "sobra".
  const alvo = fs.existsSync(alvoPath) ? readPNG(alvoPath) : ref1;

  /*
   * GEOMETRIA PLANA, SEM NENHUM TERMO DE ALTURA.
   *
   * A celula e recortada da referencia na posicao da GRADE e desenhada
   * nessa mesma posicao. Isso torna a reconstrucao uma identidade: cada
   * pixel da tela recebe o valor da ultima celula que o cobre, que e
   * exatamente a celula de onde aquele pixel foi cortado. Medido: 99,90%.
   *
   * A altura do FFTA saiu daqui. Ela entrava na projecao do recorte
   * (project(c, r, altura)) e precisava voltar no desenho como elevation --
   * dois lugares para manter em acordo, e qualquer diferenca entre eles
   * aparecia como relevo torto. A altura continua gravada por celula no
   * mapdata, que E versionado; o que saiu foi a participacao dela no
   * desenho.
   *
   * A origem nao e calibrada por busca: ela e a largura que a grade ocupa a
   * esquerda. Com 13 linhas, a celula (0,12) fica em x = -12*16, entao a
   * grade inteira cabe deslocando 192 para a direita -- e (16-1)*16 + 192 +
   * 32 da 464, a largura exata da referencia.
   */
  const origin = { x: (hm.length - 1) * E.TILE_HALF_W, y: 0 };
  const corta = (img, c, r) => img.crop(
    origin.x + (c - r) * E.TILE_HALF_W,
    origin.y + (c + r) * E.TILE_HALF_H,
    LARGURA_TILE, ALTURA_TILE);

  let minHeight = Infinity;
  for (const linha of hm) for (const h of linha) minHeight = Math.min(minHeight, h);

  const celulas = [];
  for (let r = 0; r < hm.length; r++) {
    for (let c = 0; c < hm[0].length; c++) {
      const h = hm[r][c];
      celulas.push({
        c, r, h,
        p: { x: origin.x + (c - r) * E.TILE_HALF_W, y: origin.y + (c + r) * E.TILE_HALF_H },
        img1: corta(ref1, c, r),
        img2: corta(ref2, c, r),
      });
    }
  }

  const comDeco = celulas.filter((x) => !x.img2.isEmpty()).length;
  console.log(`mapa ${mapIndex}: ${hm[0].length}x${hm.length} = ${celulas.length} celulas`);
  console.log(`referencia ${ref1.width}x${ref1.height}, origem (${origin.x},${origin.y}), altura ${minHeight}..${Math.max(...hm.flat())}`);
  console.log(`camada 2: ${comDeco} celulas com decoracao, ${celulas.length - comDeco} vazias (nao viram item)`);
  console.log('');
  console.log('  tolerancia   terreno   deco   px iguais   erro/canal   buracos');
  console.log('  ----------   -------   ----   ---------   ----------   -------');

  const resultados = [];
  for (const tol of (tolArg ? [Number(tolArg.slice('--tolerancia='.length))] : VARREDURA)) {
    const l1 = quantizar(celulas, 'img1', tol);
    const l2 = quantizar(celulas, 'img2', tol);
    const out = desenhar(celulas, l1, l2, alvo.width, alvo.height);
    const m = medir(alvo, out);
    console.log(`  ${String(tol).padStart(10)}   ${String(l1.tiles.length).padStart(7)}   ${String(l2.tiles.length).padStart(4)}`
      + `   ${m.pct.toFixed(1).padStart(8)}%   ${m.erro.toFixed(2).padStart(10)}   ${String(m.buracos).padStart(7)}`);
    resultados.push({ tol, l1, l2, out, m });
  }

  if (!tolArg) {
    console.log('');
    console.log('tolerancia 0 = deduplicacao exata. Rode com --tolerancia=N para gravar.');
    return;
  }

  const { tol, l1, l2, out, m } = resultados[0];
  const dbg = path.join(ASSETS, 'debug');
  fs.mkdirSync(dbg, { recursive: true });
  writePNG(path.join(dbg, `rebuild-map${mapIndex}.png`), out);

  // Limpa os tiles antigos deste mapa: sobra de uma rodada com mais tiles
  // viraria id fantasma no .dat e deslocaria todos os outros.
  const itemsDir = path.join(ASSETS, 'items');
  let removidos = 0;
  for (const f of fs.readdirSync(itemsDir)) {
    if (/-map\d+(L\d+)?-\d+\.png$/i.test(f)) { fs.unlinkSync(path.join(itemsDir, f)); removidos++; }
  }

  /*
   * PREFIXO NUMERICO: e ele que define a ordem alfabetica, e portanto o id.
   * A camada 1 comeca em 200 e a 2 logo depois, para os ids de terreno nao
   * mudarem quando a decoracao cresce ou encolhe.
   */
  gravarTiles(l1.tiles, mapIndex, 1, 200);
  gravarTiles(l2.tiles, mapIndex, 2, 200 + l1.tiles.length);

  const grid = [];
  let k = 0;
  for (let r = 0; r < hm.length; r++) {
    const linha = [];
    for (let c = 0; c < hm[0].length; c++) {
      linha.push({
        tile: l1.indice[k],
        tile2: l2.indice[k],
        height: celulas[k].h,
        elevation: celulas[k].h - minHeight,
      });
      k++;
    }
    grid.push(linha);
  }

  const dataDir = path.join(ASSETS, 'mapdata');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `map${mapIndex}.json`), JSON.stringify(
    { map: mapIndex, cols: hm[0].length, rows: hm.length, origin, minHeight, grid }, null, 1));

  console.log('');
  console.log(`tolerancia ${tol}: ${l1.tiles.length} tiles de terreno + ${l2.tiles.length} de decoracao`
    + `  (${removidos} antigos removidos)`);
  console.log(`px iguais ao original: ${m.pct.toFixed(1)}%   erro medio por canal: ${m.erro.toFixed(2)}`);
  console.log(`-> assets/items/, assets/mapdata/map${mapIndex}.json`);
  console.log(`-> assets/debug/rebuild-map${mapIndex}.png`);
}

if (require.main === module) main();
