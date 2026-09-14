'use strict';
/*
 * varrer.js -- processa uma sequencia de despejos feita pelo dump-frames.lua.
 *
 *   node tools/ffta-vram/varrer.js <pasta-com-os-frames> [--2d]
 *
 *
 * O PROBLEMA QUE ELE RESOLVE
 *
 * O dump-frames.lua grava um despejo por frame, entao uma habilidade de tres
 * segundos vira ~180 pastas. Rodar o vram-rip em cada uma a mao e inviavel, e
 * abrir 180 folhas para achar onde o efeito aparece, pior ainda.
 *
 * Este script roda tudo e, mais importante, DIZ QUAIS FRAMES INTERESSAM:
 * compara a OBJ VRAM de cada frame com a do anterior e marca onde ela mudou
 * muito. O efeito de uma habilidade e exatamente isso -- graficos novos
 * entrando na VRAM e saindo logo depois.
 *
 * Sem essa pista voce olharia 180 pastas iguais procurando as 6 diferentes.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RIP = path.join(__dirname, 'vram-rip.js');

/** Quantos bytes diferem entre dois buffers, em fracao do total. */
function diferenca(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n / a.length;
}

/** Quantos bytes nao-zero tem o buffer -- VRAM vazia e cena sem sprite. */
function ocupacao(b) {
  let n = 0;
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) n++;
  return n / b.length;
}

function main() {
  const raiz = process.argv[2];
  const doisD = process.argv.includes('--2d');

  if (!raiz || !fs.existsSync(raiz)) {
    console.error('uso: node tools/ffta-vram/varrer.js <pasta-com-os-frames> [--2d]');
    process.exit(1);
  }

  const frames = fs.readdirSync(raiz)
    .filter((f) => fs.existsSync(path.join(raiz, f, 'objvram.bin')))
    .sort();

  if (!frames.length) {
    console.error(`nenhum frame em ${raiz}`);
    console.error('  esperava subpastas com objvram.bin -- e o que o dump-frames.lua grava.');
    process.exit(1);
  }

  console.log(`${frames.length} frames em ${path.basename(raiz)}\n`);

  // Primeira passada: onde a VRAM muda.
  const analise = [];
  let anterior = null;
  for (const f of frames) {
    const vram = fs.readFileSync(path.join(raiz, f, 'objvram.bin'));
    analise.push({
      nome: f,
      mudou: diferenca(anterior, vram),
      ocupado: ocupacao(vram),
    });
    anterior = vram;
  }

  /*
   * O limiar e relativo, nao absoluto: numa batalha parada a VRAM muda uns
   * poucos por cento por frame (animacao de idle), e o efeito entrando muda
   * muito mais. Comparar com a mediana separa os dois sem eu ter que adivinhar
   * um numero que sirva para toda habilidade.
   */
  const mudancas = analise.map((a) => a.mudou).slice(1).sort((a, b) => a - b);
  const mediana = mudancas[Math.floor(mudancas.length / 2)] || 0;
  const limiar = Math.max(mediana * 3, 0.02);

  const interessantes = analise.filter((a, i) => i > 0 && a.mudou > limiar);

  console.log(`mudanca mediana por frame: ${(mediana * 100).toFixed(1)}%`);
  console.log(`limiar: ${(limiar * 100).toFixed(1)}%`);
  console.log(`frames com mudanca grande: ${interessantes.length}\n`);

  if (interessantes.length) {
    console.log('FRAMES QUE INTERESSAM:');
    for (const a of interessantes.slice(0, 20)) {
      console.log(`  ${a.nome}   mudou ${(a.mudou * 100).toFixed(1)}%   VRAM ${(a.ocupado * 100).toFixed(0)}% ocupada`);
    }
    if (interessantes.length > 20) console.log(`  ... e mais ${interessantes.length - 20}`);
    console.log();
  }

  // Segunda passada: extrai. So os interessantes, ou todos se nada se
  // destacou (habilidade que nao mexeu na VRAM, ou captura curta demais).
  const extrair = interessantes.length ? interessantes : analise;
  console.log(`extraindo ${extrair.length} frame(s)...`);

  let ok = 0, erro = 0;
  for (const a of extrair) {
    const dir = path.join(raiz, a.nome);
    try {
      // O vram-rip le argv[2] como pasta de saida, entao o --2d precisa vir
      // DEPOIS de um destino explicito -- passa-lo na posicao 2 faria o
      // script criar uma pasta chamada "--2d".
      const args = [RIP, dir, path.join(dir, 'out')];
      if (doisD) args.push('--2d');
      execFileSync(process.execPath, args, { stdio: 'pipe' });
      ok++;
    } catch (e) {
      erro++;
    }
  }

  console.log(`\n${ok} extraido(s), ${erro} com erro`);
  if (ok) {
    console.log(`\nOlhe as folhas em ${path.join(raiz, extrair[0].nome, 'out', 'folhas')}`);
    console.log('As folhas valem mesmo quando a OAM pegou a cena errada.');
  }
}

main();
