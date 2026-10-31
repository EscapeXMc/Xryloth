#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

// Include the generated keys at compile time
include!(concat!(env!("OUT_DIR"), "/embedded_keys.rs"));

// ============================================================================
// XRYLOTH INSTALLER / UPDATER
// ============================================================================
// This binary serves as both installer and updater:
// - First run: installs Xryloth Launcher
// - Subsequent runs: updates Xryloth Launcher
// - Uninstall mode: removes everything
// ============================================================================

const GITHUB_REPO: &str = "EscapeXMc/Xryloth";
const GITHUB_API_URL: &str = "https://api.github.com/repos/EscapeXMc/Xryloth/releases/latest";
const INSTALL_DIR_NAME: &str = "Xryloth";
const LAUNCHER_NAME_LINUX: &str = "xryloth_launcher";
const LAUNCHER_NAME_WINDOWS: &str = "XrylothLauncher.exe";
const UNINSTALL_URL: &str = "https://xrylothclient.vercel.app/uninstall/";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
struct InstallConfig {
    install_dir: PathBuf,
    launcher_path: PathBuf,
    create_desktop_shortcut: bool,
    create_taskbar_shortcut: bool,
    create_start_menu_shortcut: bool,
    auto_start: bool,
    /// Release tag recorded at install/update time; the update check
    /// compares this against the latest GitHub release.
    version: String,
}

impl InstallConfig {
    /// The UI only knows install_dir + shortcut flags; launcher_path is derived,
    /// so it must be recomputed whenever install_dir changes (or when the UI
    /// omits it entirely — serde(default) fills it from Default first).
    fn normalize(&mut self) {
        if self.install_dir.as_os_str().is_empty() {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            self.install_dir = home.join(INSTALL_DIR_NAME);
        }
        let launcher_name = if cfg!(target_os = "windows") {
            LAUNCHER_NAME_WINDOWS
        } else {
            LAUNCHER_NAME_LINUX
        };
        self.launcher_path = self.install_dir.join(launcher_name);
    }
}

impl Default for InstallConfig {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let install_dir = home.join(INSTALL_DIR_NAME);
        let launcher_name = if cfg!(target_os = "windows") {
            LAUNCHER_NAME_WINDOWS
        } else {
            LAUNCHER_NAME_LINUX
        };
        Self {
            install_dir: install_dir.clone(),
            launcher_path: install_dir.join(launcher_name),
            create_desktop_shortcut: true,
            create_taskbar_shortcut: true,
            create_start_menu_shortcut: true,
            auto_start: false,
            version: String::new(),
        }
    }
}

struct InstallerState {
    config: InstallConfig,
    client: Client,
    is_update: bool,
    current_version: Option<String>,
    latest_release: Option<GitHubRelease>,
    app_handle: Option<tauri::AppHandle>,
}

impl Clone for InstallerState {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            client: self.client.clone(),
            is_update: self.is_update,
            current_version: self.current_version.clone(),
            latest_release: self.latest_release.clone(),
            app_handle: self.app_handle.clone(),
        }
    }
}

impl InstallerState {
    fn new() -> Self {
        let config = InstallConfig::default();
        let is_update = config.launcher_path.exists();
        Self {
            config,
            client: Client::builder()
                .user_agent("XrylothInstaller/1.0")
                .timeout(std::time::Duration::from_secs(300))
                .build()
                .expect("Failed to create HTTP client"),
            is_update,
            current_version: None,
            latest_release: None,
            app_handle: None,
        }
    }

    async fn fetch_latest_release(&mut self) -> Result<(), String> {
        let resp = self.client
            .get(GITHUB_API_URL)
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch release: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API error: {}", resp.status()));
        }

        let release: GitHubRelease = resp.json().await
            .map_err(|e| format!("Failed to parse release: {}", e))?;

        self.current_version = Some(release.tag_name.clone());
        self.latest_release = Some(release);
        Ok(())
    }

    fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }

    fn find_launcher_asset(&self) -> Option<&ReleaseAsset> {
        let release = self.latest_release.as_ref()?;
        // Real release assets are named like:
        //   xryloth_v<X>_Windows64.exe, xryloth_v<X>_Windows32.exe,
        //   xryloth_v<X>_linux.appImage
        // Match case-insensitively on the platform + arch substrings.
        let is_win = cfg!(target_os = "windows");
        let is_x64 = cfg!(target_arch = "x86_64");
        release.assets.iter().find(|a| {
            let n = a.name.to_ascii_lowercase();
            if is_win {
                if is_x64 {
                    n.contains("windows64") || n.contains("x64")
                } else {
                    n.contains("windows32") || n.contains("windowsx86") || n.contains("x86") || n.contains("ia32")
                }
            } else {
                n.contains("appimage") && (n.contains("linux") || n.contains("amd64") || n.contains("x64"))
            }
        })
    }

    /// Emit an installer-progress event (no-op if the app handle is gone).
    fn emit_progress(&self, stage: &str, message: &str, progress: f64, total: u64, downloaded: u64) {
        if let Some(handle) = self.app_handle.as_ref() {
            let _ = handle.emit_all("installer-progress", InstallProgress {
                stage: stage.to_string(),
                message: message.to_string(),
                progress,
                total_bytes: total,
                downloaded_bytes: downloaded,
            });
        }
    }

    /// Stream the launcher to disk chunk-by-chunk, emitting progress as it goes.
    /// (The old implementation buffered the whole file in memory and only
    /// emitted a 100% event at the end, so the UI sat on "Starting... 0%"
    /// for the entire download — and died on fresh installs because the
    /// install directory was never created.)
    async fn download_launcher_with_handle(&self, asset: &ReleaseAsset) -> Result<(), String> {
        let url = asset.browser_download_url.clone();
        let total_hint = asset.size;

        // The UI only knows install_dir; make sure it exists before writing.
        tokio::fs::create_dir_all(&self.config.install_dir).await
            .map_err(|e| format!("Failed to create install directory {}: {}",
                self.config.install_dir.display(), e))?;

        self.emit_progress("downloading", "Connecting to GitHub...", 0.0, total_hint, 0);

        let mut resp = self.client.get(&url).send().await
            .map_err(|e| format!("Download failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Download failed: HTTP {}", resp.status()));
        }

        let total = resp.content_length().filter(|&n| n > 0).unwrap_or(total_hint).max(1);

        // Write to a temp file first so a failed download never leaves a
        // half-written launcher behind.
        let tmp_path = self.config.install_dir.join(".xryloth_launcher.part");
        let mut file = tokio::fs::File::create(&tmp_path).await
            .map_err(|e| format!("Failed to create launcher file: {}", e))?;

        use tokio::io::AsyncWriteExt;
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(std::time::Instant::now);

        loop {
            let chunk = match resp.chunk().await {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return Err(format!("Download interrupted: {}", e));
                }
            };
            file.write_all(&chunk).await
                .map_err(|e| format!("Write error: {}", e))?;
            downloaded += chunk.len() as u64;

            // Throttle UI updates to ~5/sec so the bar actually moves.
            if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                let p = (downloaded as f64 / total as f64).min(0.99);
                self.emit_progress("downloading",
                    &format!("Downloading launcher... {:.0}%", p * 100.0),
                    p, total, downloaded);
                last_emit = std::time::Instant::now();
            }
        }
        file.flush().await.map_err(|e| format!("Write error: {}", e))?;
        drop(file);

        if downloaded == 0 {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err("Download failed: empty response".to_string());
        }

        // Swap the temp file into place.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&tmp_path)
                .map_err(|e| format!("Failed to get file metadata: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&tmp_path, perms)
                .map_err(|e| format!("Failed to make executable: {}", e))?;
        }
        fs::rename(&tmp_path, &self.config.launcher_path)
            .map_err(|e| format!("Failed to finalize launcher file: {}", e))?;

        self.emit_progress("downloading", "Download complete", 1.0, total, downloaded);
        Ok(())
    }

    fn create_shortcuts(&self) -> Result<(), String> {
        #[cfg(target_os = "linux")]
        {
            self.create_linux_shortcuts()?;
        }
        #[cfg(target_os = "windows")]
        {
            self.create_windows_shortcuts()?;
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn create_linux_shortcuts(&self) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;

        let desktop_dir = dirs::home_dir()
            .ok_or("No home directory")?
            .join(".local/share/applications");
        fs::create_dir_all(&desktop_dir).map_err(|e| e.to_string())?;

        let desktop_entry = format!(
            r#"[Desktop Entry]
Version=1.0
Type=Application
Name=Xryloth
Comment=Minecraft Launcher with AI Assistant
Exec={}
Icon={}
Terminal=false
Categories=Game;Application;
StartupNotify=true
Categories=Game;
"#,
            self.config.launcher_path.display(),
            self.config.install_dir.join("icon.png").display()
        );

        let desktop_path = desktop_dir.join("xryloth.desktop");
        fs::write(&desktop_path, desktop_entry).map_err(|e| e.to_string())?;
        let mut perms = fs::metadata(&desktop_path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&desktop_path, perms).map_err(|e| e.to_string())?;

        // Also create autostart entry if requested
        if self.config.auto_start {
            let autostart_dir = dirs::home_dir()
                .ok_or("No home directory")?
                .join(".config/autostart");
            fs::create_dir_all(&autostart_dir).map_err(|e| e.to_string())?;
            fs::copy(&desktop_path, autostart_dir.join("xryloth.desktop")).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    fn copy_icons(&self) -> Result<(), String> {
        // Copy icon.png and icon.ico from the installer resources to the install directory
        let install_dir = &self.config.install_dir;
        
        // Try to find icons in the installer's resource directory
        // The installer binary is typically in the same directory as the resources
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let installer_dir = exe_path.parent().ok_or("No parent directory")?;
        
        let icon_png_src = installer_dir.join("icon.png");
        let icon_ico_src = installer_dir.join("icon.ico");
        
        let icon_png_dst = install_dir.join("icon.png");
        let icon_ico_dst = install_dir.join("icon.ico");
        
        if icon_png_src.exists() {
            fs::copy(&icon_png_src, &icon_png_dst).map_err(|e| e.to_string())?;
        }
        
        if icon_ico_src.exists() {
            fs::copy(&icon_ico_src, &icon_ico_dst).map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn create_windows_shortcuts(&self) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use winapi::um::shellapi::*;
        use winapi::um::winuser::*;
        use winapi::um::combaseapi::*;
        use winapi::um::shlobj::*;
        use winapi::um::objbase::*;
        use winapi::ctypes::c_void;
        use winapi::shared::wtypesbase::*;
        use winapi::um::objidl::*;
        use std::ptr;

        // Initialize COM
        unsafe {
            CoInitialize(ptr::null_mut());
        }

        let result = self.create_windows_shortcut_proper()?;

        unsafe {
            CoUninitialize();
        }

        Ok(result)
    }

    #[cfg(target_os = "windows")]
    fn create_windows_shortcut_proper(&self) -> Result<(), String> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use winapi::um::shellapi::*;
        use winapi::um::winuser::*;
        use winapi::um::combaseapi::*;
        use winapi::um::shlobj::*;
        use winapi::um::objbase::*;
        use winapi::ctypes::c_void;
        use winapi::shared::wtypesbase::*;
        use winapi::um::objidl::*;
        use std::ptr;

        let icon_path = self.config.install_dir.join("icon.ico");
        let launcher_path = &self.config.launcher_path;

        // Desktop shortcut
        let desktop = dirs::desktop_dir().ok_or("No desktop directory")?;
        let shortcut_path = desktop.join("Xryloth.lnk");
        self.create_lnk_shortcut(&shortcut_path, launcher_path, &icon_path, "Xryloth Launcher")?;

        // Start Menu shortcut
        let start_menu = dirs::home_dir()
            .ok_or("No home directory")?
            .join("AppData/Roaming/Microsoft/Windows/Start Menu/Programs");
        fs::create_dir_all(&start_menu).map_err(|e| e.to_string())?;
        let start_menu_shortcut = start_menu.join("Xryloth.lnk");
        self.create_lnk_shortcut(&start_menu_shortcut, launcher_path, &icon_path, "Xryloth Launcher")?;

        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn create_lnk_shortcut(&self, shortcut_path: &Path, target_path: &Path, icon_path: &Path, description: &str) -> Result<(), String> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use winapi::um::combaseapi::*;
        use winapi::um::objbase::*;
        use winapi::um::objidl::{IPersistFile};
        use winapi::um::shobjidl_core::{IShellLinkW};
        use winapi::ctypes::c_void;
        use winapi::shared::guiddef::{GUID};
        use winapi::shared::wtypesbase::*;
        use std::ptr;

        // winapi 0.3 does not expose these Shell Link GUIDs, so define them here.
        #[allow(non_upper_case_globals)]
        const CLSID_ShellLink: GUID = GUID { Data1: 0x00021401, Data2: 0x0000, Data3: 0x0000, Data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46] };
        #[allow(non_upper_case_globals)]
        const IID_IShellLinkW: GUID = GUID { Data1: 0x000214F9, Data2: 0x0000, Data3: 0x0000, Data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46] };
        #[allow(non_upper_case_globals)]
        const IID_IPersistFile: GUID = GUID { Data1: 0x0000010B, Data2: 0x0000, Data3: 0x0000, Data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46] };

        unsafe {
            // Create ShellLink COM object
            let mut shell_link: *mut IShellLinkW = ptr::null_mut();
            let hr = CoCreateInstance(
                &CLSID_ShellLink,
                ptr::null_mut(),
                CLSCTX_INPROC_SERVER,
                &IID_IShellLinkW,
                &mut shell_link as *mut *mut IShellLinkW as *mut *mut c_void,
            );
            if hr != 0 {
                return Err(format!("Failed to create ShellLink: 0x{:08X}", hr));
            }

            // Convert paths to wide strings
            let target_wide: Vec<u16> = OsStr::new(target_path.to_str().unwrap_or("")).encode_wide().chain(Some(0)).collect();
            let icon_wide: Vec<u16> = OsStr::new(icon_path.to_str().unwrap_or("")).encode_wide().chain(Some(0)).collect();
            let desc_wide: Vec<u16> = OsStr::new(description).encode_wide().chain(Some(0)).collect();
            let shortcut_wide: Vec<u16> = OsStr::new(shortcut_path.to_str().unwrap_or("")).encode_wide().chain(Some(0)).collect();

            // Set target path
            (*shell_link).SetPath(target_wide.as_ptr());
            // Set description
            (*shell_link).SetDescription(desc_wide.as_ptr());
            // Set icon
            (*shell_link).SetIconLocation(icon_wide.as_ptr(), 0);
            // Set working directory
            if let Some(parent) = target_path.parent() {
                let workdir_wide: Vec<u16> = OsStr::new(parent.to_str().unwrap_or("")).encode_wide().chain(Some(0)).collect();
                (*shell_link).SetWorkingDirectory(workdir_wide.as_ptr());
            }

            // Get IPersistFile interface
            let mut persist_file: *mut IPersistFile = ptr::null_mut();
            let hr = (*shell_link).QueryInterface(&IID_IPersistFile, &mut persist_file as *mut *mut IPersistFile as *mut *mut c_void);
            if hr != 0 {
                (*shell_link).Release();
                return Err(format!("Failed to get IPersistFile: 0x{:08X}", hr));
            }

            // Save the shortcut
            let hr = (*persist_file).Save(shortcut_wide.as_ptr(), 1); // TRUE = remember current working directory
            (*persist_file).Release();
            (*shell_link).Release();

            if hr != 0 {
                return Err(format!("Failed to save shortcut: 0x{:08X}", hr));
            }
        }

        Ok(())
    }

    fn uninstall(&self) -> Result<(), String> {
        // Remove launcher
        if self.config.launcher_path.exists() {
            fs::remove_file(&self.config.launcher_path).map_err(|e| e.to_string())?;
        }

        // Remove shortcuts
        #[cfg(target_os = "linux")]
        {
            let desktop_dir = dirs::home_dir()
                .ok_or("No home directory")?
                .join(".local/share/applications");
            let _ = fs::remove_file(desktop_dir.join("xryloth.desktop"));
            let autostart_dir = dirs::home_dir()
                .ok_or("No home directory")?
                .join(".config/autostart");
            let _ = fs::remove_file(autostart_dir.join("xryloth.desktop"));
        }

        #[cfg(target_os = "windows")]
        {
            let desktop = dirs::desktop_dir().ok_or("No desktop directory")?;
            let _ = fs::remove_file(desktop.join("Xryloth.lnk"));
            let _ = fs::remove_file(desktop.join("Xryloth.url"));
            let start_menu = dirs::home_dir()
                .ok_or("No home directory")?
                .join("AppData/Roaming/Microsoft/Windows/Start Menu/Programs");
            let _ = fs::remove_file(start_menu.join("Xryloth.lnk"));
            let _ = fs::remove_file(start_menu.join("Xryloth.url"));
        }

        // Remove install directory if empty
        if self.config.install_dir.exists() {
            let entries = fs::read_dir(&self.config.install_dir).map_err(|e| e.to_string())?;
            if entries.count() == 0 {
                fs::remove_dir(&self.config.install_dir).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Clone)]
struct InstallProgress {
    stage: String,
    message: String,
    progress: f64,
    total_bytes: u64,
    downloaded_bytes: u64,
}

// Tauri commands for the installer UI
#[tauri::command]
async fn installer_check_installed() -> Result<bool, String> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let launcher_name = if cfg!(target_os = "windows") {
        LAUNCHER_NAME_WINDOWS
    } else {
        LAUNCHER_NAME_LINUX
    };
    let launcher_path = home.join(INSTALL_DIR_NAME).join(launcher_name);
    Ok(launcher_path.exists())
}

#[tauri::command]
async fn installer_get_config() -> Result<InstallConfig, String> {
    // Return the SAVED config if present (so the UI shows the installed
    // version and the directory actually used), otherwise defaults.
    let mut config = InstallConfig::default();
    let path = config.install_dir.join("installer_config.json");
    if let Ok(text) = fs::read_to_string(&path) {
        if let Ok(mut saved) = serde_json::from_str::<InstallConfig>(&text) {
            saved.normalize();
            config = saved;
        }
    }
    Ok(config)
}

#[tauri::command]
async fn installer_set_config(mut config: InstallConfig) -> Result<(), String> {
    config.normalize();
    Ok(())
}

#[tauri::command]
async fn installer_fetch_release() -> Result<GitHubRelease, String> {
    let client = Client::builder()
        .user_agent("XrylothInstaller/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(GITHUB_API_URL)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let release: GitHubRelease = resp.json().await.map_err(|e| e.to_string())?;
    Ok(release)
}

#[tauri::command]
async fn installer_install(
    config: InstallConfig,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut state = InstallerState::new();
    state.set_app_handle(app_handle);
    state.config = config;
    state.config.normalize();

    state.emit_progress("fetching", "Fetching latest release...", 0.0, 0, 0);
    state.fetch_latest_release().await?;

    let asset = state.find_launcher_asset()
        .ok_or("No compatible launcher asset found for this platform")?
        .clone();

    state.download_launcher_with_handle(&asset).await?;

    // Copy icon files to install directory
    state.emit_progress("installing", "Installing...", 1.0, asset.size, asset.size);
    state.copy_icons()?;

    // Create shortcuts
    state.emit_progress("shortcuts", "Creating shortcuts...", 1.0, asset.size, asset.size);
    state.create_shortcuts()?;

    // Save config (record which release we installed for the update check)
    if let Some(tag) = state.latest_release.as_ref().map(|r| r.tag_name.clone()) {
        state.config.version = tag;
    }
    let config_path = state.config.install_dir.join("installer_config.json");
    fs::write(&config_path, serde_json::to_string_pretty(&state.config).unwrap())
        .map_err(|e| e.to_string())?;

    state.emit_progress("done", "Installation complete!", 1.0, asset.size, asset.size);
    Ok(format!("Successfully installed Xryloth Launcher v{}", state.current_version.unwrap_or_default()))
}

#[tauri::command]
async fn installer_update(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut state = InstallerState::new();
    state.set_app_handle(app_handle);
    if !state.is_update {
        return Err("Xryloth is not installed. Run install first.".to_string());
    }

    state.emit_progress("fetching", "Fetching latest release...", 0.0, 0, 0);
    state.fetch_latest_release().await?;

    // The installed version is whatever installer_config.json recorded at
    // install time — NOT the freshly fetched tag (fetch_latest_release puts
    // the LATEST tag in current_version, which made this comparison always
    // say "Already up to date").
    let installed_version = fs::read_to_string(state.config.install_dir.join("installer_config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(String::from));

    let latest = state.latest_release.as_ref().map(|r| r.tag_name.clone());
    if let (Some(installed), Some(latest)) = (installed_version.as_deref(), latest.as_deref()) {
        if installed == latest {
            return Ok("Already up to date".to_string());
        }
    }

    let asset = state.find_launcher_asset()
        .ok_or("No compatible launcher asset found")?
        .clone();

    state.download_launcher_with_handle(&asset).await?;

    // Record the new version so the next update check compares correctly.
    if let Some(tag) = state.latest_release.as_ref().map(|r| r.tag_name.clone()) {
        let config_path = state.config.install_dir.join("installer_config.json");
        let mut saved = fs::read_to_string(&config_path)
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if let Some(obj) = saved.as_object_mut() {
            obj.insert("version".to_string(), serde_json::Value::String(tag.clone()));
            let _ = fs::write(&config_path, serde_json::to_string_pretty(&saved).unwrap_or_default());
        }
        state.emit_progress("done", "Update complete!", 1.0, asset.size, asset.size);
        Ok(format!("Updated to v{}", tag))
    } else {
        Ok("Updated".to_string())
    }
}

#[tauri::command]
async fn installer_uninstall() -> Result<String, String> {
    let state = InstallerState::new();
    state.uninstall()?;
    Ok("Xryloth has been uninstalled. Thank you for being part of Xryloth!".to_string())
}

/// Launch the installed launcher, detached from the installer: the installer
/// closes itself right after this returns, so the launcher must outlive it
/// (std spawn does that on Linux and Windows — no process-group kill happens).
#[tauri::command]
async fn installer_launch_launcher() -> Result<(), String> {
    let config = installer_get_config().await?;
    if !config.launcher_path.exists() {
        return Err(format!("Xryloth is not installed at {}", config.install_dir.display()));
    }
    Command::new(&config.launcher_path)
        .current_dir(&config.install_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch Xryloth: {}", e))?;
    Ok(())
}

/// Close the installer after it has handed off to the launcher.
#[tauri::command]
async fn installer_close_app(app_handle: tauri::AppHandle) -> Result<(), String> {
    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
async fn installer_open_uninstall_page() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(UNINSTALL_URL).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd").args(["/C", "start", UNINSTALL_URL]).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================================================
// MAIN
// ============================================================================

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            installer_check_installed,
            installer_get_config,
            installer_set_config,
            installer_fetch_release,
            installer_install,
            installer_update,
            installer_uninstall,
            installer_open_uninstall_page,
            installer_launch_launcher,
            installer_close_app,
        ])
        .setup(|app| {
            // Set up the installer window FIRST (see below for why).
            let handle = app.handle();
            let window = tauri::WindowBuilder::new(
                &handle,
                "installer",
                tauri::WindowUrl::App("installer.html".into()),
            )
            .title("Xryloth Installer")
            .inner_size(500.0, 600.0)
            .resizable(false)
            .maximizable(false)
            .decorations(true)
            .always_on_top(false)
            .center()
            .build()?;

            // The installer binary shares tauri.conf.json with the launcher, so the
            // default "main" launcher window is created automatically at startup.
            // Close it — the installer must NEVER open the launcher app.
            if let Some(main_window) = app.get_window("main") {
                let _ = main_window.close();
            }

            // Check if already installed on startup
            let handle_clone = handle.clone();
            tauri::async_runtime::spawn(async move {
                let installed = installer_check_installed().await.unwrap_or(false);
                let _ = handle_clone.emit_all("installer-status", serde_json::json!({
                    "installed": installed
                }));
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Xryloth Installer");
}
// ============================================================================
// TESTS — verify the exact flows the installer UI exercises
// ============================================================================
#[cfg(test)]
mod installer_tests {
    use super::*;

    /// The UI sends ONLY install_dir + shortcut flags (no launcher_path).
    /// v6.0.0.16 failed here with "missing field `launcher_path`".
    #[test]
    fn config_from_ui_json_deserializes_and_normalizes() {
        let ui_json = r#"{
            "install_dir": "/tmp/xryloth-test",
            "create_desktop_shortcut": true,
            "create_taskbar_shortcut": true,
            "create_start_menu_shortcut": true,
            "auto_start": false
        }"#;
        let mut cfg: InstallConfig = serde_json::from_str(ui_json)
            .expect("UI config JSON must deserialize (launcher_path is serde(default))");
        cfg.normalize();
        let expect_name = if cfg!(target_os = "windows") { LAUNCHER_NAME_WINDOWS } else { LAUNCHER_NAME_LINUX };
        assert_eq!(cfg.launcher_path, cfg.install_dir.join(expect_name));
    }

    /// Empty/missing install_dir falls back to ~/Xryloth.
    #[test]
    fn config_empty_dir_falls_back_to_home() {
        let mut cfg = InstallConfig {
            install_dir: PathBuf::new(),
            ..Default::default()
        };
        cfg.normalize();
        let home = dirs::home_dir().unwrap();
        assert_eq!(cfg.install_dir, home.join(INSTALL_DIR_NAME));
        assert!(cfg.launcher_path.starts_with(&cfg.install_dir));
    }

    /// find_launcher_asset must match the REAL asset names on the
    /// EscapeXMc/Xryloth release (xryloth_v6.0.0.16_linux.appImage etc).
    #[test]
    fn finds_real_release_asset_names() {
        let real_names = [
            "xryloth_v6.0.0.16_Windows64.exe",
            "xryloth_v6.0.0.16_Windows32.exe",
            "xryloth_v6.0.0.16_linux.appImage",
        ];
        let release = GitHubRelease {
            tag_name: "v6.0.0.16".into(),
            assets: real_names.iter().map(|n| ReleaseAsset {
                name: n.to_string(),
                browser_download_url: format!("https://example.com/{}", n),
                size: 100,
            }).collect(),
        };
        let mut state = InstallerState::new();
        state.latest_release = Some(release);
        let asset = state.find_launcher_asset().expect("no asset matched");
        if cfg!(target_os = "windows") {
            assert!(asset.name.to_ascii_lowercase().contains(if cfg!(target_arch = "x86_64") { "windows64" } else { "windows32" }));
        } else {
            assert_eq!(asset.name, "xryloth_v6.0.0.16_linux.appImage");
        }
    }

    /// Regression: a fresh install has NO install directory yet. The old
    /// code called File::create() directly and failed with ENOENT (UI stuck
    /// on "Starting... 0%"). Also asserts the download streams to disk
    /// (no leftover .part file) and the result is executable.
    #[tokio::test]
    async fn download_creates_missing_dir_and_streams_to_disk() {
        let base = std::env::temp_dir().join(format!("xryloth-dl-test-{}", std::process::id()));
        let install_dir = base.join("Xryloth");
        let _ = fs::remove_dir_all(&base);
        assert!(!install_dir.exists(), "test precondition: dir must NOT exist");

        // Assets are re-uploaded on every publish, so name + size + URL come
        // from the live installer release instead of a hardcoded byte count
        // (a fixed size breaks the moment the .deb is rebuilt).
        let client = Client::builder()
            .user_agent("XrylothInstaller/1.0")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("test http client");
        let rel: serde_json::Value = client
            .get("https://api.github.com/repos/EscapeXMc/xrylothInstaller/releases/latest")
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
            .expect("installer release fetch failed")
            .json()
            .await
            .expect("installer release json failed");
        let asset_json = rel["assets"]
            .as_array()
            .and_then(|arr| {
                arr.iter().find(|a| {
                    a["name"].as_str().map(|n| n.ends_with("_linux.deb")).unwrap_or(false)
                })
            })
            .expect("no .deb asset in the latest installer release")
            .clone();
        let asset = ReleaseAsset {
            name: asset_json["name"].as_str().unwrap().to_string(),
            browser_download_url: asset_json["browser_download_url"].as_str().unwrap().to_string(),
            size: asset_json["size"].as_u64().unwrap(),
        };
        assert!(asset.size > 0, "asset.size must come from the API");

        let mut state = InstallerState::new();
        state.config.install_dir = install_dir.clone();
        state.config.normalize();

        state.download_launcher_with_handle(&asset).await
            .expect("download into a non-existent directory must succeed");

        let out = state.config.launcher_path;
        assert!(out.exists(), "launcher file must exist after download");
        let len = fs::metadata(&out).unwrap().len();
        assert_eq!(len, asset.size, "downloaded byte count must match asset.size");
        assert!(!install_dir.join(".xryloth_launcher.part").exists(),
            "temp .part file must be swapped away");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&out).unwrap().permissions().mode();
            assert_ne!(mode & 0o111, 0, "launcher must be executable (mode {:o})", mode);
        }
        let _ = fs::remove_dir_all(&base);
    }

    /// Full network round-trip: fetch the real latest release and pick the
    /// launcher asset. This is the exact call the UI's "Checking..." fix relies on.
    #[tokio::test]
    async fn fetch_real_github_release_and_pick_asset() {
        let release = installer_fetch_release().await.expect("installer_fetch_release failed");
        assert!(!release.tag_name.is_empty(), "tag_name empty");
        assert!(!release.assets.is_empty(), "no assets in release");
        let mut state = InstallerState::new();
        state.latest_release = Some(release.clone());
        let asset = state.find_launcher_asset().expect("no compatible asset in real release");
        // Download the first few KB only (range) to prove the URL is live.
        let client = Client::builder()
            .user_agent("XrylothInstaller/1.0")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();
        let resp = client.get(&asset.browser_download_url)
            .header("Range", "bytes=0-1023")
            .send()
            .await
            .expect("asset download request failed");
        assert!(resp.status().is_success() || resp.status().as_u16() == 206,
            "asset URL returned {}", resp.status());
        let bytes = resp.bytes().await.unwrap();
        assert!(!bytes.is_empty());
    }
}
