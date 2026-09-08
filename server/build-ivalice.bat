@echo off
REM Build do server ivalice (Windows, MSVC + Ninja + vcpkg).
REM Gera o binario em build/ (tfs.exe). Ver .claude/skills/vcpkg/SKILL.md.
REM ATENCAO: este arquivo PRECISA de quebras de linha CRLF -- com LF o
REM cmd.exe nao interpreta as linhas e o script sai sem fazer nada.
setlocal

REM --- Visual Studio: descoberto pelo vswhere, nao hardcoded.
REM A edicao muda de maquina para maquina (Community, Enterprise, ...) e um
REM caminho fixo faz o script falhar em silencio na maquina errada.
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo ERRO: vswhere nao encontrado em "%VSWHERE%".
  exit /b 1
)
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
if not defined VSDIR (
  echo ERRO: nenhuma instalacao do Visual Studio com as ferramentas C++ encontrada.
  exit /b 1
)

call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1

REM cmake e ninja vem embutidos no VS -- nao existem no PATH global.
set "PATH=%VSDIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;%VSDIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;%PATH%"

REM --- vcpkg: vem do ambiente, que tambem muda de maquina.
if not defined VCPKG_ROOT (
  echo ERRO: VCPKG_ROOT nao esta definido.
  exit /b 1
)
if not exist "%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake" (
  echo ERRO: toolchain do vcpkg nao encontrado em "%VCPKG_ROOT%".
  exit /b 1
)

REM O diretorio do proprio script -- o repo pode estar em qualquer lugar.
cd /d "%~dp0"

echo === CONFIGURE ===
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_TOOLCHAIN_FILE="%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake" -DVCPKG_TARGET_TRIPLET=x64-windows -DBUILD_TESTING=OFF
if errorlevel 1 exit /b 1
echo === BUILD ===
cmake --build build
