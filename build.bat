@echo off
echo ============================================
echo  Xryloth - Build Script (32-bit + 64-bit)
echo ============================================
echo.

echo [1/4] Checking Rust targets...
rustup target add i686-pc-windows-msvc 2>nul
rustup target add x86_64-pc-windows-msvc 2>nul
echo.

echo [2/4] Building 64-bit (x86_64)...
cd src-tauri
cargo build --release --target x86_64-pc-windows-msvc 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 64-bit build failed!
    cd ..
    exit /b 1
)
echo [OK] 64-bit build succeeded.
echo.

echo [3/4] Building 32-bit (i686)...
cargo build --release --target i686-pc-windows-msvc 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 32-bit build failed!
    cd ..
    exit /b 1
)
echo [OK] 32-bit build succeeded.
echo.

echo [4/4] Bundling installers...
echo   Bundling 64-bit NSIS/MSI...
cargo tauri build --target x86_64-pc-windows-msvc 2>&1
echo   Bundling 32-bit NSIS/MSI...
cargo tauri build --target i686-pc-windows-msvc 2>&1
cd ..
echo.

echo ============================================
echo  Build complete! Check src-tauri/target/
echo  for both x86_64 and i686 releases.
echo ============================================
pause