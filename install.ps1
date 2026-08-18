Write-Host "=== YourTube Native Client Installer ===" -ForegroundColor Cyan

# 1. Check prerequisites
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'git' is not installed. Please install git first." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'cargo' (Rust) is not installed. Please install it from https://rustup.rs first." -ForegroundColor Red
    exit 1
}

# 2. Clone into temp directory
$TempDir = Join-Path $env:TEMP "yourtube_install_$([guid]::NewGuid().ToString().Substring(0,8))"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
Set-Location $TempDir

Write-Host "Downloading YourTube..." -ForegroundColor Yellow
git clone --depth 1 https://github.com/shirushimori/YourTube.git
Set-Location "YourTube\rust-client"

# 3. Build & Install
Write-Host "Building client..." -ForegroundColor Yellow
cargo build --release

Write-Host "Installing client and registering browser manifests..." -ForegroundColor Yellow
.\target\release\yourtube-client.exe --install

# 4. Cleanup
Write-Host "Cleaning up..." -ForegroundColor Yellow
Set-Location $env:USERPROFILE
Remove-Item -Recurse -Force $TempDir

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "The native client is successfully installed."
Write-Host "You can now install the YourTube extension from the Firefox Add-on Store or Chrome Web Store."
