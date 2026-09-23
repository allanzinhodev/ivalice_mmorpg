# Sprites de unidade do FFTA

180 folhas, 4915 frames. Uma folha por unidade.

## Formato

| | |
|---|---|
| Largura | **64 px**, sempre |
| Altura | múltiplo de 64 — os frames empilhados na vertical |
| Frame | **64×64** |
| Cor | **4bpp indexado** (PNG color type 3), 16 cores |
| Fundo | a cor 0 da paleta é a transparência |

O 4bpp indexado é o formato nativo de sprite do GBA — sinal de que estas
folhas vieram de extração real, não de redesenho.

> **O `png.js` do projeto não lê estes arquivos.** Ele exige bit depth 8
> (`tools/asset-compiler/png.js:112`). Quem for consumir precisa de um
> decodificador 4bpp, ou converter antes.

## O nome do arquivo é o `spriteIndex` do job

`000.png` … `247.png`, e o número é o campo `spriteIndex` de
`assets/ffta/jobs.json` (offset `0x07` do registro de job na ROM).

Conferido: **60 de 60** jobs jogáveis têm folha correspondente.

| arquivo | job |
|---|---|
| `001.png` | Paladin |
| `002.png` | Fighter |
| `003.png` | Thief |
| `005.png` | White Mage |

Isso fecha a ligação que nove tentativas de análise estática da ROM não
deram — ver `tools/ffta-vram/BECOS-SPRITE.md`.

## `000.png` é fallback, não o Soldier

**Dezenove jobs apontam para o índice 0**: o Soldier, as entradas sem nome
(`"-"`), e NPCs que não são classe de verdade (Librarian, Nurse,
Judgemaster, Box, Statue). É o sprite padrão de quem não tem um próprio.

Tratá-lo como "a arte do Soldier" é errado, e o erro só apareceria quando
alguém estranhasse a Nurse parecendo um soldado. O `index.json` marca essa
folha com `fallback: true`.

## Cobertura

| | |
|---|---|
| Folhas | 180 |
| Frames | 4915 |
| Jobs jogáveis com folha **própria** | **41** |
| Folhas sem job jogável | 138 — monstros, inimigos, NPCs |

Faltam os números 112, 116–117 e 123–187 — a faixa 123–187 coincide com o
bloco `spriteIndex` 42–87, que nenhum job jogável usa.

## A estrutura dos frames

**Não é grade fixa.** A contagem varia por job: 38, 42, 43, 44 ou 45 frames.
Os Hume em geral têm 44; os Bangaa, 42.

Inspecionando o `003.png` (Thief, 45 frames) quadro a quadro, a ordem é
**agrupada por direção** — um bloco de frente, depois de costas, depois de
lado — e **dentro de cada direção** vêm idle, passos de caminhada, golpe e
poses especiais (queda, conjuração).

O que ainda **não** está mapeado é o índice exato de cada estado dentro do
bloco. Isso não sai da folha sozinho: contagens irregulares significam que
cada job aloca o que precisa, então a tabela estado→frame vive no código da
ROM, não na imagem.

Duas formas de resolver, quando for necessário:

1. **Visual** — recortar a folha e rotular à mão. 41 jobs, trabalhoso mas
   determinístico.
2. **VRAM** — `tools/ffta-vram/vram-rip.js`. Despejando a mesma unidade
   parada, andando e atacando, o estado fica identificado por construção.

## Para onde isso vai

O client já tem o destino pronto: 6 frame groups implementados e validados
(`Idle`, `Moving`, `Attacking`, `Casting`, `Hurt`, `Dying`), com
`creature:setAnimation(n)` no Lua. Ver a skill `frame-groups`.

O que falta é o mapeamento frame→estado descrito acima.
