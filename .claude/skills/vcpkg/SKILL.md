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

## Não versionar

`tools/rom.gba` é a ROM comercial de FFTA — mantida **fora** do repositório
(risco de DMCA). O FFTAUtils já espera que o usuário forneça a ROM: veja
`tools/FFTAUtils/BIN/rom/PLACE_ROMFILE_ffta.gba_HERE`.
