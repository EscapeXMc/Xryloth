# Xryloth Session Notes

## Version: 5.9.0

## Features Completed

### Previous Sessions
- Java auto-detection/download (8, 16, 17, 21)
- XrylothAI (4 tabs), Settings Java, Instance Java Status
- Offline auth fix, CMD window fix, Not Responding fix
- Instance Cloning, Dark/Light Theme Toggle
- Keyboard Shortcuts, Multiplayer Page, Resource Pack Preview
- Plugin/Server Support, Instance Grid/List View Toggle
- Instance Sorting, Pin Instances, Drag & Drop
- Recent Games Dashboard, Screenshot Gallery, Batch Install
- Instance Export/Import, Live Log Stream, Real Auto-Update
- Instance Templates (13), Mod Config Editor
- Discord RPC (client_id: 1506599015826067476)
- Achievement System (14 achievements)
- Firebase In-Launcher Chat (project: xryloth-chatsystem)
- Custom Themes (8 built-in + custom creator, 22 color fields)
- QoL: Tooltips, Page Transitions, Toast Notifications, Breadcrumb
- QoL: Keyboard Shortcut Hints, Hover Preview Cards, Smooth Scroll
- Game Boost (kills 30+ bloatware, clears temp/cache, DNS flush, auto FPS mods)

### This Session — 7 New Features
1. **Animated Backgrounds** — `AnimatedBackgrounds.tsx` — 5 types: rain, snow, fire, galaxy, matrix — CSS particle effects, stored in localStorage
2. **Launch Animation** — `LaunchAnimation.tsx` — End Portal effect (spinning portal → warp lines → done) plays between boost and game launch
3. **Minecraft Particle Effects** — `MinecraftParticles.tsx` — Canvas-based, 6 types: heart, xp, firework, note, dust, crit — `useParticles()` hook
4. **Sound Effects** — `SoundEffects.tsx` — Web Audio API generated: click, success, error, notepad, whoosh, pop, levelup, noteblock — no external files needed
5. **Animated Logo** — `AnimatedLogo.tsx` — Spring entrance, conic glow ring, pulse glow, orbiting dot, hover effects — integrated into Sidebar
6. **Minecraft Music Player** — `MusicPlayer.tsx` — 14 C418-style tracks via Web Audio oscillators (calm/ambient/melancholy/mystery moods), full controls, track list, volume
7. **User Status System** — `UserStatus.tsx` — Discord-style: Online/Away/DND/Gaming/Invisible/Offline, custom text, auto-detect game launch, time-ago

### Custom Background System Overhaul
- **Rust backend**: Added `save_background_video`, `get_background_video_path`, `delete_background_video` — saves video to `~/.xryloth/backgrounds/custom_video.{mp4|webm|mov}`
- **Frontend API**: `api.background.saveVideo()`, `getVideoPath()`, `deleteVideo()`
- **SettingsPage Background tab**: URL input for images/videos, brightness slider (10-200%), dark dimming overlay slider (0-80%), fit mode grid (cover/contain/fill/stretch), reset all button, 7 quick presets
- **BackgroundLayer**: Handles brightness filter, dark dimming overlay, video file path resolution via `getVideoPath()`
- **Default background**: Pixabay video (`cdn.pixabay.com/video/2023/06/24/168653-839542456_large.mp4`) with opacity 65%, brightness 36%, blur 4px, dark overlay 3%
- **New Settings types**: `launcher_bg_brightness`, `launcher_bg_dimming`

### HomePage Cleanup
- Removed decorative gradient orbs/overlays that bled through default background
- Hero section is now solid/opaque with one subtle accent glow
- Clean `rounded-3xl` corners, solid text colors, removed clutter buttons
- `hasCustomBg` check for proper hero styling

## Tech Stack
- Tauri v1.6 + React 18 + TypeScript + Rust backend
- Rust deps: tauri 1.6, reqwest 0.11 (blocking+streaming), tokio, zip 0.6, tempfile 3, dirs 5, webbrowser, regex-lite, base64 0.21, urlencoding 2.1, chrono 0.4
- Frontend: react, zustand, framer-motion, lucide-react, firebase@12.16.0
- Java: MC ≤1.16.x→Java 8, 1.17.x→Java 16+, 1.18–1.20→Java 17+, 1.21+→Java 21+
- Discord RPC client_id: 1506599015826067476
- Firebase: project xryloth-chatsystem, API key AIzaSyAwrNiB1Jl_oj5JpAtq6igkl9Irdp6qH14
- GITHUB_API_URL: https://api.github.com/repos/EscapeXMc/Xryloth/releases/latest
- Build command: `$env:PATH = "C:\Users\power\.cargo\bin;$env:PATH"; npx tauri build`
- Exe path: `src-tauri/target/release/bundle/nsis/Xryloth_5.9.0_x64-setup.exe`
- Launcher data dir: `~/.xryloth/`
- User Java: `C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot`

## Key Files Modified/Created This Session
- `src/components/ui/AnimatedBackgrounds.tsx` — rain/snow/fire/galaxy/matrix
- `src/components/ui/LaunchAnimation.tsx` — End Portal launch animation
- `src/components/ui/MinecraftParticles.tsx` — Canvas particle system
- `src/components/ui/SoundEffects.tsx` — Web Audio sound effects
- `src/components/ui/AnimatedLogo.tsx` — Animated launcher logo
- `src/components/ui/MusicPlayer.tsx` — C418 ambient music player
- `src/components/ui/UserStatus.tsx` — Discord-style status system
- `src/App.tsx` — Integrated all 7 features, BackgroundLayer with brightness/dimming/video fix
- `src/components/ui/Sidebar.tsx` — AnimatedLogo, UserStatus, sound effects on click
- `src/components/pages/HomePage.tsx` — Clean hero, hasCustomBg check
- `src/components/pages/SettingsPage.tsx` — Overhauled Background tab (URL input, brightness, dimming, presets, video file save)
- `src/lib/types.ts` — Added `launcher_bg_brightness`, `launcher_bg_dimming`
- `src/lib/api.ts` — Added `saveVideo`, `getVideoPath`, `deleteVideo`
- `src-tauri/src/lib.rs` — Added `save_background_video`, `get_background_video_path`, `delete_background_video` commands
