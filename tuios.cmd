@echo off
setlocal
call "%~dp0portable\windows-env.cmd"
if errorlevel 1 exit /b 1
set "SHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%OOMAGENT_WINDOWS_STATE%\tuios\tuios.exe" --standalone %*
exit /b %ERRORLEVEL%
