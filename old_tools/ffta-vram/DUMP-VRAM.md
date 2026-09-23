# Como despejar as sprites de unidade do FFTA (GBA)

## Por que assim

As sprites de unidade do FFTA **não cederam à análise estática** da ROM. Está
registrado em [vram-rip.js](vram-rip.js) o que já foi descartado, para a
próxima tentativa não repetir o caminho:

- **tabela de ponteiros** — 2557 candidatas com ≥120 ponteiros válidos, nenhuma
  com header de compressão uniforme nos alvos;
- **tabela de structs** perto do job table (`0x521A14`) — cai sempre no
  `itemLocNames` (`0x526680`), que é texto;
- **regiões com estatística de 4bpp** — as 4 maiores, renderizadas, são dado
  comprimido, não tiles;
- **streams LZ77 de tamanho uniforme** — 204 streams de exatamente 4096 bytes
  (128 tiles) pareciam promissores (204 ≈ 2 × os ~102 `spriteIndex`), mas
  descomprimidos e renderizados dão ruído.

O `spriteIndex` do job existe e é válido (offset `0x07` do registro, ver
[ffta.js](../ffta-extract/ffta.js)); o que falta é a **indireção** entre ele e
o gráfico.

A saída é não decodificar. **O hardware do GBA não entende formato
proprietário:** para desenhar na tela, o jogo é obrigado a converter tudo para
tile 4bpp e paleta RGB555 na VRAM. O decodificador que falta já está dentro do
FFTA — basta rodar o jogo e ler o resultado.

**O preço:** a VRAM só tem o que está carregado na cena. A extração é
incremental, uma batalha por vez. Em troca, é determinística.

## O que despejar

Entre numa **batalha** e espere os personagens aparecerem na tela. É onde
unidades e monstros estão carregados ao mesmo tempo.

| arquivo | endereço | tamanho | conteúdo |
|---|---|---|---|
| `palette.bin` | `0x05000000` | 1024 | paletas BG + OBJ |
| `objvram.bin` | `0x06010000` | 32768 | **personagens e monstros** |
| `oam.bin` | `0x07000000` | 1024 | como os sprites se montam |

> **Atenção aos endereços — não são os do DS.** No GBA a OBJ VRAM começa em
> `0x06010000` e tem **32 KB**, não 256 KB. A paleta de OBJ fica em
> `0x05000200`; despejar a partir de `0x05000000` também serve (o extrator
> detecta pelo tamanho).

O extrator aceita esses nomes, ou `obj.bin`/`pal.bin`, ou o endereço como nome
(`06010000.bin`).

### Pelo mGBA

`Tools > Memory Viewer`, ir ao endereço, `Save Range` com o tamanho da tabela.

Antes de despejar, `Tools > Game State Views > View Sprites` mostra os OBJs da
cena — se os personagens já aparecem ali, o despejo vem bom.

### Pelo VBA-M

`Tools > Memory Viewer`, mesma ideia. `Tools > OAM Viewer` para conferir a cena.

## Depois

```
node tools/ffta-vram/vram-rip.js <pasta-com-os-dumps>
```

Saída, dentro de `<pasta>/out/`:

| pasta | conteúdo |
|---|---|
| `folhas/` | a OBJ VRAM inteira, um PNG por banco de paleta — **não depende da OAM** |
| `objs/` | um PNG por OBJ ativo, com tamanho, tile e paleta no nome |
| `unidades/` | os OBJs agrupados em personagens, + `unidades.json` |
| `oam.json` | os 128 slots crus, para conferência |

As **folhas** valem sempre: se a OAM pegou a cena errada (menu, transição),
elas ainda mostram o que está carregado.

## Se sair errado

**Sprites fatiadas ou embaralhadas** — o modo de mapeamento (1D/2D) vem do bit
6 do `DISPCNT`, que não está nos despejos. Rode com `--2d`:

```
node tools/ffta-vram/vram-rip.js <pasta> <saida> --2d
```

**Cores erradas** — o banco de paleta vem da OAM, mas se o jogo trocou a
paleta depois do despejo, confira as `folhas/` e ache o banco certo.

**Unidades grudadas** — o agrupamento é por proximidade na tela, é heurística e
não formato. Dois personagens encostados viram uma unidade só. O `oam.json` tem
os OBJs crus para reagrupar à mão.

## O que isto responde

Além das sprites, a OAM diz **como cada pose se monta** — quantos OBJs, de que
tamanho, em que posição. Despejando a mesma unidade em momentos diferentes
(parado, andando, atacando) dá para levantar os **estados de animação reais do
jogo**, que é o que a análise estática não entregou.
