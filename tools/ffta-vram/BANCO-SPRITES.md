# O banco de sprites não comprimidos

**Achado em 14/09/2026, casando pixels exportados do emulador contra a ROM.**

## O que é

| | |
|---|---|
| Início | `0x69B000` |
| Fim | `0x8EA000` |
| Tamanho | **2364 KB** |
| Conteúdo | **75.648 tiles 8×8, 4bpp, SEM compressão** |

A espada exportada pelo sprite view do mGBA está em **`0x7940FC`**, e os
tiles seguintes do mesmo sprite em `0x79411C` e `0x79413C` — consecutivos, 32
bytes de distância.

Renderizando a região sai um banco de armas: dezenas de espadas, machados,
lâminas e cabos, lado a lado.

## Por que treze tentativas não acharam

Todas procuravam **streams LZ77**. Os registros de mapa apontam para dados
comprimidos, então era razoável supor que os sprites também estivessem. Não
estão: este banco é **byte cru**, pronto para DMA direto para a VRAM.

O `BECOS-SPRITE.md` lista as buscas que falharam. Nenhuma delas procurava
dado não comprimido — esse era o ponto cego.

## Como foi achado

O método que funcionou é o inverso do que eu vinha fazendo:

1. **Exportar um sprite do emulador** (sprite view do mGBA → PNG indexado)
2. Converter os índices de pixel para o formato **4bpp do GBA**
3. Procurar esses bytes **na ROM crua**

O passo 2 tem um detalhe que decide tudo: o **nibble baixo vem primeiro**.
Com a ordem invertida não casa nada — testei as duas e só uma achou.

```
pixel par   -> nibble baixo do byte
pixel impar -> nibble alto
```

A paleta exportada (`espada.pal`) confirmou que os índices do PNG são os
mesmos da VRAM: 16 de 16 cores idênticas.

## O que isto abre

Qualquer sprite que você consiga ver no emulador pode ser **localizado na
ROM** pelo mesmo caminho. Exportou, converteu, procurou — e tem o offset.

Com o offset, dá para extrair os vizinhos: sprites de animação ficam juntos,
então achar um frame do golpe entrega a sequência inteira.

## Arma sim, efeito de spell não

A espada casou de primeira. O efeito do **First Aid** — um anel de luz ciano
de 8×8, exportado do mesmo jeito — **não está no banco**.

Testado:

| Busca | Resultado |
|---|---|
| Bytes exatos do tile (22 bytes úteis, conteúdo de sobra) | não achado |
| Máscara de transparência, alinhada em 32 bytes | 0 ocorrências |
| Máscara sem alinhamento | genérica demais — qualquer bloco cheio casa |
| Dentro de 3000 streams LZ77 descomprimidos | não apareceu |

A paleta também difere: a espada usa 16 cores, o anel usa **4**
(`#00bdce`, `#18ffde`, `#ffffef`). Índice de paleta diferente muda os bytes,
mas a busca por máscara de transparência é imune a isso — e mesmo ela não
achou.

**Hipóteses, em ordem de probabilidade:**

1. **O efeito é gerado, não armazenado.** Um anel simétrico de 4 cores é
   barato de desenhar por código — escalando/rotacionando um tile base, ou
   com affine sprite. Nesse caso não existe na ROM como bitmap.
2. Está num banco separado, com outro formato (8bpp? outro bpp?).
3. Está comprimido com algo que não é o LZ77 do `gfx.js`.

A primeira explica melhor o conjunto: efeitos de magia no GBA costumam usar
rotação/escala por hardware sobre poucos tiles, justamente para não gastar
VRAM.

**Consequência prática:** para efeitos de spell, capturar do emulador pode
ser o único caminho — não porque a busca na ROM falhou, mas porque pode não
haver o que buscar.

## O que ainda falta

**A tabela que diz qual tile pertence a quê.** O banco é uma extensão
contínua de tiles; nada ali diz "estes 4 tiles são a espada do Soldier".

Essa indireção é a mesma que o `spriteIndex` do job precisa — e continua não
localizada. A diferença é que agora sabemos **onde a arte mora**, então a
tabela pode ser procurada por offsets que caiam dentro de
`0x69B000`–`0x8EA000`, em vez de na ROM inteira.

## Ferramenta

```
node tools/ffta-vram/achar-na-rom.js <sprite.png>
```

Recebe um PNG indexado exportado do sprite view e diz onde ele está na ROM.
