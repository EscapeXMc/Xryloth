#!/bin/bash
set -e

echo "============================================"
echo "  Xryloth - Cross-Platform Build Script"
echo "  Linux host -> Windows x64/x86 + Linux"
echo "  (produces installers + a ready-to-upload release/ folder)"
echo "============================================"
echo ""

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)"
echo "Version: $VERSION"
echo ""

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
command -v cargo >/dev/null 2>&1 || { echo "ERROR: Rust/cargo not found in PATH"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "ERROR: npm not found in PATH"; exit 1; }
command -v makensis >/dev/null 2>&1 || { echo "ERROR: makensis not found. Install the 'nsis' package."; exit 1; }
command -v cargo-xwin >/dev/null 2>&1 || cargo xwin --version >/dev/null 2>&1 || {
  echo "ERROR: cargo-xwin not found. Install with: cargo install cargo-xwin"; exit 1;
}

# Keep memory use sane on small machines (4 cores / low RAM = avoid OOM).
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
# cargo-xwin needs the x86 MSVC SDK libs for the 32-bit target.
export XWIN_ARCH="${XWIN_ARCH:-x86,x86_64,aarch64}"

# ---------------------------------------------------------------------------
# Ubuntu 24.04 ships webkit2gtk-4.1, but Tauri v1 looks for 4.0.
# If local alias files exist, expose them so the Linux build can link.
# ---------------------------------------------------------------------------
LINUX_COMPAT_DIR="/tmp/opencode"
if [ -d "$LINUX_COMPAT_DIR/pkgconfig" ]; then
  export PKG_CONFIG_PATH="$LINUX_COMPAT_DIR/pkgconfig:${PKG_CONFIG_PATH:-}"
  export LIBRARY_PATH="$LINUX_COMPAT_DIR/lib:${LIBRARY_PATH:-}"
  echo "Using webkit2gtk 4.0 -> 4.1 compatibility files in $LINUX_COMPAT_DIR"
fi

# ---------------------------------------------------------------------------
# Tauri invokes `cargo`; this shim routes Windows MSVC targets to cargo-xwin.
# ---------------------------------------------------------------------------
RUNNER_DIR="$(mktemp -d)"
cat > "$RUNNER_DIR/cargo" <<'SHIM'
#!/bin/sh
for a in "$@"; do
  case "$a" in
    x86_64-pc-windows-msvc|i686-pc-windows-msvc|aarch64-pc-windows-msvc)
      exec "$HOME/.cargo/bin/cargo-xwin" "$@" ;;
  esac
done
exec "$HOME/.cargo/bin/cargo" "$@"
SHIM
chmod +x "$RUNNER_DIR/cargo"

# ---------------------------------------------------------------------------
echo "[1/4] Installing npm dependencies..."
npm install
echo ""

echo "[2/4] Building frontend..."
npm run build
echo ""

echo "[3/4] Building Windows installers (.exe) + portable exes..."
rustup target add x86_64-pc-windows-msvc 2>/dev/null || true
rustup target add i686-pc-windows-msvc 2>/dev/null || true
./node_modules/.bin/tauri build --runner "$RUNNER_DIR/cargo" \
  --target x86_64-pc-windows-msvc --bundles nsis
./node_modules/.bin/tauri build --runner "$RUNNER_DIR/cargo" \
  --target i686-pc-windows-msvc --bundles nsis
echo ""

echo "[4/4] Building Linux x64 (AppImage + .deb)..."
rustup target add x86_64-unknown-linux-gnu 2>/dev/null || true
npm run tauri:build:linux
echo ""

# ---------------------------------------------------------------------------
# Collect ready-to-upload assets with release-friendly names.
# ---------------------------------------------------------------------------
rm -rf release
mkdir -p release

X64_DIR="src-tauri/target/x86_64-pc-windows-msvc/release"
X86_DIR="src-tauri/target/i686-pc-windows-msvc/release"
LINUX_DIR="src-tauri/target/x86_64-unknown-linux-gnu/release"
BUNDLE="$LINUX_DIR/bundle"

cp "$X64_DIR/bundle/nsis/Xryloth_${VERSION}_x64-setup.exe" "release/Xryloth_${VERSION}_x64-setup.exe" 2>/dev/null || \
  cp "$X64_DIR"/bundle/nsis/*.exe "release/Xryloth_${VERSION}_x64-setup.exe"
cp "$X86_DIR/bundle/nsis/Xryloth_${VERSION}_x86-setup.exe" "release/Xryloth_${VERSION}_x86-setup.exe" 2>/dev/null || \
  cp "$X86_DIR"/bundle/nsis/*.exe "release/Xryloth_${VERSION}_x86-setup.exe"
# The Tauri build renames the binary to the product name (Xryloth.exe).
X64_EXE="$(ls "$X64_DIR"/Xryloth.exe "$X64_DIR"/xryloth.exe 2>/dev/null | head -1)"
X86_EXE="$(ls "$X86_DIR"/Xryloth.exe "$X86_DIR"/xryloth.exe 2>/dev/null | head -1)"
[ -n "$X64_EXE" ] && cp "$X64_EXE" "release/Xryloth_${VERSION}_x64-portable.exe"
[ -n "$X86_EXE" ] && cp "$X86_EXE" "release/Xryloth_${VERSION}_x86-portable.exe"
cp "$BUNDLE/appimage/xryloth_${VERSION}_amd64.AppImage" "release/Xryloth_${VERSION}_amd64.AppImage" 2>/dev/null || \
  cp "$BUNDLE"/appimage/*.AppImage "release/Xryloth_${VERSION}_amd64.AppImage"
cp "$BUNDLE/deb/xryloth_${VERSION}_amd64.deb" "release/Xryloth_${VERSION}_amd64.deb" 2>/dev/null || \
  cp "$BUNDLE"/deb/*.deb "release/Xryloth_${VERSION}_amd64.deb"

echo "============================================"
echo "  Build complete!  Tag this release: v$VERSION"
echo "============================================"
ls -1sh release/
echo ""
echo "  Upload the files in release/ to the GitHub release."
echo "  The updater downloads *-setup.exe (Windows) / *.AppImage (Linux)."
echo ""
echo "  macOS is NOT built by this script (requires Xcode; use build-macos.sh on a Mac)."
echo "============================================"
