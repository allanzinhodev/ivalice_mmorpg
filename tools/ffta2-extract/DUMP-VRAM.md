# Como despejar os gráficos do FFTA2 pelo DeSmuME

## Por que assim

O FFTA2 guarda gráfico em formato próprio, dentro de um container próprio
(`/master/pc.bin` indexado por `pc.idx`). Nenhum dos dois cedeu à análise
estática — não há magic Nintendo na ROM, os blocos LZ77 não são imagem, e a
tabela de gráficos do ROM map só guarda índices.

A saída é não decodificar. **O hardware do DS não entende formato próprio:**
para desenhar na tela, o jogo é obrigado a converter tudo para tile 4bpp/8bpp e
paleta RGB555 na VRAM. O decodificador que falta já está dentro do FFTA2 —
basta rodar o jogo e ler o resultado.

Contorna as duas barreiras de uma vez: o índice deixa de importar (o jogo
resolve) e o formato deixa de importar (o jogo converte).

**O preço:** a VRAM só tem o que está carregado na cena. A extração é
incremental, uma batalha por vez. Em troca, é determinística.

## O que despejar

Entre numa **batalha** — é onde personagens, monstros e tiles de mapa estão
carregados ao mesmo tempo. Então despeje estas quatro faixas:

| arquivo | endereço | tamanho | conteúdo |
|---|---|---|---|
| `palette.bin` | `0x05000000` | 2048 | todas as paletas (BG e OBJ, main e sub) |
| `objvram.bin` | `0x06400000` | 262144 | **personagens e monstros** |
| `bgvram.bin` | `0x06000000` | 524288 | **tiles de mapa** |
| `oam.bin` | `0x07000000` | 2048 | como os sprites se montam |

Os nomes acima são o que o extrator procura primeiro; ele também aceita
`obj.bin`/`bg.bin`/`pal.bin` ou o endereço como nome (`06400000.bin`).

### Pelo DeSmuME

`Tools > View Memory` para navegar até o endereço e salvar a faixa. As janelas
`View Tiles`, `View Palette` e `View OAM` servem para **conferir na hora** se a
cena tem o que você quer antes de despejar — se o tile viewer já mostra os
personagens, o despejo vai vir bom.

`Tools > Lua Scripting` automatiza, se preferir repetir várias cenas.

## Depois

```
node tools/ffta2-extract/vram-rip.js <pasta-com-os-dumps>
```

Sai em `tools/extracted-ffta2/graphics/`:

- `objvram-4bpp.png` e `objvram-8bpp.png` — a VRAM de sprites inteira como
  folha de tiles. **É o resultado mais confiável**, porque não depende de
  interpretar OAM. Uma das duas profundidades vai estar certa; é olhar qual.
- `bgvram-4bpp.png` / `bgvram-8bpp.png` — idem para os tiles de mapa.
- `sprites/` — um PNG por sprite ativo, já montado pela OAM com o tamanho e a
  sub-paleta certos, e com o índice 0 transparente.
- `oam.json` — os 128 slots decodificados (posição, tamanho, tile, paleta,
  flip), útil para entender como o jogo remonta um personagem.

## Detalhes que podem precisar de ajuste

- **Mapeamento 1D vs 2D.** O extrator assume 1D, que é o normal no DS. O modo
  2D mudaria o passo entre linhas de tiles, e depende do `DISPCNT`, que não
  está nestes despejos. Se os sprites saírem "picotados" na horizontal, é isso.
- **4bpp vs 8bpp.** Cada sprite declara o seu na OAM, então `sprites/` acerta
  sozinho. As folhas completas saem nas duas versões justamente porque a VRAM
  inteira não declara nada.
- **Tela sub.** Estes endereços são a tela principal. Se o que você quer estiver
  na de baixo, use `0x06200000` (BG sub) e `0x06600000` (OBJ sub), e as paletas
  em `0x05000400` / `0x05000600`.
