'use strict';
/*
 * serve.js -- servidor do editor de mapa.
 *
 *   node tools/world-editor/serve.js [porta]
 *   -> abre http://localhost:8080
 *
 *
 * POR QUE UM SERVIDOR, E NAO UM HTML SOLTO
 *
 * O editor precisa de tres coisas do disco: o atlas de tiles, o mapa de
 * indices e o height map. Um navegador em file:// nao alcanca nenhuma delas
 * (CORS), e foi por isso que o editor antigo (map-editor/build.js) embutia
 * tudo em base64 num HTML gerado -- o que obrigava a regerar a pagina a cada
 * mudanca de dado.
 *
 * Com um servidor de 60 linhas o problema some, e de quebra o editor pode
 * GRAVAR de volta. Sem npm: so o modulo `http` nativo, como o resto do repo.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const RAIZ = path.resolve(__dirname, '..', '..');
const AQUI = __dirname;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

/*
 * O que o editor pode ler, por prefixo.
 *
 * Nao e paranoia: o servidor resolve caminho vindo da URL, e sem esta lista
 * um `../../..` daria acesso ao disco inteiro de quem estiver rodando.
 */
const PERMITIDOS = [
  path.join(RAIZ, 'assets', 'ffta'),
  path.join(RAIZ, 'tools', 'world-editor'),
];

function dentroDoPermitido(alvo) {
  const real = path.resolve(alvo);
  return PERMITIDOS.some((base) => real === base || real.startsWith(base + path.sep));
}

function servirArquivo(res, arquivo) {
  if (!dentroDoPermitido(arquivo) || !fs.existsSync(arquivo)) {
    res.writeHead(404); res.end('nao encontrado');
    return;
  }
  const tipo = TIPOS[path.extname(arquivo)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(arquivo));
}

function json(res, dado, status = 200) {
  const corpo = JSON.stringify(dado);
  res.writeHead(status, { 'Content-Type': TIPOS['.json'], 'Cache-Control': 'no-store' });
  res.end(corpo);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const CAMINHO_HM = path.join(RAIZ, 'assets', 'ffta', 'maps', 'heightmaps.json');

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rota = url.pathname;

  try {
    if (rota === '/' || rota === '/index.html') {
      return servirArquivo(res, path.join(AQUI, 'index.html'));
    }

    if (rota === '/editor.js') {
      return servirArquivo(res, path.join(AQUI, 'editor.js'));
    }

    // GET /api/mapa?nome=aizenfield&indice=150
    if (rota === '/api/mapa' && req.method === 'GET') {
      const nome = url.searchParams.get('nome') || 'aizenfield';
      const indice = parseInt(url.searchParams.get('indice') || '150', 10);

      const dirTileset = path.join(RAIZ, 'assets', 'ffta', 'tilesets', nome);
      const mapa = JSON.parse(fs.readFileSync(path.join(dirTileset, 'mapa.json'), 'utf8'));
      const hm = JSON.parse(fs.readFileSync(CAMINHO_HM, 'utf8'));
      const altura = hm.mapas.find((m) => m.index === indice);

      if (!altura || !altura.decodificado) {
        return json(res, { erro: `mapa ${indice} sem height map decodificado` }, 404);
      }

      return json(res, { nome, indice, tileset: mapa, altura });
    }

    // POST /api/altura  {indice, col, row, valor}
    if (rota === '/api/altura' && req.method === 'POST') {
      const { indice, col, row, valor } = await lerCorpo(req);

      const hm = JSON.parse(fs.readFileSync(CAMINHO_HM, 'utf8'));
      const mapa = hm.mapas.find((m) => m.index === indice);
      if (!mapa || !mapa.decodificado) return json(res, { erro: 'mapa invalido' }, 400);

      if (row < 0 || row >= mapa.altura || col < 0 || col >= mapa.largura) {
        return json(res, { erro: 'celula fora da grade' }, 400);
      }
      // 32 niveis (0..31): a altura do FFTA usa 5 bits.
      if (valor !== null && (!Number.isInteger(valor) || valor < 0 || valor > 31)) {
        return json(res, { erro: 'altura fora de 0..31' }, 400);
      }

      mapa.grade[row][col] = valor;

      // Recalcula min/max: sao usados para a escala de cor, e deixa-los
      // velhos faria o mapa inteiro mudar de cor depois de uma edicao.
      const planas = mapa.grade.flat().filter((v) => v !== null);
      mapa.min = Math.min(...planas);
      mapa.max = Math.max(...planas);

      fs.writeFileSync(CAMINHO_HM, JSON.stringify(hm, null, 1));
      return json(res, { ok: true, min: mapa.min, max: mapa.max });
    }

    // Estaticos de assets/ffta (atlas, paleta, ...)
    if (rota.startsWith('/assets/')) {
      return servirArquivo(res, path.join(RAIZ, rota.slice(1)));
    }

    res.writeHead(404); res.end('rota desconhecida');
  } catch (e) {
    json(res, { erro: e.message }, 500);
  }
});

const porta = parseInt(process.argv[2] || '8080', 10);
servidor.listen(porta, () => {
  console.log(`editor em http://localhost:${porta}`);
  console.log('Ctrl+C para parar.');
});
