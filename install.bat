@echo off
setlocal

echo === YourTube Native Client Installer ===

where git >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: 'git' is not installed. Please install git first.
    pause
    exit /b 1
)

where cargo >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: 'cargo' (Rust) is not installed. Please install it from https://rustup.rs first.
    pause
    exit /b 1
)

set TEMP_DIR=%TEMP%\yourtube_install_%RANDOM%
mkdir "%TEMP_DIR%"
cd /d "%TEMP_DIR%"

echo Downloading YourTube...
git clone --depth 1 https://github.com/shirushimori/YourTube.git
cd YourTube\rust-client

echo Building client...
cargo build --release

echo Installing client and registering browser manifests...
.\target\release\yourtube-client.exe --install

echo Cleaning up...
cd /d "%USERPROFILE%"
rmdir /s /q "%TEMP_DIR%"

echo.
echo === Done! ===
echo The native client is successfully installed.
echo You can now install the YourTube extension from the Firefox Add-on Store or Chrome Web Store.
pause
