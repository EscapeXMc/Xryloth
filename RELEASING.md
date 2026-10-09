# Releasing Xryloth

The launcher, the installer, and the updater are **one and the same file**.

- A **first-time user** downloads `Xryloth_<version>_x64-setup.exe` and runs it — that installs the app.
- The **updater** inside the app downloads *that same `-setup.exe`* from the newest GitHub
  release, replaces the old files, shows a live log, and restarts the launcher.

There is no separate "update patch" to build.

## Repository

Releases live in **`EscapeXMc/Xryloth`**. The in-app updater reads
`https://api.github.com/repos/EscapeXMc/Xryloth/releases/latest` (see `src-tauri/src/lib.rs`,
`GITHUB_API_URL`). Publish the release there or the updater will not see it.

## How the updater picks a file

The updater scores every asset on the latest release and downloads the best match for the OS:

| Platform | Preferred asset | Score |
|---|---|---|
| Windows | name contains `setup`/`install` and ends `.exe` | 100 |
| Windows | other `.exe` (portable) | 60 |
| Windows | `.msi` | 40 |
| Linux (running as AppImage) | `.AppImage` | 100 |
| Linux (running as AppImage) | `.deb` | 60 |
| Linux (running as `.deb`/portable) | `.deb` | 100 |
| Linux (running as `.deb`/portable) | `.AppImage` | 70 |
| macOS | `.dmg` | 100 |
| macOS | `.app` | 50 |

Because the installer scores highest, it is downloaded even if a portable `.exe` is also
uploaded. Keep the words **`setup`** (or `install`) in the Windows filename.

## Asset names

Upload them in this order (order is not critical for Windows/Linux now that scoring is used,
but it keeps the release tidy):

**Windows**

| Filename | What it is |
|---|---|
| `Xryloth_5.9.1_x64-setup.exe` | 64-bit installer **and** the file the updater downloads |
| `Xryloth_5.9.1_x86-setup.exe` | 32-bit installer |
| `Xryloth_5.9.1_x64-portable.exe` | optional portable build |
| `Xryloth_5.9.1_x86-portable.exe` | optional portable build |

> Two assets on one release cannot share a name. The old portable output is just
> `xryloth.exe`, so **rename it** to include version + arch before uploading.

**Linux**

| Filename | What it is |
|---|---|
| `Xryloth_5.9.1_amd64.AppImage` | portable app; the updater downloads this |
| `Xryloth_5.9.1_amd64.deb` | Debian package |

**macOS** (build on a Mac)

| Filename | What it is |
|---|---|
| `Xryloth_5.9.1_x64.dmg` | Intel installer |
| `Xryloth_5.9.1_aarch64.dmg` | Apple-silicon installer |

## The release tag

- Tag the release `v5.9.1` (the leading `v` is stripped automatically).
- The tag **must be numerically greater** than the version compiled into the app
  (`APP_VERSION`, which tracks `src-tauri/Cargo.toml`). For example, to update users on
  `5.9.0`, publish `v5.9.1` or `v6.0`. A `v5.9.0` release will **not** trigger an update for
  users already on `5.9.0`.
- Publish it as a normal **Release** — drafts and pre-releases are ignored by
  `/releases/latest`.

## Version bump checklist

1. Bump the version in **all** of these so the build and updater agree:
   - `src-tauri/Cargo.toml` → `version = "5.9.1"` (this is what `APP_VERSION` reads)
   - `src-tauri/tauri.conf.json` → `package.version`
   - `package.json` → `version`
2. Rebuild the Windows installers and the Linux bundles.
3. Create the GitHub release with tag `v5.9.1` and the assets named as above.

## Building

### Windows installers (cross-compiled from Linux)

```
cargo xwin build --release --target x86_64-pc-windows-msvc --bin xryloth   # raw exe
cargo xwin build --release --target i686-pc-windows-msvc  --bin xryloth   # raw exe
./node_modules/.bin/tauri build --runner /tmp/opencode/cargowrap/cargo \
    --target x86_64-pc-windows-msvc --bundles nsis
```

`--runner` points at a tiny `cargo` shim that forwards Windows targets to `cargo-xwin`;
`makensis` (the `nsis` package) produces the `-setup.exe`.

### Linux bundles

```
npm run tauri:build:linux
```

### Everything

```
./build-all.sh
```
