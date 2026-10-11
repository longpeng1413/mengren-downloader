@echo off
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-dev.ps1"
set "setupCode=%ERRORLEVEL%"
echo.
pause
exit /b %setupCode%
