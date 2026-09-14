# Sprites de unidade: o que já foi descartado

> **RESOLVIDO POR OUTRO CAMINHO.** As folhas de sprite já existiam fora do
> repositório e estão em `assets/ffta/sprites/` — 180 folhas, 4915 frames,
> e **o nome do arquivo é o `spriteIndex` do job** (60 de 60 casam).
>
> Este documento continua valendo para quem precisar achar as sprites **na
> ROM** — por exemplo para pegar as que faltam, ou para entender de onde as
> existentes vieram. As tentativas abaixo continuam sendo becos.

Registro das tentativas de extrair as sprites de personagem do FFTA por
**análise estática da ROM**. Existe para a próxima investida não repetir
caminho já andado.

O `spriteIndex` do job (`ffta.js:258`, offset `0x07` do registro) é válido e
aponta para **algo**. O que falta é a indireção entre ele e o gráfico.

## O alvo, medido

| | |
|---|---|
| Valores de `spriteIndex` | **densos, 0 a 101** |
| Jobs com índice válido | 114 de 116 (`0xFFFF` nos dois vazios) |
| Valores distintos usados | **56** |
| Faixa nunca usada pelos jobs | 42–87 (provavelmente monstros) |

Como é índice denso e não ponteiro, **existe uma tabela de ~102 entradas**
em algum lugar. É esse o alvo.

## Descartado na primeira rodada

Documentado em `vram-rip.js:12-22`:

1. **Tabela de ponteiros** — 2557 candidatas com ≥120 ponteiros válidos,
   nenhuma com header de compressão uniforme nos alvos.
2. **Tabela de structs perto do job table** (`0x521A14`) — cai sempre no
   `itemLocNames` (`0x526680`), que é texto.
3. **Regiões com estatística de 4bpp** — as 4 maiores, renderizadas, são
   dado comprimido, não tiles.
4. **Streams LZ77 de tamanho uniforme** — 204 streams de exatamente 4096
   bytes (128 tiles), ≈2× os ~102 `spriteIndex`; descomprimidos dão ruído.

## Descartado na segunda rodada

**5. Tabelas de ponteiro com 100–140 entradas.** Varredura da ROM inteira:
4 achadas. Duas já conhecidas como texto (`storyChars` `0x5516D0`,
`clanNames` `0x565F14`); as duas novas sondadas byte a byte:

| Offset | O que é |
|---|---|
| `0x0929D0` | código ARM/Thumb (alvos começam com `48 2f`, `16 f0`) |
| `0x3A8604` | código Thumb — `b5 04` = `push {r2,lr}` |

Zero alvos com header LZ77 em qualquer das duas.

**6. Tabela de structs com ponteiro LZ77 em offset fixo.** Varredura com
stride 4–32 e campo 0–16, exigindo 102 entradas consecutivas cujo ponteiro
aponte para stream `0x10`: **zero candidatas** em toda a ROM.

**7. Streams LZ77 de 4369 bytes — a coincidência numérica.** São
**exatamente 102**, o mesmo número do `spriteIndex`, o que chamou atenção.
Investigado até o fim:

- os 102 descomprimem sem falha;
- 61% de nibbles zero, que *parecia* assinatura de 4bpp com transparência;
- **renderizados dão ruído.**

Além disso, o espaçamento entre eles é irregular (85 distintos) e 4369 não é
múltiplo de 32 (136,5 tiles). Coincidência, não estrutura.

**8. Sequência identidade `0,1,2,…,101`.** Existe **uma** na ROM inteira, em
`0x52A140`, logo depois do job table — parecia a tabela indexada pelo
`spriteIndex`. Investigada: a sequência vai até 104 (105 entradas u16) e não
é lista segmentada (só 2 separadores `0xFFFF` em 9 KB ao redor). Não leva a
gráfico nenhum.

**9. Caminho pela paleta.** Hipótese: achar a paleta de unidade e caminhar
para trás até o gráfico. Filtrando streams LZ77 múltiplos de 32 com cor 0
transparente, ≥10 cores e tom de pele, restaram 90 — e as mais fortes
(19–25 "tons de pele") estão em `0x5861EC`, `0x594940`, `0x5958E4`.

**São paletas de cenário, não de personagem.** Duas evidências:

- as rampas são terrosas e esverdeadas (`#5a4a29`, `#73a56b`, `#adbd8c`) —
  o filtro de pele pegou marrom de terra;
- ficam **dentro da região de dados de mapa**, 116–178 KB depois da base dos
  registros de mapa (`0x569104`).

Renderizar os gráficos vizinhos com essas paletas (inclusive os de tamanho
múltiplo exato de 32: 3072 B = 96 tiles, 6144 B = 192 tiles) também deu
ruído.

## Animação de habilidade e de arma: também não saiu

Rodada separada, atrás dos efeitos visuais (magia, golpe de arma).

**O ponto de partida:** o registro de habilidade (`0x55187C`, 347 entradas
de 28 bytes) tem `animationId` em `+0x14`, denso de 2 a 341 (340 distintos).
É índice de array, como o `spriteIndex` do job — logo existe uma tabela de
~342 entradas de animação em algum lugar.

> Cheguei a anotar que `+0x16` e `+0x1a` eram campos densos **não lidos**.
> Errado: `+0x16` é o `descriptionId` e `+0x1a` é o `aiPriority`, ambos já
> lidos (`ffta.js:199,202`). Eu os li como u16 onde são campos separados.
> O único índice de animação no registro é o `+0x14`.

**O que foi testado e falhou:**

10. **Tabela de ponteiros de 330–400 entradas** — zero na ROM inteira.
11. **Tabela de structs com primeiro campo sequencial** (≥300 entradas,
    stride 4–32, faixa `0x400000`–`0x700000`) — zero.
12. **Tabelas de 200–500 ponteiros** — 14 achadas, todas com 256/257
    entradas (tamanho de código, não de tabela de 341/400) e praticamente
    nenhum alvo LZ77.
13. **Regiões densas em streams do tamanho de tile** — `0x390000-0x3A0000`
    (199 streams) e `0x8F0000-0x950000` (~300). Renderizadas em grade
    linear, em blocos de OBJ 32×32 e 64×64, e como bitmap linear de largura
    32/64/128/240/256: **ruído em todas**.

### A medida que quase me enganou

Duas estatísticas apontaram forte para gráfico, e vale registrar por quê
elas não bastam:

| | índice 0 | entropia |
|---|---|---|
| Tileset de mapa (gráfico **real**) | 11,2% | 89,0% |
| Candidatos em `0x390000` | **72,1%** | **45,1%** |
| Candidatos em `0x8F0000` | **61,8%** | **52,1%** |

Muito índice 0 e entropia baixa é *exatamente* o perfil de sprite com fundo
transparente — e o oposto do tileset, que preenche tudo. A coerência entre
nibbles vizinhos também ficou alta (58–66% contra 40% da referência).

E mesmo assim **nenhuma geometria produziu imagem**. A conclusão é que
essas estatísticas não distinguem sprite de **outro dado esparso
comprimido** — estrutura de nível, script de batalha, tabela esparsa. É o
mesmo engano registrado na primeira rodada: *"as 4 maiores, renderizadas,
são dado comprimido, não tiles"*.

Lição para a próxima investida: **entropia e contagem de zeros não provam
que é gráfico.** Só renderizar prova.

## O que sobra

**Rastrear o `spriteIndex` pelo código que o indexa.** A constante do job
table (`0x08521A14`) aparece em 8 pools literais:

```
0xC8598  0xC8D88  0xC8DE4  0xC953C
0x12FEF4 0x12FF28 0x130830 0x134158
```

Os vizinhos nesses pools são endereços de código (`0x0C8xxx`), não tabelas
de dados. Seguir daqui exige **desmontar ARM/Thumb de verdade** e rastrear o
uso do registrador — não dá para fazer por padrão de bytes.

É trabalho de engenharia reversa com desassemblador, de resultado incerto.

## A alternativa que funciona

`vram-rip.js`, nesta mesma pasta. Não decodifica nada: o hardware do GBA
**obriga** o jogo a converter para tile 4bpp + RGB555 na VRAM para desenhar.
O decodificador que falta já está dentro do jogo — basta rodar e ler.

O preço é ser incremental: a VRAM só tem o que está na cena, então a
extração vira uma batalha por vez. Em troca, é determinística.

Ver `DUMP-VRAM.md` para o procedimento.

> E há um ganho que a análise estática não daria: despejando a mesma unidade
> parada, andando e atacando, saem **os estados de animação reais** — que é
> exatamente o dado estruturado que falta para preencher os frame groups
> (`Idle`, `Moving`, `Attacking`, `Casting`, `Hurt`, `Dying`).
