---
name: vcpkg
description: Como compilar o ivalice - vcpkg root, build em OpenGL, e reaproveitamento das dependências já compiladas em D:\backlands\client. Use ao compilar, buildar ou configurar CMake em ivalice (client ou server), ou quando um build falhar por não encontrar dependências do vcpkg.
---

# Build do ivalice

**vcpkg root: `D:\vcpkg`**

Toolchain file para CMake:

```
-DCMAKE_TOOLCHAIN_FILE=D:/vcpkg/scripts/buildsystems/vcpkg.cmake
```

`VCPKG_ROOT` já está definido no ambiente com esse mesmo valor, então
normalmente não é preciso passar nada explicitamente. Se um preset ou build
falhar por não achar as dependências, passe o toolchain file acima.

## Manifest mode

Client e server são projetos vcpkg separados, cada um com seu próprio
`vcpkg.json` e seu próprio `builtin-baseline`:

- `client/vcpkg.json`
- `server/vcpkg.json`

O server ainda carrega overlay ports via `server/vcpkg-configuration.json`,
apontando para `server/vcpkg-overlays/`.

Por isso, invoque o vcpkg / configure o CMake a partir do diretório do projeto
correspondente (`D:\ivalice\client` ou `D:\ivalice\server`), nunca da raiz
`D:\ivalice`.

## Client: compilar em OpenGL

Configuração **`OpenGL|x64`** (não DirectX). Alvo: `otclient_gl_x64.exe`.
As configs disponíveis em `client/vc23/otclient.sln` são `OpenGL`, `DirectX` e
`Debug`, cada uma em `Win32` e `x64`.

## Reaproveitar o build de D:\backlands\client

`D:\backlands\client` é o mesmo client já compilado. Use como base para não
recompilar tudo do zero — lá já estão `otclient_gl_x64.exe`, `.exp`, `.lib` e
`.pdb` prontos.

**O ganho real é o `vcpkg_installed/`** (~2.9 GB, triplet `x64-windows-static`):
é a árvore de dependências já compilada, que é a parte lenta de um primeiro
build. `D:\ivalice\client` **não** tem `vcpkg_installed/`, então sem
reaproveitar isso o vcpkg recompila boost, openssl, luajit, angle etc.

Reaproveitar é seguro porque os arquivos de build dos dois repos são
**idênticos** (verificado por hash):

- `vcpkg.json` — mesmas dependências, mesmo override de `openal-soft 1.23.1#2`,
  mesmo `builtin-baseline` `389e18e8`
- `CMakeLists.txt`
- `vc23/otclient.vcxproj`

Ou seja, as dependências compiladas servem sem rebuild. O que muda entre os dois
repos é só o código em `src/` e os assets.

Também existe `D:\backlands\client\vc23\otclient\x64\OpenGL\` (~1.2 GB de objs)
— reaproveitável, mas cuidado: qualquer header tocado invalida boa parte, e o
build incremental só é confiável se a árvore de fontes corresponder. O
`vcpkg_installed/` é o reaproveitamento de baixo risco; os objs são bônus.

Antes de copiar por cima, confira se os hashes ainda batem — se `vcpkg.json`
divergir (dependência nova, baseline diferente), o `vcpkg_installed/` fica
desatualizado e precisa ser refeito.

## Server: reaproveitar D:\backlands\server

Mesma situação do client: `D:\ivalice\server` **não** tem `vcpkg_installed/`, e
`vcpkg.json` + `CMakeLists.txt` são **idênticos** aos de `D:\backlands\server`.
Copiar o `vcpkg_installed/` de lá (~0.23 GB) evita recompilar as dependências.

### Docker / produção — stack SEPARADA, prefixo `ivalice`

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
- O daemon do Docker pode não estar rodando nesta máquina (`docker ps` falha no
  npipe `dockerDesktopLinuxEngine`). Subir o Docker Desktop antes.
- `deploy.sh` roda o binário **nativo** (`pgrep tfs`, SIGTERM, troca o binário),
  não o container. São dois fluxos distintos.
- O `Dockerfile` copia `key.pem` para a imagem — é a chave do protocolo do TFS.

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

```
docker run -d --name ivalice-db -e MARIADB_ROOT_PASSWORD=ivalice \
  -e MARIADB_DATABASE=ivalice -e MARIADB_USER=ivalice \
  -e MARIADB_PASSWORD=ivalice -p 3316:3306 mariadb:11
```

Porta **3316** de proposito, para nao conflitar com um MySQL local na 3306.
No `config.lua`: `mysqlUser/Pass/Database = "ivalice"`, `mysqlPort = 3316`.

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
