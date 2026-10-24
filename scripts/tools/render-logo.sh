#!/usr/bin/env bash
# Renders the Xryloth mark (scripts/tools/xryloth-logo.svg) to PNGs.
#
# The mark is authored as SVG; the game and the app bundle need raster assets,
# so headless Chrome renders it with a transparent background.
#
# usage: scripts/tools/render-logo.sh <out.png> <size> [more sizes...]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVG="$HERE/xryloth-logo.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/logo.html" <<HTML
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:100vw;height:100vh}
</style></head><body>
$(cat "$SVG")
</body></html>
HTML

for size in "$@"; do
  case "$size" in
    */*) out="$size"; size="$(basename "$out" | sed 's/[^0-9].*//')" ;;
    *)   out="$size" ;;
  esac
  google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --default-background-color=00000000 --window-size="$size,$size" \
    --screenshot="$out" "file://$TMP/logo.html" >/dev/null 2>&1
  echo "rendered $out ($size x $size)"
done
