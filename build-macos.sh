#!/bin/bash
set -e

# NOTE: macOS builds require Xcode + a macOS host. They cannot be produced from
# Linux. Run this script on a Mac only.

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: This script must be run on macOS (current host: $(uname -s))."
  echo "       Cross-building .dmg from Linux is not supported."
  exit 1
fi

echo "============================================"
echo "  Xryloth - macOS Build Script"
echo "============================================"
echo ""

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "[1/4] Installing npm dependencies..."
npm install
echo ""

echo "[2/4] Building frontend..."
npm run build
echo ""

echo "[3/4] Building macOS x64..."
rustup target add x86_64-apple-darwin 2>/dev/null || true
cargo tauri build --target x86_64-apple-darwin 2>&1
echo ""

echo "[4/4] Building macOS ARM64 (Apple Silicon)..."
rustup target add aarch64-apple-darwin 2>/dev/null || true
cargo tauri build --target aarch64-apple-darwin 2>&1
echo ""

echo "============================================"
echo "  Build complete!"
echo "  macOS x64: src-tauri/target/x86_64-apple-darwin/release/bundle/"
echo "  macOS ARM64: src-tauri/target/aarch64-apple-darwin/release/bundle/"
echo "============================================"
