param(
    [string]$Arch = "both"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Xryloth - Build Script (32-bit + 64-bit)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path $MyInvocation.MyCommand.Path -Parent
$srcTauri = Join-Path $projectRoot "src-tauri"

if ($Arch -eq "both" -or $Arch -eq "x64") {
    Write-Host "[1/4] Checking Rust targets..." -Yellow
    rustup target add x86_64-pc-windows-msvc 2>$null
    Write-Host ""

    Write-Host "[2/4] Building 64-bit (x86_64)..." -Yellow
    Set-Location $srcTauri
    cargo build --release --target x86_64-pc-windows-msvc 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] 64-bit build failed!" -ForegroundColor Red
        Set-Location $projectRoot
        exit 1
    }
    Write-Host "[OK] 64-bit build succeeded." -ForegroundColor Green
    Write-Host ""

    Write-Host "[3/4] Bundling 64-bit NSIS/MSI..." -Yellow
    cargo tauri build --target x86_64-pc-windows-msvc 2>&1
    Write-Host ""
}

if ($Arch -eq "both" -or $Arch -eq "x86") {
    Write-Host "[1/4] Checking Rust targets..." -Yellow
    rustup target add i686-pc-windows-msvc 2>$null
    Write-Host ""

    Write-Host "[2/4] Building 32-bit (i686)..." -Yellow
    Set-Location $srcTauri
    cargo build --release --target i686-pc-windows-msvc 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] 32-bit build failed!" -ForegroundColor Red
        Set-Location $projectRoot
        exit 1
    }
    Write-Host "[OK] 32-bit build succeeded." -ForegroundColor Green
    Write-Host ""

    Write-Host "[3/4] Bundling 32-bit NSIS/MSI..." -Yellow
    cargo tauri build --target i686-pc-windows-msvc 2>&1
    Write-Host ""
}

Set-Location $projectRoot
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Build complete!" -ForegroundColor Green
Write-Host "  Check src-tauri/target/ for releases." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Read-Host "Press Enter to exit"