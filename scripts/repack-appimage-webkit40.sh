#!/usr/bin/env bash
# Repack a Tauri v1 AppImage so it works on distros without webkit2gtk-4.0
# (e.g. Ubuntu 24.04). Adds the vendored webkit2gtk-4.0 helper processes and
# exports LD_LIBRARY_PATH so those helpers can find the bundled libs.
set -euo pipefail

APPIMAGE="${1:?usage: repack-appimage-webkit40.sh <in.AppImage> <out.AppImage>}"
OUT="${2:?usage: repack-appimage-webkit40.sh <in.AppImage> <out.AppImage>}"
APPIMAGE="$(readlink -f "$APPIMAGE")"
OUT="$(readlink -f "$OUT" 2>/dev/null || echo "$OUT")"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
PREFIX="${WEBKIT40_PREFIX:-$HOME/.local/share/xryloth-compat/webkit40}"
LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"

[ -d "$LIBDIR/webkit2gtk-4.0" ] || { echo "missing $LIBDIR/webkit2gtk-4.0" >&2; exit 1; }

WORK="$(mktemp -d /tmp/opencode/repack.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# 1. Locate the squashfs superblock (version_major==4 at +28) -> runtime size.
OFF="$(python3 - "$APPIMAGE" <<'PY'
import sys
d = open(sys.argv[1], 'rb').read(4_000_000)
i = 0
best = -1
while True:
    i = d.find(b'hsqs', i)
    if i < 0:
        break
    if d[i + 28:i + 30] == b'\x04\x00':
        best = i
    i += 1
print(best)
PY
)"
[ "$OFF" -gt 0 ] || { echo "squashfs offset not found" >&2; exit 1; }
echo "runtime size: $OFF bytes"

head -c "$OFF" "$APPIMAGE" > runtime.bin

# 2. Extract AppDir.
"$APPIMAGE" --appimage-extract >/dev/null

# 3. Drop the unused webkit 4.1 / 6.0 stack (avoids any libsoup2+3 clash, shrinks image).
rm -f  squashfs-root/usr/lib/libwebkit2gtk-4.1.so.0 \
       squashfs-root/usr/lib/libjavascriptcoregtk-4.1.so.0 \
       squashfs-root/usr/lib/libwebkitgtk-6.0.so.4 \
       squashfs-root/usr/lib/libjavascriptcoregtk-6.0.so.1 \
       squashfs-root/usr/lib/libsoup-3.0.so.0
rm -rf squashfs-root/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 \
       squashfs-root/usr/lib/x86_64-linux-gnu/webkitgtk-6.0

# 4. Add the webkit2gtk-4.0 helper processes where WebKit looks for them
#    (WebKit chdir()s to $APPDIR/usr, so the compiled-in /usr/lib/... path
#     resolves to $APPDIR/usr/lib/x86_64-linux-gnu/webkit2gtk-4.0/).
mkdir -p squashfs-root/usr/lib/x86_64-linux-gnu
cp -a "$LIBDIR/webkit2gtk-4.0" squashfs-root/usr/lib/x86_64-linux-gnu/

# 5. Make the helper children find libwebkit2gtk-4.0.so.37 etc.
HOOK="squashfs-root/apprun-hooks/linuxdeploy-plugin-gtk.sh"
printf '\nexport LD_LIBRARY_PATH="$APPDIR/usr/lib:$APPDIR/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\n' >> "$HOOK"

# 6. Repack: original runtime + fresh squashfs.
mksquashfs squashfs-root new.sqfs -comp gzip -b 128K -all-root -noappend -no-xattrs -no-progress >/dev/null
cat runtime.bin new.sqfs > "$OUT"
chmod +x "$OUT"
echo "wrote $OUT ($(stat -c %s "$OUT") bytes)"
