@echo off
REM V.I.P.E.R. Supervisor Edition - launches the LAN node + web dashboard
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
call npm run dev:all
