# Direcoes de outfit na projecao isometrica

As 4 direcoes de uma outfit sao os patterns em X do `.dat`, na ordem de
`Otc::Direction` (`client/src/client/const.h`):

| slot | direcao | na tela (projecao isometrica) |
|---|---|---|
| 0 | North | cima-direita `(+16, -8)` |
| 1 | East | baixo-direita `(+16, +8)` |
| 2 | South | baixo-esquerda `(-16, +8)` |
| 3 | West | cima-esquerda `(-16, -8)` |

Os deltas saem de `MapView::transformPositionTo2D`: `screenX = (col-row)*16`,
`screenY = (col+row)*8`.

## A regra que e facil errar

Quem desenha personagem costuma fazer **2 poses e espelhar cada uma** — o que e
correto e economiza metade do trabalho. O erro mora em **qual direcao e o
espelho de qual**, e a resposta depende da projecao.

Espelhar na horizontal troca direita por esquerda na tela. Aplicando na tabela
acima:

- North (cima-**direita**) espelha para cima-**esquerda** = **West**
- East (baixo-**direita**) espelha para baixo-**esquerda** = **South**

> Os pares espelhados tem que ser **(North, West)** e **(East, South)**.

Isso e diferente do Tibia comum, onde a camera nao e isometrica e o par
espelhado e (East, West), com North e South sendo desenhos independentes
(costas e frente). Vir do habito do Tibia e o caminho mais curto para o erro.

## Como diagnosticar sem abrir o editor

O sintoma e discreto: andar para norte e para sul parece certo, e so leste e
oeste mostram o personagem virado ao contrario. Facil de confundir com bug da
projecao.

O teste decisivo e comparar os sprites de cada par procurando espelhamento
**exato**, tolerando deslocamento horizontal (o desenho raramente esta centrado
no canvas). Se o par espelhado for (North, East) e (South, West) em vez de
(North, West) e (East, South), os slots estao trocados.

Para saber qual pose e a de costas — e portanto qual e o North — olhe as cores
na regiao da cabeca: a vista de frente tem **olho** (pixels quase brancos junto
de pixels escuros) e a de costas nao.

## Correcao

```
node tools/datapack-gen/swap-outfit-dirs.js east west
```

Troca dois slots de direcao em todas as outfits, levando junto todas as layers
(base e mascara de cor) e todas as fases de todos os frame groups. Grava um
`Tibia.dat.bak` ao lado.

**Nao e idempotente**: e uma permutacao, entao rodar duas vezes desfaz.

Com o live-reload ligado (`AUTO_RELOAD_MODULE` em `client/init.lua`) o client
recarrega o datapack sozinho em ~2s, sem reabrir.

## Caso ja enfrentado

Neste projeto os 4 frames estavam em `[5, 7, 9, 11]` com os pares espelhados em
(North, East) e (South, West) — diferenca 0, espelho perfeito, no par errado.
North e South estavam corretos; **East e West e que estavam trocados entre si**.
A correcao levou para `[5, 11, 9, 7]`.
