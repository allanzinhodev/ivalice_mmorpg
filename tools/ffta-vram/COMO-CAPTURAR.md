# Como capturar animação de habilidade e de arma

Guia passo a passo. Para **sprite de unidade parada**, o `DUMP-VRAM.md`
basta — lá você pausa a batalha e despeja à mão.

Aqui o problema é outro: **o efeito de uma habilidade dura poucos frames e
some.** Acertar o despejo manual no frame certo é sorte. Este procedimento
grava todo frame automaticamente e depois acha sozinho onde o efeito está.

## O que você precisa

| | |
|---|---|
| Emulador | mGBA **0.10+** (você tem o 0.10.5 em `Downloads\mGBA-0.10.5-win32`) |
| Executável | **`mGBA.exe`** — o `mgba-sdl.exe` não tem os menus |
| ROM | `tools/rom.gba` |
| Um save | numa batalha, com a unidade que tem a habilidade |

## Passo a passo

### 1. Abra o jogo

Rode `mGBA.exe`, `File > Load ROM`, escolha `D:\ivalice\tools\rom.gba`.

### 2. Entre numa batalha

Chegue até o ponto em que a unidade pode usar a habilidade que você quer.
Deixe o cursor pronto para confirmar — o ideal é parar **um confirm antes**
do efeito tocar.

> Dica: salve um save state aqui (`Shift+F1`). Você vai repetir isso para
> cada habilidade, e voltar ao mesmo ponto economiza muito tempo.

### 3. Carregue o script

`Tools > Scripting...` → na janela, `File > Load script` →
`D:\ivalice\tools\ffta-vram\dump-frames.lua`

O console mostra:

```
dump-frames.lua carregado.
  iniciar("nome")  comeca a gravar
  parar()          termina
```

### 4. Grave

No campo de comando do console do script, digite:

```lua
iniciar("cure")
```

Volte ao jogo e **execute a habilidade**. Deixe a animação terminar.

Quando acabar, volte ao console:

```lua
parar()
```

Ele diz quantos frames capturou.

> Um frame por despejo, três arquivos por frame. Uma animação de 3 segundos
> dá ~180 pastas. É pesado de propósito: melhor gravar demais que perder o
> frame que importa.

### 5. Extraia

No terminal, na raiz do projeto:

```
node tools/ffta-vram/varrer.js tools/ffta-vram/dumps
```

Ele compara os frames entre si e **diz quais interessam** — o efeito
entrando na VRAM aparece como mudança grande:

```
mudanca mediana por frame: 1.2%
limiar: 3.6%
frames com mudanca grande: 7

FRAMES QUE INTERESSAM:
  cure-0043   mudou 38.1%   VRAM 74% ocupada
  cure-0044   mudou 41.5%   VRAM 76% ocupada
  ...
```

Depois extrai só esses. Sem isso você abriria 180 pastas iguais procurando
as 6 diferentes.

### 6. Olhe o resultado

```
tools/ffta-vram/dumps/cure-0043/out/
  folhas/      a OBJ VRAM inteira, um PNG por banco de paleta
  objs/        um PNG por sprite ativo
  unidades/    os sprites agrupados
  oam.json     os 128 slots crus
```

**Comece pelas `folhas/`** — elas mostram tudo que está carregado, mesmo se
a OAM pegou um frame de transição.

## Se sair errado

**Sprites fatiadas ou embaralhadas** — o modo de mapeamento (1D/2D) vem do
`DISPCNT`, que não está no despejo:

```
node tools/ffta-vram/varrer.js tools/ffta-vram/dumps --2d
```

**"frames com mudanca grande: 0"** — a habilidade não trocou gráfico na VRAM
(efeito só de paleta ou de BG, não de OBJ). O varredor extrai tudo nesse
caso; olhe as folhas de alguns frames do meio.

**Cores erradas** — o banco de paleta vem da OAM. Se o jogo trocou a paleta
depois do despejo, procure o banco certo nas `folhas/`.

**O script trava o emulador** — baixe a frequência: abra o
`dump-frames.lua` e mude `PASSO = 1` para `2` ou `3`. Perde frames
intermediários, mas o efeito geralmente dura o bastante.

## Por que isto também resolve os estados de animação

Além do gráfico, a OAM diz **como cada pose se monta** — quantos objetos, de
que tamanho, em que posição.

Capturando a mesma unidade **parada, andando e atacando**, sai o mapeamento
frame→estado que falta nas folhas de `assets/ffta/sprites/` (ver o README de
lá). É o dado que a análise estática da ROM não entregou em nenhuma das
treze tentativas registradas no `BECOS-SPRITE.md`.

## Ordem sugerida

1. Uma habilidade simples de cura (**Cure**) — efeito curto e bem visível.
2. Um ataque físico com arma — para ver a animação de armamento.
3. A mesma unidade parada e andando — para os estados de animação.

Uma captura por vez, conferindo o resultado antes de seguir. Se a primeira
sair boa, o resto é repetição.
