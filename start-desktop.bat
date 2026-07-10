@echo off
REM V.I.P.E.R. Supervisor Edition - DESKTOP shell (Electron)
REM Launches the LAN node + Vite web server + the Electron desktop window,
REM which hosts the embedded ICAC Data System (IDS) browser with in-app
REM download capture. Use start.bat for the plain web (browser) build.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
call npm run desktop
