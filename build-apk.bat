@echo off
REM NEXCHAT Admin Dashboard APK Build Script for Windows
REM This script automates the APK building process for the admin dashboard

echo.
echo ===================================
echo    NEXCHAT Admin Dashboard APK Builder
echo ===================================
echo.

REM Check if Node.js is installed
node -v >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/5] Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [2/5] Building web application...
call npm run build
if errorlevel 1 (
    echo ERROR: Failed to build web app
    pause
    exit /b 1
)

echo.
echo [3/5] Checking for Capacitor...
if not exist "android" (
    echo [3.1] Adding Android platform...
    call npx cap add android
)

echo.
echo [4/5] Syncing files...
call npm run cap:sync
if errorlevel 1 (
    echo ERROR: Failed to sync files
    pause
    exit /b 1
)

echo.
echo [5/5] Opening Android Studio...
echo Please follow these steps in Android Studio:
echo   1. Click "Build" menu
echo   2. Select "Generate Signed Bundle / APK"
echo   3. Choose "APK" and click Next
echo   4. Configure your signing key
echo   5. Select release build type
echo   6. Click Finish
echo.

call npx cap open android

echo.
echo ===================================
echo    APK Build Process Complete
echo ===================================
echo.
pause
