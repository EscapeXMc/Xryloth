#!/usr/bin/env bash
#
# Does a launcher come back when it is started again while minimised?
#
# This is the "the launcher minimises itself" regression check. A second launch
# never opens a second window; it hands over to the running copy, which has to
# ask the window manager to restore and raise the window. On GNOME that request
# is refused from the application itself (its focus request looks stale next to
# the click that started us), so the launcher sends a taskbar-style
# _NET_ACTIVE_WINDOW as well -- see the WINDOW ACTIVATION section in
# src-tauri/src/lib.rs.
#
# What it does, against a throwaway HOME so an installed launcher and the real
# desktop are never touched:
#
#   1. start the AppImage and wait for its window
#   2. minimise the window the way a taskbar button does (ICCCM WM_CHANGE_STATE)
#   3. start a second copy -> it hands over and exits
#   4. ASSERT the window is no longer minimised (WM_STATE Normal, no
#      _NET_WM_STATE_HIDDEN). This is the regression: before 6.0.0.8 the window
#      stayed Iconic and only the taskbar entry was flagged.
#
# Needs an X11 session (DISPLAY) and python3-xlib. Usage:
#
#   scripts/verify-launcher-window.sh <linux.appImage>
#
# Exits 0 on PASS, 1 on FAIL, 2 on a missing prerequisite.
set -uo pipefail

APP="${1:?usage: verify-launcher-window.sh <linux.appImage>}"
[ -s "$APP" ] || { echo "  no such file: $APP"; exit 2; }
command -v python3 >/dev/null || { echo "  SKIP: python3 is required"; exit 2; }
python3 -c 'import Xlib' 2>/dev/null || { echo "  SKIP: python3-xlib is required (apt install python3-xlib)"; exit 2; }
[ -n "${DISPLAY:-}" ] || { echo "  SKIP: needs an X11 session (DISPLAY is unset)"; exit 2; }

# A locked session refuses window activation from anybody -- the launcher's own
# request and a dock-style one both get ignored, so this check can only be run at
# an unlocked screen. (Measured: while locked the window stays `WM_STATE=Iconic`
# and not even `_NET_ACTIVE_WINDOW` from another client restores it.)
session_locked() {
  local answer uid session
  answer="$(timeout 5 gdbus call --session --dest org.gnome.ScreenSaver \
    --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.GetActive 2>/dev/null)"
  case "$answer" in
    *true*) return 0 ;;
    *false*) return 1 ;;
  esac
  uid="$(id -u)"
  for session in $(loginctl list-sessions --no-legend 2>/dev/null | awk -v u="$uid" '$2 == u { print $1 }'); do
    [ "$(loginctl show-session "$session" -p LockedHint --value 2>/dev/null)" = "yes" ] && return 0
  done
  return 1
}
if session_locked; then
  echo "  SKIP: the session is locked. GNOME refuses window activation while the"
  echo "        screen is locked (nothing can restore a minimised window then), so"
  echo "        this check has to be run with the screen unlocked."
  exit 2
fi

if ! python3 - <<'PY'
# Is a launcher already up? It holds its single-instance port for as long as it
# runs, which is a precise answer -- matching command lines would also match this
# script's own arguments.
import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", 51543))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
then
  echo "  SKIP: a launcher is already running (its single-instance port is taken);"
  echo "        a second launch would hand over to that window, not to this test's"
  exit 2
fi

WORK="$(mktemp -d /tmp/opencode/verify-window.XXXXXX)"
LOG="$WORK/launcher.log"
PROBE="$WORK/probe.py"
DESK="$WORK/Desktop"
rm -rf "$WORK/home" "$DESK"
mkdir -p "$WORK/home/.config" "$WORK/home/.local/share" "$DESK"

# Keep every XDG lookup (including the Desktop directory) inside the throwaway
# HOME: GTK reads these, and a test must never be able to touch the real desktop.
cat > "$WORK/home/.config/user-dirs.dirs" <<EOF
XDG_DESKTOP_DIR="$DESK"
XDG_DOCUMENTS_DIR="$WORK/home/Documents"
XDG_DOWNLOAD_DIR="$WORK/home/Downloads"
XDG_PICTURES_DIR="$WORK/home/Pictures"
EOF
mkdir -p "$WORK/home/Documents" "$WORK/home/Downloads" "$WORK/home/Pictures"

cat > "$PROBE" <<'PY'
"""find/minimise/report the launcher window (WM_CLASS 'xryloth') over X11."""
import sys
from Xlib import display, X, protocol

CLASS = "xryloth"


def windows(d):
    out = []
    for w in d.screen().root.query_tree().children:
        try:
            cls = w.get_wm_class()
        except Exception:
            continue
        if cls and any(CLASS == c.lower() for c in cls if c):
            out.append(w)
    return out


def real(d):
    """The mapped window; GTK's tiny group-leader window carries the same class."""
    wins = windows(d)
    for w in wins:
        try:
            if w.get_attributes().map_state == 2:
                return w
        except Exception:
            pass
    return wins[-1] if wins else None


def report(d, w):
    st = w.get_full_property(d.intern_atom("WM_STATE"), X.AnyPropertyType)
    state = {0: "Withdrawn", 1: "Normal", 3: "Iconic"}.get(st.value[0] if st else None)
    prop = w.get_full_property(d.intern_atom("_NET_WM_STATE"), X.AnyPropertyType)
    names = [d.get_atom_name(a) for a in prop.value] if prop else []
    hidden = "minimised" if ("_NET_WM_STATE_HIDDEN" in names or state == "Iconic") else "visible"
    print(f"{state or 'None'} {' '.join(names) or '[]'} -> {hidden}")


def main():
    d = display.Display()
    cmd = sys.argv[1]
    w = real(d)
    if w is None:
        print("nowindow")
        return 0
    if cmd == "state":
        report(d, w)
    elif cmd == "iconify":
        ev = protocol.event.ClientMessage(window=w, client_type=d.intern_atom("WM_CHANGE_STATE"),
                                         data=(32, [3, 0, 0, 0, 0]))  # 3 = IconicState
        d.screen().root.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        d.sync()
    return 0


main()
PY

run_app() {                # <app> <seconds-to-wait> ; leaves the pid in APP_PID
  HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/home/.config" XDG_DATA_HOME="$WORK/home/.local/share" \
  DISPLAY="$DISPLAY" GDK_BACKEND=x11 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  nohup "$1" >>"$LOG" 2>&1 &
  APP_PID=$!
}

wait_for_window() {        # <seconds>
  local deadline=$(( $(date +%s) + ${1:-30} ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$(python3 "$PROBE" state 2>/dev/null)" != "nowindow" ]; then return 0; fi
    sleep 1
  done
  return 1
}

cleanup() {
  # Kill only what this test started: processes whose HOME is the throwaway one.
  # Never a blunt pkill -- an installed launcher could be running too.
  for p in $(pgrep -f "launcher.appImage" 2>/dev/null); do
    [ -d "/proc/$p" ] || continue
    if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx "HOME=$WORK/home"; then
      kill "$p" 2>/dev/null
    fi
  done
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  sleep 1
  for p in $(pgrep -f "xryloth" 2>/dev/null); do
    [ -d "/proc/$p" ] || continue
    if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx "HOME=$WORK/home"; then
      kill -9 "$p" 2>/dev/null
    fi
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "=== 1. start the launcher ==="
run_app "$APP" || { echo "  could not start $APP"; exit 1; }
if ! wait_for_window 40; then
  echo "  FAIL: no launcher window appeared"
  tail -15 "$LOG" | sed 's/^/        /'
  exit 1
fi
STATE="$(python3 "$PROBE" state)"
echo "  window: $STATE"
case "$STATE" in
  *visible*) ;;
  *) echo "  FAIL: the launcher started minimised"; exit 1;;
esac

echo ""
echo "=== 2. minimise it like a taskbar button ==="
# The launcher presents itself at startup and checks again about 1.5 s later; from
# 6.0.0.8 that check really does restore a minimised window, so minimise after it
# has passed, and retry in case the window manager is still mid-transition.
sleep 3
MINIMISED=0
for attempt in 1 2 3; do
  python3 "$PROBE" iconify
  sleep 2
  STATE="$(python3 "$PROBE" state)"
  echo "  attempt $attempt -> $STATE"
  case "$STATE" in *minimised*) MINIMISED=1; break;; esac
done
if [ "$MINIMISED" != "1" ]; then
  echo "  FAIL: the window did not stay minimised, so the check cannot run"
  exit 1
fi

echo ""
echo "=== 3. start it again (hand-off to the running copy) ==="
HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/home/.config" XDG_DATA_HOME="$WORK/home/.local/share" \
DISPLAY="$DISPLAY" GDK_BACKEND=x11 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
timeout 30 "$APP" >>"$LOG" 2>&1
echo "  second copy exited with $?"

echo ""
echo "=== 4. the running window must be back ==="
RESTORED=0
for _ in 1 2 3 4 5 6; do
  sleep 1
  STATE="$(python3 "$PROBE" state)"
  echo "  window: $STATE"
  case "$STATE" in *visible*) RESTORED=1; break;; esac
done

echo ""
if [ "$RESTORED" = "1" ]; then
  echo "LAUNCHER-WINDOW-TEST: PASS -- a second launch restores a minimised window"
  exit 0
fi
echo "LAUNCHER-WINDOW-TEST: FAIL -- the window stayed minimised after a second launch"
tail -15 "$LOG" | sed 's/^/        /'
exit 1
