@echo off
for %%I in ("%~dp0..") do set "OOMAGENT_PI_ROOT=%%~fI"
set "OOMAGENT_WINDOWS_STATE=%OOMAGENT_PI_ROOT%\.portable\windows"
set "PI_CODING_AGENT_DIR=%OOMAGENT_WINDOWS_STATE%\agent"
set "PI_CODING_AGENT_SESSION_DIR="
set "PI_MANAGED_INSTALL_ROOT="
set "PI_SESSION_ID="
set "PI_SESSION_FILE="
set "PI_PACKAGE_DIR="
set "PI_SKIP_VERSION_CHECK=1"
set "PI_SELF_UPDATE_COMMAND=cmd.exe /d /c exit 1"
set "PLAYWRIGHT_BROWSERS_PATH=%OOMAGENT_WINDOWS_STATE%\browsers"
set "OOMAGENT_PYTHON=%OOMAGENT_WINDOWS_STATE%\python\Scripts\python.exe"
set "PATH=%OOMAGENT_PI_ROOT%;%OOMAGENT_WINDOWS_STATE%\node-v25.6.1-win-x64;%OOMAGENT_WINDOWS_STATE%\python\Scripts;%PATH%"
if not exist "%PI_CODING_AGENT_DIR%\settings.json" (
  echo Run powershell -NoProfile -ExecutionPolicy Bypass -File "%OOMAGENT_PI_ROOT%\setup.ps1" first.
  exit /b 1
)
exit /b 0
