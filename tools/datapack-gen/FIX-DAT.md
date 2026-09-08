# Correcoes necessarias no Tibia.dat

`client/data/things/860/Tibia.dat` **nao e versionado** (`client/.gitignore:2`
ignora `data/things/*`). As correcoes abaixo foram aplicadas manualmente e
precisam ser refeitas se o arquivo for regerado.

Rode `node tools/datapack-gen/fix-dat.js` para aplicar as duas de uma vez.

## 1. Falta o ThingAttrGround (atributo 0)

Os itens 100/101/102 tinham so os atributos 24 (displacement) e 30, sem o
`ThingAttrGround`. Sem ele `ThingType::isGround()` retorna false
(`client/src/client/thingtype.h:256`) e `Tile::drawGround` faz `break` na
primeira iteracao (`client/src/client/tile.cpp`) -- nenhum chao e desenhado.

Correcao: inserir `00 6E 00` (atributo 0, speed = 110) no inicio dos
atributos de cada item de chao.

## 2. Displacement 65520 (deveria ser 0)

Os tres itens tinham displacement `(0, 65520)`. O 65520 e o -16 lido como
unsigned: `ThingType::unserialize` usa `fin->getU16()`
(`client/src/client/thingtype.cpp`), entao o valor vira 65520 de verdade.

Esse displacement entra direto no `screenRect`
(`client/src/client/thingtype.cpp:540`), jogando o sprite 65520 px para fora
da tela. **Era a causa da tela preta**, mesmo com a projecao correta e os
draw calls acontecendo nas coordenadas certas.

Correcao: zerar os dois u16 do atributo 24.

## Como diagnosticamos

Instrumentacao temporaria em `Tile::drawGround` mostrou
`things=1 ground=1 dest=(240,296)`, `(224,304)`, `(256,304)` -- ou seja, o
chao ESTAVA sendo desenhado, nas coordenadas certas do losango (X variando
+-16, Y +8). Isso isolou o problema no `screenRect`, e dali no displacement.
