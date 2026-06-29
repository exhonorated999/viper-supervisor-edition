@echo off
REM ---------------------------------------------------------------------------
REM V.I.P.E.R. Supervisor Edition - developer build launcher
REM Starts the LAN node + Vite web dashboard (npm run dev:all) on port 3061
REM and opens the dashboard in a dedicated app window (Edge/Chrome --app).
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

REM Locate a Chromium browser (Edge first, then Chrome) for app-window mode.
set "BROWSER="
for %%P in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) do (
  if exist %%P if not defined BROWSER set "BROWSER=%%~P"
)

REM Open the dashboard in a dedicated app window once the dev server is up.
REM Falls back to the default browser if no Chromium browser is found.
if defined BROWSER (
  start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process '%BROWSER%' -ArgumentList '--app=http://localhost:%APP_PORT%/','--window-size=1440,900'"
) else (
  start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:%APP_PORT%/'"
)

call npm run dev:all
