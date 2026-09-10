---
name: ffta-map
description: Mapas do Final Fantasy Tactics Advance extraidos da ROM - identificacao (Aisenfield = mapa 150), formato dos streams, paleta, height map e o que ja foi decodificado. Use ao trabalhar com assets de mapa do FFTA, render-maps.js, gen-map-ffta.js ou o pipeline em tools/ffta-extract.
---

# Mapas do FFTA

A ROM (`tools/rom.gba`, US, verificada) tem **163 registros de mapa** em
`0x569104`, 88 bytes (`0x58`) cada.

## Offsets do registro

| Offset | Conteudo | Estado |
|---|---|---|
| `+0x00` | tileset (tiles 8x8 4bpp) | decodificado |
| `+0x04` | arrangement 1 | parcial |
| `+0x08` | **arrangement 2** | achado, nao decodificado |
| `+0x0C` | paleta | decodificado |
| `+0x10` | height map | decodificado |
| `+0x54` | tipo de paleta (`&3`) | decodificado |
| `+0x56` | indice na tabela de paleta | decodificado |

O `extract-graphics.js` so lia `+0x04`. O `+0x08` existe e tem dados
(1540 bytes no mapa 150) -- provavelmente a segunda camada.

## Aisenfield = mapa 150

Identificado por comparacao de cores contra `assets/mapref/aisenfield.png`,
que veio do jogo:

- as 19 cores da referencia batem 13/15 com a subpaleta 0 do mapa 150
- casando os tiles 8x8 da referencia contra o tileset: **1008 tiles casados**
  no alinhamento `(3,2)`
- grade real: **58x34 tiles**, area util 57x32

O mapa 147 tambem bate 13/15, mas o arrangement dele esta quebrado (o slice
nao comprimido vai ate o fim da ROM).

## Paleta: 5 bits viram 8 por DESLOCAMENTO

O `gfx.js` convertia com regra de tres (`v*255/31`). O GBA usa `v<<3`:

- `<<3`: 21 -> 168. Bate EXATAMENTE com a referencia do jogo.
- `*255/31`: 21 -> 173. Nao casa nenhuma das 19 cores.

Ja corrigido. Se as cores sairem "quase certas", e este o suspeito.

## Camadas

A referencia confirma o que o arrangement sugeria:

- `aisenfield.png` = terreno (613 tiles na camada 1)
- `aisenfield2.png` = decoracao esparsa -- pedras, arbustos, tufos de grama
  (157 tiles, 3.7% da imagem)

## Height map: decodificado e em uso

```
[u16 ?] [u16 ~28]              4 bytes de cabecalho
por celula: [u8 altura] [u8 flag]
```

Stride 16, mas as **ultimas colunas nao sao terreno**: contem enderecos (no
mapa 0 a coluna 14 vai 32,64,96,128... de 32 em 32). O
`RenderHeightMap.cs` pula essas colunas com o comentario "it's addresses,
not values". Ler so 14 colunas.

`gen-map-ffta.js` ja usa isso: altura -> z invertido, 3 unidades por andar.

### Quantos valores de altura existem: 32 (0 a 31)

Medido nos 159 mapas que descomprimem, 25.936 celulas de terreno. Cabem
exatamente em 5 bits -- a altura e gravada num byte, mas o jogo so usa os
5 bits baixos.

| Faixa | Cobertura |
|---|---|
| 0-4 | 42% |
| 0-10 | 75% |
| 0-16 | 88% |
| 17-31 | 12% |

A altura 2 sozinha e 17% das celulas -- e o "chao padrao". Valores como 27 e
29 aparecem em 2-3 celulas no jogo INTEIRO.

Por mapa, a altura maxima vai de 7 a 31. O Aisenfield (150) usa 2..7, um dos
mais planos.

**Cuidado ao contar**: sem filtrar as colunas de endereco aparecem 118
valores distintos ate 252. Os multiplos de 32 (32, 64, 96, 128, 160, 192,
224) sao endereco, nao altura. Filtrar por "multiplo de 32 e >= 32" e mais
robusto que exigir a progressao exata +32 por linha -- o detector do
extract-map-tiles.js usa a progressao e falha em 4 mapas.

### HEIGHT_PER_FLOOR e o limite de z

O OTBM so tem z de 0 a 15. Com o intervalo real 0..31:

- **3 por andar** (atual) -> ate 11 andares. Cabe, mas aperta num mapa que
  use altura 31.
- 2 por andar -> ate 16 andares, ESTOURA.
- 4 por andar -> ate 8 andares, com folga.

Decisao: fica em 3. So vale mexer quando aparecer um mapa alto de verdade --
para o Aisenfield (2..7) qualquer valor serve.

## O que FALTA

**A ordem dos tiles dentro do arrangement.** As cores, a separacao de camadas
e a grade estao certas, a posicao individual nao.

Pistas ja levantadas:

- O `+0x04` referencia tiles ate 262, mas a referencia usa ate 429 -- o mapa
  completo nao esta so nesse stream.
- O `+0x08` tem valores ate 61960, longe demais para indice puro de tile. Com
  a mascara do tilemap padrao do GBA (bits 0-9 tile, 10-11 flip, 12-15 paleta)
  aparecem as 16 paletas e os 4 flips, e a intersecao com a referencia sobe
  para 46. **E o formato mais provavel.**
- O `RenderArrangeMap` do FFTAUtils NAO e referencia confiavel para isso: usa
  `addr + i*4` tratando endereco como indice de celula, o que estoura a grade
  e sai esparso. Serve para a silhueta, nao para a posicao.

## Ferramentas

```
node tools/ffta-extract/extract-graphics.js   # tileset/arrange/height -> bin+png
node tools/ffta-extract/render-maps.js [N]    # monta o cenario (162/163)
node tools/datapack-gen/gen-map-ffta.js [N]   # height map -> world.otbm com andares
```

O `render-maps.js` aceita `--pal=N` para trocar a subpaleta. Tipo `0x01` de
arrangement e "packed" (nao comprimido, dados apos 4 bytes de header) -- o
`decompress` do gfx.js devolve null nesse caso, e sao 47 dos 163 mapas.
