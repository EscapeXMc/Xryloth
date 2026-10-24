#!/usr/bin/env bash
#
# Finalize the electron-builder .deb for release.
#
# Why this exists:
#   * electron-builder derives the Debian version from package.json, and Cargo /
#     electron-builder reject a 4-part semver like "6.0.0.2". Debian accepts it,
#     so the control file is rewritten here. This is what makes 6.0.0.2 an
#     actual upgrade over an installed 6.0.0.
#   * `dpkg-deb -b` defaults to zstd on Ubuntu 24.04, which older dpkg (22.04)
#     cannot read, so the payload is repacked with xz.
#   * The published filename uses a lowercase ".deb" extension. GNOME Software
#     only recognises the lowercase `*.deb` suffix, so a capital ".Deb" file
#     fails to open on double-click with:
#       "no application was created for running file-to-app on plugin=packagekit"
#
# Usage: scripts/finalize-deb.sh <display-version>      e.g. 6.0.0.2
#
set -euo pipefail

VER="${1:?usage: finalize-deb.sh <display-version>  e.g. 6.0.0.2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/src-tauri/xryloth-installer/dist"

SRC="$(ls -t "$DIST"/xryloth-installer_*_amd64.deb 2>/dev/null | head -1 || true)"
if [ -z "$SRC" ]; then
  echo "error: no xryloth-installer_*_amd64.deb in $DIST (run: npm run build:linux)" >&2
  exit 1
fi

OUT_DIR="$ROOT/release-v$VER/installer"
OUT="$OUT_DIR/xryloth_v${VER}_linux.deb"

# The asset filename is the download contract, so it is asserted here.
# GNOME Software only opens a lowercase ".deb"; a capital ".Deb" fails with
# "no application was created for running file-to-app on plugin=packagekit".
# GitHub also compares asset names case-insensitively, so a ".Deb" and a ".deb"
# cannot coexist on one release -- an accidental re-introduction would 422 on
# upload, or silently leave only the broken name published.
if [ "$(basename "$OUT")" != "$(basename "$OUT" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "error: release asset name must be lowercase: $(basename "$OUT")" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "source : $SRC"
dpkg-deb -R "$SRC" "$WORK/pkg"
sed -i "s/^Version: .*/Version: $VER/" "$WORK/pkg/DEBIAN/control"

# The installer's window reports WM_CLASS "xryloth-installer". Without a matching
# StartupWMClass, GNOME cannot tie the running installer to this entry and the
# dock falls back to a generic icon; and the entry must reference its icon by
# the name that is actually installed into the icon theme. electron-builder
# writes both, so assert them here instead of trusting the build config.
DESKTOP="$WORK/pkg/usr/share/applications/xryloth-installer.desktop"
[ -f "$DESKTOP" ] || { echo "error: $DESKTOP missing from the package" >&2; exit 1; }
for want in "Icon=xryloth-installer" "StartupWMClass=xryloth-installer"; do
  grep -qx "$want" "$DESKTOP" || { echo "error: desktop entry is missing '$want'" >&2; exit 1; }
done
# A nested object in linux.desktop is serialised as this by electron-builder <26.
if grep -q "\[object Object\]" "$DESKTOP"; then
  echo "error: desktop entry contains a mis-serialised value: $(grep '\[object Object\]' "$DESKTOP")" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
dpkg-deb -b -Zxz --root-owner-group "$WORK/pkg" "$OUT"

echo "output : $OUT"
dpkg-deb -I "$OUT" | grep -E '^ (Package|Version):'
echo "-- description --"
dpkg-deb -f "$OUT" Description | head -3
