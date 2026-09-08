@echo off
REM Build do server ivalice (Windows, MSVC + Ninja + vcpkg).
REM Gera o binario em build/ (tfs.exe). Ver .claude/skills/vcpkg/SKILL.md.
REM ATENCAO: este arquivo PRECISA de quebras de linha CRLF -- com LF o
REM cmd.exe nao interpreta as linhas e o script sai sem fazer nada.
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
set VCPKG_ROOT=D:\vcpkg
set PATH=C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;%PATH%
cd /d D:\ivalice\server
echo === CONFIGURE ===
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_TOOLCHAIN_FILE=D:/vcpkg/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-windows -DBUILD_TESTING=OFF
if errorlevel 1 exit /b 1
echo === BUILD ===
cmake --build build
