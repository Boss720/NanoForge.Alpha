@echo off
setlocal
title NanoForge Installer
cd /d "%~dp0"

echo ==========================================================
echo         NanoForge Windows Distribution Installer          
echo ==========================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-nanoforge.ps1" %*
set INSTALL_EXIT_CODE=%ERRORLEVEL%

if %INSTALL_EXIT_CODE% NEQ 0 (
    echo.
    echo [ERROR] Installation failed with error code %INSTALL_EXIT_CODE%.
    echo Please check the error messages above.
    echo.
    pause
    exit /b %INSTALL_EXIT_CODE%
)

echo.
if "%~1"=="" (
    echo Press any key to exit installer...
    pause >nul
)
exit /b 0
