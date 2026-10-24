<div align="center">

<img src="https://cdn.jsdelivr.net/gh/EscapeXMc/Xryloth@main/.github/banner.png" alt="Xryloth" width="100%" onerror="this.style.display='none'"/>

# ⚡ XRYLOTH

### The all-in-one Minecraft launcher — built for speed, servers & community.

**One launcher. Every version. Zero friction.**

[![Release](https://img.shields.io/github/v/release/EscapeXMc/Xryloth?style=for-the-badge&color=ff7a18&label=latest)](https://github.com/EscapeXMc/Xryloth/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%7C%20macOS-1e88e5?style=for-the-badge)](#-download)
[![License](https://img.shields.io/badge/license-Proprietary-ef4444?style=for-the-badge)](#-license)

[**Download**](#-download) · [**Features**](#-features) · [**Server Hosting**](#-built-in-server-hosting) · [**FAQ**](#-faq)

</div>

---

## 🚀 Download

Grab the latest build for your platform from the [**Releases page**](https://github.com/EscapeXMc/Xryloth/releases/latest).

<table>
<tr>
<th align="left">Platform</th>
<th align="left">File</th>
<th align="left">Notes</th>
</tr>
<tr>
<td>🪟 <b>Windows 10 / 11 (64-bit)</b></td>
<td><code>Xryloth_x.x.x_x64-setup.exe</code></td>
<td>Recommended — installer + auto-updater</td>
</tr>
<tr>
<td>🪟 <b>Windows (32-bit)</b></td>
<td><code>Xryloth_x.x.x_x86-setup.exe</code></td>
<td>For older 32-bit systems</td>
</tr>
<tr>
<td>🪟 <b>Windows (portable)</b></td>
<td><code>Xryloth_x.x.x_x64-portable.exe</code></td>
<td>No install, just run</td>
</tr>
<tr>
<td>🐧 <b>Linux (AppImage)</b></td>
<td><code>Xryloth_x.x.x_amd64.AppImage</code></td>
<td><code>chmod +x</code> then run</td>
</tr>
<tr>
<td>🐧 <b>Linux (Debian/Ubuntu)</b></td>
<td><code>Xryloth_x.x.x_amd64.deb</code></td>
<td><code>sudo dpkg -i …</code></td>
</tr>
<tr>
<td>🍎 <b>macOS</b></td>
<td><code>Xryloth_x.x.x_*.dmg</code></td>
<td>Intel &amp; Apple Silicon</td>
</tr>
</table>

> **Auto-updates:** install the `-setup.exe` (Windows) or the AppImage (Linux) and Xryloth keeps itself current on every launch.

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🎮 Game & Profiles
- Unlimited **profiles** for every version
- **Vanilla, Fabric, Quilt, Forge, NeoForge** — one click
- Automatic **Java runtime** management
- Per-profile **RAM, JVM args & icon**
- Skin, cape & account manager (Microsoft / offline)

### 🧩 Mods & Packs
- Built-in **Modrinth** browser (mods, plugins, packs)
- **One-click modpacks**
- Automatic **mod dependency** resolution
- Mod conflicts & crash-log analysis
- Resource-pack manager

</td>
<td width="50%" valign="top">

### ⚡ Performance
- **Auto-FPS mods** on every new modded instance
  (Sodium, Lithium, Dynamic FPS, Mod Menu + more)
- Smart version matching — unsupported mods are skipped
- **Game Boost** — one click before you play
- Optimised default game settings

### 🌐 Community & Servers
- **Host your own server** in the launcher
- Publish it **publicly** to the Xryloth website list
- **Live announcements + Discord-style pings**
- Partner servers, community chat & invites
- **Xryloth AI** assistant, built in

</td>
</tr>
</table>

---

## 🖥️ Built-in Server Hosting

Xryloth can host a Minecraft server for you — no command line required.

- **Paper, Purpur, Fabric, Vanilla** (+ more)
- Live **console**, command history & log streaming
- **Properties editor**, plugin marketplace & file manager
- **Backups**, world manager & player tools
- Choose **Private** (only you) or **Public**
  - **Public** servers appear on the Xryloth website server list with name, IP, port, MOTD, icon & tags.
  - **Private** servers are never uploaded — everything stays on your machine.

> Creating a public server? Make sure the port is **forwarded** on your router so other players can join.

---

## ⚡ Performance Mods (Automatic)

Create any **Fabric, Quilt, Forge or NeoForge** profile and Xryloth automatically installs a curated FPS pack into `/mods/`:

`Fabric API` · `Sodium` · `Lithium` · `Dynamic FPS` · `Mod Menu` · `FerriteCore` · `EntityCulling` · `ImmediatelyFast` · `MoreCulling` · `ModernFix` · `Krypton` · `MemoryLeakFix` · `Starlight` · `BadOptimizations` · `ThreadTweak` · `Noisium` · `C2ME` · `Enhanced Block Entities` · `LazyDFU` · `Nvidium`

If a mod has **no build for your exact version**, it is skipped — never force-installed. Toggle this under **Settings → Performance**.

---

## 🛠️ Building from Source

> Xryloth is **proprietary** — see [License](#-license). These notes are for the maintainers.

```bash
npm install          # frontend deps
npm run tauri dev    # run in development
npm run build        # type-check + bundle the frontend
./build-all.sh       # cross-build Windows + Linux release artifacts
```

Outputs land in `release/` ready to upload to a GitHub release.

---

## ❓ FAQ

<details>
<summary><b>Which Minecraft versions are supported?</b></summary>

All release versions that the selected loader supports — from legacy 1.x through the newest snapshots/releases. Xryloth picks a compatible Java runtime automatically.
</details>

<details>
<summary><b>Do I need a Microsoft account?</b></summary>

No. Xryloth works offline with a username, or you can sign in with Microsoft for official servers.
</details>

<details>
<summary><b>Why were some FPS mods skipped?</b></summary>

The mod has no build for your exact Minecraft version. Xryloth only installs compatible mods so your game won't crash.
</details>

<details>
<summary><b>Is my public server always online?</b></summary>

The website listing shows your server's address. It's reachable whenever your server is running and the port is forwarded.
</details>

---

## 📄 License

**Proprietary — All Rights Reserved.**
© Xryloth / EscapeXOG. This software may **not** be copied, modified, or redistributed without written permission. See [`LICENSE`](LICENSE) for details.

<div align="center">

**Made with ❤️ for the Minecraft community.**

</div>
