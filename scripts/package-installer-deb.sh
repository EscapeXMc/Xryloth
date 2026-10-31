#!/usr/bin/env bash
#
# Package the compiled Rust `xryloth_installer` binary into a Debian .deb.
#
# The installer is a self-contained Tauri app (frontend + installer.html are
# embedded in the binary at compile time). It only needs the WebKit/GTK runtime,
# which are declared as deb dependencies.
#
# Usage: scripts/package-installer-deb.sh <display-version>   e.g. 6.0.0.16
#
set -euo pipefail

VER="${1:?usage: package-installer-deb.sh <display-version>  e.g. 6.0.0.16}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SRC_BIN="$ROOT/src-tauri/target/x86_64-unknown-linux-gnu/release/xryloth_installer"
if [ ! -f "$SRC_BIN" ]; then
  echo "error: $SRC_BIN not found (build the Linux installer bin first)"
  exit 1
fi

PKG="xryloth-installer_${VER}_amd64"
STAGE="$ROOT/release/deb-stage/$PKG"
OUT_DIR="$ROOT/release"
ICON_SRC="$ROOT/public/logo.png"

rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN"
mkdir -p "$STAGE/opt/XrylothInstaller"
mkdir -p "$STAGE/usr/share/applications"
mkdir -p "$STAGE/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$STAGE/usr/bin"

# Binary
install -m 755 "$SRC_BIN" "$STAGE/opt/XrylothInstaller/xryloth_installer"

# Icon
install -m 644 "$ICON_SRC" "$STAGE/usr/share/icons/hicolor/256x256/apps/xryloth-installer.png"

# PATH shim
cat > "$STAGE/usr/bin/xryloth-installer" <<EOF
#!/bin/sh
exec /opt/XrylothInstaller/xryloth_installer "\$@"
EOF
chmod 755 "$STAGE/usr/bin/xryloth-installer"

# Desktop entry
cat > "$STAGE/usr/share/applications/xryloth-installer.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Xryloth Installer
GenericName=Minecraft Launcher Installer
Comment=Download and install the Xryloth Minecraft Launcher
Exec=/opt/XrylothInstaller/xryloth_installer
Icon=xryloth-installer
Terminal=false
Categories=Game;
StartupNotify=true
EOF

# Control file — minimal, distro-agnostic dependency set.
# Only libwebkit2gtk-4.1-0 is listed as the runtime: its own Depends chain
# pulls GTK3/javascriptcore/cairo/pango/atk/gstreamer with the correct package
# names for the target release (t64 vs non-t64). Listing those directly caused
# "not installable" errors (e.g. the non-existent libgdk-3-0, or libgtk-3-0
# vs libgtk-3-0t64). Fuse is the one soft dep needed by the AppImage launcher.
cat > "$STAGE/DEBIAN/control" <<EOF
Package: xryloth-installer
Version: ${VER}
Section: games
Priority: optional
Architecture: amd64
Maintainer: EscapeX <escape@xrylothclient.com>
Depends: libwebkit2gtk-4.1-0, libfuse2 | libfuse2t64
Description: Xryloth Launcher bootstrap installer (Linux)
 Self-contained installer for the Xryloth Minecraft Launcher.
 Installs, updates, and uninstalls the launcher. Downloads the latest
 launcher build from GitHub on first run.
 .
 libwebkit2gtk-4.1-0 pulls the full WebKit/GTK runtime this app needs
 (GTK3, javascriptcore, cairo, pango, atk, gstreamer) using whatever
 package names your distro release uses (works on t64 releases such as
 Ubuntu 24.04+ and older non-t64 releases alike).
 .
 libfuse2 (or libfuse2t64 on newer releases) is required to run the
 downloaded AppImage launcher after installation.
EOF

# Build with xz compression (zstd breaks on older dpkg)
dpkg-deb -b -Zxz "$STAGE" "$OUT_DIR/xryloth_v${VER}_linux.deb"

echo "Built: $OUT_DIR/xryloth_v${VER}_linux.deb"
ls -lh "$OUT_DIR/xryloth_v${VER}_linux.deb"
