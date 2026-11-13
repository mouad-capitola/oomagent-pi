@echo off
setlocal
call "%~dp0portable\windows-env.cmd"
if errorlevel 1 exit /b 1
rem Only this configuration repository has Linux-specific project MCP defaults.
rem Its resources are already loaded by the Windows global profile.
if /I "%CD%"=="%OOMAGENT_PI_ROOT%" (
  "%OOMAGENT_WINDOWS_STATE%\node-v25.6.1-win-x64\node.exe" "%OOMAGENT_WINDOWS_STATE%\pi-source\packages\coding-agent\dist\cli.js" %* --no-approve
) else (
  "%OOMAGENT_WINDOWS_STATE%\node-v25.6.1-win-x64\node.exe" "%OOMAGENT_WINDOWS_STATE%\pi-source\packages\coding-agent\dist\cli.js" %*
)
exit /b %ERRORLEVEL%
