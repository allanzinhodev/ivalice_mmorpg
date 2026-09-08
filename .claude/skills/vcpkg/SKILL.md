---
name: vcpkg
description: Como compilar e rodar o ivalice - vcpkg, build do client em OpenGL, build do server, banco de dados, datapack e reaproveitamento das dependências já compiladas do backlands. Use ao compilar, buildar, configurar CMake ou subir client/server do ivalice, ou quando um build falhar por não encontrar dependências do vcpkg.
---

# Build do ivalice

**Nada de caminho absoluto neste documento é garantido.** O projeto é
compilado em mais de uma máquina e a raiz do repo, a raiz do vcpkg e a edição
do Visual Studio mudam entre elas. Descubra sempre em vez de assumir:

| O quê | Como descobrir |
|---|---|
| raiz do vcpkg | `$VCPKG_ROOT` (já definido no ambiente) |
| Visual Studio | `vswhere.exe -latest -property installationPath` |
| repo | o diretório de trabalho / `%~dp0` no `.bat` |

Toolchain file para CMake:

```
-DCMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%/scripts/buildsystems/vcpkg.cmake
```

Se um preset ou build falhar por não achar as dependências, passe o toolchain
file acima explicitamente.

## Manifest mode

Client e server são projetos vcpkg separados, cada um com seu próprio
`vcpkg.json` e seu próprio `builtin-baseline`:

- `client/vcpkg.json`
- `server/vcpkg.json`

O server ainda carrega overlay ports via `server/vcpkg-configuration.json`,
apontando para `server/vcpkg-overlays/`.

Por isso, invoque o vcpkg / configure o CMake a partir do diretório do projeto
correspondente (`client/` ou `server/`), nunca da raiz do repo.

## Client: compilar em OpenGL

Configuração **`OpenGL|x64`** (não DirectX). Alvo: `otclient_gl_x64.exe`.
As configs disponíveis em `client/vc23/otclient.sln` são `OpenGL`, `DirectX` e
`Debug`, cada uma em `Win32` e `x64`.

## Reaproveitar o build do backlands

Existe um checkout do backlands na mesma máquina (nesta, em
`C:\Users\Allan\backlands-workflow`; noutras já foi `D:\backlands`) com o mesmo
client e o mesmo server **já compilados**. Os arquivos de build dos dois repos
são idênticos — confira por hash antes de reaproveitar:

```bash
for f in vcpkg.json CMakeLists.txt vc23/otclient.vcxproj; do
  sha1sum "client/$f" "$BACKLANDS/client/$f"
done
```

O que muda entre os repos é só `src/` e os assets.

### Client: copiar `vcpkg_installed/` FUNCIONA

~2.9 GB, triplet `x64-windows-static`, para `client/vcpkg_installed/`. É a parte
lenta de um primeiro build (boost, openssl, luajit, angle...). O MSBuild do
`vc23/otclient.vcxproj` linka direto contra o que estiver lá, sem revalidar
ABI, então a árvore copiada é usada como está.

Medido: `robocopy /MT:16` leva ~1,5 min e o build completo do client sai em
**~9 min** (v145, unity build, LTCG no fim). Sem isso, é hora.

Os objs (`vc23/otclient/x64/OpenGL/`, ~1,2 GB) **não** valem a cópia: num clone
novo todo `.cpp` tem mtime mais recente que os objs, então o MSBuild recompila
tudo do mesmo jeito.

### Server: copiar `vcpkg_installed/` NÃO funciona

Duas armadilhas, as duas já pagas:

1. **O lugar é outro.** O fluxo do server é CMake, e o toolchain do vcpkg
   instala em `${CMAKE_BINARY_DIR}/vcpkg_installed` — ou seja,
   `server/build/vcpkg_installed/`, não `server/vcpkg_installed/`. Copiar para
   a raiz do projeto não tem efeito nenhum.
2. **O vcpkg revalida.** Diferente do MSBuild, o toolchain CMake recalcula o
   ABI hash de cada porta (que inclui a versão do compilador). Se o VS foi
   atualizado desde o build do backlands, os hashes não batem e o vcpkg
   **desinstala a árvore copiada e recompila**. Foi o que aconteceu.

O reaproveitamento que de fato funciona no server é o **binary cache** do
vcpkg, em `%LOCALAPPDATA%\vcpkg\archives` — ele é global à máquina e
compartilhado entre os dois repos. Num build limpo aqui, 7 das 14 portas foram
restauradas do cache em ~1 s; só o `openssl` (que não estava no cache)
precisou compilar de verdade.

## Docker / produção — stack SEPARADA, prefixo `ivalice`

O ivalice tem **sua própria stack de containers**, não compartilha com o
backlands. Motivo: o `Dockerfile` faz `COPY data /srv/data/` — o **datapack é
assado dentro da imagem**, então rodar o container do backlands serviria o
datapack errado.

**Todo recurso do Docker leva o prefixo `ivalice`:**

| Recurso | Nome |
|---|---|
| Imagem | `ivalice-tfs` |
| Container do server | `ivalice-server` |
| Container do banco | `ivalice-db` |
| Rede | `ivalice-net` |
| Volume | `ivalice-data` |
| Projeto compose | `ivalice` (`docker compose -p ivalice`) |

Se as duas stacks subirem juntas, separar também **portas** e **banco**:
`config.lua.dist` usa `loginProtocolPort 7171` / `gameProtocolPort 7172` e
`mysqlHost 127.0.0.1` — conflitam lado a lado.

O que ainda é reaproveitado: o **cache de camadas do Docker**. As etapas caras
(`vcpkg install --triplet x64-linux` e o build do CMake) vêm *antes* do
`COPY data` e só dependem de `vcpkg.json`, `vcpkg-configuration.json`,
`vcpkg-overlays`, `cmake`, `src` e `CMakeLists.txt` — o Docker reaproveita
sozinho enquanto esses não mudarem. Stack separada não custa recompilar tudo.

Notas:
- `deploy.sh` roda o binário **nativo** (`pgrep tfs`, SIGTERM, troca o binário),
  não o container. São dois fluxos distintos.
- O `Dockerfile` copia `key.pem` para a imagem — é a chave do protocolo do TFS.

### Quando `docker ps` falha com 500 no npipe `dockerDesktopLinuxEngine`

**Não é o Docker Desktop.** Vale a pena diagnosticar antes de reinstalar: o
sintoma é sempre o mesmo, mas a causa pode ser a máquina não ter o backend de
virtualização.

Nesta máquina os processos do Docker Desktop sobem normalmente, mas o motor
Linux nunca fica pronto — o backend registra `backend is not running` há dias.
A causa está abaixo do Docker:

```
wsl --status  ->  Class not registered
                  Wsl/CallMsi/Install/REGDB_E_CLASSNOTREG
```

E os três serviços que WSL2 e Docker precisam **não existem**:

```powershell
Get-Service LxssManager, vmcompute, vmms   # nenhum encontrado
```

O pacote `MicrosoftCorporationII.WindowsSubsystemForLinux` está instalado
(status Ok), mas as *features* do Windows não. O hipervisor até está presente
(VBS rodando), então é só habilitar — **precisa de admin e reinicialização**:

```powershell
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
# reiniciar, depois:
wsl --update
```

Enquanto isso não for feito, **não há Docker nesta máquina** — use o caminho
nativo (build com `build-ivalice.bat` + MariaDB local, abaixo).

## Build do server no Windows (validado)

Use `server/build-ivalice.bat` — ele chama o vcvars64, poe cmake/ninja no PATH
e roda configure + build. Gera `server/build/tfs.exe`.

Toolchain confirmado nesta maquina: **Visual Studio 18 (2026) Community** em
`C:\Program Files\Microsoft Visual Studio\18\Community`, com MSVC 14.51,
CMake 4.2.3 e Ninja 1.13.2 embutidos (nao ha cmake/ninja no PATH global).
Triplet: `x64-windows` (dinamico) — e o que existe no backlands.

### Armadilhas ja enfrentadas

- **O .bat precisa de CRLF.** Com LF o `cmd.exe` nao interpreta as linhas e o
  script sai sem fazer nada, sem mensagem de erro.
- **`cmd.exe /c` a partir do bash** pode abrir o shell interativo em vez de
  executar. Rodar via PowerShell, com `.\` antes do nome do .bat.
- Para rodar, o binario precisa de `data/`, `config.lua` e `key.pem` no
  diretorio de trabalho (o build so copia as DLLs).
- Warnings `Loot:setIdFromName Unknown loot item` sao esperados no datapack
  minimo: os monstros referenciam itens que nao existem mais no items.otb.
  Inofensivo (nao ha spawns), so ruidoso.

### Banco para teste

O que separa o ivalice do backlands é o **nome do banco**, não a porta: o
backlands usa `forgottenserver`, o ivalice usa `ivalice`. Os dois podem
conviver no mesmo servidor MySQL.

Com Docker:

```
docker run -d --name ivalice-db -e MARIADB_ROOT_PASSWORD=ivalice \
  -e MARIADB_DATABASE=ivalice -e MARIADB_USER=ivalice \
  -e MARIADB_PASSWORD=ivalice -p 3316:3306 mariadb:11
```

Porta **3316** de propósito, para não conflitar com um MySQL local na 3306.
No `config.lua`: `mysqlPort = 3316`.

**Sem Docker** (o caso desta máquina), há um MariaDB nativo em
`C:\Users\Allan\mariadb`, rodando na 3306, com `root` sem senha:

```bash
MDB=/c/Users/Allan/mariadb/bin/mariadb.exe
"$MDB" -u root -e "
CREATE DATABASE IF NOT EXISTS ivalice CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'ivalice'@'localhost' IDENTIFIED BY 'ivalice';
CREATE USER IF NOT EXISTS 'ivalice'@'127.0.0.1' IDENTIFIED BY 'ivalice';
GRANT ALL PRIVILEGES ON ivalice.* TO 'ivalice'@'localhost';
GRANT ALL PRIVILEGES ON ivalice.* TO 'ivalice'@'127.0.0.1';"
"$MDB" -u ivalice -pivalice ivalice < server/schema.sql
```

O `schema.sql` já vem com a conta de teste semeada: **account `1` / senha `1`**,
com 4 personagens. No `config.lua`: `mysqlUser/Pass/Database = "ivalice"`,
`mysqlPort = 3306`.

`config.lua` não é versionado (`server/.gitignore:209`) — copie de
`config.lua.dist` e ajuste esses campos.

## Projecao isometrica: armadilhas ja enfrentadas

A projecao vive em `MapView::transformPositionTo2D` e as constantes em
`client/src/client/const.h` (`TILE_HALF_W/H`, `FLOOR_LIFT`).

Tres bugs custaram tempo e valem lembrar:

- **Tela preta com a projecao correta.** O `Tibia.dat` tinha displacement
  `(0, 65520)` -- o -16 lido como unsigned, porque `ThingType::unserialize`
  usa `getU16()`. Esse valor entra no `screenRect` (thingtype.cpp:540) e joga
  o sprite para fora da tela. Rode `node tools/datapack-gen/fix-dat.js`.

- **Chao invisivel.** Itens sem `ThingAttrGround` (atributo 0) fazem
  `Tile::drawGround` dar `break` na primeira iteracao. Mesmo script corrige.

- **Metade do mapa cortada.** A origem da projecao fica DENTRO do campo de
  tiles, nao no topo. Os extremos tem que vir dos quatro cantos projetados,
  tanto em `updateGeometry` quanto em `calcFramebufferSource`.

Para diagnosticar: instrumente `Tile::drawGround` logando `dest`. Se as
coordenadas variam +-16 em X e +8 em Y, a projecao esta certa e o problema
esta depois (sprite, displacement, framebuffer).

### O displacement NÃO é para ser chutado

Vale mais que as três armadilhas acima, porque elimina a categoria inteira.
Para uma thing 1x1, `ThingType::draw` calcula
`screenRect.topLeft = dest + textureOffset - displacement`, e a textura
desenhada É o `textureOffset` (o bbox dos pixels não transparentes, calculado
em `ThingType::getTexture`). Os dois se cancelam, e sobra:

> **o displacement é o ponto do canvas 32x32 que cai em `dest`.**

Chame esse ponto de âncora. Não importa onde o desenho está dentro do sprite —
mude o desenho de lugar e o displacement continua valendo.

E `dest` tem um significado fixo, definido pela inversa usada no picking
(`MapView::getPosition`): ela dá o tile para todo ponto `(sx,sy)` relativo a
`dest` com `0 <= sx + 2*sy < 32` e `0 <= 2*sy - sx < 32` — o losango cujo
**vértice superior** está em `dest`. Logo:

| thing | onde deve cair | âncora |
|---|---|---|
| chão | vértice superior do losango | `(16, 0)` |
| criatura | pés no centro da célula | `(16, pés_y - 8)` |
| efeito / missile | centro do desenho no centro da célula | `(16, 16 - 8)` |

`gen-things.js` rasteriza o chão com a **mesma inequação** do picking, então
render e clique concordam pixel a pixel e a tesselação sai sem folga nem
sobreposição — por construção, não por tentativa e erro de offset.

Displacement negativo continua sendo válido e suportado (o `.dat` grava u16 mas
o valor é int16 — ver `ThingType::unserialize`); ele significa "`dest` cai fora
do canvas, acima/à esquerda". Nenhuma thing do datapack mínimo precisa disso.

### Datapack do client: `gen-things.js`

`client/data/things/860/{Tibia.dat,Tibia.spr,Tibia.otfi}` **não são
versionados** (`client/.gitignore:2`), então um clone novo não tem o que
desenhar. Não refaça no Object Builder:

```bash
node tools/datapack-gen/gen-things.js   # gera .dat + .spr + .otfi
node tools/datapack-gen/verify.js       # confere server E client
```

O `verify.js` cruza os dois lados: todo id de chão do `items.otb` precisa ter
ThingType no `.dat` e o atributo `ThingAttrGround` — era exatamente o bug de
"chão invisível que parece erro de projeção". Ele também decodifica o `.spr`
como o `SpriteManager` decodifica, o que pega o caso do `transparency: true`
faltando no `.otfi` (pixels lidos como RGB, stream dessincronizado).

### Ids de item

O formato `.dat` reserva os ids 1..99: itens comecam em **100**
(`thingtypemanager.cpp`, `firstId = 100`). Ids abaixo disso existem no
server mas nao no client.

### Automacao do client

`SendKeys`/`mouse_event` **nao chegam** de forma confiavel ao client OpenGL.
Caminhada, picking e projeteis precisam de teste manual.

## Não versionar

`tools/rom.gba` é a ROM comercial de FFTA — mantida **fora** do repositório
(risco de DMCA). O FFTAUtils já espera que o usuário forneça a ROM: veja
`tools/FFTAUtils/BIN/rom/PLACE_ROMFILE_ffta.gba_HERE`.
