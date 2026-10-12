@echo off
chcp 65001 >nul
"%~dp0CaptureHelper.exe" recover "%LOCALAPPDATA%\MengrenDownloader\Capture"
pause
