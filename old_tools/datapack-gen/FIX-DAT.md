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

## 2. Displacement negativo -- RESOLVIDO NO CLIENT

Os itens tinham displacement `(0, 65520)`. O 65520 e o -16 em complemento de
dois: o `.dat` grava displacement como u16, mas o valor e logicamente COM
SINAL.

Antes o client lia com `getU16()` e o -16 virava 65520 de verdade, jogando o
sprite para fora da tela. **Isso foi corrigido no client**
(`ThingType::unserialize` agora reinterpreta como `int16_t`), entao
displacements negativos sao validos e nao devem mais ser zerados -- eles sao
necessarios para posicionar o chao na projecao isometrica.

## Como diagnosticamos

Instrumentacao temporaria em `Tile::drawGround` mostrou
`things=1 ground=1 dest=(240,296)`, `(224,304)`, `(256,304)` -- ou seja, o
chao ESTAVA sendo desenhado, nas coordenadas certas do losango (X variando
+-16, Y +8). Isso isolou o problema no `screenRect`, e dali no displacement.
