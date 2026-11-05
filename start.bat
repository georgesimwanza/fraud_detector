@echo off
rem Starts the fraud detection system: inference service (port 8000) and web app (port 3000),
rem each in its own window, then opens the browser.
rem
rem   start.bat          inference + web
rem   start.bat sim      also run the simulator (200 synthetic transactions at 3/s)
rem
rem A shadow (challenger) model is loaded automatically if models\shadow\stub-challenger exists.
rem Stop everything with stop.bat.

setlocal
cd /d "%~dp0"

rem ---- prerequisites --------------------------------------------------------------------------
if not exist ".venv\Scripts\uvicorn.exe" (
  echo [start] Python venv missing. Run once:  py -3.12 -m venv .venv ^&^& .venv\Scripts\pip install -r inference\requirements.txt -r training\requirements.txt
  exit /b 1
)
if not exist "web\node_modules" (
  echo [start] web\node_modules missing. Run once:  cd web ^&^& npm install
  exit /b 1
)
if not exist "inference\.env" (
  echo [start] inference\.env missing. Copy inference\.env.example and fill it in.
  exit /b 1
)
if not exist "web\.env.local" (
  echo [start] web\.env.local missing. Copy web\.env.example and fill it in.
  exit /b 1
)

powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 5432); $c.Close() } catch { exit 1 }"
if errorlevel 1 (
  echo [start] PostgreSQL is not answering on localhost:5432. Start the postgresql-x64-18 service first.
  exit /b 1
)

for %%P in (3000 8000) do (
  netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul && (
    echo [start] Port %%P is already in use. Is the app already running? Use stop.bat first.
    exit /b 1
  )
)

rem ---- inference service --------------------------------------------------------------------
set "SHADOW="
if exist "models\shadow\stub-challenger\metadata.json" (
  set "SHADOW=set SHADOW_MODEL_BUNDLE=..\models\shadow\stub-challenger&& "
  echo [start] Shadow model: stub-challenger
)
echo [start] Starting inference service on http://127.0.0.1:8000 ...
start "Fraud - inference" cmd /k "cd /d "%~dp0inference" && %SHADOW%..\.venv\Scripts\uvicorn app.main:app --port 8000 --env-file .env"

rem ---- web app ----------------------------------------------------------------------------------
echo [start] Starting web app on http://localhost:3000 ...
start "Fraud - web" cmd /k "cd /d "%~dp0web" && npm run dev"

rem ---- wait until each answers (TensorFlow can take a few minutes to load on a cold start) ------
echo [start] Waiting for the web app (first compile can take a minute)...
call :wait http://localhost:3000/login 300
if errorlevel 1 (
  echo [start] Web app not ready after 5 minutes. Check the "Fraud - web" window for errors.
  exit /b 1
)
echo [start] Web app ready.
echo [start] Waiting for the inference service (loading TensorFlow and the model)...
call :wait http://127.0.0.1:8000/health 300
if errorlevel 1 (
  echo [start] Inference not ready after 5 minutes. Check the "Fraud - inference" window for errors.
  exit /b 1
)
echo [start] Inference ready.

echo [start] Ready: http://localhost:3000
start "" http://localhost:3000

if /i "%~1"=="sim" (
  echo [start] Starting the simulator...
  start "Fraud - simulator" cmd /k "cd /d "%~dp0" && .venv\Scripts\python simulator\simulate.py --synthetic --rate 3 --count 200 --fraud-share 0.1"
)
endlocal
exit /b 0

rem :wait <url> <seconds> - polls the URL every 2 s until it answers or the time runs out.
:wait
powershell -NoProfile -Command "$end = (Get-Date).AddSeconds(%2); do { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 '%1' | Out-Null; exit 0 } catch { Start-Sleep -Seconds 2 } } while ((Get-Date) -lt $end); exit 1"
exit /b %errorlevel%
