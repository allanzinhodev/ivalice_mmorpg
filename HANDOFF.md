# Handoff — renderização de mapa em 2 camadas

Documento de continuidade do plano novo de renderização.

## O plano

O mapa passa a ser renderizado assim:

1. **Duas camadas.** A segunda serve para sobrepor a sprite que fica *na
   frente* do objeto. — *pendente*
2. **Sprites 8×8** no spr/dat, compondo o tile isométrico em **mosaico** —
   o tile de 32×16 vira 4×2 sprites de 8×8. É como o GBA monta, e permite
   reaproveitar pedaços entre tiles (dedup muito maior). — **feito**
3. **Flag de item "meramente visual"** — sinaliza que aquele dat/spr só
   compõe o mapa, não é objeto de jogo. — **feito**
4. **Sem divisão de andares.** Tudo visível ao mesmo tempo; não há o z do
   Tibia. — *pendente*
5. **Flag de andar/elevação por tile**, onde cada nível desloca **−8y**. —
   a elevação já está desacoplada do tamanho do sprite (nos dois lados,
   tile e criatura); falta a flag por tile.
6. **Perspectiva isométrica** continua igual. — nada a fazer

### Decisões já tomadas

| Questão | Decisão |
|---|---|
| Como o 8×8 compõe o tile | **Mosaico** — várias 8×8 formam o tile de 32×16 |
| `getOffsetFactor()` vira 0.25 com sprite 8×8 | **Desacoplar**: elevação em px absolutos |
| Formato de assets | Próprio, novo (não o .dat/.spr do Tibia) |

### Validações dispensadas

O usuário dispensou **todas** as listas de validação anteriores (frame
groups, caminhada nas 8 direções, picking, andares, camada 2 do Aisenfield).
Não voltar com elas como pendência.

O mapa antigo (Aisenfield via `gen-map-ffta.js`) foi explicitamente
abandonado — "pode esquecer o mapa".

## O que já foi feito

**Elevação desacoplada do tamanho do sprite.** Os 8 pontos de
[tile.cpp](client/src/client/tile.cpp) que desenham com elevação
multiplicavam por `g_sprites.getOffsetFactor()` (= `spriteSize/32`). Com
sprite 8×8 o fator vira 0.25 e uma elevação de 8 apareceria como 2px — o
degrau sumiria silenciosamente. O mesmo termo existia em
`Creature::getDrawOffset` e ficou de fora daquela passagem; a assimetria era
pior que o bug original, porque o tile subiria 8px e o personagem sobre ele
só 2 — o boneco afundaria no relevo.

**Mosaico 8×8, em CWM.** A arte continua autorada em 32×32 (tile) e 32×64
(frame de personagem); o que mudou é o fatiamento. `--cell=8` no
[compile.js](tools/asset-compiler/compile.js) emite `Tibia.cwm` em vez de
`Tibia.spr`. Resultado medido: 664 sprites de 32px viram 3063 células de 8px
(dedup de 3,5×) e o arquivo cai de 1,19 MB para 448 KB.

**Flag de item meramente visual** (`ThingAttrVisualOnly = 102`). O efeito
está nos *fallbacks* de `getTop*Thing` em [tile.cpp](client/src/client/tile.cpp):
eles devolvem `m_things[0]` quando nada mais serve, e era ali que um pedaço
de cenário virava alvo do clique.

### Três armadilhas que apareceram no caminho

**A ordem dos sprites no `.dat` é de trás para frente, nos dois eixos.** O
índice 0 é a célula **inferior-direita**. O compilador assumia o contrário, e
com `height=2` isso trocava as duas metades do personagem — invisível
enquanto a arte cabia numa metade, mas **432 de 432** quadros estavam
trocados e 76 deles saíam rasgados na tela (as poses de ataque e dano, que
cruzam a linha dos 32px). A regra virou código com teste, em
[mosaic.js](tools/asset-compiler/mosaic.js).

**O teto do atlas de textura vinha de `spriteSize()`.**
`ThingType::getBestTextureDimension` conta *sprites* por eixo, mas usava o
tamanho do sprite como limite — 32 e 32 coincidiam por acaso. Com 8×8 o teto
cairia para 8 e nada maior que um tile caberia. E falharia **em silêncio**:
o `VALIDATE` que protegia isso vira `((void)0)` em release. Agora o limite é
`Otc::MAX_ATLAS_PIXELS` (1024), com a contagem derivada dele.

**Displacement não é medida de tela.** Ele entra na conta multiplicado por
`cell/32`, junto de um termo `(cols-1, rows-1) * cell` — os dois mudam quando
a mesma arte é fatiada diferente. Escrever o número à mão daria certo para um
tamanho de célula e errado para o outro. O compilador autora a **âncora** (o
pixel onde o canto do quadro cai, relativo a `dest`) e deriva o resto em
`displacementFor`.

## Como conferir que continua certo

```
node --test tools/asset-compiler/*.test.js
node tools/asset-compiler/render-check.js <dirA> <dirB>
```

`render-check` compara duas compilações pelo que elas **põem na tela**, não
pelos bytes — trocar o tamanho da célula muda todo id, toda contagem e todo
displacement, e ainda assim o desenho tem que ser idêntico. Foi ele que
provou que o mosaico 8×8 desenha exatamente igual ao build de 32px nos 684
quadros.

Isso, porém, compara um modelo em JS contra outro modelo em JS. Quem fecha a
conta contra o **client de verdade** é
[client/mods/client_assetcheck/](client/mods/client_assetcheck/), que carrega
o datapack pelo caminho real e exporta as folhas, e o
[export-check.js](tools/asset-compiler/export-check.js), que compara essas
folhas com o modelo:

```
touch client/data/assetcheck.request
./client/otclient_gl_x64.exe
node tools/asset-compiler/export-check.js "$APPDATA/AstraClient/otclientv8/assetcheck-1-1.png" 1 1
```

Última medida: **0 pixels diferentes em 245.760**.

## O que a base já dá de graça

Levantado por exploração do código; vale confiar em vez de re-investigar.

**Sprite 8×8 já é suportado — mas só pelo loader CWM.** O `.spr` clássico tem
32 hardcoded em [spritemanager.cpp:70](client/src/client/spritemanager.cpp#L70),
[:328](client/src/client/spritemanager.cpp#L328) e
[:465](client/src/client/spritemanager.cpp#L465). Já o
`loadCwmSpr` ([:500-531](client/src/client/spritemanager.cpp#L500-L531)) lê o
sprite size **do arquivo** (`:512-513`) e guarda **PNGs empacotados**. O
dispatcher em [:60-85](client/src/client/spritemanager.cpp#L60-L85) escolhe
CWM > OTV8 > .spr clássico.

> A conclusão que estava aqui — "emitindo CWM, o 8×8 sai sem tocar em C++" —
> **não se sustentou**. O *carregamento* sai, sim: `loadCwmSpr` leu o arquivo
> de 8px sem uma linha de C++. Quem quebrou foi o passo seguinte,
> `getBestTextureDimension`, que tirava o teto do atlas de `spriteSize()`. A
> lição é que o tamanho do sprite vaza para além do loader: vale procurar
> pelas outras aparições dele antes de supor que um trecho é neutro.
> A escolha do arquivo é por **extensão**, não por configuração — então um
> `.cwm` esquecido no diretório ganha em silêncio de um `.spr` recém-compilado.
> Por isso o compilador apaga o formato que não está usando.

**O `.dat` não tem rota de fuga.**
[thingtypemanager.cpp:269](client/src/client/thingtypemanager.cpp#L269) só
implementa o layout Tibia — sem dispatcher. Há uma válvula declarativa:
`loadOtml()` ([:313-346](client/src/client/thingtypemanager.cpp#L313-L346))
aplica overrides de OTML por id sobre o `.dat` já carregado. Assimetria
importante: o lado sprite está resolvido, o lado metadados não.

**Espaço livre para a flag "visual".** `ThingAttr` vai até 42, depois pula
para 100/101 e 252-254
([thingtype.h:83-135](client/src/client/thingtype.h#L83-L135)). Dá para usar
43 ou 102 sem colidir. O atributo precisa existir em **três lugares** (já
mordeu antes): enum do client, escrita no `.dat`, e o lado server no `.otb`.

**Sem andares** é o mais barato: é o loop de z em
[mapview.cpp:148](client/src/client/mapview.cpp#L148) rodando um valor só.

**A isometria já está pronta e é ativo, não trabalho pendente.** Projeção em
`transformPositionTo2D`
([mapview.cpp:772-786](client/src/client/mapview.cpp#L772-L786)), a inversa
para picking ([:568-581](client/src/client/mapview.cpp#L568-L581), com
`std::floor` em float porque divisão inteira erraria tiles à esquerda/acima
da câmera), painter's em 3 níveis, e a normalização do passo de caminhada
([creature.cpp:635-645](client/src/client/creature.cpp#L635-L645)) — que
existe porque no diamante o passo diagonal é mais longo em px que o cardinal,
e medir em pixels fazia a velocidade parecer irregular.

Constantes em [const.h](client/src/client/const.h): `TILE_HALF_W=16`,
`TILE_HALF_H=8`, `FLOOR_LIFT=16`, `MAX_ELEVATION=248`.

## Armadilhas conhecidas

- **`m_drawElevation` é `uint8`** ([tile.h:181](client/src/client/tile.h#L181)).
  Com `MAX_ELEVATION=248` cabe, mas a margem é de 7 unidades.
- **O grafo de módulos declarado subestima o acoplamento.** `load-later` é
  soft (módulo ausente só loga erro), mas `modules.<nome>.<função>` espalhado
  em `.lua`/`.otui` é hard e invisível. `client_init.lua:11` carrega
  `client_entergame` imperativamente e nenhum `.otmod` declara essa aresta.
- **Dois sistemas de build em paralelo.** Adicionar um `.cpp` exige editar
  `client/src/client/CMakeLists.txt` **e** `client/vc23/otclient.vcxproj`
  **e** o `.filters`.
- **`Image.blit` copia pixels transparentes** e apaga o vizinho já desenhado.
  Para composição use alpha (ver `blitOver` em
  [render-demo.js](tools/asset-compiler/render-demo.js)).

## Ambiente

Build, vcpkg, Docker e banco: [.claude/skills/vcpkg/SKILL.md](.claude/skills/vcpkg/SKILL.md).
Nada de caminho absoluto é garantido — a skill explica como descobrir cada um.

- Login de teste: **1 / 1**
- Server: portas 7171/7172, `mvp`/Docker com prefixo `ivalice`, MariaDB em 3316
- `tools/rom.gba` **não** é versionado (risco de DMCA)

Nesta máquina o build do server precisou de dev shell do VS (senão `cl.exe`
não acha `cmath`), e o link falha com `LNK1104` se o `tfs.exe` estiver
rodando — parar o processo antes.

## O que falta

O trabalho está todo em commits; nada importante fica só na conversa.

**Não validado no jogo.** Toda a verificação acima é estática — compara
arquivos e folhas exportadas. O mosaico 8×8 ainda não foi visto rodando,
porque isso precisa do server de pé (MariaDB + `tfs.exe`), que estava
desligado nesta passagem. É o primeiro passo de quem retomar.

Do plano, sobram os itens 1 e 4, que são o mesmo assunto por dois lados:

- **Duas camadas** — a segunda desenha o que fica *na frente* do objeto.
- **Sem divisão de andares** — é o mais barato do plano: o laço de z em
  [mapview.cpp:148](client/src/client/mapview.cpp#L148) rodando um valor só.

E, do item 5, a **flag de elevação por tile**. A parte difícil dela já está
feita (a elevação em pixels de tela, nos dois lados); falta o dado por tile.
