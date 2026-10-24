#!/usr/bin/env bash
#
# Verify that staged launcher artifacts actually embed the frontend in dist/.
#
# Why this exists:
#   Tauri embeds the frontend at *compile* time (distDir = "../dist"), and
#   tauri.conf.json leaves beforeBuildCommand empty, so a release build silently
#   embeds whatever happens to be in dist/ at that moment. Build a binary after
#   the frontend source changed but before `npm run build`, and you publish a
#   launcher with a stale UI -- with no build error anywhere.
#
#   The embedded bundle name (index-<hash>.js) is the cheapest reliable
#   fingerprint for that, and the same comparison also catches the other
#   failure mode seen in practice: shipping the capitalised `Xryloth.exe` CLI
#   leftover instead of the real lowercase `xryloth.exe` cargo output.
#
# Usage: scripts/verify-launcher-assets.sh [version]      e.g. 6.0.0.3
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/src-tauri/src/lib.rs"

VER="${1:-}"
if [ -z "$VER" ]; then
  VER="$(sed -n 's/.*APP_DISPLAY_VERSION: &str = "\([0-9.]*\)".*/\1/p' "$LIB" | head -1)"
fi
if [ -z "$VER" ]; then
  echo "error: could not read APP_DISPLAY_VERSION from $LIB; pass a version" >&2
  exit 1
fi

DIR="$ROOT/release-v$VER/launcher"
[ -d "$DIR" ] || { echo "error: no staged artifacts in $DIR" >&2; exit 1; }

JS="$(basename "$(ls -t "$ROOT"/dist/assets/index-*.js | head -1)")"
echo "version : $VER"
echo "fresh   : dist/assets/$JS"
echo "staged  : $DIR"
echo ""

# Command the Settings > General uninstall button calls. If it is absent from a
# binary but present in the frontend, the UI and backend are from different
# builds.
REQUIRED="uninstall_launcher"

fail=0
note() { printf '  %-38s %s\n' "$1" "$2"; }

check_binary() {                       # <label> <binary>
  local label="$1" bin="$2" js
  if [ ! -f "$bin" ]; then note "$label" "MISSING ($bin)"; fail=1; return; fi
  js="$(strings -a "$bin" | grep -oE 'index-[A-Za-z0-9_-]{8}\.js' | sort -u | tr '\n' ' ')"
  case " $js " in
    *" $JS "*) note "$label" "ok  embedded $JS" ;;
    *)         note "$label" "STALE  embedded: ${js:-<none>}  expected: $JS"; fail=1 ;;
  esac
  if ! grep -qa "$REQUIRED" "$bin"; then
    note "$label" "MISSING command '$REQUIRED'"; fail=1
  fi
}

# An NSIS installer keeps the app in a (usually compressed) payload, so the
# markers are not visible in the .exe itself. Unpack it and check the binary
# that actually ships.
check_windows_asset() {                # <label> <installer>
  local label="$1" file="$2" work inner
  if [ ! -f "$file" ]; then note "$label" "MISSING ($file)"; fail=1; return; fi

  if strings -a "$file" | grep -qa "$REQUIRED"; then
    check_binary "$label" "$file"
    return
  fi

  if ! command -v 7z >/dev/null 2>&1 && ! command -v 7za >/dev/null 2>&1; then
    note "$label" "compressed payload and no 7z to unpack it - check by hand"; fail=1
    return
  fi

  work="$(mktemp -d)"
  ( cd "$work" && 7z x -y "$OLDPWD/$file" >/dev/null 2>&1 ) || 7z x -y "$file" -o"$work" >/dev/null 2>&1
  inner="$(find "$work" -maxdepth 2 -type f \( -iname 'Xryloth.exe' -o -iname 'xryloth.exe' \) | head -1)"
  if [ -z "$inner" ]; then
    note "$label" "could not find the app inside the installer"; fail=1
  else
    check_binary "$label (payload)" "$inner"
  fi
  rm -rf "$work"
}

# Windows: cargo emits lowercase `xryloth.exe`; the capitalised Xryloth.exe is a
# stale CLI copy and must never be staged.
for f in "$DIR"/*_Windows64.exe "$DIR"/*_windows32.exe; do
  [ -e "$f" ] && check_windows_asset "$(basename "$f")" "$f"
done

# Linux: the frontend sits inside the AppImage's squashfs payload.
APP="$(ls "$DIR"/*_linux.appImage 2>/dev/null | head -1 || true)"
if [ -n "$APP" ]; then
  [ -x "$APP" ] || chmod +x "$APP"
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  ( cd "$WORK" && "$APP" --appimage-extract >/dev/null 2>&1 )
  INNER="$(find "$WORK/squashfs-root/usr/bin" -maxdepth 1 -type f -size +10M | head -1)"
  check_binary "$(basename "$APP")" "$INNER"
else
  note "linux appImage" "MISSING"; fail=1
fi

echo ""
if [ "$fail" -ne 0 ]; then
  echo "FAILED -- do not upload. Rebuild the frontend (npm run build) and rebuild the binaries."
  exit 1
fi
echo "OK -- every staged artifact embeds the current frontend and exposes '$REQUIRED'."
