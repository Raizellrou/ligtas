@echo off
rem Double-click launcher for the local mesh-test demo (docs/ONBOARDING.md
rem Section 4.3). After Docker Desktop is running, this is the only other
rem manual step -- everything past this point is clicking in the browser.
rem
rem Starts the hub (reading packages/hub/.env for its secrets, via Node's
rem own --env-file flag -- no dotenv dependency) and the PWA dev server in
rem their own windows, then opens the browser to the Tester tab.

setlocal
cd /d "%~dp0.."

if not exist "packages\hub\.env" (
  echo packages\hub\.env is missing.
  echo Copy packages\hub\.env.example to packages\hub\.env and fill in real
  echo values first -- see docs\ONBOARDING.md Section 4 and Section 5 for
  echo where to get them.
  pause
  exit /b 1
)

if not exist "packages\hub\dist\index.js" (
  echo Hub isn't built yet -- building it now...
  call pnpm --filter @ligtas/core build
  if errorlevel 1 goto :buildfailed
  call pnpm --filter @ligtas/hub build
  if errorlevel 1 goto :buildfailed
)

echo Starting the hub and the PWA dev server in their own windows...
start "LIGTAS hub" cmd /k "node --env-file=packages\hub\.env packages\hub\dist\index.js"
start "LIGTAS PWA" cmd /k "pnpm --filter @ligtas/pwa dev"

echo Waiting for the PWA dev server to come up...
rem ping as a sleep substitute -- timeout.exe errors out when its stdin
rem isn't a real interactive console, which a script-launched window can't
rem always guarantee; this avoids that entirely.
ping -n 5 127.0.0.1 >nul
start http://localhost:5173

echo.
echo Done. Click the Tester tab, then "Live mesh demo".
echo Docker Desktop must already be running for the mesh buttons to work --
echo this script does not start Docker for you.
goto :eof

:buildfailed
echo Build failed -- see the output above. Fix that first, then re-run this script.
pause
exit /b 1
