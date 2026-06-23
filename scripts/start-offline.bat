@echo off
cd /d "%~dp0"
title OKO Offline
start "OKO Offline Server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
ping -n 3 127.0.0.1 >nul
start http://localhost:8787/
echo.
echo OKO Offline opened in your browser.
echo Do not close the "OKO Offline Server" window while you work.
echo.
pause
