# Sistema isométrico

Documento de planejamento. O `/client` e o `/server` estão no estado inicial
do repositório; a implementação anterior vive no branch `hardtest`.

---

## Constantes que não mudam

Geometria do losango. Vale para qualquer implementação.

```
Célula      32 × 16 px
Meia-largura   16
Meia-altura     8

Projeção        screenX = offsetX + (col - row) * 16
                screenY = offsetY + (col + row) * 8

Inversa         col = (sx/16 + sy/8) / 2
(picking)       row = (sy/8 - sx/16) / 2
```

**Ordem de desenho:** anti-diagonal `(col + row)` crescente — quem está
atrás desenha primeiro.

Dois avisos de geometria, não de projeto:

- A inversa precisa de `floor` em **float**. Divisão inteira trunca em
  direção a zero e erra o tile à esquerda/acima da câmera, onde as
  coordenadas são negativas.
- **Tamanho da célula ≠ tamanho do sprite.** A arte pode ser maior que o
  losango que ela ocupa.

---

## Como a altura é expressa

*O ponto em aberto. Descreva aqui o que carrega a altura e como ela vira
pixel na tela.*

## Camadas

*Quantas, o que cada uma carrega, e em que ordem desenham em relação ao
personagem.*

## O que o server precisa saber

*O que é lógica de jogo (andável, bloqueio, altura para movimento) e o que é
só visual — o server não precisa saber do resto.*

## Formato dos assets

*Como a arte chega ao jogo.*

---

## Decisões tomadas

| Questão | Decisão | Por quê |
|---|---|---|
| | | |

## Em aberto

-
