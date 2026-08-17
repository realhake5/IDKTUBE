@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run idktube locally.
  echo Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

start "idktube server" /b node server.mjs
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:4173
echo idktube is open at http://127.0.0.1:4173
echo The local server is running in the background.
