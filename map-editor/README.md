# map-editor

Editor de mapa do ivalice. Roda no navegador, sem servidor e sem dependência
nenhuma além do Node para gerar.

## Uso

```
node map-editor/build.js      # gera o editor.html
                              # abra map-editor/editor.html no navegador
                              # edite, clique em "Exportar JSON"
node map-editor/apply.js ~/Downloads/map150.json
```

O `apply.js` grava o JSON por cima de `assets/mapdata/map150.json` e regera o
`world.otbm`, o `items.otb` e o `items.xml`. Sem argumento, ele só regera a
partir do mapdata que já está no repositório.

> **O servidor lê de `server/build/data/`, que é uma cópia.** Depois de
> aplicar, copie para lá — senão ele serve a versão antiga sem reclamar de
> nada. Isso já custou uma sessão inteira de depuração.

## O que dá para editar

| | |
|---|---|
| **Posição da célula** | setas, ou os botões do painel |
| **Posição da grade inteira** | Ctrl+setas |
| **Andar** | PageUp/PageDown, ou o campo — **move a célula na tela** |
| **Terreno** | andável, água ou bloqueado |
| **Personagem** | Shift+setas, para ver o que passa na frente dele |

O andar arrasta a célula de propósito: o deslocamento que você vê é o mesmo
que o personagem recebe ao pisar ali (−8 px por nível), então a edição mostra
o resultado em vez de só mudar um número.

## Por que `apply.js` e não `gen-map-ffta.js`

O `gen-map-ffta.js` lê a altura da ROM (`tools/rom.gba`, que não é
versionada). Como destino do editor ele seria inútil por dois motivos: quem
clonar o repo sem a ROM não gera mapa, e — pior — ele **ignoraria os andares
que você acabou de editar**, reimportando os originais do FFTA por cima.

Aqui a única fonte é o mapdata. O que o editor grava é o que vai para o jogo.

O `apply.js` foi verificado produzindo saída **byte a byte idêntica** à dos
geradores antigos quando o mapdata não mudou — é substituto fiel, não
reimplementação aproximada.

## O que cada campo vira

```
tile     -> id do item de terreno (camada 1)
tile2    -> id do item de decoração (camada 2, onTop)
terreno  -> block vira FLAG_BLOCK_SOLID + FLAG_BLOCK_PATHFIND no items.otb
andar    -> gravado no mapdata; ainda NÃO entra no OTBM
```

**O andar não vira `z`, e isso é decisão, não pendência.** Três mecanismos já
foram tentados e descartados (ver [HANDOFF.md](../HANDOFF.md)): altura como z
do OTBM, `HEIGHT_PER_FLOOR`, e pilha de itens com `elevation`. O mapa inteiro
fica num z só. O dado do andar não se perde — fica no mapdata, que é
versionado, esperando a decisão de como expressar altura.

**Água ainda não tem efeito no servidor.** O campo existe e é exportado, mas
nada o consome: o TFS não tem um conceito de "tile de água" que se declare
por flag. Quando for implementado, a marcação já vai estar feita.

## Arquivos

```
build.js           gera o editor.html a partir do datapack + otbm + mapdata
editor.tpl.html    o molde: HTML, CSS e JS da página
editor.html        gerado; não edite à mão
apply.js           mapdata -> world.otbm + items.otb + items.xml
```

Rode o `build.js` de novo sempre que o datapack ou o mapa mudarem — ele
embute as duas camadas já rasterizadas, porque um navegador em `file://` não
alcança o `.dat`, o `.cwm` nem o `.otbm`.
