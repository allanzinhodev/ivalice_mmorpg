# Handoff — renderização de mapa em 2 camadas

Documento para retomar o trabalho em outra máquina. Estado em 2026-09-10,
commit `c794a5f`.

## O plano novo (decidido, não implementado)

O mapa passa a ser renderizado assim:

1. **Duas camadas.** A segunda serve para sobrepor a sprite que fica *na
   frente* do objeto.
2. **Sprites 8×8** no spr/dat, compondo o tile isométrico em **mosaico** —
   o tile de 32×16 vira 4×2 sprites de 8×8. É como o GBA monta, e permite
   reaproveitar pedaços entre tiles (dedup muito maior).
3. **Flag de item "meramente visual"** — sinaliza que aquele dat/spr só
   compõe o mapa, não é objeto de jogo.
4. **Sem divisão de andares.** Tudo visível ao mesmo tempo; não há o z do
   Tibia.
5. **Flag de andar/elevação por tile**, onde cada nível desloca **−8y**.
6. **Perspectiva isométrica** continua igual.

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

`2988d1a` — **elevação desacoplada do tamanho do sprite**, o primeiro passo
do plano novo. Os 8 pontos de [tile.cpp](client/src/client/tile.cpp) que
desenham com elevação multiplicavam por `g_sprites.getOffsetFactor()`
(= `spriteSize/32`). Com sprite 8×8 o fator vira 0.25 e uma elevação de 8
apareceria como 2px — o degrau sumiria silenciosamente.

## O que a base já dá de graça

Levantado por exploração do código; vale confiar em vez de re-investigar.

**Sprite 8×8 já é suportado — mas só pelo loader CWM.** O `.spr` clássico tem
32 hardcoded em [spritemanager.cpp:70](client/src/client/spritemanager.cpp#L70),
[:328](client/src/client/spritemanager.cpp#L328) e
[:465](client/src/client/spritemanager.cpp#L465). Já o
`loadCwmSpr` ([:500-531](client/src/client/spritemanager.cpp#L500-L531)) lê o
sprite size **do arquivo** (`:512-513`) e guarda **PNGs empacotados**. O
dispatcher em [:60-85](client/src/client/spritemanager.cpp#L60-L85) escolhe
CWM > OTV8 > .spr clássico. Emitindo CWM, o 8×8 sai sem tocar em C++.

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

## Como retomar

```
git pull
```

O trabalho está todo em commits; nada importante ficou só na conversa. O
próximo passo do plano é o formato de assets próprio (CWM para os sprites
8×8) e a flag de item visual.
