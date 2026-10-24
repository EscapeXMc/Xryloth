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
struct InstallConfig {
    install_dir: PathBuf,
    launcher_path: PathBuf,
    create_desktop_shortcut: bool,
    create_taskbar_shortcut: bool,
    create_start_menu_shortcut: bool,
    auto_start: bool,
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
        let launcher_name = if cfg!(target_os = "windows") {
            if cfg!(target_arch = "x86_64") {
                "XrylothLauncher_x64.exe"
            } else {
                "XrylothLauncher_x86.exe"
            }
        } else {
            "xryloth_launcher_amd64.AppImage"
        };
        release.assets.iter().find(|a| a.name == launcher_name)
    }

    async fn download_launcher(&self, asset: &ReleaseAsset) -> Result<(), String> {
        let resp = self.client.get(&asset.browser_download_url).send().await
            .map_err(|e| format!("Download failed: {}", e))?;

        let total = resp.content_length().unwrap_or(asset.size);
        let bytes = resp.bytes().await
            .map_err(|e| format!("Download failed: {}", e))?;
        
        let mut file = tokio::fs::File::create(&self.config.launcher_path).await
            .map_err(|e| format!("Failed to create launcher file: {}", e))?;
        
        tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await
            .map_err(|e| format!("Write error: {}", e))?;
        
        let downloaded = bytes.len() as u64;
        
        // Emit progress event
        let _ = self.app_handle.as_ref().unwrap().emit_all("installer-progress", InstallProgress {
            stage: "downloading".to_string(),
            message: format!("Downloading launcher... 100%"),
            progress: 1.0,
            total_bytes: total,
            downloaded_bytes: downloaded,
        });

        // Make executable on Linux
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&self.config.launcher_path)
                .map_err(|e| format!("Failed to get file metadata: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&self.config.launcher_path, perms)
                .map_err(|e| format!("Failed to make executable: {}", e))?;
        }

        Ok(())
    }

    async fn download_launcher_with_handle(&self, asset: &ReleaseAsset) -> Result<(), String> {
        let handle = self.app_handle.as_ref().ok_or("AppHandle not set")?;
        
        let resp = self.client.get(&asset.browser_download_url).send().await
            .map_err(|e| format!("Download failed: {}", e))?;

        let total = resp.content_length().unwrap_or(asset.size);
        let bytes = resp.bytes().await
            .map_err(|e| format!("Download failed: {}", e))?;
        
        let mut file = tokio::fs::File::create(&self.config.launcher_path).await
            .map_err(|e| format!("Failed to create launcher file: {}", e))?;
        
        tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await
            .map_err(|e| format!("Write error: {}", e))?;
        
        let downloaded = bytes.len() as u64;
        
        // Emit progress event
        let _ = self.app_handle.as_ref().unwrap().emit_all("installer-progress", InstallProgress {
            stage: "downloading".to_string(),
            message: format!("Downloading launcher... 100%"),
            progress: 1.0,
            total_bytes: total,
            downloaded_bytes: downloaded,
        });

        // Make executable on Linux
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&self.config.launcher_path)
                .map_err(|e| format!("Failed to get file metadata: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&self.config.launcher_path, perms)
                .map_err(|e| format!("Failed to make executable: {}", e))?;
        }

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
        use winapi::um::shlobj::*;
        use winapi::um::objbase::*;
        use winapi::um::objidl::*;
        use winapi::um::shellapi::*;
        use winapi::ctypes::c_void;
        use winapi::shared::wtypesbase::*;
        use std::ptr;

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
    Ok(InstallConfig::default())
}

#[tauri::command]
async fn installer_set_config(_config: InstallConfig) -> Result<(), String> {
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

    state.fetch_latest_release().await?;

    let asset = state.find_launcher_asset()
        .ok_or("No compatible launcher asset found for this platform")?;

    state.download_launcher_with_handle(asset).await?;

    // Copy icon files to install directory
    state.copy_icons()?;

    // Create shortcuts
    state.create_shortcuts()?;

    // Save config
    let config_path = state.config.install_dir.join("installer_config.json");
    fs::write(&config_path, serde_json::to_string_pretty(&state.config).unwrap())
        .map_err(|e| e.to_string())?;

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

    state.fetch_latest_release().await?;

    // Check if update needed
    if state.current_version == state.latest_release.as_ref().map(|r| r.tag_name.clone()) {
        return Ok("Already up to date".to_string());
    }

    let asset = state.find_launcher_asset()
        .ok_or("No compatible launcher asset found")?;

    state.download_launcher_with_handle(asset).await?;

    Ok(format!("Updated to v{}", state.current_version.unwrap_or_default()))
}

#[tauri::command]
async fn installer_uninstall() -> Result<String, String> {
    let state = InstallerState::new();
    state.uninstall()?;
    Ok("Xryloth has been uninstalled. Thank you for being part of Xryloth!".to_string())
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
        ])
        .setup(|app| {
            // Set up the installer window
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
            .build()?;

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