@echo off
REM ---------------------------------------------------------------------------
REM V.I.P.E.R. Supervisor Edition - developer build launcher
REM Starts the LAN node + Vite web dashboard (npm run dev:all) on port 3061
REM and opens the dashboard in the default browser.
REM ---------------------------------------------------------------------------
title V.I.P.E.R. Supervisor - Dev
cd /d "%~dp0"

set "APP_PORT=3061"

if not exist node_modules (
  echo Installing dependencies ^(first run^)...
  call npm install
)

echo.
echo   V.I.P.E.R. Supervisor Edition - developer build
echo   LAN node ^(ws://localhost:7071^) + web dashboard ^(http://localhost:%APP_PORT%^)
echo   Close this window to stop both.
echo.

REM Open the dashboard once the dev server has had a moment to come up.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:%APP_PORT%/'"

call npm run dev:all
