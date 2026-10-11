@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\build.ps1"
exit /b %ERRORLEVEL%
