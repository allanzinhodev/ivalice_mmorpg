---
name: frame-groups
description: Frame groups estendidos do ivalice - animações de ação (atacar, castar, tomar dano, morrer) visíveis por todos os jogadores. Use ao trabalhar com animações de criatura, frame groups, o enum FrameGroupType, o campo lookAnimation do outfit, creature:setAnimation em Lua, ou ao validar/continuar essa implementação.
---

# Frame groups estendidos (animações de ação)

O ivalice suporta mais de 2 frame groups por criatura, para animações de ação
num jogo de tactics. A implementação está **completa e compilando nos três
lados**, mas a **validação end-to-end ainda não foi feita** — falta um `.dat`
com 3+ grupos, que depende do Object Builder compilado.

## O que já está pronto

| Camada | Estado | Onde |
|---|---|---|
| Formato `.dat` | Sempre aceitou N grupos | `groupCount` é um byte; reader/writer já iteram por ele |
| Object Builder | Corrigido, **não compilado** | `allanzinhodev/backlands-objectbuilder`, commit `5dc4213` |
| Client (leitura) | Pronto | `ThingType::unserialize` guarda animator/fases por grupo |
| Client (desenho) | Pronto | `Outfit::draw` usa o range do grupo ativo |
| Rede | Pronto | `lookAnimation` no `Outfit_t`, feature 145 |
| Lua | Pronto | `creature:setAnimation(n)` / `getAnimation()` |

### Os enums TÊM que bater

Três lugares, mesmos valores — mudar um sem os outros corrompe a leitura:

| Valor | Client (`client/src/client/thingtype.h`) | Object Builder (`FrameGroupType.as`) |
|---|---|---|
| 0 | `FrameGroupIdle` / `FrameGroupDefault` | `DEFAULT` |
| 1 | `FrameGroupMoving` | `WALKING` |
| 2 | `FrameGroupAttacking` | `ATTACKING` |
| 3 | `FrameGroupCasting` | `CASTING` |
| 4 | `FrameGroupHurt` | `HURT` |
| 5 | `FrameGroupDying` | `DYING` |

E a feature de rede é **145** nos três: `GameFeature::CreatureAnimationGroup`
(server/src/const.h), `Otc::GameCreatureAnimationGroup` (client/src/client/const.h)
e `GameCreatureAnimationGroup` (client/modules/gamelib/const.lua).

## Próximos passos da validação

### Passo 1 — compilar o Object Builder (BLOQUEIO ATUAL)

Exige **Adobe AIR SDK 51.2.2.6**, que não está instalado nesta máquina
(`asconfig.json` na raiz de `tools/ObjectBuilder`). Sem isso não há como gerar
um `.dat` com grupos extras pela interface.

Alternativa se o SDK continuar indisponível: escrever um gerador em Node que
emita um `.dat` com 3+ grupos, no espírito de `tools/datapack-gen`. O formato
está documentado — o parser do client em `ThingType::unserialize` é a
referência. Isso destrava os passos 2 a 5 sem depender do editor.

### Passo 2 — o `.dat` carrega com 3+ grupos

Gerar um `.dat` com pelo menos 3 grupos e conferir que o client:

- lê todos os grupos (não só 2),
- soma as fases corretamente em `m_animationPhases`,
- guarda um animator para cada grupo.

O ponto exato que estava quebrado antes: um `switch` só tratava os tipos 0 e 1,
e o animator de um grupo 2+ era **silenciosamente descartado** — os sprites
entravam, a animação não. Se a animação de ação não tocar, é aqui que se olha
primeiro.

### Passo 3 — animação na tela (um client)

Com o `.dat` pronto, disparar por Lua:

```lua
creature:setAnimation(2)  -- FrameGroupAttacking
```

Confirmar que a criatura troca de animação. Voltar com `setAnimation(0)`.

### Passo 4 — VISÍVEL POR TODOS (o teste que importa)

Este é o requisito que motivou o desenho da solução:

1. Abrir **dois clients**, logar com personagens diferentes (há 4:
   Sorcerer/Druid/Paladin/Knight, conta `1` senha `1`).
2. Disparar `setAnimation` num deles.
3. **Confirmar que o outro client vê a animação.**

Deve funcionar porque `internalCreatureChangeOutfit` faz `getSpectators` +
loop por todos os players. Se não funcionar, verificar se a feature 145 foi
negociada — o byte só é enviado quando os dois lados concordam.

### Passo 5 — quem entra depois

Com a animação em loop rodando, logar um **terceiro** personagem e confirmar
que ele já vê o estado correto. Valida que o `lookAnimation` viaja no
`AddOutfit` de qualquer criatura enviada, não só no evento de troca.

### Passo 6 — compatibilidade

Confirmar que o `.dat` atual (2 grupos) continua funcionando sem mudança de
comportamento. Todos os loops tratam grupo ausente (`getFrameGroup` devolve
null / `hasFrameGroup` é false).

## Armadilhas

- **Não mandar o byte na janela de outfits.** `sendOutfitWindow` usa o mesmo
  `AddOutfit`, mas o client lê aquela janela com `getOutfit(msg, true)`, que
  **para antes do mount**. Por isso existe o parâmetro `withAnimation`, ligado
  só nos caminhos de criatura (`0x8E` e `AddCreature`). Ligar em todos
  desincroniza o pacote.

- **`zPattern` não serve para animação.** É o seletor de montaria
  (`m_mount > 0 ? 1 : 0` em `outfit.cpp`). Usá-lo quebra criaturas montadas.

- **Fases são um range plano.** As fases de todos os grupos são
  **concatenadas** num único range — é assim que `getSpriteIndex` as enxerga.
  Para tocar "grupo 3, fase 0" é preciso somar `getGroupPhaseBegin(3)`.

- **Teto de 4096 sprites por thing.** Com muitos grupos × direções × fases isso
  aperta rápido. Calcular antes de desenhar a arte.

- **Frame groups só valem para criaturas.** `hasFrameGroups` exige
  `GameIdleAnimations` **e** categoria criatura. Itens e efeitos não têm.

- **O writer do client não grava frame groups** — ele achata tudo num grupo só.
  Não re-salvar um `.dat` pelo client, ou os grupos extras se perdem.

## Object Builder

Clonado em `tools/ObjectBuilder` (ignorado pelo git da raiz — tem repositório
próprio). O limite de 2 estava em `FrameGroupType.as` e em **32 loops**
`for (g = DEFAULT; g <= WALKING; g++)` espalhados por 11 arquivos, todos
trocados para `<= LAST`.

Não alterados de propósito:
- `createOutfit()` — outfit novo nasce com 2 grupos; os de ação são adicionados
  deliberadamente.
- `removeFrameGroupState()` — colapsar para 1 grupo é um downgrade proposital.

A UI já era data-driven: `frameGroupSlider` usa
`maximum="{_thingBinding.groups - 1}"`, então oferece os grupos extras sozinha.
