'use strict';
/*
 * Extrai a tabela de equipamentos do FFTA2 para tools/extracted-ffta2/.
 *
 *
 * ESTA TABELA NAO ESTA DOCUMENTADA
 *
 * O ROM map da a FAIXA da Equipment Data (412 entradas de 0x28) mas nao diz o
 * que sao os campos -- ao contrario de Job Data e Ability Data. Os campos aqui
 * foram deduzidos e cada um esta validado por uma propriedade que so seria
 * verdadeira se a leitura estivesse certa:
 *
 *   0x0E  preco de compra
 *   0x10  preco de venda
 *         Validacao: venda == compra/2 em 382 das 411 entradas com preco
 *         (92,9%). As excecoes sao itens especiais/nao vendaveis.
 *
 *   0x13  ataque
 *         Validacao: cresce junto com o preco dentro da mesma categoria.
 *         Nas facas: Jackknife 160g/22, Kard 360g/27, Scramasax 500g/30,
 *         Rondel 600g/33, Khukuri 1200g/34, Swordbreaker 1850g/37,
 *         Orichalcum Dirk 3200g/40, Cinquedea 5200g/42, Jambiya 10800g/43.
 *         E os itens mais caros (Genji Gloves, Fortune Ring, Magick Ring, a
 *         25500g) tem ataque ZERO -- sao acessorios, exatamente como deveria.
 *
 *   0x0D  tipo de equipamento
 *         Validacao: os valores formam blocos CONTIGUOS que batem com as
 *         categorias do jogo -- 0x0B sao as 14 facas, 0x0C as 49 espadas,
 *         0x10 as lancas, 0x11 as varas, 0x14 os arcos, e assim por diante.
 *         Armaduras e acessorios ficam em 0x00.
 *
 * Os bytes ainda nao identificados saem em `raw`, em hexadecimal, para nao
 * fingir conhecimento que nao temos.
 *
 *
 * NOMES
 *
 * Vem da tabela de texto que comeca em "Jackknife", com o casamento
 * `equipamento[i] -> nome[i-1]` (a entrada 0 e placeholder zerado). O mesmo
 * teste de ataque-versus-preco acima confirma o alinhamento: se estivesse
 * deslocado, a progressao das facas nao fecharia.
 *
 * Leitura apenas -- a ROM nao e modificada.
 */

const fs = require('fs');
const path = require('path');
const { TABELAS, DELTA_EU } = require('./extract-jobs');
const { decodeString, ehLetra } = require('./extract-strings');

const ROM = path.resolve(__dirname, '../ffta2.nds');
const OUT = path.resolve(__dirname, '../extracted-ffta2');

/*
 * Categorias observadas em 0x0D. Os rotulos vem de olhar quais itens caem em
 * cada bloco -- nao de documentacao. Por isso o valor cru tambem e mantido.
 */
const TIPO = {
  0x00: 'Armadura/Acessorio', 0x0b: 'Faca', 0x0c: 'Espada', 0x0d: 'Lamina',
  0x0e: 'Katana', 0x0f: 'Rapieira', 0x10: 'Lanca', 0x11: 'Vara',
  0x12: 'Bastao', 0x13: 'Punho', 0x14: 'Arco', 0x15: 'Arco grande',
  0x16: 'Instrumento', 0x18: 'Arma de fogo', 0x1a: 'Machado',
  0x1b: 'Martelo/Maca', 0x1c: 'Carta', 0x1e: 'Livro',
};

function codificar(s) {
  return Buffer.from([...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if (ch === ' ') return 0x01;
    if (c >= 65 && c <= 90) return 0x02 + c - 65;
    return 0x1c + c - 97;
  }));
}

function lerNomes(buf, quantos) {
  const inicio = buf.indexOf(codificar('Jackknife'));
  if (inicio < 0) return [];
  const out = [];
  for (let o = inicio; o < buf.length && out.length < quantos; o++) {
    if (!ehLetra(buf[o])) continue;
    const r = decodeString(buf, o, 2);
    if (!r || r.texto.length < 1) continue;
    out.push(r.texto);
    o = r.fim - 1;
  }
  return out;
}

function main() {
  const buf = fs.readFileSync(ROM);
  const t = TABELAS.equipmentData;
  const inicio = t.us + DELTA_EU;
  const nomes = lerNomes(buf, t.entradas + 16);

  const itens = [];
  for (let i = 0; i < t.entradas; i++) {
    const o = inicio + i * t.entrada;
    const tipo = buf[o + 0x0d];
    const compra = buf.readUInt16LE(o + 0x0e);
    const venda = buf.readUInt16LE(o + 0x10);
    itens.push({
      index: i,
      offset: o,
      name: i === 0 ? null : (nomes[i - 1] || null),
      type: tipo,
      typeName: TIPO[tipo] || `0x${tipo.toString(16)}`,
      buyPrice: compra,
      sellPrice: venda,
      attack: buf[o + 0x13],
      raw: Buffer.from(buf.subarray(o, o + t.entrada)).toString('hex'),
    });
  }

  // --- validacoes, impressas para nao virarem fe
  const comPreco = itens.filter((x) => x.buyPrice > 0);
  const metade = comPreco.filter((x) => x.sellPrice === Math.floor(x.buyPrice / 2)).length;

  const porTipo = {};
  for (const x of itens) porTipo[x.typeName] = (porTipo[x.typeName] || 0) + 1;

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'equipment.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: `ffta2.nds @ 0x${inicio.toString(16)} (ROM map US + 0x${DELTA_EU.toString(16)})`,
    note: 'Campos deduzidos: o ROM map da a faixa mas nao o layout. Ver cabecalho de extract-equipment.js para as validacoes.',
    count: itens.length,
    byType: porTipo,
    items: itens,
  }, null, 2));

  console.log(`equipment.json  ${itens.length} entradas de 0x${inicio.toString(16)}`);
  console.log(`nomes lidos: ${nomes.length}`);
  console.log('');
  console.log('--- validacao ---');
  console.log(`  venda == compra/2 em ${metade}/${comPreco.length} (${(100 * metade / comPreco.length).toFixed(1)}%)`);
  const semNome = itens.filter((x) => x.index > 0 && !x.name).length;
  console.log(`  entradas sem nome: ${semNome}`);
  console.log('');
  console.log('por tipo:');
  for (const [k, v] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}x  ${k}`);
  }
}

if (require.main === module) main();
