@echo off
rem Stops what start.bat started: the processes listening on ports 3000 (web) and 8000 (inference),
rem the simulator, and their console windows. PostgreSQL is left running.

setlocal
cd /d "%~dp0"

for %%P in (3000 8000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    echo [stop] Port %%P: stopping process %%I
    taskkill /PID %%I /T /F >nul 2>&1
  )
)

rem Close the windows start.bat opened (cmd adds the running command to the title, hence the *).
for %%T in ("Fraud - inference" "Fraud - web" "Fraud - simulator") do (
  taskkill /FI "WINDOWTITLE eq %%~T*" /T /F >nul 2>&1
)

echo [stop] Stopped.
endlocal
