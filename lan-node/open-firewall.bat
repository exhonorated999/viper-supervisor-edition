@echo off
REM ---------------------------------------------------------------------------
REM Allow other computers on the LAN to reach the V.I.P.E.R. Supervisor node.
REM Opens BOTH:
REM   TCP 7071 - encrypted WebSocket transport (the actual data link)
REM   UDP 7071 - zero-config discovery (laptops broadcast to find this node)
REM Run this ONCE on the SUPERVISOR machine, as Administrator
REM (right-click -> "Run as administrator").
REM ---------------------------------------------------------------------------
echo Adding Windows Firewall rules for the V.I.P.E.R. Supervisor node...

netsh advfirewall firewall delete rule name="VIPER LAN Node 7071 TCP" >nul 2>&1
netsh advfirewall firewall delete rule name="VIPER LAN Node 7071 UDP" >nul 2>&1
netsh advfirewall firewall delete rule name="VIPER LAN Node 7071" >nul 2>&1

REM profile=any so it works on Public Wi-Fi too (many routers report the
REM network as "Public", which previously left 7071 blocked).
netsh advfirewall firewall add rule name="VIPER LAN Node 7071 TCP" dir=in action=allow protocol=TCP localport=7071 profile=any
netsh advfirewall firewall add rule name="VIPER LAN Node 7071 UDP" dir=in action=allow protocol=UDP localport=7071 profile=any

if %errorlevel%==0 (
  echo.
  echo   Done. Inbound TCP+UDP 7071 allowed on ALL networks (incl. Public).
  echo   Investigators can now auto-discover this machine, reachable at:
  for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo       ws://%%a:7071
) else (
  echo.
  echo   FAILED. Make sure you ran this as Administrator.
)
echo.
pause
