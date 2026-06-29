@echo off
REM ---------------------------------------------------------------------------
REM Allow inbound LAN connections to the V.I.P.E.R. LAN node (TCP 7071).
REM Run this ONCE on the SUPERVISOR machine, as Administrator
REM (right-click -> "Run as administrator").
REM ---------------------------------------------------------------------------
echo Adding Windows Firewall rule for V.I.P.E.R. LAN node (TCP 7071)...

netsh advfirewall firewall delete rule name="VIPER LAN Node 7071" >nul 2>&1
netsh advfirewall firewall add rule name="VIPER LAN Node 7071" dir=in action=allow protocol=TCP localport=7071 profile=private,domain

if %errorlevel%==0 (
  echo.
  echo   Done. Inbound TCP 7071 is now allowed on Private/Domain networks.
  echo   Investigators can reach this machine at:
  for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo       ws://%%a:7071
) else (
  echo.
  echo   FAILED. Make sure you ran this as Administrator.
)
echo.
pause
