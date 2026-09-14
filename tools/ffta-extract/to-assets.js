'use strict';
/*
 * to-assets.js -- leva o que foi extraido da ROM para assets/ffta/.
 *
 *   node tools/ffta-extract/to-assets.js [rom.gba]
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * A extracao (extract.js, extract-graphics.js) grava em tools/extracted/, que
 * e area de trabalho: dado cru, .bin intermediario, saida de experimento. O
 * jogo nao le de la.
 *
 * Este script e a ponte que faltava. Ele nao extrai nada de novo -- so
 * seleciona, normaliza e copia o que ja foi decodificado para assets/ffta/,
 * que e versionado e e a fonte para o resto do pipeline.
 *
 * A ROM em si (tools/rom.gba) NAO e versionada, por ser material comercial.
 * Quem clonar o repositorio recebe os dados derivados, nao a ROM.
 *
 *
 * O HEIGHT MAP E AS COLUNAS DE ENDERECO
 *
 * O stream de altura tem stride 16, mas as ultimas colunas NAO sao terreno:
 * contem enderecos. No mapa 0, a coluna 14 vai 32,64,96,128... de 32 em 32.
 * O RenderHeightMap.cs do FFTAUtils pula essas colunas com o comentario
 * "it's addresses, not values".
 *
 * Filtramos por "multiplo de 32 e >= 32", que e mais robusto do que exigir a
 * progressao exata +32 por linha -- o detector do extract-map-tiles.js usa a
 * progressao e falha em 4 mapas.
 */

const fs = require('fs');
const path = require('path');
const G = require('./gfx.js');

const RAIZ = path.resolve(__dirname, '..', '..');
const ROM = process.argv[2] || path.join(RAIZ, 'tools', 'rom.gba');
const EXTRACTED = path.join(RAIZ, 'tools', 'extracted');
const SAIDA = path.join(RAIZ, 'assets', 'ffta');

const MAP_BASE = 0x569104;
const MAP_REC = 0x58;
const MAP_COUNT = 163;

// Largura util do height map. As colunas 14 e 15 sao endereco (ver cabecalho).
const HM_STRIDE = 16;
const HM_COLUNAS_UTEIS = 14;

function escrever(rel, dado) {
  const destino = path.join(SAIDA, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const texto = JSON.stringify(dado, null, 1);
  fs.writeFileSync(destino, texto);
  console.log(`  ${rel}  ${(texto.length / 1024).toFixed(1)} KB`);
}

function lerExtraido(nome) {
  const p = path.join(EXTRACTED, nome);
  if (!fs.existsSync(p)) {
    throw new Error(
      `${nome} nao existe em tools/extracted/.\n` +
      '  Rode antes: node tools/ffta-extract/extract.js');
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ------------------------------------------------------------------ jobs

/*
 * So os jogaveis. Dos 116 registros da tabela, 60 sao das cinco racas
 * jogaveis (Hume, Bangaa, Nu Mou, Viera, Moogle); o resto e monstro, job de
 * inimigo e as duas entradas vazias do inicio.
 *
 * O spriteIndex vem junto de proposito: e o unico fio conhecido entre o job e
 * a arte dele na ROM. Nao resolve a sprite sozinho -- a indirecao ate o
 * grafico continua desconhecida --, mas quem for atras precisa dele a mao.
 */
function jobs() {
  const todos = lerExtraido('jobs.json');
  return todos
    .filter((j) => j.playable)
    .map((j) => ({
      index: j.index,
      name: j.name,
      race: j.race,
      spriteIndex: j.ids.spriteIndex,
      base: j.base,
      growth: j.growth,
      movement: j.movement,
      elementResist: j.elementResist,
      statusDefense: j.statusDefense,
      equippable: j.equippable,
      unlockRequirements: j.unlockRequirements,
      learnset: j.learnset,
    }));
}

// ------------------------------------------------------------ height maps

/** Descomprime o stream de altura de um registro de mapa. */
function lerHeightMap(rom, rec) {
  const off = (rom.readUInt32LE(rec + 0x10) + MAP_BASE) >>> 0;
  if (off >= rom.length) return null;
  try {
    // decompress devolve {type, data}; data e null no tipo 0x01 ("packed",
    // nao comprimido), que atinge 47 dos 163 mapas.
    const r = G.decompress(rom, off);
    return r && r.data ? r.data : null;
  } catch (e) {
    return null;
  }
}

/*
 * Devolve a grade de alturas de um mapa, ja sem as colunas de endereco.
 *
 * Formato: 4 bytes de cabecalho, depois [u8 altura][u8 flag] por celula.
 * A altura real usa so os 5 bits baixos -- sao 32 niveis (0..31), medido em
 * 25.936 celulas de 159 mapas.
 */
function gradeDeAlturas(buf) {
  if (!buf || buf.length < 4) return null;

  const celulas = (buf.length - 4) / 2;
  const linhas = Math.floor(celulas / HM_STRIDE);
  if (linhas <= 0) return null;

  const grade = [];
  for (let y = 0; y < linhas; y++) {
    const linha = [];
    for (let x = 0; x < HM_COLUNAS_UTEIS; x++) {
      const o = 4 + (y * HM_STRIDE + x) * 2;
      const v = buf[o];
      // Endereco vazando: multiplo de 32 e >= 32. Nao e altura.
      linha.push(v >= 32 && v % 32 === 0 ? null : (v & 31));
    }
    grade.push(linha);
  }
  return grade;
}

function heightMaps(rom) {
  const mapas = [];
  let ok = 0, falhou = 0;

  for (let i = 0; i < MAP_COUNT; i++) {
    const grade = gradeDeAlturas(lerHeightMap(rom, MAP_BASE + i * MAP_REC));
    if (!grade) {
      mapas.push({ index: i, decodificado: false });
      falhou++;
      continue;
    }

    const planas = grade.flat().filter((v) => v !== null);
    mapas.push({
      index: i,
      decodificado: true,
      largura: HM_COLUNAS_UTEIS,
      altura: grade.length,
      min: Math.min(...planas),
      max: Math.max(...planas),
      grade,
    });
    ok++;
  }

  console.log(`  height maps: ${ok} decodificados, ${falhou} nao`);
  return {
    nota: 'Altura por celula dos mapas do FFTA. 32 niveis (0..31); 1 unidade = 8px na tela. ' +
          'As colunas 14 e 15 do stream original sao endereco, nao terreno, e foram removidas. ' +
          'null numa celula = valor descartado por parecer endereco.',
    colunasUteis: HM_COLUNAS_UTEIS,
    mapas,
  };
}

// --------------------------------------------------------------- tilesets

/*
 * Copia os tilesets em PNG e monta o indice mapa -> arquivo.
 *
 * Varios mapas compartilham o mesmo tileset: sao 163 mapas para 50 tilesets
 * distintos. O extract-graphics.js grava uma vez so, nomeando pelo PRIMEIRO
 * mapa que usa aquele stream -- por isso o mapa 150 (Aisenfield) e servido
 * por map147.png. Sem este indice nao ha como saber disso.
 */
function tilesets() {
  const origem = path.join(EXTRACTED, 'graphics', 'tileset-png');
  if (!fs.existsSync(origem)) {
    throw new Error(
      'tools/extracted/graphics/tileset-png nao existe.\n' +
      '  Rode antes: node tools/ffta-extract/extract-graphics.js');
  }

  const destino = path.join(SAIDA, 'maps', 'tilesets');
  fs.mkdirSync(destino, { recursive: true });

  let copiados = 0;
  for (const f of fs.readdirSync(origem).filter((f) => f.endsWith('.png'))) {
    fs.copyFileSync(path.join(origem, f), path.join(destino, f));
    copiados++;
  }
  console.log(`  ${copiados} tilesets copiados`);

  return copiados;
}

/** Para cada mapa, qual arquivo de tileset o serve. */
function indiceDeTilesets(rom) {
  const dir = path.join(SAIDA, 'maps', 'tilesets');
  const primeiroPorOffset = new Map();
  const porMapa = [];
  let semArte = 0;

  for (let i = 0; i < MAP_COUNT; i++) {
    const off = (rom.readUInt32LE(MAP_BASE + i * MAP_REC) + MAP_BASE) >>> 0;
    if (!primeiroPorOffset.has(off)) primeiroPorOffset.set(off, i);
    const dono = primeiroPorOffset.get(off);
    const arquivo = `map${String(dono).padStart(3, '0')}.png`;

    /*
     * Nem todo registro rende PNG. O mapa 162 aponta para um stream com byte
     * de tipo 0x9b, que nao e nenhum dos formatos conhecidos (0x01/0x10/0x11/
     * 0x12/0x20/0x22) -- e o ultimo registro da tabela e provavelmente lixo.
     *
     * Apontar para um arquivo que nao existe seria pior do que dizer que nao
     * ha arte: quem consumir o indice quebraria num ENOENT longe daqui.
     */
    const existe = fs.existsSync(path.join(dir, arquivo));
    if (!existe) semArte++;

    porMapa.push({
      index: i,
      tileset: existe ? arquivo : null,
      compartilhadoCom: dono === i ? null : dono,
    });
  }

  if (semArte) console.log(`  ${semArte} mapa(s) sem tileset decodificavel`);

  return {
    nota: 'Qual arquivo de tileset serve cada mapa. Varios mapas compartilham o mesmo ' +
          'stream de graficos, e o arquivo leva o numero do PRIMEIRO mapa que o usa -- ' +
          'por isso o mapa 150 (Aisenfield) e servido por map147.png. ' +
          'tileset null = o stream nao descomprime com nenhum formato conhecido.',
    mapas: porMapa,
  };
}

// ------------------------------------------------------------------ main

function main() {
  if (!fs.existsSync(ROM)) {
    console.error(`ROM nao encontrada em ${ROM}`);
    console.error('A ROM nao e versionada (material comercial). Ponha-a em tools/rom.gba.');
    process.exit(1);
  }

  const rom = fs.readFileSync(ROM);
  fs.mkdirSync(SAIDA, { recursive: true });

  console.log('dados de jogo:');
  const jogaveis = jobs();
  escrever('jobs.json', jogaveis);
  console.log(`  ${jogaveis.length} jobs jogaveis`);

  escrever('abilities.json', lerExtraido('abilities.json'));
  escrever('items.json', lerExtraido('items.json'));

  console.log('mapas:');
  escrever('maps/heightmaps.json', heightMaps(rom));
  tilesets();
  escrever('maps/tilesets.json', indiceDeTilesets(rom));

  console.log(`\nassets/ffta/ populado a partir de ${path.basename(ROM)}.`);
}

main();
