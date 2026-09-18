@echo off
REM Build do mvp (Windows, MSVC + Ninja + vcpkg). Ver .claude/skills/vcpkg/SKILL.md.
REM ATENCAO: este arquivo PRECISA de quebras de linha CRLF -- com LF o
REM cmd.exe nao interpreta as linhas e o script sai sem fazer nada.
setlocal

if not defined VCPKG_ROOT (
  echo ERRO: VCPKG_ROOT nao esta definido.
  exit /b 1
)
if not exist "%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake" (
  echo ERRO: toolchain do vcpkg nao encontrado em "%VCPKG_ROOT%".
  exit /b 1
)
REM Guarda o VCPKG_ROOT do ambiente ANTES do vcvars64 -- o vcvars64.bat do
REM VS2026 (build 18) SOBRESCREVE VCPKG_ROOT para o vcpkg embutido dele
REM (C:\...\VC\vcpkg), que nesta maquina trava esperando lock indefinidamente
REM (--x-wait-for-lock nunca resolve). Ver skill vcpkg.
set "REAL_VCPKG_ROOT=%VCPKG_ROOT%"

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

REM Restaura o VCPKG_ROOT real e garante que ele vem ANTES do vcpkg do VS no
REM PATH, para "where vcpkg"/o toolchain nunca resolverem para o embutido.
set "VCPKG_ROOT=%REAL_VCPKG_ROOT%"

REM O vcpkg chama "git --version" para o hash do compilador. Nesta maquina o
REM primeiro git.exe do PATH e o do MSYS2/devkitPro (C:\devkitPro\msys2\...),
REM que trava indefinidamente sem erro -- confirmado isolado, fora deste
REM script. O Git for Windows normal funciona; forcamos ele na frente so
REM aqui, sem tocar no PATH global da maquina.
if exist "%ProgramFiles%\Git\cmd\git.exe" (
  set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
)

set "PATH=%VSDIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;%VSDIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;%VCPKG_ROOT%;%PATH%"

cd /d "%~dp0"

echo === CONFIGURE ===
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_TOOLCHAIN_FILE="%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake" -DVCPKG_TARGET_TRIPLET=x64-windows
if errorlevel 1 exit /b 1
echo === BUILD ===
cmake --build build
