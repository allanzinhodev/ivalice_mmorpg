# ffta2-extract — extração de dados do Final Fantasy Tactics A2 (Nintendo DS)

Equivalente, para o FFTA2, do que `tools/ffta-extract/` faz para o FFTA1. A ROM
(`tools/ffta2.nds`) **não é versionada** (`.gitignore`: `*.nds`) e **nunca é
modificada** — tudo aqui é leitura.

## Como rodar

```
node tools/ffta2-extract/scan.js               # 1. mapeia o cartucho
node tools/ffta2-extract/find-tables.js        # 2. acha as tabelas por assinatura
node tools/ffta2-extract/extract-jobs.js       # 3. jobs (com nomes)
node tools/ffta2-extract/extract-abilities.js  #    habilidades e conjuntos
node tools/ffta2-extract/extract-equipment.js  #    equipamentos
node tools/ffta2-extract/extract-strings.js    #    tabelas de texto
```

Saída em `tools/extracted-ffta2/`.

## O que já saiu

| arquivo | conteúdo |
|---|---|
| `rom-info.json` | cabeçalho, hashes, região |
| `filelist.json` | os 37 arquivos do cartucho, com magic e palpite |
| `tables.json` | as 7 tabelas, com endereço já corrigido para esta ROM |
| `jobs.json` | **163 jobs** com nome, raça, stats, afinidades, movimento, equipáveis e conjunto de habilidades |
| `abilities.json` | **822 habilidades** com nome, elemento, MP, alcance, alvo, efeitos e propriedades |
| `ability-sets.json` | 96 conjuntos com nome e faixa de habilidades |
| `ability-table.json` | 722 entradas de AP para dominar |
| `equipment.json` | **412 equipamentos** com nome, tipo, preços e ataque |
| `text-tables.json` | tabelas de texto: jobs, conjuntos, itens/habilidades, áreas, missões |

## As três descobertas que destravaram isso

### 1. O ROM map publicado é de outra versão

Os endereços que circulam para o FFTA2 são da versão **americana**. Esta ROM é a
**europeia** (`FFTA2-EU`, gameCode `A6FP`), e no endereço publicado do Job Data
só 5–30% dos campos caem no domínio documentado — ruído, não dado.

As tabelas existem, deslocadas de **+0x200**. O delta foi **achado**, não
chutado: `find-tables.js` varre a ROM procurando a *assinatura da estrutura* —
os 8 bytes de afinidade elemental que só podem valer 0–4, mais move/stand/gender
com domínio estreito. Só o domínio deu 111 candidatos (região zerada passa em
qualquer limite), então o filtro exige **conteúdo**: as 7 raças jogáveis, os 3
gêneros, afinidade que varia. Sobrou **um**, exatamente a 0x200 do publicado.

A validação fecha por quatro lados independentes: domínio 100%; as 11 primeiras
entradas todas Hume com ability set numerado 1,2,3…11; a contagem por raça
batendo com o jogo (Seeq 4, Gria 4); e o equipamento decodificado dando
Soldier, Thief, White Mage, Black Mage, Archer, Paladin na ordem canônica.

### 2. O texto usa alfabeto próprio, achado sem chutar

Não há texto legível: "Soldier" em ASCII e UTF-16 dá zero, e procurar dentro dos
25 mil blocos LZ77 descomprimidos também.

A saída foi buscar de forma **invariante a deslocamento**: numa codificação
aditiva, as *diferenças* entre letras consecutivas não dependem da base, então
"oldier" vira o padrão `[-3,-8,+5,-4,+13]`, que se acha sem saber nada. Dez
palavras casaram e **todas** apontaram a mesma base.

```
0x01         espaço
0x02 .. 0x1B  A .. Z
0x1C .. 0x35  a .. z
```

### 3. As três tabelas de habilidade são uma indireção

Ignorar isso produz dado silenciosamente errado, e foi o erro mais perigoso
desta extração — porque *parecia* certo.

O Ability Set **não** aponta para a Ability Data. Ele aponta para a Ability
**Table**, e é a Table que traduz para o índice da Data:

```
Set [first..last]  ->  Table[i].ability  ->  Data[j]
```

Como apareceu: casando nome com Data direto, os nomes saíam certos (First Aid,
Rend Power, Cure, Fire…) mas a mecânica não — "Fire" com elemento Neutral e MP
zero, "Cure" com elemento Thunder. Nome certo e dado errado é justamente o tipo
de defeito que passa numa revisão superficial.

A trinca Fire/Fira/Firaga é reconhecível na Data pelo padrão (elemento Fire, MP
8/14/18, raio 5) e está em 63/64/65, enquanto o set Black Magick diz 76..84. A
Table fecha a conta: `Table[76].ability == 63`.

Depois de resolver a indireção tudo bate com o jogo: Fire/Fira/Firaga com MP
8/14/18 e AP 10/25/35, Thunder e Blizzard nos seus elementos, e Cure como
elemento **Holy** — que é o correto no FFTA2.

### 4. Os campos indocumentados saem por validação, não por fé

O ROM map documenta Job Data e Ability Data, mas **não** a Equipment Data. Cada
campo deduzido tem uma propriedade que só seria verdadeira se a leitura
estivesse certa:

- **preço**: venda == compra/2 em 92,9% das entradas
- **ataque**: cresce com o preço dentro da categoria (Jackknife 160g/22 →
  Jambiya 10800g/43), e os itens mais caros do jogo (Genji Gloves, Fortune Ring,
  a 25500g) têm ataque **zero**, porque são acessórios
- **tipo**: os valores formam blocos contíguos que batem com as categorias —
  0x0B são as 14 facas, 0x0C as 49 espadas, e assim por diante

O mesmo critério vale para os bits de propriedade das habilidades: o bit
"mágico" acende em 90% das que custam MP e 3% das que não custam, o que
**confirma a ordem LSB-first** em vez de assumi-la. (O ROM map chama de "big
endian binary array", mas o exemplo que ele mesmo dá desmente: escreve
`84 00 00 EC 0E` como `00100001 …`, e 0x84 é `10000100`.)

## O que continua fechado: gráficos

Sprites e tiles **não** saíram, e o motivo está documentado em
[DUMP-VRAM.md](DUMP-VRAM.md). Resumo:

- Praticamente todo o jogo está em `/master/pc.bin` (86,5 MB, 67% do cartucho),
  indexado pelo `pc.idx` — container proprietário que não cedeu a força bruta.
- O formato gráfico também é próprio: **zero** NCGR/NCLR/NCER/NANR/NSCR/BMD0 na
  ROM inteira.
- Há 22.964 blocos LZ77 válidos, mas nenhum é imagem em 4/8bpp, tiles ou linear.
  E não é bug do descompressor — ele foi conferido linha a linha contra o LZ77
  já validado do FFTA1 em `tools/ffta-extract/gfx.js`.

O caminho escolhido é **não decodificar**: o hardware do DS não entende formato
próprio, então o jogo é obrigado a converter para tile 4bpp/8bpp e paleta RGB555
na VRAM. Rodar no DeSmuME, despejar VRAM/paleta/OAM e montar os PNGs com
`vram-rip.js`. Instruções em [DUMP-VRAM.md](DUMP-VRAM.md).

O áudio, ao contrário do gráfico, **é** formato padrão: 214 SDAT com SWAR/SBNK e
37 SSEQ, todos localizáveis por magic dentro do `pc.bin`, sem depender do índice.

## Arquivos

| script | o que faz |
|---|---|
| `nds.js` | NitroROM: cabeçalho, FAT, FNT, NARC, classificação por magic |
| `scan.js` | passo 1 — mapeia o cartucho |
| `find-tables.js` | acha tabelas pela assinatura da estrutura |
| `extract-jobs.js` | jobs + nomes + conjuntos |
| `extract-abilities.js` | habilidades, conjuntos, tabela de AP |
| `extract-equipment.js` | equipamentos |
| `extract-strings.js` | decodificador de texto e tabelas |
| `find-lz77.js` | descompressor LZ77 verificado |
| `render-tiles.js` | renderiza blocos em 4/8bpp (PNG em zlib puro, sem dependência) |
| `vram-rip.js` | monta PNGs a partir de despejos do DeSmuME |
