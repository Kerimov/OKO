@echo off
setlocal
set NODE_OPTIONS=--experimental-sqlite
cd /d "%~dp0"
start "" "%~dp0ОКО Заполнение.exe" %*
