# O container `pc.bin` / `pc.idx` — o que se sabe e o que já foi descartado

Este é o obstáculo que resta no FFTA2. Praticamente todo o conteúdo do jogo
está em `/master/pc.bin` (86.510.888 bytes, 67% do cartucho), indexado por
`/master/pc.idx` (20.424 bytes). **Enquanto o índice não ceder, sprites, tiles
e mapas ficam inacessíveis por análise estática.**

Este documento existe para a próxima tentativa não repetir o que já falhou.

## O que está estabelecido

**O índice não está comprimido nem cifrado.** Entropia de **4,37 bits/byte**,
com **53,6% de bytes zero** e os 256 valores presentes. Dado comprimido daria
perto de 8,0. Ou seja: é estrutura legível, e o problema é só descobrir o
layout.

**Há periodicidade de 3 bytes.** Autocorrelação da máscara de zeros (que não
sofre o viés da entropia por coluna, onde período maior sempre "ganha") dá
picos em lag 3, 15, 18, 27, 45, 69, 72, 84, 99, 126 — quase todos múltiplos de
3, com o 3 sendo o fundamental. Os dois maiores picos absolutos são 99
(+17,1 pontos) e 23 (+14,2).

**As primeiras entradas parecem 9 bytes = 3 × u24.** Com header de 8 bytes:

```
(20371, 5104, 54)   (26559, 1956, 54)   (5773798, 9302, 54)
(8067378, 24418, 54)  (24303, 3352, 54)  (7197316, 204384, 54)
```

O terceiro campo constante em 54 é chamativo — **mas só vale para 33% das 2268
entradas possíveis.** É regularidade do começo, não registro global.

## O que já foi descartado

| hipótese | como caiu |
|---|---|
| Tabela ordenada por offset | Busca exaustiva sobre (tamanho de entrada × header × posição × largura, LE e BE) não achou **nenhum** campo monotonicamente crescente que caiba nos 86,5 MB |
| Índice guarda tamanhos, offsets cumulativos | Nenhuma combinação faz a soma chegar perto de 86,5 MB (testado 2/4/6/8/9/10/12/16 bytes por entrada) |
| Registro 9 bytes = 3 × u24 | Soma do campo A dá 7668% do `pc.bin`, do campo B dá 4166%. O terceiro campo tem 707 valores distintos, não é constante |
| Tabela de offsets no início do `pc.bin` | A maior sequência u32 crescente e dentro dos limites tem **4 valores** |
| Formato Nintendo padrão | Zero NARC na ROM inteira; o `pc.bin` também não começa com magic reconhecível |

## O caminho que sobra

**Desmontar o ARM9** (`0x4000`, 1.185.400 bytes, já mapeado em
`filelist.json`) e achar a rotina que lê o `pc.idx`. É o único caminho que não
depende de adivinhar layout.

Ponto de partida sugerido: o jogo precisa abrir o `pc.idx` pelo sistema de
arquivos do NitroROM, então há uma chamada com o id de arquivo **20** (a
posição dele na FAT, ver `filelist.json`). Achar essa constante no ARM9 e
seguir o código dali.

## Por que isso importa menos do que parecia

As **tabelas de dados não dependem do índice**: os endereços do ROM map (mais o
delta de +0x200 desta ROM) caem dentro do `pc.bin` e são lidos direto. Já saíram
jobs, habilidades, equipamentos e todas as tabelas de texto.

E para **gráficos** há um desvio que não precisa do índice: rodar o jogo no
DeSmuME e ler a VRAM, onde o próprio FFTA2 já deixou tudo convertido para
formato de hardware. Ver [DUMP-VRAM.md](DUMP-VRAM.md).

O **áudio** também não depende: 214 SDAT com SWAR/SBNK e 37 SSEQ são
localizáveis por magic dentro do `pc.bin`.

Ou seja, o `pc.idx` hoje bloqueia apenas a extração *em lote* de gráficos e
mapas — não o acesso a eles.
