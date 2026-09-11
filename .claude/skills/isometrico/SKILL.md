---
name: isometrico
description: Sistema isometrico do ivalice - projecao em losango 32x16, altura por empilhamento de itens (sem andares), JUMP do personagem, agua com zPattern proprio e classificacao dos 115 tiles. Use ao mexer em mapview/tile/creature do client, no movimento do server, no tile-spec.js ou ao validar o mapa na tela.
---

# Sistema isométrico

Estado em 2026-09-11. Branch `main`; a implementação anterior (abandonada)
está em `hardtest`.

## As regras do jogo

| | |
|---|---|
| Projeção | losango **32×16** |
| Andares | **não existem** — tudo em z=7 |
| Altura | pilha de itens no mesmo tile, **sem limite** |
| Um nível | **−8 px** em Y na tela |
| `JUMP` | diferença de altura que o personagem vence; cravado em **4** |
| Sprites | 32×32, `.dat` + `.spr` |

**A altura não é o z do OTBM.** Cada item com `CONST_PROP_HASHEIGHT`
empilhado num tile é um nível. Subir um degrau mais alto que o `JUMP` é
barrado; descer é sempre livre.

## Fórmulas

```
screenX = origemX + (col - row) * 16
screenY =           (col + row) * 8

origemX = (drawDimension.w + drawDimension.h) * 16 / 2

inversa (picking):
  col = ((sx - origemX)/16 + sy/8) / 2
  row = (sy/8 - (sx - origemX)/16) / 2
```

A inversa precisa de **`floor` em float**. Divisão inteira trunca em direção
a zero, e à esquerda/acima da câmera as coordenadas são negativas — ali o
truncamento erra o tile por um.

## O que está feito

- **Projeção e picking** — `mapview.cpp`
- **Deslocamento do personagem** — `creature.cpp`: passo como fração
  normalizada, `updateWalkingTile` invertendo a projeção
- **Altura por empilhamento** — `Tile::getHeightLevels()` no server,
  `m_drawElevation` sem teto no client
- **`JUMP`** — `player->getJump()`, exposto ao Lua como
  `getJump`/`setJump`
- **Água → `zPattern` 2** — `Tile::isWater()`, `ThingAttrWater = 103`
- **115 tiles classificados** — `tools/asset-compiler/tile-spec.js`

## Altura: o "bloco", e por que o terreno não empilha

**Um tile de terreno não pode ser empilhado.** `Tile::internalAddThing` do
server aceita **um** ground por tile e descarta os demais
(`server/src/tile.cpp:1718-1724`) — uma pilha de 13 grounds vira 1 no
carregamento, sem erro.

Por isso cada tile que é degrau gera **dois** itens no datapack:

| | `ThingAttrGround` | `onBottom` | empilha |
|---|---|---|---|
| terreno | sim | não | não |
| `#bloco` | **não** | **sim** | **sim** |

Mesma arte, mesma elevação (8). A expansão mora em
`tile-spec.js:expandirItens` porque o `.dat` e o `.otb` precisam gerar a
mesma lista **na mesma ordem** — id divergente entre os dois faz o client
abortar o parse do mapa inteiro.

O `onBottom` não é decorativo: `Tile::drawGround` percorre a pilha até achar
algo que não seja ground, groundBorder **ou** onBottom, e para
(`client/src/client/tile.cpp:57`). Sem ele o loop para no primeiro bloco e a
elevação trava em 8px.

Dois tetos foram subidos de 10 para 64, e precisam continuar casados:
`Tile::MAX_THINGS` (client) e `MAX_TILE_STACK` (`protocolgame.cpp`). No
server o corte acontecia **antes das criaturas**, então um personagem sobre
pilha alta nem era enviado.

## Cinco armadilhas que já custaram caro

**1. Canal alfa.** O `.otfi` declara `transparency: true` (RGBA), mas se
`GameSpritesAlphaChannel` não for ligada o client lê RGB. O stream sai de
fase e a tela mostra pixels esparsos — **sem erro no log**.

**2. Store inbox.** O server manda `ITEM_STORE_INBOX` (23396) no login para
clients OTC. Se o datapack não tiver esse id, o client aborta a mensagem
inteira — e o mapa vinha nela. O erro fala de *inventário*, não de mapa.

**3. `server/build/data/` é cópia.** O `tfs.exe` roda com working directory
em `build/`. Esquecer de sincronizar faz ele servir o datapack antigo **sem
erro nenhum**. `gen-items.js` e `gen-map-test.js` já copiam sozinhos.

**4. `m_virtualCenterOffset` cancela em X.** Somá-lo a `col` e `row` antes
de projetar não centraliza: como é igual nos dois eixos, o `(col - row)`
anula o termo. Calcule a origem direto.

**5. Proporção do recorte.** Encolher o recorte para caber na caixa 2:1 do
losango distorce, porque a viewport não é 2:1 — e a distorção *muda* ao
andar. Fixe a altura e derive a largura da janela.

## A classificação dos tiles

`tools/asset-compiler/tile-spec.js` é a **fonte única**: o compilador do
`.dat` e o gerador do `.otb` leem dela. Manter em dois lugares foi como o
`hasHeight` divergiu antes.

| Faixa | Tipo | Andável | Degrau |
|---|---|---|---|
| 0–21, 25, 26 | ground | sim | sim |
| 22–24, 27–40 | grass | sim | sim |
| 36 | grass | **não** | sim |
| 41–47 | plant | sim | **não** |
| 48–60 | stone | **não** | **não** |
| 61–81 | stone | só 61,62,63,66,69,70,77 | sim |
| 82–114 | water | sim | **não** |

Água é **andável** de propósito: o `zPattern` 2 pressupõe pisar nela.

## Como gerar e rodar

```
node tools/asset-compiler/compile.js      # 32x32 -> Tibia.dat + .spr
node tools/datapack-gen/gen-items.js      # -> items.otb (sincroniza)
node tools/datapack-gen/gen-map-test.js   # -> world.otbm (sincroniza)
```

Build: ver a skill `vcpkg`. Login **1/1**; a conta já existe em
`server/schema.sql:16`, com as 4 classes e outfits 1–4.

## O mapa de teste

`gen-map-test.js` é um banco de provas, não um mapa bonito. Temple em (8,8):

- **(10,8)–(15,8)** — degraus de 1 a 6 níveis. Com `JUMP=4`, sobe até o de 4
- **(12,12)** — pilha de 12 níveis, para provar que não há limite
- **(6,10)–(10,12)** — poça de água, para o `zPattern` 2
- **y=20** — muro de pedra que bloqueia; **y=22** — pedra andável ao lado

## Como validar sem interação

**`SendKeys` e `PostMessage` não alcançam o client OpenGL** — os dois foram
tentados e o personagem não se move. Duas peças contornam isso:

- **`client/mods/client_autologin/`** — loga com 1/1. Só dispara se existir
  `client/data/autologin.request`.
- **`server/.../creaturescripts/others/autotest.lua`** — teleporta no login
  para a coordenada em `data/autotest.request` (conteúdo: `"x y"`).

Alvos úteis: `8 8` chão plano, `13 8` degrau de 4, `14 8` degrau de 5
(barra), `14 14` pilha de 12, `8 11` água.

Para medir a elevação, compare capturas do **mesmo tile** antes e depois —
o Y absoluto do boneco não serve, porque a câmera o segue.

## Validado na tela

- [x] Mapa centrado no personagem, escala 1:1, sem distorcer
- [x] Tiles empilhados desenhando relevo com faces laterais
- [x] Elevação acumulando sem teto (5 itens = 40px, 7 = 56px)
- [x] Água renderizando, personagem em pé sobre ela

## Falta validar

- [ ] `JUMP=4` barrando o degrau de 5 (precisa andar)
- [ ] Água trocando a outfit para o terceiro padrão — **só funciona se as
      outfits tiverem 3 colunas de `patternZ`**; com 2 o código cai no
      padrão da montaria e nada muda na tela
- [ ] Caminhada nas 8 direções com velocidade uniforme
- [ ] Picking à esquerda/acima da câmera

> A água só muda de aparência se as outfits tiverem **3 colunas de
> `patternZ`**. Com 2, o código cai no padrão da montaria — não quebra, mas
> nada muda na tela. É o sinal de que falta a terceira coluna na
> spritesheet.
