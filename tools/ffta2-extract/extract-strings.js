'use strict';
/*
 * Decodifica o texto do FFTA2 e varre a ROM atras de todas as strings.
 *
 *
 * COMO O ALFABETO FOI DESCOBERTO
 *
 * Nao ha texto legivel na ROM: busca por "Soldier" em ASCII e em UTF-16 da
 * zero, e procurar dentro dos 25 mil blocos LZ77 descomprimidos tambem da
 * zero. O texto usa codificacao propria, como no FFTA1 (ver ffta.js, onde
 * 'A'=0xB0 e 'a'=0xCA).
 *
 * Mas o deslocamento do FFTA2 e outro, e adivinhar ia custar caro. A saida foi
 * procurar de forma INVARIANTE A DESLOCAMENTO: numa codificacao aditiva
 * (byte = base + letra), as DIFERENCAS entre letras consecutivas nao dependem
 * da base. Entao "oldier" vira o padrao [-3,-8,+5,-4,+13], que se acha sem
 * saber nada sobre a base.
 *
 * Dez palavras de job (oldier, aladin, ighter, ummoner, lchemist, ssassin,
 * erserker, ragoon, llusionist, eomancer) casaram, e TODAS apontaram a mesma
 * base: 'a' = 0x1C. Isso encaixa exato -- A-Z ocupa 0x02..0x1B, que sao 26
 * valores, e a-z comeca logo em seguida, em 0x1C.
 *
 * Confirmado decodificando: sai "The one you seek is... a soldier".
 *
 *
 * O MAPA
 *
 *   0x01         espaco
 *   0x02 .. 0x1B  A .. Z
 *   0x1C .. 0x35  a .. z
 *   0x36 .. 0x3F  0 .. 9   (deduzido pela continuidade; conferir em numeros)
 *   0x73          fim de frase / terminador
 *   0xC0 0xC1 0xC2  codigos de controle de dois bytes (quebra, pausa, ...)
 *
 * Byte desconhecido sai como \xHH, para nao inventar texto que nao existe.
 */

const fs = require('fs');
const path = require('path');

const ROM = path.resolve(__dirname, '../ffta2.nds');
const OUT = path.resolve(__dirname, '../extracted-ffta2');

const ESPACO = 0x01;
const MAI_INI = 0x02, MAI_FIM = 0x1b;
const MIN_INI = 0x1c, MIN_FIM = 0x35;
const DIG_INI = 0x36, DIG_FIM = 0x3f;

/** Um byte que faz parte de texto legivel. */
function ehLetra(b) {
  return (b >= MAI_INI && b <= MAI_FIM) || (b >= MIN_INI && b <= MIN_FIM);
}

function decodeByte(b) {
  if (b === ESPACO) return ' ';
  if (b >= MAI_INI && b <= MAI_FIM) return String.fromCharCode(65 + b - MAI_INI);
  if (b >= MIN_INI && b <= MIN_FIM) return String.fromCharCode(97 + b - MIN_INI);
  if (b >= DIG_INI && b <= DIG_FIM) return String.fromCharCode(48 + b - DIG_INI);
  return null;
}

/**
 * Decodifica a partir de `off` ate encontrar byte que nao seja texto.
 * Devolve null se for curto demais para valer.
 */
function decodeString(buf, off, minLetras = 3) {
  let s = '';
  let letras = 0;
  let p = off;
  while (p < buf.length) {
    const c = decodeByte(buf[p]);
    if (c === null) break;
    if (ehLetra(buf[p])) letras++;
    s += c;
    p++;
  }
  if (letras < minLetras) return null;
  return { texto: s.trim(), fim: p, letras };
}

/*
 * So o alfabeto nao basta para separar texto de ruido: os bytes 0x01..0x3F
 * sao valores pequenos, comuns em qualquer dado binario. Uma varredura sem
 * filtro devolve mais de um milhao de "strings", quase todas lixo.
 *
 * O que separa de verdade e a ESTATISTICA DO INGLES:
 *   - texto real e predominantemente minusculo (maiuscula so inicia palavra);
 *   - a proporcao de vogais fica em torno de 35-40%;
 *   - nao existem corridas longas de consoante.
 * Os tres juntos derrubam o ruido praticamente todo.
 */
function pareceIngles(s) {
  const letras = s.replace(/[^A-Za-z]/g, '');
  if (letras.length < 4) return false;

  const min = (letras.match(/[a-z]/g) || []).length;
  if (min / letras.length < 0.6) return false; // maiuscula demais = ruido

  const vogais = (letras.match(/[aeiouAEIOU]/g) || []).length;
  const taxa = vogais / letras.length;
  if (taxa < 0.2 || taxa > 0.6) return false;

  if (/[bcdfghjklmnpqrstvwxz]{5}/i.test(letras)) return false; // 5 consoantes seguidas

  return true;
}

function codificar(s) {
  return Buffer.from([...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if (ch === ' ') return 0x01;
    if (c >= 65 && c <= 90) return 0x02 + c - 65;
    return 0x1c + c - 97;
  }));
}

/**
 * Extrai as TABELAS de texto, que e o que interessa -- varrer a ROM inteira
 * devolve meio milhao de falsos positivos, porque os bytes 0x01..0x3F sao
 * valores pequenos e comuns em dado binario qualquer.
 *
 * As tabelas ficam todas num bloco continuo. Ancoramos em "First Aid", que e
 * a unica string realmente unica na ROM (ancorar em "Potion" nao funciona --
 * ela aparece 7 vezes), e a partir dai separamos as tabelas pelas LACUNAS:
 * dentro de uma tabela as strings sao coladas, e entre tabelas ha centenas ou
 * milhares de bytes de outra coisa.
 */
function extrairTabelas(buf) {
  const ancora = buf.indexOf(codificar('First Aid'));
  if (ancora < 0) return [];

  const ini = Math.max(0, ancora - 0x4000);
  const fim = Math.min(buf.length, ancora + 0x10000);

  const itens = [];
  for (let o = ini; o < fim; o++) {
    if (!ehLetra(buf[o])) continue;
    const r = decodeString(buf, o, 2);
    if (!r || r.texto.length < 2) continue;
    itens.push({ offset: o, text: r.texto });
    o = r.fim - 1;
  }

  // Quebra em tabelas onde a lacuna passa de 48 bytes.
  const tabelas = [];
  let atual = [];
  for (let i = 0; i < itens.length; i++) {
    if (i > 0) {
      const anterior = itens[i - 1];
      const lacuna = itens[i].offset - anterior.offset - anterior.text.length;
      if (lacuna > 48 && atual.length) { tabelas.push(atual); atual = []; }
    }
    atual.push(itens[i]);
  }
  if (atual.length) tabelas.push(atual);

  /*
   * Entre as tabelas reais aparecem "tabelas" de duas letras (BO, DO, FO...):
   * sao bytes de outra natureza que por acaso caem no alfabeto. Uma tabela de
   * verdade tem nomes, entao exigimos comprimento medio razoavel e que a
   * maioria das entradas tenha 3+ caracteres.
   */
  return tabelas.filter((t) => {
    if (t.length < 10) return false;
    const medio = t.reduce((s, x) => s + x.text.length, 0) / t.length;
    const longas = t.filter((x) => x.text.length >= 3).length / t.length;
    return medio >= 4 && longas >= 0.6;
  });
}

/** Rotula a tabela pelo que ela contem, para o JSON sair legivel. */
function rotular(t) {
  const textos = t.map((x) => x.text);
  const tem = (s) => textos.includes(s);
  if (tem('Soldier') && tem('Thief')) return 'jobNames';
  if (tem('Arts of War') && tem('Thievery')) return 'abilitySetNames';
  if (tem('First Aid') || tem('Cure')) return 'itemAndAbilityNames';
  if (tem('Targ Wood') || tem('Camoa')) return 'areaNames';
  // Missao tem titulo longo com varias palavras; nome de unidade nao.
  const multiPalavra = textos.filter((s) => s.split(' ').length >= 3).length / textos.length;
  if (multiPalavra > 0.3) return 'missionNames';
  const medio = textos.reduce((s, x) => s + x.length, 0) / textos.length;
  if (medio < 10) return 'unitNames';
  return `tabela_${t[0].offset.toString(16)}`;
}

function main() {
  const minLetras = Number(process.argv[2] || 4);
  const buf = fs.readFileSync(ROM);

  // --- tabelas de texto (o entregavel util)
  const tabelas = extrairTabelas(buf);
  const porNome = {};
  for (const t of tabelas) {
    let nome = rotular(t);
    let n = 2;
    while (porNome[nome]) nome = `${rotular(t)}_${n++}`;
    porNome[nome] = { offset: `0x${t[0].offset.toString(16)}`, count: t.length, strings: t.map((x) => x.text) };
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'text-tables.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: 'Alfabeto proprio: 0x01 espaco, 0x02-0x1B A-Z, 0x1C-0x35 a-z. Ver cabecalho de extract-strings.js.',
    tables: porNome,
  }, null, 2));

  console.log('=== tabelas de texto ===');
  for (const [nome, v] of Object.entries(porNome)) {
    console.log(`  ${nome.padEnd(22)} ${String(v.count).padStart(4)} strings  em ${v.offset}`);
    console.log(`     ${v.strings.slice(0, 4).join(' | ')} ... ${v.strings.slice(-2).join(' | ')}`);
  }
  console.log('');

  if (process.argv[3] !== '--tudo') {
    console.log('text-tables.json escrito. use --tudo para tambem varrer a ROM inteira (ruidoso).');
    return;
  }

  const strings = [];
  for (let off = 0; off < buf.length; off++) {
    if (!ehLetra(buf[off])) continue;
    const r = decodeString(buf, off, minLetras);
    if (!r) { continue; }
    if (!pareceIngles(r.texto)) continue;
    strings.push({ offset: off, text: r.texto });
    off = r.fim - 1;
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'strings.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Alfabeto proprio do FFTA2: 0x01 espaco, 0x02-0x1B A-Z, 0x1C-0x35 a-z. Ver cabecalho de extract-strings.js.",
    minLetters: minLetras,
    count: strings.length,
    strings,
  }, null, 2));

  console.log(`strings.json  ${strings.length} strings (min ${minLetras} letras)`);

  // Agrupa por regiao de 64KB, para revelar onde estao as tabelas.
  const regioes = new Map();
  for (const s of strings) {
    const r = s.offset >> 16;
    if (!regioes.has(r)) regioes.set(r, { n: 0, ini: s.offset });
    regioes.get(r).n++;
  }
  const top = [...regioes.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  console.log('\nregioes com mais texto (blocos de 64KB):');
  for (const [r, v] of top) {
    console.log(`  0x${(r << 16).toString(16).padStart(8, '0')}  ${String(v.n).padStart(6)} strings`);
  }

  // Strings curtas, que e onde moram nomes de job/item/habilidade.
  const curtas = strings.filter((s) => s.text.length >= 4 && s.text.length <= 20 && !s.text.includes('  '));
  console.log(`\nstrings curtas (4-20 chars): ${curtas.length}`);
  console.log('amostra:');
  for (const s of curtas.slice(0, 25)) {
    console.log(`  0x${s.offset.toString(16).padStart(8, '0')}  ${s.text}`);
  }
}

if (require.main === module) main();
module.exports = { decodeByte, decodeString, ehLetra };
