# Capturar animação com o sprite view do mGBA

**Este é o caminho mais curto.** Não precisa de script, não precisa compilar
nada, e você escolhe o frame exato em vez de gravar centenas e procurar
depois.

O `dump-frames.lua` continua útil para capturar uma sequência inteira de uma
vez, mas para pegar poses específicas — o golpe da espada, o frame de
impacto — o sprite view é melhor.

## Por que é melhor que o script

O script grava todo frame e depois você procura o golpe no meio. Isso
significa gravar 34 KB × 60 por segundo, que é o que travou o emulador duas
vezes.

Com o sprite view você **pausa no frame que quer** e exporta só ele. O custo
de I/O some, porque não há gravação contínua.

## O procedimento

### 1. Chegue ao momento do golpe

Jogue até a unidade estar pronta para atacar. Deixe o cursor no alvo, um
confirm antes do golpe.

> Salve um save state aqui (`Shift+F1` por padrão). Você vai repetir isso
> para cada animação que quiser, e voltar ao mesmo ponto economiza muito
> tempo.

### 2. Abra as duas janelas

- `Tools > Game State Views > View Sprites` — os OBJs da cena, um a um
- `Tools > Game State Views > View Tiles` — a VRAM inteira, útil quando o
  sprite está montado de vários OBJs

Deixe as duas abertas ao lado do jogo.

### 3. Avance frame a frame

- **Pausar**: `Ctrl+P`
- **Avançar um frame**: `Ctrl+N`

Confirme o ataque e vá batendo `Ctrl+N`. A cada frame o sprite view
atualiza, e você vê a pose mudar.

Quando chegar num frame que interessa — o braço erguido, o impacto — pare.

### 4. Exporte

No sprite view, selecione o OBJ na lista e use o botão de exportar
(`Export` / ícone de salvar). Ele grava o PNG daquele sprite.

Um personagem costuma ser **vários OBJs** (corpo, arma, efeito). Exporte
todos os que compõem a pose; o `Magnification` ajuda a ver qual é qual.

### 5. Repita para cada pose

Volte o save state, avance até o próximo frame de interesse, exporte de
novo. Uma animação de golpe costuma ter 4 a 8 poses distintas.

## O que exportar, na ordem

1. **Frame de preparação** — o braço indo para trás
2. **Frame de impacto** — o momento do golpe, geralmente o mais distinto
3. **Frame de retorno** — voltando à pose neutra
4. **O efeito**, se houver — faísca, corte, brilho

Os intermediários costumam ser interpolação e podem ser recriados.

## Onde guardar

```
assets/ffta/animacoes/<job>/<acao>/NN.png
```

Por exemplo: `assets/ffta/animacoes/soldier/ataque-espada/01.png`

O nome importa porque é o que vai virar frame group depois — o client já tem
os seis estados (`Idle`, `Moving`, `Attacking`, `Casting`, `Hurt`, `Dying`),
ver a skill `frame-groups`.

## Se o sprite view não bastar

Casos em que ele fica no meio do caminho:

- **A pose é montada de muitos OBJs** e exportar um a um é tedioso — aí o
  `View Tiles` mostra a VRAM inteira e você recorta
- **Você quer a sequência completa**, não poses soltas — aí o
  `dump-frames.lua` vale, agora que ele guarda só a VRAM que muda

Me diga qual dos dois travou e eu ajusto o caminho.
