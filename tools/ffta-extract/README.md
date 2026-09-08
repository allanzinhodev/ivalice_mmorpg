# ffta-extract

Extração de dados estruturados da ROM de **Final Fantasy Tactics Advance**
(versão US, `gamecode AFXE`, `md5 cd99cdde3d45554c1b36fbeb8863b7bd`).

Nada aqui modifica a ROM. A ROM em si **não** é versionada (`*.gba` no `.gitignore`);
coloque-a em `tools/rom.gba`.

## Como rodar

```bash
node tools/ffta-extract/extract.js            # texto + itens + habilidades + jobs
node tools/ffta-extract/extract-graphics.js   # tiles / arrangement / heightmaps de mapa
```

Saída em `tools/extracted/`.

## O que sai

| Arquivo | Conteúdo |
|---|---|
| `rom-info.json` | cabeçalho GBA, hashes, verificação do dump |
| `strings/universal.json` | 767 strings de menu, nomes de habilidades/magias, buffs |
| `strings/itemLocNames.json` | 753 nomes: itens, jobs, monstros, clãs inimigos, áreas, meses |
| `strings/missionNames.json` | 512 nomes de missão |
| `strings/unitNames.json` | 725 nomes de unidade (pool aleatório + personagens nomeados) |
| `strings/storyChars.json` | 107 nomes de personagens de história / especiais |
| `strings/clanNames.json` | 128 nomes de clã |
| `strings/areaTypeNames.json` | 84 tipos de local no mapa |
| `strings/clanTitles.json` | 52 títulos/prefixos de clã |
| `strings/dummyTable.json` | 92 entradas (quase tudo `dummy`, não usado) |
| `items.json` | 375 itens/equipamentos com stats, tipo, slot, elemento, preços |
| `abilities.json` | 347 habilidades/magias com poder, MP, AP, alcance, alvo, AoE, IA |
| `jobs.json` | 116 jobs com stats-base, crescimento, resistências elementais, equipáveis, requisitos e learnset (habilidade → AP) |
| `maps-index.json` | tabela de 163 registros de mapa (offsets de gráfico/arranjo/altura) |
| `graphics/tileset-bin/*.bin` | tiles 4bpp descomprimidos (32 bytes por tile 8×8) — 50 únicos |
| `graphics/tileset-png/*.png` | prévia renderizada de cada tileset |
| `graphics/arrange-bin/*.bin` | grade de índices de tile por mapa — 91 únicos |
| `graphics/height-bin/*.bin` | altura + permissão por célula — 110 únicos |
| `graphics/maps.json` | índice cruzando tudo acima |

## Fontes das estruturas

Data Crystal (`datacrystal.tcrf.net/wiki/Final_Fantasy_Tactics_Advance`):
`ROM map`, `Items`, `Abilities`, `Jobs`, `String Tables`.

Offsets principais (offset de arquivo):

| Tabela | Offset | Registros | Tamanho |
|---|---|---|---|
| Itens/equipamento | `0x51D1A0` | 375 (`0x177`) | `0x20` |
| Habilidades | `0x55187C` | 347 (`0x15B`) | `0x1C` |
| Jobs | `0x521A14` | 116 (`0x00`–`0x73`) | `0x34` |
| Requisitos de job | `0x5231A4` | — | `0x04` |
| Máscara de equipáveis | `0x51D0F4` | — | `0x04` (word) |
| Learnset por raça (ponteiros) | `0x51BA84` | — | `0x04` |
| String table "universal" | `0x5567F0` | 767 | ponteiro `0x04` |
| String table "item/local" | `0x526680` | 753 | ponteiro `0x04` |
| Registros de mapa | `0x569104` | 163 | `0x58` |

Descompressores de mapa (`LZ77` MSB-first e `LZSS`) portados de
`tools/FFTAUtils/FFTA_MapEditor/{LZ77,LZSS}.cs`.

## Codificação de texto

FFTA usa substituição simples com duas "fontes":

* fonte de diálogo (prefixo `0x01`): `A`=`0xB1`, `a`=`0xCB`
* fonte de menu (prefixo `0x80`, deslocada −1): `A`=`0xB0`, `a`=`0xCA`, dígitos `0`=`0xA6`

Pontuação fica num bloco alto compartilhado (`?`=`0xEB`, `!`=`0xEC`, `:`=`0xEE`,
`'`=`0xF4`, `+`=`0xFD`, `-`=`0xFE`, `<`/`>`=`0x02`/`0x03`, …). `0x40 0x3E` = quebra
de palavra (espaço), `0x40 0x3C` = par de kerning. Ver `ffta.js` para a tabela
completa; bytes não mapeados saem como `\xHH` (restam ~0 nas tabelas de nome).

## Limitações conhecidas

* **Descrições** (texto de ajuda de item/habilidade) não foram extraídas — a
  tabela de ponteiros correspondente ainda não está localizada. `descriptionId`
  é preservado em cada registro para quando for.
* **Paletas de tileset** de mapa são aproximadas: usa-se a primeira sub-paleta;
  o arranjo real seleciona a sub-paleta por tile.
* Campos marcados como `unknown`/`buffer` na wiki não são interpretados; o hex
  cru de cada registro fica no campo `raw`.
