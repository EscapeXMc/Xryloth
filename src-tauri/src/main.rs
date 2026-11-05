#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    // The launcher's single-instance hand-off, present_running_window and
    // startup activation all talk to the window through Xlib (XWM_CLASS
    // lookups, _NET_ACTIVE_WINDOW, unminimize). A native Wayland window is
    // invisible to every one of those calls, so the window would never be
    // found, raised or restored. Every release up to v6 ran as XWayland
    // (its statically-linked GTK had no Wayland backend compiled in); the
    // dynamically-linked build must pin the same backend explicitly, while
    // still respecting a GDK_BACKEND the user chose themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    xryloth_lib::run();
}
