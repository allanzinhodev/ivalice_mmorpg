'use strict';
/*
 * coletar-sprites.js -- organiza os PNGs exportados do sprite view do mGBA.
 *
 *   node tools/ffta-vram/coletar-sprites.js <arquivo.png...> --job <job> --acao <acao>
 *
 * Exemplo:
 *   node tools/ffta-vram/coletar-sprites.js tools/espadada.png --job soldier --acao ataque-espada
 *
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * O sprite view do mGBA exporta um PNG por OBJ, com o nome que voce digitar.
 * Uma pose de ataque costuma ser varios OBJs (corpo, arma, efeito), e uma
 * animacao tem varias poses -- vira uma pilha de arquivos soltos com nomes
 * improvisados em minutos.
 *
 * Este script poe cada um no lugar, numera em sequencia e registra o que veio
 * de onde. Nao converte nem redimensiona: o PNG indexado que o mGBA produz ja
 * e a arte final.
 *
 *
 * O DESTINO
 *
 *   assets/ffta/animacoes/<job>/<acao>/NN.png
 *   assets/ffta/animacoes/<job>/<acao>/index.json
 *
 * Os nomes de acao seguem os frame groups que o client ja implementa (ver a
 * skill frame-groups): idle, walk, attack, cast, hurt, die. Acoes mais
 * especificas (ataque-espada, ataque-arco) sao refinamento e podem ser
 * mapeadas para o grupo `attack` na hora de compilar.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const BASE = path.join(RAIZ, 'assets', 'ffta', 'animacoes');

/** Le largura/altura/bits do IHDR sem decodificar a imagem. */
function cabecalho(buf) {
  if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return {
    largura: buf.readUInt32BE(16),
    altura: buf.readUInt32BE(20),
    bits: buf[24],
    tipoCor: buf[25],
  };
}

function argumento(nome, padrao) {
  const i = process.argv.indexOf('--' + nome);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function main() {
  const job = argumento('job');
  const acao = argumento('acao');

  const entradas = process.argv.slice(2)
    .filter((a) => !a.startsWith('--'))
    .filter((a, i, arr) => {
      // descarta os valores que pertencem a um --flag anterior
      const anterior = process.argv[process.argv.indexOf(a) - 1];
      return !(anterior && anterior.startsWith('--'));
    });

  if (!job || !acao || !entradas.length) {
    console.error('uso: node tools/ffta-vram/coletar-sprites.js <png...> --job <job> --acao <acao>');
    console.error('');
    console.error('exemplo:');
    console.error('  node tools/ffta-vram/coletar-sprites.js tools/espadada.png \\');
    console.error('    --job soldier --acao ataque-espada');
    process.exit(1);
  }

  const destino = path.join(BASE, job, acao);
  fs.mkdirSync(destino, { recursive: true });

  // Continua a numeracao em vez de sobrescrever: a captura e incremental,
  // uma sessao de emulador por vez.
  const jaExistem = fs.readdirSync(destino).filter((f) => /^\d+\.png$/.test(f));
  let proximo = jaExistem.length
    ? Math.max(...jaExistem.map((f) => parseInt(f, 10))) + 1
    : 1;

  const registro = [];
  const indexPath = path.join(destino, 'index.json');
  if (fs.existsSync(indexPath)) {
    registro.push(...JSON.parse(fs.readFileSync(indexPath, 'utf8')).frames);
  }

  let copiados = 0;
  for (const entrada of entradas) {
    if (!fs.existsSync(entrada)) {
      console.error(`  ${entrada}: nao existe, pulado`);
      continue;
    }

    const buf = fs.readFileSync(entrada);
    const h = cabecalho(buf);
    if (!h) {
      console.error(`  ${entrada}: nao e PNG, pulado`);
      continue;
    }

    const nome = String(proximo).padStart(2, '0') + '.png';
    fs.writeFileSync(path.join(destino, nome), buf);

    registro.push({
      arquivo: nome,
      origem: path.basename(entrada),
      largura: h.largura,
      altura: h.altura,
      bits: h.bits,
    });

    console.log(`  ${nome}  ${h.largura}x${h.altura}  ${h.bits}bpp   <- ${path.basename(entrada)}`);
    proximo++;
    copiados++;
  }

  fs.writeFileSync(indexPath, JSON.stringify({
    job,
    acao,
    nota: 'Frames exportados do sprite view do mGBA. Uma pose costuma ser varios ' +
          'OBJs (corpo, arma, efeito) -- cada um e um arquivo. PNG indexado, como ' +
          'o emulador produziu; nao foi convertido.',
    frames: registro,
  }, null, 1));

  console.log(`\n${copiados} arquivo(s) em assets/ffta/animacoes/${job}/${acao}/`);
  console.log(`total acumulado: ${registro.length} frame(s)`);
}

main();
