#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const APP_ARCH: &str = "x86_64";
#[cfg(all(target_os = "windows", target_arch = "x86"))]
const APP_ARCH: &str = "i686";
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const APP_ARCH: &str = "aarch64";
#[cfg(not(target_os = "windows"))]
const APP_ARCH: &str = "unknown";

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{Manager, State};
use base64::Engine as _;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ==================== CONSTANTS ====================
// Keys are baked into the binary at compile time by build.rs
// (embedded_keys.rs is generated into OUT_DIR from rustc-env/secrets.json).
#[allow(dead_code)]
mod embedded_keys {
    include!(concat!(env!("OUT_DIR"), "/embedded_keys.rs"));
}

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
// Release tags use the 4-part marketing version (e.g. v6.0.0.1) while Cargo
// requires valid semver, so APP_VERSION stays 3-part. Update checks compare
// against this so a same-release tag never looks "newer".
const APP_DISPLAY_VERSION: &str = "6.0.0.20";
const GITHUB_API_URL: &str = "https://api.github.com/repos/EscapeXMc/xryloth/releases/latest";
const MOJANG_VERSION_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_VERSIONS_URL: &str = "https://meta.fabricmc.net/v2/versions/game";
const MODRINTH_API: &str = "https://api.modrinth.com/v2";
const ELYBY_CLIENT_ID: &str = "xryloth1";
const ELYBY_CLIENT_SECRET: &str = "C4O5syHE3ZCm2OLh8ii6kSYO8xc82t758qdhxW6peBiF3kypVRFgzWWSydfUMCOo";
const ELYBY_REDIRECT_URI: &str = "http://127.0.0.1:8080/callback";

// Aikar's recommended JVM flags for Minecraft servers (G1GC tuning).
const AIKAR_FLAGS: [&str; 24] = [
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
    "-Dusing.aikar=true",
    "-Daikar.g1.enabled=true",
    "-XX:+UseStringDeduplication",
    "-XX:+OptimizeStringConcat",
    "-Dfile.encoding=UTF-8",
    "-Djava.awt.headless=true",
];

// ==================== HTTP CACHE ====================
static HTTP_CACHE: std::sync::OnceLock<Mutex<HashMap<String, (u64, Value)>>> = std::sync::OnceLock::new();

fn http_cache() -> &'static Mutex<HashMap<String, (u64, Value)>> {
    HTTP_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn http_get_cached(url: &str, headers: Option<&[(&str, &str)]>) -> Result<Value, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    {
        let cache = http_cache().lock().unwrap();
        if let Some((ts, val)) = cache.get(url) {
            if now - *ts < 600 {
                return Ok(val.clone());
            }
        }
    }
    let result = http_get(url, headers);
    if let Ok(ref val) = result {
        let mut cache = http_cache().lock().unwrap();
        cache.insert(url.to_string(), (now, val.clone()));
    }
    result
}
const USER_AGENT: &str = "Xryloth/5.0";

// ==================== DISCORD RPC HELPERS ====================
use std::io::{Read as IoRead, Write as IoWrite};

// Discord IPC transport differs per platform:
//   Windows -> named pipe  \\.\pipe\discord-ipc-N
//   Unix    -> domain socket at $XDG_RUNTIME_DIR/discord-ipc-N (or /tmp/discord-ipc-N)
#[cfg(target_os = "windows")]
type DiscordStream = std::fs::File;
#[cfg(not(target_os = "windows"))]
type DiscordStream = std::os::unix::net::UnixStream;

#[allow(unused_variables)]
fn discord_connect(index: u32) -> std::io::Result<DiscordStream> {
    #[cfg(target_os = "windows")]
    {
        let pipe_name = format!(r"\\.\pipe\discord-ipc-{}", index);
        std::fs::OpenOptions::new().read(true).write(true).open(&pipe_name)
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::net::UnixStream;
        let mut candidates: Vec<String> = Vec::new();
        if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
            candidates.push(format!("{}/discord-ipc-{}", dir, index));
            candidates.push(format!("{}/app/com.discordapp.Discord/discord-ipc-{}", dir, index));
        }
        candidates.push(format!("/tmp/discord-ipc-{}", index));
        for path in &candidates {
            if let Ok(stream) = UnixStream::connect(path) {
                return Ok(stream);
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("no Discord IPC socket found (tried {} locations)", candidates.len()),
        ))
    }
}

fn discord_ipc_frame(opcode: u32, payload: &str) -> Vec<u8> {
    let bytes = payload.as_bytes();
    let len = bytes.len() as u32;
    let mut frame = Vec::with_capacity(8 + bytes.len());
    frame.extend_from_slice(&opcode.to_le_bytes());
    frame.extend_from_slice(&len.to_le_bytes());
    frame.extend_from_slice(bytes);
    frame
}

fn discord_ipc_read(reader: &mut dyn IoRead) -> Result<(u32, String), String> {
    let mut header = [0u8; 8];
    reader.read_exact(&mut header).map_err(|e| e.to_string())?;
    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload).map_err(|e| e.to_string())?;
    String::from_utf8(payload).map_err(|e| e.to_string()).map(|s| (opcode, s))
}

fn discord_set_activity(writer: &mut dyn IoWrite, nonce: &str, details: &str, state: &str, large_image: &str, large_text: &str, small_image: &str, small_text: &str) {
    let start_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let assets = if small_image.is_empty() && small_text.is_empty() {
        json!({
            "large_image": large_image,
            "large_text": large_text,
        })
    } else {
        json!({
            "large_image": large_image,
            "large_text": large_text,
            "small_image": small_image,
            "small_text": small_text,
        })
    };

    let activity = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": {
                "details": details,
                "state": state,
                "assets": assets,
                "timestamps": {
                    "start": start_ts
                }
            }
        },
        "nonce": nonce
    });

    let _ = writer.write_all(&discord_ipc_frame(1, &activity.to_string()));
}

// ==================== DISCORD RPC MESSAGES ====================
enum DiscordMessage {
    Update {
        details: String,
        state: String,
        large_image: String,
        large_text: String,
        small_image: String,
        small_text: String,
    },
    Stop,
}

struct DiscordRpcHandle {
    sender: std::sync::mpsc::Sender<DiscordMessage>,
}

// ==================== LOCAL SERVER MANAGER ====================
// A running self-hosted Minecraft server process plus its stdin handle.
struct ServerProc {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    started_at: std::time::Instant,
}

// ==================== APP STATE ====================
struct AppState {
    settings: Mutex<HashMap<String, Value>>,
    instances: Mutex<Vec<Value>>,
    log_entries: Mutex<Vec<String>>,
    game_output: Mutex<Vec<String>>,
    http_cache: Mutex<HashMap<String, (f64, Value)>>,
    elyby_auth_code: Arc<Mutex<Option<String>>>,
    ms_auth_result: Arc<Mutex<Option<Value>>>,
    ms_auth_polling: Arc<AtomicBool>,
    game_session_start: Mutex<Option<f64>>,
    game_session_instance: Mutex<Option<String>>,
    discord_handle: Arc<Mutex<Option<DiscordRpcHandle>>>,
    java_cache: Mutex<Option<(u64, Vec<Value>)>>,
    server_procs: Mutex<HashMap<String, ServerProc>>,
    server_logs: Mutex<HashMap<String, Vec<String>>>,
    server_stopping: Mutex<std::collections::HashSet<String>>,
    ai_context: Mutex<Option<Value>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            settings: Mutex::new(HashMap::new()),
            instances: Mutex::new(Vec::new()),
            log_entries: Mutex::new(Vec::new()),
            game_output: Mutex::new(Vec::new()),
            http_cache: Mutex::new(HashMap::new()),
            elyby_auth_code: Arc::new(Mutex::new(None)),
            ms_auth_result: Arc::new(Mutex::new(None)),
            ms_auth_polling: Arc::new(AtomicBool::new(false)),
            game_session_start: Mutex::new(None),
            game_session_instance: Mutex::new(None),
            discord_handle: Arc::new(Mutex::new(None)),
            java_cache: Mutex::new(None),
            server_procs: Mutex::new(HashMap::new()),
            server_logs: Mutex::new(HashMap::new()),
            server_stopping: Mutex::new(std::collections::HashSet::new()),
            ai_context: Mutex::new(None),
        }
    }
}

// ==================== PATH HELPERS ====================
fn app_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".xryloth")
}

fn instances_dir() -> PathBuf { app_dir().join("instances") }
fn instances_file() -> PathBuf { app_dir().join("instances.json") }
fn settings_file() -> PathBuf { app_dir().join("settings.json") }
fn playtimes_file() -> PathBuf { app_dir().join("playtimes.json") }
fn libraries_dir() -> PathBuf { app_dir().join("libraries") }
fn assets_dir() -> PathBuf { app_dir().join("assets") }
fn custom_skin_path() -> PathBuf { app_dir().join("custom_skin.png") }
fn authlib_injector_path() -> PathBuf { app_dir().join("authlib-injector.jar") }

fn ensure_dirs() {
    for d in [
        app_dir(), instances_dir(), libraries_dir(),
        assets_dir().join("indexes"), assets_dir().join("objects"),
        app_dir().join("servers"),
    ] {
        let _ = std::fs::create_dir_all(&d);
    }
}

// ==================== JSON FILE HELPERS ====================
fn load_json(path: &Path) -> Value {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
        Err(_) => Value::Null,
    }
}

fn save_json(path: &Path, data: &Value) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(s) = serde_json::to_string_pretty(data) {
        let _ = std::fs::write(path, s);
    }
}

// ==================== LOGGING ====================
fn log_msg(app: &State<AppState>, msg: &str) {
    let ts = chrono::Local::now().format("%H:%M:%S");
    let entry = format!("[{}] {}", ts, msg);
    if let Ok(mut entries) = app.log_entries.lock() {
        entries.push(entry.clone());
        if entries.len() > 5000 { entries.remove(0); }
    }
    println!("{}", entry);
}

fn append_game_output(app: &State<AppState>, line: &str) {
    if let Ok(mut buf) = app.game_output.lock() {
        buf.push(line.to_string());
        if buf.len() > 500 { buf.remove(0); }
    }
}

// ==================== CMD HELPER (hide console windows) ====================
fn hidden_cmd(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

// Run a shell command string with no visible console window, cross-platform.
// Uses `cmd /C` on Windows and `sh -c` on Linux/macOS.
fn run_shell_hidden(command: &str) {
    #[cfg(target_os = "windows")]
    let mut hook = {
        let mut c = hidden_cmd("cmd");
        c.args(["/C", command]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut hook = {
        let mut c = hidden_cmd("sh");
        c.args(["-c", command]);
        c
    };
    hook.stdout(std::process::Stdio::null());
    hook.stderr(std::process::Stdio::null());
    hook.stdin(std::process::Stdio::null());
    let _ = hook.spawn();
}

// ==================== HTTP HELPERS ====================
static ONLINE_CACHE: AtomicBool = AtomicBool::new(true);
static ONLINE_CHECK_TIME: AtomicU64 = AtomicU64::new(0);

fn is_connected() -> bool {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let last_check = ONLINE_CHECK_TIME.load(Ordering::Relaxed);
    if now - last_check < 10 {
        return ONLINE_CACHE.load(Ordering::Relaxed);
    }
    ONLINE_CHECK_TIME.store(now, Ordering::Relaxed);
    let result = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .and_then(|c| c.head("https://sessionserver.mojang.com").send().map(|r| r.status().is_success()))
        .unwrap_or(false);
    ONLINE_CACHE.store(result, Ordering::Relaxed);
    result
}

fn http_get(url: &str, headers: Option<&[(&str, &str)]>) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(url);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(*k, *v);
        }
    }
    let resp = req.send().map_err(|e| e.to_string())?;
    let text = resp.text().map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| text)
}

async fn http_get_async(url: &str, headers: Option<Vec<(&str, &str)>>) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(url);
    if let Some(hdrs) = &headers {
        for (k, v) in hdrs {
            req = req.header(*k, *v);
        }
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| text)
}

fn http_post_json(url: &str, body: &Value, headers: Option<&[(&str, &str)]>) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(url).json(body);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(*k, *v);
        }
    }
    let resp = req.send().map_err(|e| e.to_string())?;
    let text = resp.text().map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| text)
}

fn http_post_form(url: &str, form: &str, auth: Option<(&str, &str)>) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form.to_string());
    if let Some((user, pass)) = auth {
        let cred = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", user, pass));
        req = req.header("Authorization", format!("Basic {}", cred));
    }
    let resp = req.send().map_err(|e| e.to_string())?;
    let text = resp.text().map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| text)
}

fn download_file_blocking(url: &str, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    std::io::copy(&mut resp, &mut file).map_err(|e| e.to_string())?;
    Ok(())
}

/// Like `download_file_blocking`, but streams in chunks and reports progress.
/// Used for server jars so the UI can show a live bar instead of a dead spinner.
fn download_file_progress(
    url: &str,
    dest: &Path,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|e| e.to_string())?;
    let total = resp.content_length();
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last = std::time::Instant::now();
    on_progress(0, total);
    loop {
        let n = std::io::Read::read(&mut resp, &mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        std::io::Write::write_all(&mut file, &buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        if last.elapsed().as_millis() >= 200 || Some(downloaded) == total {
            last = std::time::Instant::now();
            on_progress(downloaded, total);
        }
    }
    on_progress(downloaded, total);
    Ok(())
}

// ==================== MAVEN HELPERS ====================
fn maven_name_to_path(maven_name: &str) -> Option<String> {
    let parts: Vec<&str> = maven_name.split(':').collect();
    if parts.len() < 3 { return None; }
    let group_path = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = if parts.len() > 3 { parts[3] } else { "" };
    if classifier.is_empty() {
        Some(format!("{}/{}/{}/{}-{}.jar", group_path, artifact, version, artifact, version))
    } else {
        Some(format!("{}/{}/{}/{}-{}-{}.jar", group_path, artifact, version, artifact, version, classifier))
    }
}

// ==================== VERSION HELPERS ====================
fn parse_version_tuple(ver: &str) -> (i32, i32, i32) {
    let parts: Vec<&str> = ver.split('.').collect();
    let a = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let b = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let c = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    (a, b, c)
}

fn loader_supports(loader: &str, ver: &str) -> bool {
    let vt = parse_version_tuple(ver);
    match loader.to_lowercase().as_str() {
        "vanilla" => true,
        "fabric" | "quilt" => vt >= (1, 14, 0),
        "forge" => vt >= (1, 4, 0),
        "neoforge" => vt >= (1, 20, 2),
        "optifine" => vt >= (1, 7, 0),
        _ => false,
    }
}

fn build_version_groups(all_versions: &[String]) -> HashMap<String, Vec<String>> {
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    let re = regex_lite::Regex::new(r"^(\d+\.\d+)").ok();
    for v in all_versions {
        if let Some(ref re) = re {
            if let Some(caps) = re.captures(v) {
                let prefix = caps[1].to_string();
                groups.entry(prefix).or_default().push(v.clone());
            }
        }
    }
    for vals in groups.values_mut() {
        vals.sort_by(|a, b| parse_version_tuple(b).cmp(&parse_version_tuple(a)));
    }
    groups
}

// ==================== SETTINGS ====================
fn load_settings(app: &State<AppState>) -> HashMap<String, Value> {
    let mut settings = app.settings.lock().unwrap();
    if settings.is_empty() {
        let data = load_json(&settings_file());
        if let Some(obj) = data.as_object() {
            for (k, v) in obj {
                settings.insert(k.clone(), v.clone());
            }
        }
    }
    settings.clone()
}

fn get_setting_val(settings: &HashMap<String, Value>, key: &str, default: Value) -> Value {
    settings.get(key).cloned().unwrap_or(default)
}

fn save_setting_val(app: &State<AppState>, key: &str, value: Value) {
    let mut settings = app.settings.lock().unwrap();
    settings.insert(key.to_string(), value);
    let data = Value::Object(settings.clone().into_iter().collect());
    save_json(&settings_file(), &data);
}

// ==================== INSTANCES ====================
fn load_instances_raw(app: &State<AppState>) -> Vec<Value> {
    let data = load_json(&instances_file());
    let mut instances = data.as_array().cloned().unwrap_or_default();
    let inst_dir = instances_dir();
    for inst in instances.iter_mut() {
        if let Some(name) = inst.get("name").and_then(|v| v.as_str()) {
            let dir = inst_dir.join(name);
            inst["installed"] = Value::Bool(dir.exists());
            if let Some(ver) = inst.get("version").and_then(|v| v.as_str()) {
                let vj = dir.join(format!("{}.json", ver));
                inst["version_json_exists"] = Value::Bool(vj.exists());
            }
        }
    }
    instances
}

fn save_instances(instances: &[Value]) {
    save_json(&instances_file(), &Value::Array(instances.to_vec()));
}

// ==================== LIBRARY RULE FILTERING ====================
fn is_lib_allowed(lib: &Value) -> bool {
    let rules = match lib.get("rules").and_then(|r| r.as_array()) {
        Some(r) if !r.is_empty() => r,
        _ => return true,
    };
    let mut allowed: Option<bool> = None;
    let os_name = if cfg!(target_os = "windows") { "windows" }
        else if cfg!(target_os = "macos") { "osx" }
        else { "linux" };
    for rule in rules {
        if rule.get("features").is_some() { continue; }
        if let Some(os_rule) = rule.get("os") {
            if let Some(name) = os_rule.get("name").and_then(|v| v.as_str()) {
                if name == os_name {
                    allowed = Some(rule.get("action").and_then(|v| v.as_str()) == Some("allow"));
                }
            }
        }
    }
    allowed.unwrap_or(true)
}

// Resolve the native library artifact (url, path) for the current OS/arch.
// Handles both formats found in real version JSONs:
//  - Modern Mojang (1.19+): a SEPARATE library entry whose `name` ends with
//    ":natives-windows[-arch]" and the jar under `downloads.artifact`.
//  - Classic/Forge: `downloads.classifiers["natives-windows[-arch]"]`.
fn get_native_artifact(lib: &Value) -> Option<(String, String)> {
    let host_arch = get_host_arch();

    // Format B (modern Mojang): name ends with :natives-windows[-arch]
    if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
        if let Some(at) = name.find(":natives-") {
            let suffix = &name[at + 1..];
            if suffix.starts_with("natives-windows") {
                let matches = if suffix == "natives-windows" {
                    true
                } else if suffix == "natives-windows-x86_64" {
                    host_arch == "x64" || host_arch == "aarch64"
                } else if suffix == "natives-windows-x86" {
                    host_arch != "aarch64"
                } else if suffix == "natives-windows-arm64" {
                    host_arch == "aarch64"
                } else {
                    false
                };
                if matches {
                    if let Some(art) = lib.get("downloads").and_then(|d| d.get("artifact")) {
                        if let (Some(url), Some(path)) = (
                            art.get("url").and_then(|u| u.as_str()),
                            art.get("path").and_then(|p| p.as_str()),
                        ) {
                            return Some((url.to_string(), path.to_string()));
                        }
                    }
                }
            }
            return None;
        }
    }

    // Format A (classic/Forge): downloads.classifiers
    if let Some(classifiers) = lib.get("downloads").and_then(|d| d.get("classifiers")) {
        let candidates: &[&str] = if host_arch == "aarch64" {
            &["natives-windows-arm64", "natives-windows"]
        } else if host_arch == "x64" {
            &["natives-windows-x86_64", "natives-windows-x86", "natives-windows"]
        } else {
            &["natives-windows-x86", "natives-windows"]
        };
        for c in candidates {
            if let Some(info) = classifiers.get(*c) {
                if let (Some(url), Some(path)) = (
                    info.get("url").and_then(|u| u.as_str()),
                    info.get("path").and_then(|p| p.as_str()),
                ) {
                    return Some((url.to_string(), path.to_string()));
                }
            }
        }
    }
    None
}

// Extract native (.dll/.so/.dylib/.jnilib) files from library native jars into the
// instance's natives folder. Missing native jars are downloaded on the fly so this is
// self-healing (e.g. a game can launch even if the original install skipped natives).
// Returns the number of native files written.
fn extract_natives(libs_dir: &Path, inst_dir: &Path, ver_json: &Value) -> usize {
    let natives_dir = inst_dir.join("natives");
    let _ = std::fs::create_dir_all(&natives_dir);
    let mut count = 0usize;
    if let Some(libraries) = ver_json.get("libraries").and_then(|l| l.as_array()) {
        for lib in libraries {
            if let Some((nat_url, nat_path_str)) = get_native_artifact(lib) {
                let nat_path = libs_dir.join(&nat_path_str);
                if !nat_path.exists() {
                    // Native jar missing — download it (self-heal on launch without reinstall).
                    let _ = download_file_blocking(&nat_url, &nat_path);
                }
                if nat_path.exists() {
                    if let Ok(file) = std::fs::File::open(&nat_path) {
                        if let Ok(mut zip) = zip::ZipArchive::new(file) {
                            for i in 0..zip.len() {
                                        if let Ok(mut f) = zip.by_index(i) {
                                            let name = f.name().to_string();
                                            if name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib") || name.ends_with(".jnilib") {
                                                let mut buf = Vec::new();
                                                if f.read_to_end(&mut buf).is_ok() {
                                                    let _ = std::fs::write(natives_dir.join(&name), &buf);
                                                    count += 1;
                                                }
                    }
                }
            }
        }
    }
                    }
                }
            }
        }
    count
}

// ==================== TAURI COMMANDS ====================

// --- Settings ---
#[tauri::command]
fn get_settings(app: State<AppState>) -> Value {
    let settings = load_settings(&app);
    Value::Object(settings.into_iter().collect())
}

#[tauri::command]
fn save_settings(app: State<AppState>, settings: Value) -> Value {
    if let Some(obj) = settings.as_object() {
        let mut current = app.settings.lock().unwrap();
        for (k, v) in obj {
            current.insert(k.clone(), v.clone());
        }
        let data = Value::Object(current.clone().into_iter().collect());
        save_json(&settings_file(), &data);
    }
    json!({"success": true})
}

#[tauri::command]
fn get_setting_cmd(app: State<AppState>, key: String, default: Option<Value>) -> Value {
    let settings = load_settings(&app);
    settings.get(&key).cloned().unwrap_or(default.unwrap_or(Value::Null))
}

#[tauri::command]
fn save_setting_cmd(app: State<AppState>, key: String, value: Value) -> Value {
    save_setting_val(&app, &key, value);
    json!({"success": true})
}

// --- Instances ---
#[tauri::command]
fn get_instances(app: State<AppState>) -> Value {
    let mut list = load_instances_raw(&app);
    // Attach the per-profile JVM/RAM overrides so the UI (and the install
    // validation checks) can show what a profile will actually launch with.
    let overrides = load_json(&app_dir().join("instance_settings.json"));
    if overrides.is_object() {
        for inst in list.iter_mut() {
            let name = match inst.get("name").and_then(|v| v.as_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if let Some(o) = overrides.get(&name) {
                if let Some(ram) = o.get("ram_mb").and_then(|v| v.as_i64()) {
                    if ram >= 512 { inst["ram_mb"] = json!(ram); }
                }
                if let Some(j) = o.get("jvm_args").and_then(|v| v.as_str()) {
                    if !j.is_empty() { inst["jvm_args"] = json!(j); }
                }
                if let Some(jp) = o.get("java_path").and_then(|v| v.as_str()) {
                    if !jp.is_empty() { inst["java_path"] = json!(jp); }
                }
            }
        }
    }
    Value::Array(list)
}

#[tauri::command]
fn create_instance(app: State<AppState>, name: String, mc_version: String, loader: String, loader_version: String) -> Value {
    log_msg(&app, &format!("[Instance] Creating '{}' ({} {})", name, loader, mc_version));
    let inst_dir = instances_dir().join(&name);
    let _ = std::fs::create_dir_all(&inst_dir);
    for subdir in &["mods", "saves", "resourcepacks", "screenshots", "natives", "assets", "config", "config/CustomSkinLoader"] {
        let _ = std::fs::create_dir_all(inst_dir.join(subdir));
    }
    let instance_data = json!({
        "name": name, "version": mc_version, "loader": loader,
        "loader_version": loader_version,
        "created": chrono::Local::now().to_rfc3339(),
        "last_played": null, "icon": "",
    });
    let mut instances = load_instances_raw(&app);
    instances.push(instance_data.clone());
    save_instances(&instances);
    json!({"success": true, "instance": instance_data})
}

#[tauri::command]
fn delete_instance(app: State<AppState>, name: String) -> Value {
    log_msg(&app, &format!("[Instance] Deleting '{}'", name));
    let inst_dir = instances_dir().join(&name);
    let _ = std::fs::remove_dir_all(&inst_dir);
    let mut instances = load_instances_raw(&app);
    instances.retain(|i| i.get("name").and_then(|v| v.as_str()) != Some(&name));
    save_instances(&instances);
    json!({"success": true})
}

#[tauri::command(async)]
fn install_instance(app_handle: tauri::AppHandle, instance_name: String, mc_version: String, loader: String, loader_version: String) -> Value {
        tokio::task::block_in_place(|| {
    // Run the entire install on a background thread and return immediately,
    // so the launcher UI stays responsive (no "Not Responding") while files
    // download one-by-one sequentially.
    let handle = app_handle.clone();
    let inst_name_ret = instance_name.clone();
    std::thread::spawn(move || -> Value {
        let app = handle.state::<AppState>();
        log_msg(&app, &format!("[Install] Installing '{}' ({} {})", instance_name, loader, mc_version));
        let emit = |step: &str, msg: &str, progress: u32, done: bool, success: bool, warnings: Vec<String>| {
            let _ = handle.emit_all("install-progress", json!({
                "step": step, "message": msg, "progress": progress,
                "done": done, "success": success, "warnings": warnings,
            }));
        };

    emit("Preparing", "Fetching version manifest...", 2, false, true, vec![]);

    // 1. Fetch version manifest
    let manifest = match http_get(MOJANG_VERSION_MANIFEST, None) {
        Ok(m) => m,
        Err(e) => {
            emit("Error", &format!("Failed to fetch version manifest: {}", e), 0, true, false, vec![]);
            return json!({"error": format!("Failed to fetch version manifest: {}", e)});
        }
    };

    let version_url = manifest.get("versions")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|v| v.get("id").and_then(|i| i.as_str()) == Some(&mc_version)))
        .and_then(|v| v.get("url").and_then(|u| u.as_str()));

    let version_url = match version_url {
        Some(u) => u.to_string(),
        None => {
            emit("Error", &format!("Version {} not found", mc_version), 0, true, false, vec![]);
            return json!({"error": format!("Version {} not found", mc_version)});
        }
    };

    emit("Version Data", &format!("Fetching version data for {}...", mc_version), 5, false, true, vec![]);
    let version_data = match http_get(&version_url, None) {
        Ok(v) => v,
        Err(e) => {
            emit("Error", &format!("Failed to fetch version data: {}", e), 0, true, false, vec![]);
            return json!({"error": format!("Failed to fetch version data: {}", e)});
        }
    };

    let inst_dir = instances_dir().join(&instance_name);
    let _ = std::fs::create_dir_all(&inst_dir);
    for subdir in &["mods", "saves", "resourcepacks", "screenshots", "natives", "assets", "config"] {
        let _ = std::fs::create_dir_all(inst_dir.join(subdir));
    }

    save_json(&inst_dir.join(format!("{}.json", mc_version)), &version_data);
    log_msg(&app, "[Install] Version JSON saved");

    // 1.5 Ensure the COMPATIBLE Java is installed BEFORE installing the instance.
    // Required version is resolved from Mojang's live manifest (real compatibility).
    let required_java = get_required_java_for_mc(&mc_version);
    emit("Java", &format!("Checking Java {} compatibility (live lookup)...", required_java), 6, false, true, vec![]);
    let java_ready = {
        let javas = find_all_java_installations();
        javas.iter().any(|j| {
            j.get("major_version").and_then(|v| v.as_u64()).unwrap_or(0) as u32 == required_java
                && j.get("compatible_arch").and_then(|v| v.as_bool()).unwrap_or(false)
        })
    };
    if !java_ready {
        emit("Java", &format!("Installing compatible Java {}...", required_java), 7, false, true, vec![]);
        match auto_download_java(&app, required_java) {
            Ok(p) => log_msg(&app, &format!("[Install] Compatible Java {} ready at {}", required_java, p)),
            Err(e) => log_msg(&app, &format!("[Install/WARN] Java {} auto-download failed: {}", required_java, e)),
        }
    } else {
        log_msg(&app, &format!("[Install] Compatible Java {} already present", required_java));
    }

    // 2. Download client jar
    emit("Client JAR", "Downloading Minecraft client jar...", 8, false, true, vec![]);
    if let Some(client_url) = version_data.get("downloads")
        .and_then(|d| d.get("client"))
        .and_then(|c| c.get("url"))
        .and_then(|u| u.as_str())
    {
        let client_jar = inst_dir.join(format!("{}.jar", mc_version));
        let need_client = !client_jar.exists() ||
            client_jar.metadata().map(|m| m.len() == 0).unwrap_or(true);
        if need_client {
            log_msg(&app, "[Install] Downloading client jar...");
            match download_file_blocking(client_url, &client_jar) {
                Ok(()) => {
                    log_msg(&app, "[Install] Client jar downloaded OK");
                    emit("Client JAR", "Minecraft client jar downloaded", 15, false, true, vec![]);
                }
                Err(e) => {
                    log_msg(&app, &format!("[Install/ERROR] Client jar download failed: {}", e));
                    emit("Error", &format!("Client jar download failed: {}", e), 0, true, false, vec![]);
                    return json!({"error": format!("Client jar download failed: {}", e)});
                }
            }
        } else {
            log_msg(&app, "[Install] Client jar already exists, skipping");
            emit("Client JAR", "Client jar already exists, skipping", 15, false, true, vec![]);
        }
    } else {
        emit("Error", "Version JSON has no client download URL", 0, true, false, vec![]);
        return json!({"error": "Version JSON has no client download URL"});
    }

    // 3. Download libraries
    emit("Libraries", "Downloading libraries...", 16, false, true, vec![]);
    let libs_dir = libraries_dir();
    let mut lib_errors: Vec<String> = Vec::new();
    if let Some(libraries) = version_data.get("libraries").and_then(|l| l.as_array()) {
        let total = libraries.len();
        let mut downloaded = 0u32;
        let mut skipped = 0u32;
        for (idx, lib) in libraries.iter().enumerate() {
            if let Some(artifact) = lib.get("downloads").and_then(|d| d.get("artifact")) {
                if let (Some(url), Some(path)) = (
                    artifact.get("url").and_then(|u| u.as_str()),
                    artifact.get("path").and_then(|p| p.as_str()),
                ) {
                    let dest = libs_dir.join(path);
                    if !dest.exists() || dest.metadata().map(|m| m.len() == 0).unwrap_or(true) {
                        match download_file_blocking(url, &dest) {
                            Ok(()) => { downloaded += 1; }
                            Err(e) => {
                                let name = lib.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                log_msg(&app, &format!("[Install/WARN] Library '{}' download failed: {}", name, e));
                                lib_errors.push(format!("{}: {}", name, e));
                            }
                        }
                    } else {
                        skipped += 1;
                    }
                }
            }

            if let Some((nat_url, nat_path_str)) = get_native_artifact(lib) {
                let nat_path = libs_dir.join(&nat_path_str);
                if !nat_path.exists() {
                    if let Err(e) = download_file_blocking(&nat_url, &nat_path) {
                        log_msg(&app, &format!("[Install/WARN] Native jar download failed: {}", e));
                        lib_errors.push(format!("native {}: {}", nat_path_str, e));
                        continue;
                    }
                }
                let natives_dir = inst_dir.join("natives");
                        let _ = std::fs::create_dir_all(&natives_dir);
                        match std::fs::File::open(&nat_path) {
                            Ok(file) => {
                                match zip::ZipArchive::new(file) {
                                    Ok(mut zip) => {
                                        for i in 0..zip.len() {
                                            if let Ok(mut file) = zip.by_index(i) {
                                                let name = file.name().to_string();
                                                if name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib") || name.ends_with(".jnilib") {
                                                    let mut buf = Vec::new();
                                                    if file.read_to_end(&mut buf).is_ok() {
                                                        let _ = std::fs::write(natives_dir.join(&name), &buf);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        log_msg(&app, &format!("[Install/WARN] Failed to open native zip: {}", e));
                                    }
                                }
                            }
                            Err(e) => {
                                log_msg(&app, &format!("[Install/WARN] Failed to open native jar file: {}", e));
                            }
                        }
                    }

            let lib_pct = 16 + ((idx as u32 + 1) * 30 / total as u32);
            if (idx + 1) % 10 == 0 || idx + 1 == total {
                let lib_name = lib.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let short_name = lib_name.rsplit(':').next().unwrap_or(lib_name);
                emit("Libraries", &format!("{}/{} libs - {}", idx + 1, total, short_name), lib_pct.min(46), false, true, vec![]);
                log_msg(&app, &format!("[Install] Libraries: {}/{} ({} downloaded, {} skipped)", idx + 1, total, downloaded, skipped));
            }
        }
        log_msg(&app, &format!("[Install] Libraries done: {} downloaded, {} already existed, {} errors", downloaded, skipped, lib_errors.len()));
        emit("Libraries", &format!("Libraries complete: {} downloaded, {} cached", downloaded, skipped), 46, false, true, vec![]);
        let _ = extract_natives(&libs_dir, &inst_dir, &version_data);
        log_msg(&app, "[Install] Native extraction verified");
    }

    // 4. Download asset index + actual assets
    if let Some(asset_index) = version_data.get("assetIndex") {
        if let (Some(url), Some(id)) = (
            asset_index.get("url").and_then(|u| u.as_str()),
            asset_index.get("id").and_then(|i| i.as_str()),
        ) {
            let index_file = assets_dir().join("indexes").join(format!("{}.json", id));
            if !index_file.exists() || index_file.metadata().map(|m| m.len() == 0).unwrap_or(true) {
                emit("Assets", &format!("Downloading asset index '{}'...", id), 47, false, true, vec![]);
                log_msg(&app, &format!("[Install] Downloading asset index '{}'...", id));
                match download_file_blocking(url, &index_file) {
                    Ok(()) => {
                        log_msg(&app, "[Install] Asset index downloaded OK");
                    }
                    Err(e) => {
                        log_msg(&app, &format!("[Install/WARN] Asset index download failed: {} (non-fatal)", e));
                    }
                }
            } else {
                log_msg(&app, "[Install] Asset index already exists, skipping");
            }

            // Download actual asset objects
            emit("Assets", "Downloading asset files...", 50, false, true, vec![]);
            log_msg(&app, "[Install] Downloading asset objects...");
            let objects_dir = assets_dir().join("objects");
            let _ = std::fs::create_dir_all(&objects_dir);
            if let Ok(index_content) = std::fs::read_to_string(&index_file) {
                if let Ok(index_data) = serde_json::from_str::<Value>(&index_content) {
                    if let Some(assets) = index_data.get("objects").and_then(|o| o.as_object()) {
                        let total_assets = assets.len();
                        let mut assets_dl = 0u32;
                        let mut assets_skipped = 0u32;
                        let mut assets_errors = 0u32;
                        for (idx, (asset_name, asset_info)) in assets.iter().enumerate() {
                            if let Some(hash) = asset_info.get("hash").and_then(|h| h.as_str()) {
                                let hash_prefix = &hash[..2.min(hash.len())];
                                let asset_path = objects_dir.join(hash_prefix).join(hash);
                                if asset_path.exists() {
                                    assets_skipped += 1;
                                } else {
                                    let asset_url = format!("https://resources.download.minecraft.net/{}/{}/{}", hash_prefix, hash, asset_name);
                                    match download_file_blocking(&asset_url, &asset_path) {
                                        Ok(()) => { assets_dl += 1; }
                                        Err(_) => { assets_errors += 1; }
                                    }
                                }
                            }
                            let asset_pct = 50 + ((idx as u32 + 1) * 25 / total_assets as u32);
                            if (idx + 1) % 50 == 0 || idx + 1 == total_assets {
                                emit("Assets", &format!("{}/{} assets", idx + 1, total_assets), asset_pct.min(75), false, true, vec![]);
                                log_msg(&app, &format!("[Install] Assets: {}/{} ({} downloaded, {} cached)", idx + 1, total_assets, assets_dl, assets_skipped));
                            }
                        }
                        log_msg(&app, &format!("[Install] Assets done: {} downloaded, {} cached, {} errors", assets_dl, assets_skipped, assets_errors));
                        emit("Assets", &format!("Assets complete: {} downloaded, {} cached", assets_dl, assets_skipped), 75, false, true, vec![]);
                    }
                }
            }
        }
    }

    // 5. Install loader
    if loader.to_lowercase() != "vanilla" {
        emit("Loader", &format!("Installing {} loader...", loader), 76, false, true, vec![]);
        let actual_loader_version = if loader_version.is_empty() {
            match loader.to_lowercase().as_str() {
                "fabric" | "quilt" => {
                    let api_url = if loader.to_lowercase() == "fabric" {
                        format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version)
                    } else {
                        format!("https://meta.quiltmc.org/v3/versions/loader/{}", mc_version)
                    };
                    log_msg(&app, &format!("[Install] Auto-fetching latest {} loader version...", loader));
                    match http_get(&api_url, None) {
                        Ok(data) => {
                            if let Some(arr) = data.as_array() {
                                let found = arr.iter().find(|v| {
                                    v.get("loader").and_then(|l| l.get("stable")).and_then(|s| s.as_bool()).unwrap_or(false)
                                }).or_else(|| arr.first());
                                if let Some(entry) = found {
                                    let ver = entry.get("loader").and_then(|l| l.get("version")).and_then(|v| v.as_str()).unwrap_or("");
                                    log_msg(&app, &format!("[Install] Auto-detected {} loader version: {}", loader, ver));
                                    emit("Loader", &format!("{} {} detected", loader, ver), 77, false, true, vec![]);
                                    ver.to_string()
                                } else { String::new() }
                            } else { String::new() }
                        }
                        Err(e) => {
                            log_msg(&app, &format!("[Install/WARN] Failed to fetch loader versions: {}", e));
                            String::new()
                        }
                    }
                }
                "forge" => {
                    log_msg(&app, &format!("[Install] Auto-fetching latest Forge version for {}...", mc_version));
                    emit("Loader", "Detecting Forge version...", 77, false, true, vec![]);
                    match reqwest::blocking::Client::builder().user_agent(USER_AGENT).timeout(std::time::Duration::from_secs(15)).build() {
                        Ok(client) => {
                            match client.get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml").send().and_then(|r| r.text()) {
                                Ok(xml) => {
                                    let prefix = format!(">{}-", mc_version);
                                    let mut best: Option<String> = None;
                                    for line in xml.lines() {
                                        if let Some(start) = line.find(&prefix) {
                                            let after = &line[start+1..];
                                            if let Some(end) = after.find('<') {
                                                let ver = &after[..end];
                                                if !ver.is_empty() && best.is_none() {
                                                    best = Some(ver.to_string());
                                                }
                                            }
                                        }
                                    }
                                    if let Some(ver_val) = best {
                                        log_msg(&app, &format!("[Install] Auto-detected Forge version: {}", ver_val));
                                        emit("Loader", &format!("Forge {} detected", ver_val), 77, false, true, vec![]);
                                        ver_val
                                    } else {
                                        log_msg(&app, &format!("[Install/WARN] No Forge version found for {}", mc_version));
                                        String::new()
                                    }
                                }
                                Err(e) => {
                                    log_msg(&app, &format!("[Install/WARN] Failed to fetch Forge version list: {}", e));
                                    String::new()
                                }
                            }
                        }
                        Err(e) => {
                            log_msg(&app, &format!("[Install/WARN] Failed to create HTTP client for Forge: {}", e));
                            String::new()
                        }
                    }
                }
                "neoforge" => {
                    log_msg(&app, &format!("[Install] Auto-fetching latest NeoForge version for {}...", mc_version));
                    emit("Loader", "Detecting NeoForge version...", 77, false, true, vec![]);
                    match reqwest::blocking::Client::builder().user_agent(USER_AGENT).timeout(std::time::Duration::from_secs(15)).build() {
                        Ok(client) => {
                            match client.get("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml").send().and_then(|r| r.text()) {
                                Ok(xml) => {
                                    let prefix = format!(">{}-", mc_version);
                                    let mut best: Option<String> = None;
                                    for line in xml.lines() {
                                        if let Some(start) = line.find(&prefix) {
                                            let after = &line[start+1..];
                                            if let Some(end) = after.find('<') {
                                                let ver = &after[..end];
                                                if ver.chars().all(|c| c.is_ascii_digit() || c == '.') {
                                                    best = Some(ver.to_string());
                                                }
                                            }
                                        }
                                    }
                                    if let Some(ver) = best {
                                        log_msg(&app, &format!("[Install] Auto-detected NeoForge version: {}", ver));
                                        emit("Loader", &format!("NeoForge {} detected", ver), 77, false, true, vec![]);
                                        ver
                                    } else {
                                        log_msg(&app, &format!("[Install/WARN] No NeoForge version found for {}", mc_version));
                                        String::new()
                                    }
                                }
                                Err(e) => {
                                    log_msg(&app, &format!("[Install/WARN] Failed to fetch NeoForge versions: {}", e));
                                    String::new()
                                }
                            }
                        }
                        Err(e) => {
                            log_msg(&app, &format!("[Install/WARN] HTTP client error: {}", e));
                            String::new()
                        }
                    }
                }
                _ => String::new(),
            }
        } else {
            loader_version.clone()
        };

        if !actual_loader_version.is_empty() {
            log_msg(&app, &format!("[Install] Installing {} loader {}...", loader, actual_loader_version));
            emit("Loader", &format!("Installing {} {}...", loader, actual_loader_version), 78, false, true, vec![]);
            match loader.to_lowercase().as_str() {
                "fabric" => {
                    let profile_url = format!("https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json", mc_version, actual_loader_version);
                    match http_get(&profile_url, None) {
                        Ok(profile) => {
                            let mut flib_errors: Vec<String> = Vec::new();
                            if let Some(libs) = profile.get("libraries").and_then(|l| l.as_array()) {
                                for lib in libs {
                                    if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                                        if let Some(lib_url) = lib.get("url").and_then(|u| u.as_str()) {
                                            if let Some(path) = maven_name_to_path(name) {
                                                let dest = libs_dir.join(&path);
                                                if !dest.exists() {
                                                    let full_url = format!("{}/{}", lib_url.trim_end_matches('/'), path);
                                                    if let Err(e) = download_file_blocking(&full_url, &dest) {
                                                        log_msg(&app, &format!("[Install/WARN] Fabric lib '{}' failed: {}", name, e));
                                                        flib_errors.push(name.to_string());
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            let loader_jar_name = format!("fabric-loader-{}.jar", actual_loader_version);
                            if let Some(libs) = profile.get("libraries").and_then(|l| l.as_array()) {
                                for lib in libs {
                                    if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                                        if name.contains(&loader_jar_name) || name.contains(&format!("fabric-loader-{}", actual_loader_version)) {
                                            if let Some(path) = maven_name_to_path(name) {
                                                let src = libs_dir.join(&path);
                                                let dst = inst_dir.join(&loader_jar_name);
                                                if src.exists() && !dst.exists() {
                                                    let _ = std::fs::copy(&src, &dst);
                                                    log_msg(&app, &format!("[Install] Copied {} to instance", loader_jar_name));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            save_json(&inst_dir.join(format!("fabric-loader-{}-profile.json", actual_loader_version)), &profile);
                            log_msg(&app, "[Install] Fabric loader installed successfully");
                            emit("Loader", "Fabric loader installed", 85, false, true, vec![]);
                        }
                        Err(e) => {
                            log_msg(&app, &format!("[Install/ERROR] Failed to fetch Fabric profile: {}", e));
                            emit("Error", &format!("Fabric profile fetch failed: {}", e), 0, true, false, vec![]);
                            return json!({"error": format!("Fabric profile fetch failed: {}", e)});
                        }
                    }
                }
                "quilt" => {
                    let profile_url = format!("https://meta.quiltmc.org/v3/versions/loader/{}/{}/profile/json", mc_version, actual_loader_version);
                    match http_get(&profile_url, None) {
                        Ok(profile) => {
                            let mut qlib_errors: Vec<String> = Vec::new();
                            if let Some(libs) = profile.get("libraries").and_then(|l| l.as_array()) {
                                for lib in libs {
                                    if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                                        if let Some(lib_url) = lib.get("url").and_then(|u| u.as_str()) {
                                            if let Some(path) = maven_name_to_path(name) {
                                                let dest = libs_dir.join(&path);
                                                if !dest.exists() {
                                                    let full_url = format!("{}/{}", lib_url.trim_end_matches('/'), path);
                                                    if let Err(e) = download_file_blocking(&full_url, &dest) {
                                                        log_msg(&app, &format!("[Install/WARN] Quilt lib '{}' failed: {}", name, e));
                                                        qlib_errors.push(name.to_string());
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            let loader_jar_name = format!("quilt-loader-{}.jar", actual_loader_version);
                            if let Some(libs) = profile.get("libraries").and_then(|l| l.as_array()) {
                                for lib in libs {
                                    if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                                        if name.contains(&format!("quilt-loader-{}", actual_loader_version)) {
                                            if let Some(path) = maven_name_to_path(name) {
                                                let src = libs_dir.join(&path);
                                                let dst = inst_dir.join(&loader_jar_name);
                                                if src.exists() && !dst.exists() {
                                                    let _ = std::fs::copy(&src, &dst);
                                                    log_msg(&app, &format!("[Install] Copied {} to instance", loader_jar_name));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            save_json(&inst_dir.join(format!("quilt-loader-{}-profile.json", actual_loader_version)), &profile);
                            log_msg(&app, "[Install] Quilt loader installed successfully");
                            emit("Loader", "Quilt loader installed", 85, false, true, vec![]);
                        }
                        Err(e) => {
                            log_msg(&app, &format!("[Install/ERROR] Failed to fetch Quilt profile: {}", e));
                            emit("Error", &format!("Quilt profile fetch failed: {}", e), 0, true, false, vec![]);
                            return json!({"error": format!("Quilt profile fetch failed: {}", e)});
                        }
                    }
                }
                "forge" | "neoforge" => {
                    log_msg(&app, &format!("[Install] {} loader installation: downloading installer for {}...", loader, actual_loader_version));
                    let installer_url = match loader.to_lowercase().as_str() {
                        "neoforge" => format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar", actual_loader_version, actual_loader_version),
                        "forge" => format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar", actual_loader_version, actual_loader_version),
                        _ => String::new(),
                    };
                    let installer_jar = inst_dir.join(format!("{}-installer.jar", loader.to_lowercase()));
                    match download_file_blocking(&installer_url, &installer_jar) {
                        Ok(()) => {
                            log_msg(&app, &format!("[Install] {} installer downloaded, extracting libraries...", loader));
                            if let Ok(file) = std::fs::File::open(&installer_jar) {
                                if let Ok(mut zip) = zip::ZipArchive::new(file) {
                                    for i in 0..zip.len() {
                                        if let Ok(mut file) = zip.by_index(i) {
                                            let name = file.name().to_string();
                                            if name.starts_with("META-INF/libraries/") && name.ends_with(".jar") {
                                                let rel = name.strip_prefix("META-INF/libraries/").unwrap_or(&name);
                                                let dest = libs_dir.join(rel);
                                                if !dest.exists() {
                                                    if let Some(parent) = dest.parent() { let _ = std::fs::create_dir_all(parent); }
                                                    let mut buf = Vec::new();
                                                    let _ = file.read_to_end(&mut buf);
                                                    let _ = std::fs::write(&dest, &buf);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            let _ = std::fs::remove_file(&installer_jar);
                            log_msg(&app, &format!("[Install] {} libraries extracted from installer", loader));
                            emit("Loader", &format!("{} loader installed", loader), 85, false, true, vec![]);
                        }
                        Err(e) => {
                            log_msg(&app, &format!("[Install/WARN] {} installer download failed: {} (using version JSON libs only)", loader, e));
                        }
                    }
                }
                _ => {}
            }
        } else {
            log_msg(&app, &format!("[Install/WARN] Could not determine {} loader version, skipping loader install", loader));
        }
    }

    // Verify critical files exist
    let vj_path = inst_dir.join(format!("{}.json", mc_version));
    let jar_path = inst_dir.join(format!("{}.jar", mc_version));
    let mut warnings: Vec<String> = Vec::new();
    if !vj_path.exists() { warnings.push("Version JSON missing".to_string()); }
    if !jar_path.exists() || jar_path.metadata().map(|m| m.len() == 0).unwrap_or(true) { warnings.push("Client JAR missing or empty".to_string()); }
    if !lib_errors.is_empty() { warnings.push(format!("{} library downloads failed", lib_errors.len())); }

    if !warnings.is_empty() {
        log_msg(&app, &format!("[Install] '{}' complete with warnings: {}", instance_name, warnings.join(", ")));
        emit("Complete", &format!("Installed with {} warning(s)", warnings.len()), 100, true, true, warnings.clone());
        json!({"success": true, "warnings": warnings})
    } else {
        log_msg(&app, &format!("[Install] '{}' installation complete!", instance_name));
        emit("Complete", "Installation complete!", 100, true, true, vec![]);
        json!({"success": true})
    }
    });
    json!({"status": "started", "instance": inst_name_ret})

        })
    }

// --- Minecraft Versions ---
#[tauri::command(async)]
fn get_minecraft_versions() -> Value {
        tokio::task::block_in_place(|| {
    match http_get(MOJANG_VERSION_MANIFEST, None) {
        Ok(data) => {
            let all_versions: Vec<String> = data.get("versions")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.get("id").and_then(|i| i.as_str()).map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let release_versions: Vec<String> = data.get("versions")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter(|v| v.get("type").and_then(|t| t.as_str()) == Some("release")).filter_map(|v| v.get("id").and_then(|i| i.as_str()).map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let version_types: HashMap<String, String> = data.get("versions")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| {
                    let id = v.get("id")?.as_str()?.to_string();
                    let t = v.get("type")?.as_str()?.to_string();
                    Some((id, t))
                }).collect())
                .unwrap_or_default();
            let groups = build_version_groups(&all_versions);
            let groups_str: HashMap<String, Vec<String>> = groups.into_iter().collect();
            json!({
                "all_versions": all_versions,
                "release_versions": release_versions,
                "version_types": version_types,
                "groups": groups_str,
                "latest": data.get("latest").cloned().unwrap_or(Value::Null),
            })
        }
        Err(e) => json!({"error": e, "all_versions": [], "release_versions": [], "version_types": {}, "groups": {}, "latest": {}})
    }

        })
    }

#[tauri::command(async)]
fn get_loader_versions(mc_version: String, loader: String) -> Value {
        tokio::task::block_in_place(|| {
    if !loader_supports(&loader, &mc_version) {
        return Value::Array(vec![]);
    }
    match loader.to_lowercase().as_str() {
        "fabric" => {
            let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);
            match http_get(&url, None) {
                Ok(data) => {
                    if let Some(arr) = data.as_array() {
                        let versions: Vec<Value> = arr.iter().filter_map(|v| {
                            v.get("loader").and_then(|l| Some(json!({
                                "version": l.get("version")?.as_str()?,
                                "stable": l.get("stable").and_then(|s| s.as_bool()).unwrap_or(false),
                            })))
                        }).collect();
                        Value::Array(versions)
                    } else {
                        Value::Array(vec![])
                    }
                }
                Err(_) => Value::Array(vec![]),
            }
        }
        "quilt" => {
            let url = format!("https://meta.quiltmc.org/v3/versions/loader/{}", mc_version);
            match http_get(&url, None) {
                Ok(data) => {
                    if let Some(arr) = data.as_array() {
                        let versions: Vec<Value> = arr.iter().filter_map(|v| {
                            v.get("loader").and_then(|l| Some(json!({
                                "version": l.get("version")?.as_str()?,
                                "stable": l.get("stable").and_then(|s| s.as_bool()).unwrap_or(false),
                            })))
                        }).collect();
                        Value::Array(versions)
                    } else {
                        Value::Array(vec![])
                    }
                }
                Err(_) => Value::Array(vec![]),
            }
        }
        "forge" => {
            match reqwest::blocking::Client::builder().user_agent(USER_AGENT).timeout(std::time::Duration::from_secs(15)).build() {
                Ok(client) => {
                    match client.get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml").send().and_then(|r| r.text()) {
                        Ok(xml) => {
                            let prefix = format!(">{}-", mc_version);
                            let mut versions: Vec<Value> = Vec::new();
                            for line in xml.lines() {
                                if let Some(start) = line.find(&prefix) {
                                    let after = &line[start+1..];
                                    if let Some(end) = after.find('<') {
                                        let ver = &after[..end];
                                        if !ver.is_empty() {
                                            versions.push(json!({
                                                "version": ver,
                                                "stable": true,
                                            }));
                                        }
                                    }
                                }
                            }
                            Value::Array(versions)
                        }
                        Err(_) => Value::Array(vec![]),
                    }
                }
                Err(_) => Value::Array(vec![]),
            }
        }
        "neoforge" => {
            match reqwest::blocking::Client::builder().user_agent(USER_AGENT).timeout(std::time::Duration::from_secs(15)).build() {
                Ok(client) => {
                    match client.get("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml").send().and_then(|r| r.text()) {
                        Ok(xml) => {
                            let prefix = format!(">{}-", mc_version);
                            let mut versions: Vec<Value> = Vec::new();
                            for line in xml.lines() {
                                if let Some(start) = line.find(&prefix) {
                                    let after = &line[start+1..];
                                    if let Some(end) = after.find('<') {
                                        let ver = &after[..end];
                                        if ver.chars().all(|c| c.is_ascii_digit() || c == '.') {
                                            versions.push(json!({
                                                "version": ver,
                                                "stable": true,
                                            }));
                                        }
                                    }
                                }
                            }
                            Value::Array(versions)
                        }
                        Err(_) => Value::Array(vec![]),
                    }
                }
                Err(_) => Value::Array(vec![]),
            }
        }
        _ => Value::Array(vec![]),
    }

        })
    }

#[tauri::command]
fn get_supported_loaders(mc_version: String) -> Value {
    let all_loaders = vec!["vanilla", "fabric", "forge", "quilt", "neoforge"];
    let supported: Vec<&str> = all_loaders.into_iter()
        .filter(|l| loader_supports(l, &mc_version))
        .collect();
    json!(supported)
}

#[tauri::command(async)]
fn get_fabric_versions() -> Value {
        tokio::task::block_in_place(|| {
    match http_get(FABRIC_VERSIONS_URL, None) {
        Ok(data) => {
            if let Some(arr) = data.as_array() {
                let versions: Vec<String> = arr.iter()
                    .filter(|v| v.get("stable").and_then(|s| s.as_bool()).unwrap_or(false))
                    .filter_map(|v| v.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()))
                    .collect();
                Value::Array(versions.into_iter().map(|v| Value::String(v)).collect())
            } else {
                Value::Array(vec![])
            }
        }
        Err(_) => Value::Array(vec![]),
    }

        })
    }

// --- Microsoft Auth ---
#[tauri::command(async)]
fn authenticate_microsoft(app: State<AppState>) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, "[Auth/MS] Starting Microsoft device code flow...");
    // Clear any previous auth state
    {
        let mut result_guard = app.ms_auth_result.lock().unwrap();
        *result_guard = None;
        app.ms_auth_polling.store(false, Ordering::Relaxed);
    }
    match http_post_json(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
        &json!({"client_id": "00000000402b5328", "scope": "XboxLive.signin XboxLive.offline_access MinecraftWin32.app"}),
        None,
    ) {
        Ok(resp) => {
            if let Some(user_code) = resp.get("user_code").and_then(|u| u.as_str()) {
                let ver_uri = resp.get("verification_uri").and_then(|u| u.as_str()).unwrap_or("https://microsoft.com/link");
                let device_code = resp.get("device_code").and_then(|u| u.as_str()).unwrap_or("");
                let interval = resp.get("interval").and_then(|i| i.as_i64()).unwrap_or(5);
                let _ = webbrowser::open(ver_uri);
                log_msg(&app, &format!("[Auth/MS] Code: {} | Go to {}", user_code, ver_uri));

                // Kick off background polling thread so the Tauri event-loop / UI
                // thread is never blocked. The thread only fetches the raw MS
                // access token and stores it in shared state; the full XBL/XSTS/
                // Minecraft exchange is finished synchronously by the frontend
                // calling complete_microsoft_auth_cmd once the token arrives.
                let polling_flag = Arc::clone(&app.ms_auth_polling);
                let result_store = Arc::clone(&app.ms_auth_result);
                let dc = device_code.to_string();
                let iv = interval as u64;
                polling_flag.store(true, Ordering::Relaxed);
                std::thread::spawn(move || {
                    let poll_interval = std::cmp::min(iv, 5).max(1);
                    for i in 0..72 {
                        std::thread::sleep(std::time::Duration::from_secs(poll_interval));
                        if !polling_flag.load(Ordering::Relaxed) {
                            return;
                        }
                        match http_post_form(
                            "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
                            &format!("client_id=00000000402b5328&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code={}", dc),
                            None,
                        ) {
                            Ok(token_resp) => {
                                if let Some(access_token) = token_resp.get("access_token").and_then(|t| t.as_str()) {
                                    let refresh = token_resp.get("refresh_token").and_then(|t| t.as_str()).unwrap_or("");
                                    let mut guard = result_store.lock().unwrap();
                                    *guard = Some(json!({"access_token": access_token, "refresh_token": refresh}));
                                    polling_flag.store(false, Ordering::Relaxed);
                                    return;
                                }
                                let err_val = token_resp.get("error").and_then(|e| e.as_str());
                                if err_val == Some("authorization_pending") || err_val == Some("slow_down") {
                                    continue;
                                }
                                let err = token_resp.get("error_description").or(token_resp.get("error"))
                                    .and_then(|e| e.as_str()).unwrap_or("Auth failed").to_string();
                                let mut guard = result_store.lock().unwrap();
                                *guard = Some(json!({"error": err}));
                                polling_flag.store(false, Ordering::Relaxed);
                                return;
                            }
                            Err(e) => {
                                let mut guard = result_store.lock().unwrap();
                                *guard = Some(json!({"error": e}));
                                polling_flag.store(false, Ordering::Relaxed);
                                return;
                            }
                        }
                    }
                    let mut guard = result_store.lock().unwrap();
                    *guard = Some(json!({"error": "Authentication timed out"}));
                    polling_flag.store(false, Ordering::Relaxed);
                });

                json!({"success": true, "user_code": user_code, "verification_uri": ver_uri, "device_code": device_code, "interval": interval})
            } else {
                let err = resp.get("error_description").or(resp.get("error")).and_then(|e| e.as_str()).unwrap_or("Device code request failed");
                json!({"error": err})
            }
        }
        Err(e) => json!({"error": e}),
    }

        })
    }

#[tauri::command]
fn poll_microsoft_status(app: State<AppState>) -> Value {
    let guard = app.ms_auth_result.lock().unwrap();
    if app.ms_auth_polling.load(Ordering::Relaxed) {
        json!({"status": "pending"})
    } else if let Some(result) = guard.as_ref() {
        json!({"status": "done", "result": result.clone()})
    } else {
        json!({"status": "idle"})
    }
}

fn complete_ms_auth(app: State<AppState>, ms_token: String, refresh_token: String) -> Value {
    log_msg(&app, "[Auth/MS] Exchanging for Xbox Live token...");
    let xbl_body = json!({"Properties": {"AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": ms_token}, "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"});
    let xbl = match http_post_json("https://user.auth.xboxlive.com/user/authenticate", &xbl_body, None) {
        Ok(r) => r, Err(e) => return json!({"error": e}),
    };
    let xbl_token = xbl.get("Token").and_then(|t| t.as_str()).unwrap_or("");
    let xbl_uhs = xbl.get("DisplayClaims").and_then(|d| d.get("xui"))
        .and_then(|u| u.as_array()).and_then(|a| a.first())
        .and_then(|c| c.get("uhs")).and_then(|u| u.as_str()).unwrap_or("");

    log_msg(&app, "[Auth/MS] Exchanging for XSTS token...");
    let xsts_body = json!({"Properties": {"SandboxId": "RETAIL", "UserTokens": [xbl_token]}, "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT"});
    let xsts = match http_post_json("https://xsts.auth.xboxlive.com/xsts/authorize", &xsts_body, None) {
        Ok(r) => r, Err(e) => return json!({"error": e}),
    };
    let xsts_token = xsts.get("Token").and_then(|t| t.as_str()).unwrap_or("");

    log_msg(&app, "[Auth/MS] Exchanging for Minecraft token...");
    let mc_data = match http_post_json("https://api.minecraftservices.com/authentication/login_with_xbox",
        &json!({"identityToken": format!("XBL3.0 x={};{}", xbl_uhs, xsts_token)}), None) {
        Ok(r) => r, Err(e) => return json!({"error": e}),
    };
    let mc_token = mc_data.get("access_token").and_then(|t| t.as_str()).unwrap_or("");

    log_msg(&app, "[Auth/MS] Fetching Minecraft profile...");
    match http_get("https://api.minecraftservices.com/minecraft/profile", Some(&[("Authorization", &format!("Bearer {}", mc_token))])) {
        Ok(profile) => {
            if let Some(username) = profile.get("name").and_then(|n| n.as_str()) {
                let username = username.to_string();
                let uuid = profile.get("id").and_then(|u| u.as_str()).unwrap_or("00000000-0000-0000-0000-000000000000").to_string();
                save_setting_val(&app, "mc_token", Value::String(mc_token.to_string()));
                save_setting_val(&app, "ms_refresh_token", Value::String(refresh_token.to_string()));
                save_setting_val(&app, "username", Value::String(username.clone()));
                save_setting_val(&app, "cracked_username", Value::String(username.clone()));
                save_setting_val(&app, "mc_uuid", Value::String(uuid.clone()));
                save_setting_val(&app, "account_type", Value::String("microsoft".to_string()));
                log_msg(&app, &format!("[Auth/MS] Success! Logged in as '{}'", username));
                return json!({"success": true, "username": username, "uuid": uuid, "mc_token": mc_token, "refresh_token": refresh_token, "type": "microsoft"});
            }
            json!({"error": "No Minecraft profile found"})
        }
        Err(e) => json!({"error": e}),
    }
}

#[tauri::command]
async fn complete_microsoft_auth_cmd(app_handle: tauri::AppHandle, ms_token: String, refresh_token: Option<String>) -> Value {
    let refresh = refresh_token.unwrap_or_default();
    let result = tokio::task::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        complete_ms_auth(state, ms_token, refresh)
    }).await;
    result.unwrap_or_else(|_| json!({"error": "Authentication exchange failed"}))
}

// --- Ely.by Auth ---
#[tauri::command]
fn authenticate_elyby(app: State<AppState>) -> Value {
    log_msg(&app, "[Auth/Ely.by] Starting OAuth2 flow...");

    // Start local HTTP server
    let code_clone = Arc::clone(&app.elyby_auth_code);
    std::thread::spawn(move || {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:8080");
        if listener.is_err() {
            return;
        }
        let listener = listener.unwrap();
        listener.set_nonblocking(true).ok();
        for _ in 0..120 {
            if let Ok(stream) = listener.accept() {
                let mut stream = stream.0;
                let mut buf = [0u8; 4096];
                if let Ok(n) = stream.read(&mut buf) {
                    let request = String::from_utf8_lossy(&buf[..n]);
                    if let Some(query_start) = request.find("code=") {
                        let query_part = &request[query_start+5..];
                        let code: String = query_part.split_whitespace().next()
                            .and_then(|s| s.split('&').next())
                            .unwrap_or("").to_string();
                        if !code.is_empty() {
                            if let Ok(mut guard) = code_clone.lock() {
                                *guard = Some(code);
                            }
                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<h1>Login Successful! You can close this window.</h1>";
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }
                    }
                }
                let response = "HTTP/1.1 400 Bad Request\r\n\r\nMissing code";
                let _ = stream.write_all(response.as_bytes());
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });

    let params = format!(
        "client_id={}&redirect_uri={}&response_type=code&scope={}",
        ELYBY_CLIENT_ID, ELYBY_REDIRECT_URI, "account_info%20minecraft_server_session%20offline_access"
    );
    let auth_url = format!("https://account.ely.by/oauth2/authorize?{}", params);
    log_msg(&app, &format!("[Auth/Ely.by] Open browser: {}", auth_url));
    let _ = webbrowser::open(&auth_url);
    json!({"auth_url": auth_url})
}

#[tauri::command(async)]
fn poll_elyby_auth(app: State<AppState>) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, "[Auth/Ely.by] Polling for auth code...");
    for _ in 0..120 {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let code = {
            let mut guard = app.elyby_auth_code.lock().unwrap();
            guard.take()
        };
        if let Some(code) = code {
            log_msg(&app, &format!("[Auth/Ely.by] Received code: {}...", &code[..8.min(code.len())]));
            return exchange_elyby_code(app, code);
        }
    }
    json!({"error": "Timed out waiting for Ely.by login"})

        })
    }

fn exchange_elyby_code(app: State<AppState>, code: String) -> Value {
    log_msg(&app, "[Auth/Ely.by] Exchanging code for token...");
    let form = format!(
        "grant_type=authorization_code&code={}&redirect_uri={}",
        code, ELYBY_REDIRECT_URI
    );
    match http_post_form(
        "https://account.ely.by/api/oauth2/v1/token",
        &form,
        Some((ELYBY_CLIENT_ID, ELYBY_CLIENT_SECRET)),
    ) {
        Ok(resp) => {
            if resp.get("error").is_some() {
                let err = resp.get("error_description").or(resp.get("error")).and_then(|e| e.as_str()).unwrap_or("Token exchange failed");
                return json!({"error": err});
            }
            let access_token = resp.get("access_token").and_then(|t| t.as_str()).unwrap_or("");
            let refresh_token = resp.get("refresh_token").and_then(|t| t.as_str()).unwrap_or("");
            if access_token.is_empty() {
                return json!({"error": "No access token from Ely.by"});
            }
            log_msg(&app, "[Auth/Ely.by] Got access token, fetching user info...");
            match http_get("https://account.ely.by/api/account/v1/info", Some(&[("Authorization", &format!("Bearer {}", access_token))])) {
                Ok(info) => {
                    if let Some(username) = info.get("username").and_then(|u| u.as_str()) {
                        let username = username.to_string();
                        let uuid = info.get("uuid").and_then(|u| u.as_str()).unwrap_or("").to_string();
                        save_setting_val(&app, "mc_token", Value::String(access_token.to_string()));
                        save_setting_val(&app, "ely_refresh_token", Value::String(refresh_token.to_string()));
                        save_setting_val(&app, "ely_access_token", Value::String(access_token.to_string()));
                        save_setting_val(&app, "username", Value::String(username.clone()));
                        save_setting_val(&app, "ely_by_username", Value::String(username.clone()));
                        save_setting_val(&app, "ely_uuid", Value::String(uuid.clone()));
                        save_setting_val(&app, "cracked_username", Value::String(username.clone()));
                        log_msg(&app, &format!("[Auth/Ely.by] Success! Logged in as '{}'", username));
                        // Auto-download authlib-injector in background
                        std::thread::spawn(move || { ensure_authlib_injector_bg(); });
                        return json!({"success": true, "username": username, "uuid": uuid, "mc_token": access_token, "type": "elyby"});
                    }
                    json!({"error": "Failed to get Ely.by user info"})
                }
                Err(e) => json!({"error": e}),
            }
        }
        Err(e) => json!({"error": e}),
    }
}

#[tauri::command(async)]
fn complete_elyby_auth_cmd(app: State<AppState>, code: String) -> Value {
        tokio::task::block_in_place(|| {
    exchange_elyby_code(app, code)

        })
    }

#[tauri::command]
fn create_offline_account(app: State<AppState>, username: String) -> Value {
    log_msg(&app, &format!("[Auth/Offline] Creating offline account: {}", username));
    save_setting_val(&app, "cracked_username", Value::String(username.clone()));
    save_setting_val(&app, "username", Value::String(username.clone()));
    save_setting_val(&app, "mc_token", Value::String("0".to_string()));
    json!({"success": true, "uuid": "00000000-0000-0000-0000-000000000000", "username": username, "mc_token": "0", "type": "offline"})
}

// --- Authlib Injector ---
// Resolve the latest authlib-injector jar URL, trying GitHub first then the
// official yushi.moe CDN as a fallback (more reliable, no rate limits).
fn fetch_authlib_injector_url() -> Option<String> {
    if let Ok(data) = http_get("https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest", None) {
        if let Some(assets) = data.get("assets").and_then(|a| a.as_array()) {
            if let Some(jar) = assets.iter().find(|a| a.get("name").and_then(|n| n.as_str()).map(|n| n.ends_with(".jar")).unwrap_or(false)) {
                if let Some(url) = jar.get("browser_download_url").and_then(|u| u.as_str()) {
                    return Some(url.to_string());
                }
            }
        }
    }
    if let Ok(data) = http_get("https://authlib-injector.yushi.moe/artifact/latest.json", None) {
        if let Some(url) = data.get("download_url").and_then(|u| u.as_str()) {
            return Some(url.to_string());
        }
    }
    None
}

fn download_authlib_injector(path: &PathBuf) -> Result<(), String> {
    match fetch_authlib_injector_url() {
        Some(url) => download_file_blocking(&url, path).map_err(|e| e),
        None => Err("Could not resolve authlib-injector download URL".to_string()),
    }
}

fn ensure_authlib_injector_bg() {
    let path = authlib_injector_path();
    if path.exists() { return; }
    let _ = download_authlib_injector(&path);
}

#[tauri::command(async)]
fn ensure_authlib_injector() -> Value {
        tokio::task::block_in_place(|| {
    let path = authlib_injector_path();
    if path.exists() {
        return json!({"success": true, "path": path.to_string_lossy()});
    }
    match download_authlib_injector(&path) {
        Ok(()) => json!({"success": true, "path": path.to_string_lossy()}),
        Err(e) => json!({"error": e}),
    }

        })
    }

// --- Game Launch ---
#[tauri::command(async)]
fn launch_game(app: State<AppState>, app_handle: tauri::AppHandle, instance_name: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[Launch] Preparing '{}'...", instance_name));

    let instances = load_instances_raw(&app);
    let instance = instances.iter().find(|i| i.get("name").and_then(|n| n.as_str()) == Some(&instance_name));
    let instance = match instance {
        Some(i) => i.clone(),
        None => return json!({"error": format!("Instance {} not found", instance_name)}),
    };

    let mc_version = instance.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let loader = instance.get("loader").and_then(|v| v.as_str()).unwrap_or("Vanilla");
    let loader_version = instance.get("loader_version").and_then(|v| v.as_str()).unwrap_or("");

    let inst_dir = instances_dir().join(&instance_name);
    let vj_path = inst_dir.join(format!("{}.json", mc_version));
    if !vj_path.exists() {
        return json!({"error": "Version JSON missing. Please reinstall."});
    }

    let ver_json = load_json(&vj_path);

    // Find Java - with auto-detection and auto-download
    let settings = load_settings(&app);

    // Per-instance overrides (JVM & RAM settings) live in instance_settings.json
    // keyed by instance name. Missing file/entry simply means "use global settings".
    let inst_overrides_raw = load_json(&app_dir().join("instance_settings.json"));
    let inst_over = inst_overrides_raw.get(&instance_name).cloned().unwrap_or_else(|| json!({}));

    let required_java = get_required_java_for_mc(mc_version);
    // Per-instance Java beats the launcher-wide Java path.
    let inst_java = inst_over.get("java_path").and_then(|v| v.as_str()).unwrap_or("");
    let custom_java_fallback = settings.get("java_path").and_then(|v| v.as_str()).unwrap_or("");
    let custom_java: &str = if !inst_java.is_empty() { inst_java } else { custom_java_fallback };
    let host_arch = get_host_arch();

    // Step 1: Check if custom path works
    let mut java_exec = String::new();
    if !custom_java.is_empty() && Path::new(custom_java).exists() {
        if let Some(major) = get_java_major_version(custom_java) {
            let arch = get_java_arch(custom_java).unwrap_or_else(|| "unknown".to_string());
            if major == required_java && arch == host_arch {
                java_exec = custom_java.to_string();
            }
        }
    }

    // Step 2: Check all installed Javas for compatible version + arch
    if java_exec.is_empty() {
        let all_javas = find_all_java_installations();
        for j in &all_javas {
            let ver_match = j.get("major_version").and_then(|v| v.as_u64()).unwrap_or(0) as u32 == required_java;
            let arch_match = j.get("compatible_arch").and_then(|v| v.as_bool()).unwrap_or(false);
            if ver_match && arch_match {
                if let Some(p) = j.get("path").and_then(|v| v.as_str()) {
                    java_exec = p.to_string();
                    break;
                }
            }
        }
        // If no arch-matched, try any version-matched
        if java_exec.is_empty() {
            for j in &all_javas {
                let ver_match = j.get("major_version").and_then(|v| v.as_u64()).unwrap_or(0) as u32 == required_java;
                if ver_match {
                    if let Some(p) = j.get("path").and_then(|v| v.as_str()) {
                        java_exec = p.to_string();
                        break;
                    }
                }
            }
        }
    }

    // Step 3: Auto-download correct Java if none found
    if java_exec.is_empty() {
        log_msg(&app, &format!("[Launch/Java] No compatible Java found. Auto-downloading Java {} (arch: {})...", required_java, host_arch));
        match auto_download_java(&app, required_java) {
            Ok(path) => {
                java_exec = path.clone();
                save_setting_val(&app, "java_path", Value::String(path));
                log_msg(&app, &format!("[Launch/Java] Auto-downloaded Java {}: {}", required_java, java_exec));
            }
            Err(e) => {
                return json!({"error": format!("Java {} not found and auto-download failed: {}. Please install Java {} for {} manually.", required_java, e, required_java, host_arch)});
            }
        }
    } else {
        // Step 4: Check if detected Java is the wrong version, auto-download correct one
        if let Some(current_major) = get_java_major_version(&java_exec) {
            if current_major != required_java {
                log_msg(&app, &format!("[Launch/Java] Java {} detected but MC {} needs Java {}. Auto-downloading...",
                    current_major, mc_version, required_java));
                match auto_download_java(&app, required_java) {
                    Ok(path) => {
                        java_exec = path.clone();
                        save_setting_val(&app, "java_path", Value::String(path));
                        log_msg(&app, &format!("[Launch/Java] Auto-downloaded Java {}: {}", required_java, java_exec));
                    }
                    Err(e) => {
                        log_msg(&app, &format!("[Launch/Java] Auto-download failed: {}. Falling back to Java {} (may not work)", e, current_major));
                    }
                }
            }
        }
    }

    if java_exec.is_empty() {
        return json!({"error": "No compatible Java found. Please install Java or check Settings -> Java."});
    }
    log_msg(&app, &format!("[Launch/Java] Using: {} (required: Java {} for MC {}, arch: {})", java_exec, required_java, mc_version, host_arch));

    // Prepare natives — self-healing: re-extract native libraries from the
    // downloaded native jars so the game always has its .dll files, even if a
    // previous install/launch left them missing.
    let natives_dir = inst_dir.join("natives");
    let _ = std::fs::create_dir_all(&natives_dir);
    let libs_dir = libraries_dir();
    let native_count = extract_natives(&libs_dir, &inst_dir, &ver_json);
    log_msg(&app, &format!("[Launch] Extracted {} native file(s) into {}", native_count, natives_dir.to_string_lossy()));
    log_msg(&app, "[Launch] Building classpath...");

    // Build classpath
    let mut classpath: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut add_cp = |path: &Path| {
        let s = path.to_string_lossy().to_string();
        if !seen.contains(&s) {
            seen.insert(s.clone());
            classpath.push(s);
        }
    };

    // MC jar
    let mc_jar = inst_dir.join(format!("{}.jar", mc_version));
    if mc_jar.exists() {
        add_cp(&mc_jar);
    }

    // Libraries
    let libs = libraries_dir();
    if let Some(libraries) = ver_json.get("libraries").and_then(|l| l.as_array()) {
        for lib in libraries {
            if !is_lib_allowed(lib) { continue; }
            if let Some(artifact) = lib.get("downloads").and_then(|d| d.get("artifact")) {
                if let Some(path) = artifact.get("path").and_then(|p| p.as_str()) {
                    let lib_path = libs.join(path);
                    if lib_path.exists() {
                        let basename = lib_path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                        if basename.contains("fabric-loader") || basename.contains("quilt-loader") { continue; }
                        add_cp(&lib_path);
                    }
                }
            }
        }
    }

    let mut main_class = ver_json.get("mainClass").and_then(|c| c.as_str()).unwrap_or("net.minecraft.client.main.Main").to_string();

    // Loader JAR + profile libraries
    let loader_lower = loader.to_lowercase();
    if loader_lower == "fabric" || loader_lower == "quilt" {
        let loader_name = if loader_lower == "quilt" { "quilt-loader" } else { "fabric-loader" };
        let loader_jars: Vec<PathBuf> = match std::fs::read_dir(&inst_dir) {
            Ok(rd) => rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    let name = p.file_name().unwrap_or_default().to_string_lossy();
                    name.starts_with(loader_name) && name.ends_with(".jar") && !name.contains("profile")
                })
                .collect(),
            Err(_) => vec![],
        };
        if loader_jars.is_empty() {
            return json!({"error": format!("{} Loader JAR missing in instance folder!", loader)});
        }
        add_cp(&loader_jars[0]);

        // Profile libraries
        let profile_globs: Vec<PathBuf> = match std::fs::read_dir(&inst_dir) {
            Ok(rd) => rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    let name = p.file_name().unwrap_or_default().to_string_lossy();
                    name.contains(loader_name) && name.ends_with("profile.json")
                })
                .collect(),
            Err(_) => vec![],
        };
        if let Some(profile_path) = profile_globs.first() {
            if let Ok(profile_data) = std::fs::read_to_string(profile_path) {
                if let Ok(profile) = serde_json::from_str::<Value>(&profile_data) {
                    if let Some(profile_libs) = profile.get("libraries").and_then(|l| l.as_array()) {
                        for lib in profile_libs {
                            if let Some(art_path) = lib.get("downloads").and_then(|d| d.get("artifact")).and_then(|a| a.get("path")).and_then(|p| p.as_str()) {
                                let fp = libs.join(art_path);
                                if fp.exists() {
                                    let basename = fp.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                                    if !basename.contains(loader_name) {
                                        add_cp(&fp);
                                    }
                                }
                            } else if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                                if let Some(maven_path) = maven_name_to_path(name) {
                                    let fp = libs.join(&maven_path);
                                    if fp.exists() {
                                        let basename = fp.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                                        if !basename.contains(loader_name) {
                                            add_cp(&fp);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if loader_lower == "fabric" {
                        main_class = "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string();
                    } else {
                        main_class = "org.quiltmc.loader.impl.launch.knot.KnotClient".to_string();
                    }
                }
            }
        }
    }

    if classpath.is_empty() {
        return json!({"error": "Classpath is empty! Installation likely failed."});
    }
    log_msg(&app, &format!("[Launch] Classpath built: {} entries", classpath.len()));

    // JVM Args — per-instance RAM override wins over the global launcher value.
    let ram_mb = inst_over.get("ram_mb").and_then(|v| v.as_i64())
        .filter(|v| *v >= 512) // 0 / unset means "inherit global"
        .or_else(|| settings.get("ram_mb").and_then(|v| v.as_i64()))
        .unwrap_or(2048);
    let min_heap = std::cmp::min(512, ram_mb);
    let mut jvm_args: Vec<String> = vec![
        format!("-Xmx{}M", ram_mb),
        format!("-Xms{}M", min_heap),
        "-XX:+UnlockExperimentalVMOptions".into(),
        "-XX:+UseG1GC".into(),
        "-XX:G1NewSizePercent=20".into(),
        "-XX:G1ReservePercent=20".into(),
        "-XX:MaxGCPauseMillis=50".into(),
        "-XX:G1HeapRegionSize=32M".into(),
        format!("-Djava.library.path={}", natives_dir.to_string_lossy()),
        format!("-Djna.tmpdir={}", natives_dir.to_string_lossy()),
        format!("-Dorg.lwjgl.system.SharedLibraryExtractPath={}", natives_dir.to_string_lossy()),
        "-Dminecraft.launcher.brand=Xryloth".into(),
        "-Dminecraft.launcher.version=5.0".into(),
    ];

    // Ely.by authlib-injector — only if online
    let ely_access = settings.get("ely_access_token").and_then(|v| v.as_str());
    let ely_uuid = settings.get("ely_uuid").and_then(|v| v.as_str());
    let online = is_connected();
    if !online {
        log_msg(&app, "[Launch] No internet connection detected — skipping authlib-injector, using offline auth");
    }
    // Ensure authlib-injector jar is present for Ely.by skins (fetch if missing).
    if online && ely_access.is_some() && ely_uuid.is_some() && !authlib_injector_path().exists() {
        log_msg(&app, "[Launch] Fetching authlib-injector for Ely.by skins...");
        let _ = ensure_authlib_injector();
    }
    if online && ely_access.is_some() && ely_uuid.is_some() && authlib_injector_path().exists() {
        jvm_args.insert(0, format!("-javaagent:{}=ely.by", authlib_injector_path().to_string_lossy()));
        log_msg(&app, "[Launch] Authlib-injector enabled for Ely.by skins");
    }
    log_msg(&app, "[Launch] Authlib-injector setup done");

    // Custom JVM args — global flags first, then this profile's own extra flags.
    let global_jvm = settings.get("global_jvm").and_then(|v| v.as_str()).unwrap_or("");
    let custom_args: Vec<&str> = global_jvm.split_whitespace().collect();
    jvm_args.extend(custom_args.iter().map(|s| s.to_string()));

    let inst_jvm = inst_over.get("jvm_args").and_then(|v| v.as_str()).unwrap_or("");
    if !inst_jvm.is_empty() {
        jvm_args.extend(inst_jvm.split_whitespace().map(|s| s.to_string()));
        log_msg(&app, &format!("[Launch] Applying {} custom JVM flag(s) for '{}'", inst_jvm.split_whitespace().count(), instance_name));
    }
    if inst_over.get("ram_mb").and_then(|v| v.as_i64()).is_some() {
        log_msg(&app, &format!("[Launch] Per-instance RAM override: {} MB", ram_mb));
    }

    // Auth selection — prefer the active account from the accounts list
    // (managed on the frontend), falling back to legacy single-account settings.
    let active_uuid = settings.get("active_account_uuid").and_then(|v| v.as_str()).unwrap_or("");
    let accounts = settings.get("accounts").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let active_account = accounts.iter().find(|a| {
        a.get("uuid").and_then(|u| u.as_str()) == Some(active_uuid) && !active_uuid.is_empty()
    });

    let ms_uuid = settings.get("mc_uuid").and_then(|v| v.as_str()).unwrap_or("00000000-0000-0000-0000-000000000000");
    let (username, access_token, user_uuid, user_type) = if let Some(acc) = active_account {
        let acc_type = acc.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let acc_username = acc.get("username").and_then(|u| u.as_str()).unwrap_or("Player");
        let acc_token = acc.get("access_token").and_then(|t| t.as_str()).unwrap_or("0");
        let acc_uuid = acc.get("uuid").and_then(|u| u.as_str()).unwrap_or("00000000-0000-0000-0000-000000000000");
        match acc_type {
            "microsoft" if online && !acc_token.is_empty() && acc_token != "0" => {
                log_msg(&app, &format!("[Launch/Auth] Using Microsoft account: {}", acc_username));
                (acc_username.to_string(), acc_token.to_string(), acc_uuid.to_string(), "mojang".to_string())
            }
            "elyby" if online && !acc_token.is_empty() && acc_token != "0" => {
                log_msg(&app, &format!("[Launch/Auth] Using Ely.by account: {}", acc_username));
                if authlib_injector_path().exists() {
                    jvm_args.insert(0, format!("-javaagent:{}=ely.by", authlib_injector_path().to_string_lossy()));
                }
                (acc_username.to_string(), acc_token.to_string(), acc_uuid.to_string(), "mojang".to_string())
            }
            "offline" => {
                log_msg(&app, &format!("[Launch/Auth] Using offline account: {}", acc_username));
                (acc_username.to_string(), "0".to_string(), acc_uuid.to_string(), "legacy".to_string())
            }
            _ => {
                log_msg(&app, &format!("[Launch/Auth] Active account '{}' not usable offline, falling back", acc_username));
                let fallback = settings.get("cracked_username").and_then(|v| v.as_str()).unwrap_or("Player");
                (fallback.to_string(), "0".to_string(), "00000000-0000-0000-0000-000000000000".to_string(), "legacy".to_string())
            }
        }
    } else {
        // Legacy fallback — single account stored in flat settings keys
        let ely_username = settings.get("ely_by_username").and_then(|v| v.as_str());
        let ely_token = settings.get("ely_access_token").and_then(|v| v.as_str()).or(settings.get("mc_token").and_then(|v| v.as_str()));
        let ms_username = settings.get("username").and_then(|v| v.as_str());

        if online && ely_username.is_some() && ely_token.is_some() {
            let un = ely_username.unwrap();
            let tk = ely_token.unwrap();
            if !un.is_empty() && tk != "0" {
                log_msg(&app, &format!("[Launch/Auth] Using Ely.by account: {}", un));
                if authlib_injector_path().exists() {
                    jvm_args.insert(0, format!("-javaagent:{}=ely.by", authlib_injector_path().to_string_lossy()));
                }
                (un.to_string(), tk.to_string(), ely_uuid.unwrap_or("00000000-0000-0000-0000-000000000000").to_string(), "mojang".to_string())
            } else if let Some(un) = ms_username {
                let tk = settings.get("mc_token").and_then(|v| v.as_str()).unwrap_or("0");
                log_msg(&app, &format!("[Launch/Auth] Using Microsoft account: {}", un));
                (un.to_string(), tk.to_string(), ms_uuid.to_string(), "mojang".to_string())
            } else {
                let un = settings.get("cracked_username").and_then(|v| v.as_str()).unwrap_or("Player");
                log_msg(&app, &format!("[Launch/Auth] Using offline account: {}", un));
                (un.to_string(), "0".to_string(), "00000000-0000-0000-0000-000000000000".to_string(), "legacy".to_string())
            }
        } else if let Some(un) = ms_username {
            let tk = settings.get("mc_token").and_then(|v| v.as_str()).unwrap_or("0");
            log_msg(&app, &format!("[Launch/Auth] Using Microsoft account: {}", un));
            (un.to_string(), tk.to_string(), ms_uuid.to_string(), "mojang".to_string())
        } else {
            let un = settings.get("cracked_username").and_then(|v| v.as_str()).unwrap_or("Player");
            log_msg(&app, &format!("[Launch/Auth] Using offline account: {}", un));
            (un.to_string(), "0".to_string(), "00000000-0000-0000-0000-000000000000".to_string(), "legacy".to_string())
        }
    };
    log_msg(&app, "[Launch] Auth selection complete");

    let asset_index = ver_json.get("assetIndex").and_then(|a| a.get("id")).and_then(|i| i.as_str()).unwrap_or(mc_version);

    let game_args = vec![
        "--version".into(), mc_version.to_string(),
        "--gameDir".into(), inst_dir.to_string_lossy().to_string(),
        "--assetsDir".into(), assets_dir().to_string_lossy().to_string(),
        "--assetIndex".into(), asset_index.to_string(),
        "--accessToken".into(), access_token,
        "--username".into(), username,
        "--uuid".into(), user_uuid,
        "--userType".into(), user_type,
    ];

    let classpath_str = classpath.join(if cfg!(target_os = "windows") { ";" } else { ":" });
    let mut cmd = vec![java_exec];
    cmd.extend(jvm_args);
    cmd.push("-cp".into());
    cmd.push(classpath_str);
    cmd.push(main_class);
    cmd.extend(game_args);
    log_msg(&app, "[Launch] Command built");

    log_msg(&app, &format!("[Launch] Starting '{}' ({})...", instance_name, loader));
    log_msg(&app, "[Launch] Saving last launch info...");

    // Save last launch
    save_setting_val(&app, &format!("last_launch_{}", instance_name), Value::String(chrono::Local::now().to_rfc3339()));
    log_msg(&app, "[Launch] Last launch info saved");

    // Launch process in background thread
    let inst_name_clone = instance_name.clone();
    let settings_clone = settings.clone();
    let loader_clone = loader.to_string();
    let version_clone = mc_version.to_string();
    std::thread::spawn(move || {
        log_msg_state(&app_handle, "[Launch] Process thread started");
        // Setup CustomSkinLoader for offline users
        let is_offline = settings_clone.get("cracked_username").is_some() &&
            settings_clone.get("mc_token").map(|v| v.as_str()) == Some(Some("0"));
        if is_offline {
            setup_custom_skin_loader(&inst_name_clone, &settings_clone);
        }

        // Pre-launch hook
        if let Some(pre_cmd) = settings_clone.get("pre_launch_cmd").and_then(|v| v.as_str()) {
            if !pre_cmd.trim().is_empty() {
                run_shell_hidden(pre_cmd);
            }
        }

        log_msg_state(&app_handle, &format!("[Launch] Process starting..."));

        let mut child = std::process::Command::new(&cmd[0]);
        for arg in &cmd[1..] {
            child.arg(arg);
        }
        child.current_dir(&inst_dir);
        child.stdout(std::process::Stdio::piped());
        child.stderr(std::process::Stdio::piped());
        child.stdin(std::process::Stdio::null());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            child.creation_flags(CREATE_NO_WINDOW);
        }

        let session_start = std::time::Instant::now();
        let full_command = cmd.join(" ");

        match child.spawn() {
            Ok(mut proc) => {
                log_msg_state(&app_handle, &format!("[Launch/OK] Process started, PID: {:?}", proc.id()));
                append_output_state(&app_handle, &format!("[Launch] Minecraft started (PID: {:?})", proc.id()));

                // Update Discord RPC to show playing state
                {
                    let rpc_enabled = settings_clone.get("discord_rpc").and_then(|v| v.as_bool()).unwrap_or(true);
                    if rpc_enabled {
                        let state = app_handle.state::<AppState>();
                        // Ensure RPC is connected
                        {
                            let discord_handle = state.discord_handle.lock().unwrap();
                            if discord_handle.is_none() {
                                drop(discord_handle);
                                let _ = init_discord_rpc(app_handle.clone());
                                // Wait briefly for connection
                                std::thread::sleep(std::time::Duration::from_secs(2));
                            }
                        }
                        let discord_handle = state.discord_handle.lock().unwrap();
                        if let Some(h) = discord_handle.as_ref() {
                            let loader_str = if loader_clone.to_lowercase() == "vanilla" { String::new() } else { format!(" ({})", loader_clone) };
                            let _ = h.sender.send(DiscordMessage::Update {
                                details: format!("Playing Minecraft{}", loader_str),
                                state: format!("{} • {}", inst_name_clone, version_clone),
                                large_image: "minecraft_logo".to_string(),
                                large_text: "Minecraft".to_string(),
                                small_image: "chatgpt_image_oct_7_2026_06_05_12_pm".to_string(),
                                small_text: "Xryloth".to_string(),
                            });
                            eprintln!("[Discord RPC] Updated to Playing state for {}", inst_name_clone);
                        }
                    }
                }

                // Read stdout + stderr concurrently so crash errors (often on stderr) are shown.
                if let Some(stdout) = proc.stdout.take() {
                    let h = app_handle.clone();
                    std::thread::spawn(move || {
                        let reader = std::io::BufReader::new(stdout);
                        for line in reader.lines() {
                            if let Ok(line) = line {
                                let trimmed = line.trim().to_string();
                                if !trimmed.is_empty() {
                                    append_output_state(&h, &trimmed);
                                    if !trimmed.contains("DEBUG") {
                                        log_msg_state(&h, &format!("[MC] {}", trimmed));
                                    }
                                }
                            }
                        }
                    });
                }
                if let Some(stderr) = proc.stderr.take() {
                    let h = app_handle.clone();
                    std::thread::spawn(move || {
                        let reader = std::io::BufReader::new(stderr);
                        for line in reader.lines() {
                            if let Ok(line) = line {
                                let trimmed = line.trim().to_string();
                                if !trimmed.is_empty() {
                                    append_output_state(&h, &format!("[MC/ERR] {}", trimmed));
                                    log_msg_state(&h, &format!("[MC/ERR] {}", trimmed));
                                }
                            }
                        }
                    });
                }

                let exit_code = proc.wait().map(|s| s.code().unwrap_or(1)).unwrap_or(1);
                let elapsed = session_start.elapsed();
                if exit_code != 0 {
                    log_msg_state(&app_handle, &format!("[MC/ERROR] Game exited with code {} (ran for {:.1?})", exit_code, elapsed));
                    append_output_state(&app_handle, &format!("[ERROR] Game exited with code {} — see logs above for the exact error", exit_code));
                } else {
                    log_msg_state(&app_handle, &format!("[MC/INFO] Game closed normally after {:.1?}.", elapsed));
                    append_output_state(&app_handle, "[INFO] Game closed normally.");
                }

                // Update Discord RPC - game closed, back to launcher
                {
                    let state = app_handle.state::<AppState>();
                    let discord_handle = state.discord_handle.lock().unwrap();
                    if let Some(h) = discord_handle.as_ref() {
                        let _ = h.sender.send(DiscordMessage::Update {
                            details: "Browsing Xryloth".to_string(),
                            state: "In Launcher".to_string(),
                            large_image: "chatgpt_image_oct_7_2026_06_05_12_pm".to_string(),
                            large_text: "Xryloth".to_string(),
                            small_image: "".to_string(),
                            small_text: "".to_string(),
                        });
                    }
                }
            }
            Err(e) => {
                // Exact reason the game process could not be started (bad Java path,
                // missing exe, permission denied, etc.) + the full command attempted.
                log_msg_state(&app_handle, &format!("[Launch/ERROR] Failed to start game process: {}", e));
                log_msg_state(&app_handle, &format!("[Launch/ERROR] Full command was: {}", full_command));
                append_output_state(&app_handle, &format!("[ERROR] Failed to launch: {}", e));
                append_output_state(&app_handle, &format!("[ERROR] Command: {}", full_command));
                // Surface a friendly error to the UI if the game-log panel isn't open.
                let _ = app_handle.emit_all("launch-failed", json!({
                    "instance": inst_name_clone,
                    "error": e.to_string(),
                    "command": full_command,
                }));
            }
        }

        // Post-launch hook
        if let Some(post_cmd) = settings_clone.get("post_launch_cmd").and_then(|v| v.as_str()) {
            if !post_cmd.trim().is_empty() {
                run_shell_hidden(post_cmd);
            }
        }

        // Save playtime
        let elapsed = session_start.elapsed().as_secs_f64();
        let pt_path = playtimes_file();
        let mut playtimes: HashMap<String, f64> = load_json(&pt_path).as_object()
            .map(|obj| obj.iter().filter_map(|(k, v)| v.as_f64().map(|f| (k.clone(), f))).collect())
            .unwrap_or_default();
        *playtimes.entry(inst_name_clone).or_insert(0.0) += elapsed;
        let pt_val: serde_json::Map<String, Value> = playtimes.into_iter().map(|(k, v)| (k, json!(v))).collect();
        save_json(&pt_path, &Value::Object(pt_val));
        log_msg_state(&app_handle, &format!("[Launch] Playtime +{}s saved", elapsed as u64));
    });

    json!({"success": true, "message": "Game process started"})

        })
    }

fn which_java() -> String {
    let cmd_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    if cfg!(target_os = "windows") {
        let paths = [
            "java.exe",
            "C:\\Program Files\\Java\\jre*\\bin\\java.exe",
            "C:\\Program Files\\Eclipse Adoptium\\*\\bin\\java.exe",
        ];
        for p in &paths {
            if let Ok(output) = hidden_cmd("where").arg(p.trim_end_matches('*')).output() {
                let out = String::from_utf8_lossy(&output.stdout);
                for line in out.lines() {
                    let trimmed = line.trim().to_string();
                    if trimmed.is_empty() { continue; }
                    if get_java_major_version(&trimmed).is_some() {
                        return trimmed;
                    }
                }
            }
        }
    }
    if let Ok(output) = hidden_cmd(cmd_name).arg("-version").output() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("java version") || stderr.contains("openjdk") {
            return cmd_name.to_string();
        }
    }
    String::new()
}

fn get_host_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") || cfg!(target_arch = "x86") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    }
}

fn get_java_arch(java_path: &str) -> Option<String> {
    // Prefer PE header check (no process execution needed)
    if let Some(arch) = get_exe_arch_from_pe_header(java_path) {
        if !arch.starts_with("unknown_") {
            return Some(arch);
        }
    }
    // Fallback: try running java
    let output = hidden_cmd(java_path)
        .arg("-XshowSettings:properties")
        .arg("-version")
        .output()
        .ok()?;
    let combined = format!("{}{}", 
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout));
    for line in combined.lines() {
        if line.contains("os.arch") {
            if let Some(val) = line.split('=').last() {
                let v = val.trim().to_lowercase();
                if v.contains("amd64") || v.contains("x86_64") { return Some("x64".to_string()); }
                if v.contains("aarch64") || v.contains("arm64") { return Some("aarch64".to_string()); }
                if v.contains("x86") || v.contains("i386") || v.contains("i686") { return Some("x86".to_string()); }
            }
        }
    }
    None
}

fn setup_custom_skin_loader(inst_name: &str, settings: &HashMap<String, Value>) {
    let username = settings.get("cracked_username").and_then(|v| v.as_str()).unwrap_or("Player");
    let mc_token = settings.get("mc_token").and_then(|v| v.as_str());
    if username.is_empty() || (mc_token.is_some() && mc_token.unwrap() != "0") { return; }

    let inst_dir = instances_dir().join(inst_name);
    let mods_dir = inst_dir.join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);

    let csl_filename = "CustomSkinLoader_Fabric-14.19.1.jar";
    let csl_path = mods_dir.join(csl_filename);

    // Always check if file exists AND is a valid ZIP before skipping
    let needs_download = if csl_path.exists() {
        match std::fs::File::open(&csl_path) {
            Ok(f) => {
                let metadata = f.metadata().map(|m| m.len()).unwrap_or(0);
                if metadata < 1000 {
                    // File is too small to be a real JAR
                    let _ = std::fs::remove_file(&csl_path);
                    true
                } else {
                    // Check if it's a valid ZIP by trying to open it
                    match zip::ZipArchive::new(f) {
                        Ok(_) => false, // Valid ZIP, no download needed
                        Err(_) => {
                            let _ = std::fs::remove_file(&csl_path);
                            true // Corrupt file, re-download
                        }
                    }
                }
            }
            Err(_) => true,
        }
    } else {
        true
    };

    if needs_download {
        let urls = [
            "https://cdn.modrinth.com/data/xnKZg9P2/versions/MkQ7y5wL/CustomSkinLoader_Fabric-14.19.1.jar",
            "https://cdn.modrinth.com/data/xnKZg9P2/version/MkQ7y5wL/CustomSkinLoader_Fabric-14.19.1.jar",
        ];
        for url in &urls {
            if download_file_blocking(url, &csl_path).is_ok() {
                // Verify the download is actually a valid JAR/ZIP
                match std::fs::File::open(&csl_path) {
                    Ok(f) => {
                        let size = f.metadata().map(|m| m.len()).unwrap_or(0);
                        if size < 1000 {
                            let _ = std::fs::remove_file(&csl_path);
                            continue;
                        }
                        match zip::ZipArchive::new(f) {
                            Ok(_) => break, // Valid!
                            Err(_) => { let _ = std::fs::remove_file(&csl_path); }
                        }
                    }
                    Err(_) => { let _ = std::fs::remove_file(&csl_path); }
                }
            }
        }
    }

    let config_file = inst_dir.join("config").join("CustomSkinLoader").join("CustomSkinLoader.json");
    if !config_file.exists() {
        let _ = std::fs::create_dir_all(config_file.parent().unwrap());
        let config = json!({
            "enable": true,
            "loadlist": [
                {"name": "LocalFile", "type": "LocalFile"},
                {"name": "Mojang", "type": "MojangAPI"},
            ]
        });
        let _ = save_json(&config_file, &config);
    }

    // Copy skin to instance
    let skin = custom_skin_path();
    if skin.exists() {
        let skin_folder = inst_dir.join("skins");
        let _ = std::fs::create_dir_all(&skin_folder);
        let target = skin_folder.join(format!("{}.png", username));
        let _ = std::fs::copy(&skin, &target);
    }
}

// --- Modrinth ---
#[tauri::command(async)]
fn search_modrinth(query: String, project_type: Option<String>, loader: Option<String>, mc_version: Option<String>, limit: Option<u32>) -> Value {
        tokio::task::block_in_place(|| {
    let ptype = project_type.unwrap_or_else(|| "mod".to_string());
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{}", ptype)]];
    if let Some(ref l) = loader {
        if !l.is_empty() {
            facets.push(vec![format!("categories:{}", l.to_lowercase())]);
        }
    }
    if let Some(ref v) = mc_version {
        if !v.is_empty() {
            facets.push(vec![format!("versions:{}", v)]);
        }
    }
    let sort = if query.is_empty() { "downloads" } else { "relevance" };
    let url = format!("{}/search?query={}&facets={}&index={}&limit={}",
        MODRINTH_API, urlencoding::encode(&query),
        urlencoding::encode(&serde_json::to_string(&facets).unwrap_or_default()),
        sort, limit.unwrap_or(20));

    match http_get(&url, None) {
        Ok(data) => {
            data.get("hits").cloned().unwrap_or(Value::Array(vec![]))
        }
        Err(_) => Value::Array(vec![]),
    }

        })
    }

#[tauri::command(async)]
fn get_modrinth_project(slug: String) -> Value {
        tokio::task::block_in_place(|| {
    http_get(&format!("{}/project/{}", MODRINTH_API, slug), None).unwrap_or(Value::Null)

        })
    }

#[tauri::command(async)]
fn get_modrinth_versions(slug: String, loader: Option<String>, mc_version: Option<String>) -> Value {
        tokio::task::block_in_place(|| {
    let mut params = Vec::new();
    if let Some(ref l) = loader {
        if !l.is_empty() {
            params.push(format!("loaders={}", urlencoding::encode(&serde_json::to_string(&vec![l.to_lowercase()]).unwrap_or_default())));
        }
    }
    if let Some(ref v) = mc_version {
        if !v.is_empty() {
            params.push(format!("game_versions={}", urlencoding::encode(&serde_json::to_string(&vec![v.clone()]).unwrap_or_default())));
        }
    }
    let url = if params.is_empty() {
        format!("{}/project/{}/version", MODRINTH_API, slug)
    } else {
        format!("{}/project/{}/version?{}", MODRINTH_API, slug, params.join("&"))
    };
    http_get(&url, None).unwrap_or(Value::Array(vec![]))

        })
    }

/// Core install logic shared by `install_mod` (async wrapper) and `batch_install_mods`.
fn install_mod_inner(app: &State<AppState>, instance_name: &str, slug: &str, version_id: Option<&str>) -> Value {
    log_msg(app, &format!("[Mod] Installing mod '{}' to '{}'...", slug, instance_name));
    let mods_dir = instances_dir().join(instance_name).join("mods");
    match std::fs::create_dir_all(&mods_dir) {
        Ok(()) => {}
        Err(e) => {
            let err = format!("Failed to create mods directory: {}", e);
            log_msg(app, &format!("[Mod/ERROR] {}", err));
            return json!({"success": false, "error": err});
        }
    }

    // Resolve the instance's MC version + loader so we can pick a compatible build.
    let instances = load_instances_raw(app);
    let inst = instances.iter().find(|i| i.get("name").and_then(|n| n.as_str()) == Some(instance_name));
    let mc_ver = inst.and_then(|i| i.get("version")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let loader = inst.and_then(|i| i.get("loader")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let loader_opt = if loader.is_empty() || loader == "vanilla" { None } else { Some(loader.clone()) };

    let mut versions = get_modrinth_versions(slug.to_string(), loader_opt.clone(), if mc_ver.is_empty() { None } else { Some(mc_ver.clone()) });
    let mut versions_arr = versions.as_array().cloned().unwrap_or_default();
    if versions_arr.is_empty() {
        // No build matches this instance version/loader -> fall back to all versions.
        versions = get_modrinth_versions(slug.to_string(), None, None);
        versions_arr = versions.as_array().cloned().unwrap_or_default();
    }
    if versions_arr.is_empty() {
        return json!({"success": false, "error": "No versions found for this instance version/loader"});
    }

    let target_version = if let Some(ref vid) = version_id {
        if !vid.is_empty() {
            versions_arr.iter().find(|v| v.get("id").and_then(|i| i.as_str()) == Some(vid)).unwrap_or(&versions_arr[0])
        } else {
            &versions_arr[0]
        }
    } else {
        &versions_arr[0]
    };

    let files = target_version.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    let primary = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)).unwrap_or(files.first().unwrap_or(&Value::Null));
    let filename = primary.get("filename").and_then(|f| f.as_str()).unwrap_or("mod.jar");
    let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");

    if download_url.is_empty() {
        return json!({"success": false, "error": "No download URL for this version"});
    }

    let dest = mods_dir.join(filename);
    match download_file_blocking(download_url, &dest) {
        Ok(()) => {
            log_msg(app, &format!("[Mod/OK] '{}' installed!", filename));
            json!({"success": true, "filename": filename})
        }
        Err(e) => {
            let err = format!("Download failed: {}", e);
            log_msg(app, &format!("[Mod/ERROR] {}", err));
            json!({"success": false, "error": err})
        }
    }
}

#[tauri::command]
async fn install_mod(app_handle: tauri::AppHandle, instance_name: String, slug: String, version_id: Option<String>) -> Value {
    let handle = app_handle.clone();
    let inst_name = instance_name.clone();
    let slug_c = slug.clone();
    let result = tokio::task::spawn_blocking(move || {
        let app = handle.state::<AppState>();
        install_mod_inner(&app, &inst_name, &slug_c, version_id.as_deref())
    }).await;
    result.unwrap_or_else(|_| json!({"success": false, "error": "Install task panicked"}))
}

#[tauri::command(async)]
fn install_resourcepack(app: State<AppState>, instance_name: String, slug: String, version_id: Option<String>) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[ResourcePack] Installing '{}' to '{}'...", slug, instance_name));
    let rp_dir = instances_dir().join(&instance_name).join("resourcepacks");
    let _ = std::fs::create_dir_all(&rp_dir);

    let versions = get_modrinth_versions(slug.clone(), None, None);
    let versions_arr = versions.as_array().cloned().unwrap_or_default();
    if versions_arr.is_empty() { return json!({"error": "No versions found"}); }

    let target_version = if let Some(ref vid) = version_id {
        if !vid.is_empty() {
            versions_arr.iter().find(|v| v.get("id").and_then(|i| i.as_str()) == Some(vid.as_str())).unwrap_or(&versions_arr[0])
        } else { &versions_arr[0] }
    } else { &versions_arr[0] };

    let files = target_version.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    let primary = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)).unwrap_or(files.first().unwrap_or(&Value::Null));
    let filename = primary.get("filename").and_then(|f| f.as_str()).unwrap_or("pack.zip");
    let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");

    if download_url.is_empty() { return json!({"error": "No download URL"}); }

    let dest = rp_dir.join(filename);
    match download_file_blocking(download_url, &dest) {
        Ok(()) => {
            log_msg(&app, &format!("[ResourcePack/OK] '{}' installed!", filename));
            json!({"success": true, "filename": filename})
        }
        Err(e) => json!({"error": e}),
    }

        })
    }

#[tauri::command]
async fn install_modpack(app_handle: tauri::AppHandle, instance_name: String, slug: String, version_id: Option<String>) -> Value {
    let handle = app_handle.clone();
    let inst_name_clone = instance_name.clone();
    let slug_clone = slug.clone();
    let result = tokio::task::spawn_blocking(move || {
        let app = handle.state::<AppState>();
        log_msg(&app, &format!("[Modpack] Installing '{}' to '{}'...", slug_clone, inst_name_clone));

        let versions = get_modrinth_versions(slug_clone.clone(), None, None);
        let versions_arr = versions.as_array().cloned().unwrap_or_default();
        if versions_arr.is_empty() { return json!({"error": "No versions found"}); }

        let target_version = if let Some(ref vid) = version_id {
            if !vid.is_empty() {
                versions_arr.iter().find(|v| v.get("id").and_then(|i| i.as_str()) == Some(vid.as_str())).unwrap_or(&versions_arr[0])
            } else { &versions_arr[0] }
        } else { &versions_arr[0] };

        let files = target_version.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
        let primary = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)).unwrap_or(files.first().unwrap_or(&Value::Null));
        let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");
        let filename = primary.get("filename").and_then(|f| f.as_str()).unwrap_or("modpack.mrpack");

        if download_url.is_empty() { return json!({"error": "No download URL"}); }

        let temp_dir = tempfile::tempdir().unwrap();
        let mrpack_file = temp_dir.path().join(filename);

        match download_file_blocking(download_url, &mrpack_file) {
            Ok(()) => {}
            Err(e) => return json!({"error": e}),
        }

        log_msg(&app, &format!("[Modpack] Parsing {}...", filename));
        let inst_dir = instances_dir().join(&inst_name_clone);

        let mut zip = match zip::ZipArchive::new(std::fs::File::open(&mrpack_file).unwrap()) {
            Ok(z) => z,
            Err(e) => return json!({"error": e.to_string()}),
        };

        // Read modrinth.index.json
        if let Ok(mut index_file) = zip.by_name("modrinth.index.json") {
            let mut index_data = String::new();
            let _ = index_file.read_to_string(&mut index_data);
            if let Ok(index) = serde_json::from_str::<Value>(&index_data) {
                if let Some(files_list) = index.get("files").and_then(|f| f.as_array()) {
                    log_msg(&app, &format!("[Modpack] {} files to install from index", files_list.len()));
                    for entry in files_list {
                        if let Some(path) = entry.get("path").and_then(|p| p.as_str()) {
                            if let Some(downloads) = entry.get("downloads").and_then(|d| d.as_array()) {
                                if let Some(file_url) = downloads.first().and_then(|u| u.as_str()) {
                                    let dest = inst_dir.join(path);
                                    if dest.exists() { continue; }
                                    if let Some(parent) = dest.parent() {
                                        let _ = std::fs::create_dir_all(parent);
                                    }
                                    let _ = download_file_blocking(file_url, &dest);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Extract overrides
        for i in 0..zip.len() {
            if let Ok(mut file) = zip.by_index(i) {
                let name = file.name().to_string();
                if name.starts_with("overrides/") && !name.ends_with('/') {
                    let rel = name.strip_prefix("overrides/").unwrap_or(&name);
                    let dest = inst_dir.join(rel);
                    if let Some(parent) = dest.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let mut buf = Vec::new();
                    let _ = file.read_to_end(&mut buf);
                    let _ = std::fs::write(&dest, &buf);
                }
            }
        }

        log_msg(&app, &format!("[Modpack/OK] '{}' installed successfully!", filename));
        json!({"success": true})
    }).await;
    result.unwrap_or_else(|_| json!({"success": false, "error": "Modpack install task failed"}))
}

// --- News ---
#[tauri::command(async)]
fn get_minecraft_news() -> Value {
        tokio::task::block_in_place(|| {
    match http_get(MOJANG_VERSION_MANIFEST, None) {
        Ok(data) => {
            let mut news = Vec::new();
            if let Some(latest) = data.get("latest") {
                let latest_release = latest.get("release").and_then(|r| r.as_str()).unwrap_or("");
                let latest_snapshot = latest.get("snapshot").and_then(|s| s.as_str()).unwrap_or("");
                if let Some(versions) = data.get("versions").and_then(|v| v.as_array()) {
                    for v in versions.iter().take(10) {
                        if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                            if id == latest_release || id == latest_snapshot {
                                news.push(json!({
                                    "title": format!("Minecraft {} ({})", id, v.get("type").and_then(|t| t.as_str()).unwrap_or("")),
                                    "url": v.get("url").and_then(|u| u.as_str()).unwrap_or(""),
                                    "date": v.get("releaseTime").and_then(|d| d.as_str()).unwrap_or(""),
                                    "type": v.get("type").and_then(|t| t.as_str()).unwrap_or(""),
                                }));
                            }
                        }
                    }
                }
            }
            Value::Array(news)
        }
        Err(_) => Value::Array(vec![]),
    }

        })
    }

/// Fetch partner servers directly from Firebase Realtime Database.
/// Uses Rust-side HTTP (no CORS/WebView sandbox restrictions), so it works in
/// every environment. Returns an array of { id, ...fields } or empty on failure.
const PARTNERS_FIREBASE_URL: &str =
    "https://xryloth-mc-default-rtdb.firebaseio.com/partnerServers.json";

#[tauri::command(async)]
fn fetch_partners_remote() -> Value {
        tokio::task::block_in_place(|| {
    match http_get(PARTNERS_FIREBASE_URL, None) {
        Ok(Value::Object(map)) => {
            let mut arr: Vec<Value> = Vec::new();
            for (id, p) in map {
                if let Some(mut obj) = p.as_object().cloned() {
                    obj.insert("id".to_string(), Value::String(id.clone()));
                    arr.push(Value::Object(obj));
                }
            }
            let names: Vec<String> = arr.iter().filter_map(|v| v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())).collect();
            eprintln!("[Partners] Rust fetch OK: {} partners -> {:?}", arr.len(), names);
            Value::Array(arr)
        }
        Ok(_) => { eprintln!("[Partners] Rust fetch: unexpected shape (empty?)"); Value::Array(vec![]) }
        Err(e) => {
            eprintln!("[Partners] Rust fetch error: {}", e);
            Value::Array(vec![])
        }
    }

        })
    }

/// Fetch live Minecraft server status for a partner server IP:port.
/// Uses the public mcsrvstat.us API (no auth, no CORS from Rust).
#[tauri::command(async)]
fn get_server_status(host: String, port: String) -> Value {
        tokio::task::block_in_place(|| {
    let safe_host = host.trim().trim_end_matches('/').to_string();
    if safe_host.is_empty() {
        return json!({"online": false, "host": "", "port": port, "error": "empty host"});
    }
    let safe_port = port.trim();

    // If the host already contains a port (e.g. "power-1.mantranodes.fun:25572"),
    // use it as-is — never double-append the port.
    let host_has_port = safe_host.contains(':');

    // Build candidate URLs to try in order.
    // 1. If host already has a port, just use it as-is.
    // 2. If host has no port: first try bare host (default 25565 / SRV record),
    //    then try host:port if a custom port was provided.
    let mut candidates: Vec<String> = Vec::new();
    if host_has_port {
        candidates.push(format!("https://api.mcsrvstat.us/3/{}", safe_host));
    } else {
        // First try bare host (lets mcsrvstat resolve SRV records / default port).
        candidates.push(format!("https://api.mcsrvstat.us/3/{}", safe_host));
        // If a custom port was provided, also try host:port as fallback.
        if !safe_port.is_empty() && safe_port != "25565" {
            candidates.push(format!("https://api.mcsrvstat.us/3/{}:{}", safe_host, safe_port));
        }
    }

    let mut last_err = String::new();
    for url in &candidates {
        match http_get(url, None) {
            Ok(v) => {
                let online = v.get("online").and_then(|o| o.as_bool()).unwrap_or(false);
                eprintln!("[Partners] status {} -> online={} ({})", url, online, v.get("version").and_then(|x| x.as_str()).unwrap_or("?"));
                // If this attempt returned online, use it immediately.
                if online {
                    return json!({
                        "online": true,
                        "host": safe_host,
                        "port": safe_port,
                        "version": v.get("version").and_then(|x| x.as_str()).unwrap_or(""),
                        "players_online": v.get("players").and_then(|p| p.get("online")).and_then(|x| x.as_u64()).unwrap_or(0),
                        "players_max": v.get("players").and_then(|p| p.get("max")).and_then(|x| x.as_u64()).unwrap_or(0),
                        "motd": v.get("motd").and_then(|m| m.get("clean")).and_then(|c| c.as_array()).and_then(|a| a.first()).and_then(|s| s.as_str()).unwrap_or(""),
                        "icon": v.get("icon").and_then(|i| i.as_str()).unwrap_or(""),
                        "latency": v.get("debug").and_then(|d| d.get("cacheexpire")).and_then(|x| x.as_u64()).unwrap_or(0),
                    });
                }
                // Offline on this candidate — remember the result but try the next candidate.
                last_err = String::new();
                // Store this offline response so we can return it if all candidates fail.
                return json!({
                    "online": false,
                    "host": safe_host,
                    "port": safe_port,
                    "version": "",
                    "players_online": 0,
                    "players_max": 0,
                    "motd": "",
                    "icon": "",
                    "latency": 0,
                });
            }
            Err(e) => {
                last_err = e;
                eprintln!("[Partners] status {} -> error: {}", url, last_err);
            }
        }
    }
    json!({"online": false, "host": safe_host, "port": safe_port, "error": last_err})

        })
    }

// --- Skin Manager ---
#[tauri::command]
fn get_skin_info(app: State<AppState>) -> Value {
    let settings = load_settings(&app);
    let custom_skin = settings.get("custom_skin_path").and_then(|v| v.as_str()).unwrap_or("");
    json!({
        "custom_skin_path": custom_skin,
        "has_skin": !custom_skin.is_empty() && Path::new(custom_skin).exists(),
    })
}

#[tauri::command]
fn set_custom_skin(file_path: String) -> Value {
    let dest = custom_skin_path();
    match std::fs::copy(&file_path, &dest) {
        Ok(_) => json!({"success": true, "path": dest.to_string_lossy()}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

// --- Optimizer ---
#[tauri::command]
fn get_optimizer_status(instance_name: String) -> Value {
    let options_path = instances_dir().join(&instance_name).join("options.txt");
    let mut options: HashMap<String, String> = HashMap::new();
    if let Ok(content) = std::fs::read_to_string(&options_path) {
        for line in content.lines() {
            if let Some((k, v)) = line.split_once(':') {
                options.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    json!({
        "render_distance": options.get("renderDistance").and_then(|v| v.parse().ok()).unwrap_or(12),
        "simulation_distance": options.get("simulationDistance").and_then(|v| v.parse().ok()).unwrap_or(12),
        "fps_limit": options.get("fpsLimit").cloned().unwrap_or_else(|| "261".to_string()),
        "vsync": options.get("vsync").cloned().unwrap_or_else(|| "true".to_string()),
        "gamma": options.get("gamma").cloned().unwrap_or_else(|| "1.0".to_string()),
    })
}

#[tauri::command]
fn apply_optimizer(app: State<AppState>, instance_name: String, settings: Value) -> Value {
    let options_path = instances_dir().join(&instance_name).join("options.txt");
    let mut existing: HashMap<String, String> = HashMap::new();
    if let Ok(content) = std::fs::read_to_string(&options_path) {
        for line in content.lines() {
            if let Some((k, v)) = line.split_once(':') {
                existing.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    if let Some(obj) = settings.as_object() {
        for (k, v) in obj {
            existing.insert(k.clone(), v.as_str().unwrap_or(&v.to_string()).to_string());
        }
    }
    let mut content = String::new();
    for (k, v) in &existing {
        content.push_str(&format!(":{}\n", v));
    }
    let _ = std::fs::write(&options_path, content);
    log_msg(&app, &format!("[Optimizer] Applied settings to {}", instance_name));
    json!({"success": true})
}

// --- Updates ---
fn version_gt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v').split('.')
            .filter_map(|s| s.split(|c: char| !c.is_ascii_digit()).next()
            .and_then(|n| n.parse::<u64>().ok()))
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    let len = va.len().max(vb.len());
    for i in 0..len {
        let pa = va.get(i).copied().unwrap_or(0);
        let pb = vb.get(i).copied().unwrap_or(0);
        if pa != pb { return pa > pb; }
    }
    false
}

// ==================== UPDATE HELPERS ====================
fn updates_dir() -> PathBuf { app_dir().join("updates") }

// Score a release asset for the current platform (higher = preferred).
// The Windows `-setup.exe` installer is preferred over a portable exe so the
// in-app updater downloads the same file that a first-time user installs.
//
// NOTE (v6.x): Xryloth now ships its launcher binaries from
// `EscapeXMc/xryloth` and is installed / updated by the standalone Xryloth
// Installer (EscapeXMc/xrylothInstaller). The installer is the updater, so the
// launcher only applies genuine installer packages (.exe setup / .msi / .deb /
// .dmg) — never the raw portable launcher files. Scoring is also used for the
// version comparison guard below.
fn asset_score(name: &str) -> i32 {
    let n = name.to_lowercase();
    if cfg!(target_os = "windows") {
        if n.ends_with(".exe") {
            if n.contains("setup") || n.contains("install") { return 100; }
            // Release assets are named xryloth_v*_Windows64/Windows32.exe — accept
            // the one matching this build's architecture (the other one is skipped,
            // and unrecognised exes stay rejected as portable-only).
            let is64 = matches!(std::env::consts::ARCH, "x86_64");
            if is64 && (n.contains("windows64") || n.contains("win64")) { return 100; }
            if !is64 && (n.contains("windows32") || n.contains("win32")) { return 100; }
            return -1;
        }
        if n.ends_with(".msi") { return 90; }
    } else if cfg!(target_os = "macos") {
        if n.ends_with(".dmg") { return 100; }
        if n.ends_with(".pkg") { return 90; }
        if n.ends_with(".app") { return 50; }
    } else if cfg!(target_os = "linux") {
        // The Xryloth Installer owns AppImage replacement; only accept packages
        // this build can install itself.
        if n.ends_with(".deb") { return 100; }
        if n.ends_with(".flatpak") { return 50; }
        if n.ends_with(".snap") { return 50; }
    }
    -1
}

fn pick_release_asset(assets: &[Value]) -> Option<(String, String, u64)> {
    let mut best: Option<(i32, String, String, u64)> = None;
    for a in assets {
        let name = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let url = a.get("browser_download_url").and_then(|u| u.as_str()).unwrap_or("");
        let size = a.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
        if url.is_empty() { continue; }
        let score = asset_score(name);
        if score < 0 { continue; }
        if best.as_ref().map(|b| score > b.0).unwrap_or(true) {
            best = Some((score, name.to_string(), url.to_string(), size));
        }
    }
    best.map(|(_, n, u, s)| (n, u, s))
}

// Extract a comparable version from a GitHub release. The maintainer names the
// release *title* as the version (e.g. "Xryloth v6.0.0.20"), so pull the dotted
// number out of whichever field is present rather than comparing raw text — a
// leading product name would otherwise swallow the first version component.
fn release_version(data: &Value) -> String {
    let raw = data.get("name").and_then(|n| n.as_str())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| data.get("tag_name").and_then(|t| t.as_str()))
        .unwrap_or("")
        .trim();
    let raw = raw.trim_start_matches(|c| c == 'v' || c == 'V').trim();
    match raw.find(|c: char| c.is_ascii_digit()) {
        Some(pos) => raw[pos..]
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect::<String>()
            .trim_end_matches('.')
            .to_string(),
        None => raw.to_string(),
    }
}

// Fetch the latest GitHub release and describe any available update.
fn release_info() -> Value {
    match http_get(GITHUB_API_URL, None) {
        Ok(data) => {
            let tag = data.get("tag_name").and_then(|t| t.as_str()).unwrap_or("").to_string();
            let remote = release_version(&data);
            let assets: Vec<Value> = data.get("assets")
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            if !remote.is_empty() && version_gt(&remote, APP_DISPLAY_VERSION) {
                let picked = pick_release_asset(&assets);
                let (name, url, size) = picked.clone().unwrap_or_default();
                return json!({
                    "update_available": picked.is_some(),
                    "current_version": APP_DISPLAY_VERSION,
                    "current_arch": APP_ARCH,
                    "latest_version": remote,
                    "tag": tag,
                    "download_url": url,
                    "download_name": name,
                    "download_size": size,
                    "release_notes": data.get("body").and_then(|b| b.as_str()).unwrap_or(""),
                    "published_at": data.get("published_at").and_then(|p| p.as_str()).unwrap_or(""),
                });
            }
            json!({
                "update_available": false,
                "current_version": APP_DISPLAY_VERSION,
                "current_arch": APP_ARCH,
                "latest_version": remote,
            })
        }
        Err(e) => json!({"update_available": false, "current_version": APP_DISPLAY_VERSION, "error": e}),
    }
}

#[tauri::command(async)]
fn check_updates() -> Value {
        tokio::task::block_in_place(|| {
    release_info()

        })
    }

// --- System Info ---
#[tauri::command]
fn get_system_info() -> Value {
    let mut info = json!({
        "cpu": 0, "ram_used": 0, "ram_total": 0, "ram_pct": 0,
        "disk_used": 0, "disk_total": 0, "disk_pct": 0,
    });

    if cfg!(target_os = "windows") {
        // Run wmic commands on a background thread with a 5-second timeout.
        // wmic is deprecated on Windows 10/11 and can block for 30s+ while
        // the WMI service spins up. Using a separate thread + channel timeout
        // prevents freezing the Tauri command thread pool.
        let (tx, rx) = std::sync::mpsc::channel::<Value>();
        std::thread::spawn(move || {
            let mut result = json!({});

            if let Ok(output) = hidden_cmd("wmic")
                .args(["OS", "get", "TotalVisibleMemorySize,FreePhysicalMemory", "/value"])
                .output() {
                let text = String::from_utf8_lossy(&output.stdout);
                let mut total = 0u64;
                let mut free = 0u64;
                for line in text.lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        if let Ok(val) = v.trim().parse::<u64>() {
                            match k.trim() {
                                "TotalVisibleMemorySize" => total = val * 1024,
                                "FreePhysicalMemory" => free = val * 1024,
                                _ => {}
                            }
                        }
                    }
                }
                if total > 0 {
                    let used = total - free;
                    result["ram_total"] = json!(total);
                    result["ram_used"] = json!(used);
                    result["ram_pct"] = json!((used as f64 / total as f64 * 100.0) as i64);
                }
            }

            if let Ok(output) = hidden_cmd("wmic")
                .args(["logicaldisk", "where", "DeviceID='C:'", "get", "Size,FreeSpace", "/value"])
                .output() {
                let text = String::from_utf8_lossy(&output.stdout);
                let mut total = 0u64;
                let mut free = 0u64;
                for line in text.lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        if let Ok(val) = v.trim().parse::<u64>() {
                            match k.trim() {
                                "Size" => total = val,
                                "FreeSpace" => free = val,
                                _ => {}
                            }
                        }
                    }
                }
                if total > 0 {
                    let used = total - free;
                    result["disk_total"] = json!(total);
                    result["disk_used"] = json!(used);
                    result["disk_pct"] = json!((used as f64 / total as f64 * 100.0) as i64);
                }
            }

            let _ = tx.send(result);
        });

        match rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(result) => {
                for (k, v) in result.as_object().unwrap_or(&serde_json::Map::new()) {
                    info[k] = v.clone();
                }
            }
            Err(_) => { eprintln!("[SystemInfo] wmic timed out, using defaults"); }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: read /proc/meminfo and use df
        if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
            for line in content.lines() {
                if let Some((key, val)) = line.split_once(':') {
                    if let Ok(val) = val.trim().split_whitespace().next().unwrap_or("0").parse::<u64>() {
                        match key.trim() {
                            "MemTotal" => info["ram_total"] = json!(val * 1024),
                            "MemAvailable" => {
                                info["ram_free"] = json!(val * 1024);
                                if let Some(total) = info["ram_total"].as_u64() {
                                    let used = total - val * 1024;
                                    info["ram_used"] = json!(used);
                                    info["ram_pct"] = json!((used as f64 / total as f64 * 100.0) as i64);
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        if let Ok(output) = std::process::Command::new("df").args(["-B1", "/"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = text.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    if let Ok(total) = parts[1].parse::<u64>() {
                        info["disk_total"] = json!(total);
                    }
                    if let Ok(free) = parts[3].parse::<u64>() {
                        info["disk_free"] = json!(free);
                        if let Some(total) = info["disk_total"].as_u64() {
                            info["disk_used"] = json!(total - free);
                            info["disk_pct"] = json!(((total - free) as f64 / total as f64 * 100.0) as i64);
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        // macOS: use sysctl and df
        if let Ok(output) = std::process::Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
            if let Ok(total) = String::from_utf8_lossy(&output.stdout).trim().parse::<u64>() {
                info["ram_total"] = json!(total);
            }
        }
        if let Ok(output) = std::process::Command::new("vm_stat").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut free_pages: u64 = 0;
            let mut page_size: u64 = 4096;
            for line in text.lines() {
                if line.contains("Mach Virtual Memory Statistics") { continue; }
                if line.starts_with("page size of") {
                    if let Some(num) = line.split_whitespace().nth(3) {
                        if let Ok(sz) = num.parse::<u64>() { page_size = sz; }
                    }
                    continue;
                }
                if line.contains("Pages free") || line.contains("Pages inactive") || line.contains("Pages speculative") {
                    if let Some(num) = line.split(':').next() {
                        // Parse the number after the colon
                    }
                }
            }
        }
        // Fallback: just set total, leave used/pct as 0 if vm_stat parsing fails
        if let Some(total) = info["ram_total"].as_u64() {
            info["ram_used"] = json!(0);
            info["ram_pct"] = json!(0);
        }
        if let Ok(output) = std::process::Command::new("df").args(["-B1", "/"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = text.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    if let Ok(total) = parts[1].parse::<u64>() {
                        info["disk_total"] = json!(total);
                    }
                    if let Ok(free) = parts[3].parse::<u64>() {
                        if let Some(total) = info["disk_total"].as_u64() {
                            info["disk_used"] = json!(total - free);
                            info["disk_pct"] = json!(((total - free) as f64 / total as f64 * 100.0) as i64);
                        }
                    }
                }
            }
        }
    }

    info
}

// --- Logs ---
#[tauri::command]
fn get_logs(app: State<AppState>) -> Value {
    let entries = app.log_entries.lock().unwrap();
    Value::Array(entries.iter().map(|e| Value::String(e.clone())).collect())
}

#[tauri::command]
fn clear_logs(app: State<AppState>) -> Value {
    app.log_entries.lock().unwrap().clear();
    json!({"success": true})
}

#[tauri::command]
fn get_game_output(app: State<AppState>) -> Value {
    let buf = app.game_output.lock().unwrap();
    Value::Array(buf.iter().map(|l| Value::String(l.clone())).collect())
}

#[tauri::command]
fn clear_game_output(app: State<AppState>) -> Value {
    app.game_output.lock().unwrap().clear();
    json!({"success": true})
}

// --- Play Times ---
#[tauri::command]
fn get_play_times() -> Value {
    match load_json(&playtimes_file()) {
        Value::Object(m) => Value::Object(m),
        _ => Value::Object(serde_json::Map::new()),
    }
}

// ==================== HELPER FUNCTIONS FOR BACKGROUND THREADS ====================
fn log_msg_state(app_handle: &tauri::AppHandle, msg: &str) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        log_msg(&state, msg);
    }
}

fn append_output_state(app_handle: &tauri::AppHandle, line: &str) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        append_game_output(&state, line);
    }
}

// --- Instance Management Commands ---
#[tauri::command]
fn open_instance_folder(instance_name: String) -> Value {
    let dir = instances_dir().join(&instance_name);
    if dir.exists() {
        let _ = webbrowser::open(&dir.to_string_lossy());
        json!({"success": true})
    } else {
        json!({"error": "Instance folder not found"})
    }
}

/// Opens a sub-folder inside an instance (mods, screenshots, config, ...)
/// using the native file explorer. Creates the folder when it doesn't exist yet
/// so "Open screenshots" never silently fails on a fresh profile.
#[tauri::command]
fn open_instance_path(instance_name: String, sub_folder: String) -> Value {
    let sub = sub_folder.trim().trim_matches('/');
    if sub.is_empty() || sub.contains("..") || sub.starts_with('/') {
        return json!({"error": "Invalid folder path"});
    }
    let base = instances_dir().join(&instance_name);
    if !base.exists() {
        return json!({"error": "Instance folder not found"});
    }
    let dir = base.join(sub);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return json!({"error": format!("Could not create folder: {}", e)});
    }
    let _ = webbrowser::open(&dir.to_string_lossy());
    json!({"success": true, "path": dir.to_string_lossy()})
}

/// Returns the per-instance JVM / RAM overrides (empty object when none set).
#[tauri::command]
fn get_instance_settings(instance_name: String) -> Value {
    let p = app_dir().join("instance_settings.json");
    let data = load_json(&p);
    let entry = data.get(&instance_name).cloned().unwrap_or_else(|| json!({}));
    json!({
        "success": true,
        "instance_name": instance_name,
        "ram_mb": entry.get("ram_mb").and_then(|v| v.as_i64()).unwrap_or(0),
        "jvm_args": entry.get("jvm_args").and_then(|v| v.as_str()).unwrap_or(""),
        "java_path": entry.get("java_path").and_then(|v| v.as_str()).unwrap_or(""),
    })
}

/// Saves per-instance JVM / RAM overrides. Values are merged into the existing
/// entry so other per-profile keys are never wiped.
#[tauri::command]
fn save_instance_settings(
    app: State<AppState>,
    instance_name: String,
    ram_mb: i64,
    jvm_args: String,
    java_path: String,
) -> Value {
    if instance_name.trim().is_empty() {
        return json!({"error": "Instance name is required"});
    }
    // 0 means "inherit the launcher-wide RAM setting" — anything else must be sane.
    if ram_mb != 0 && (ram_mb < 512 || ram_mb > 65536) {
        return json!({"error": "RAM must be between 512 MB and 65536 MB"});
    }
    let p = app_dir().join("instance_settings.json");
    let mut data = load_json(&p);
    if !data.is_object() { data = json!({}); }
    let mut entry = data.get(&instance_name)
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    entry.insert("ram_mb".to_string(), json!(ram_mb));
    entry.insert("jvm_args".to_string(), json!(jvm_args.trim()));
    entry.insert("java_path".to_string(), json!(java_path.trim()));
    data[&instance_name] = Value::Object(entry);
    save_json(&p, &data);
    log_msg(&app, &format!("[Instance] Saved JVM settings for '{}' ({} MB)", instance_name, ram_mb));
    json!({"success": true})
}

/// Clears temporary files of a profile (logs, crash reports, caches).
/// Mods, worlds, configs and saves are never touched.
#[tauri::command]
fn clear_instance_cache(app: State<AppState>, instance_name: String) -> Value {
    let dir = instances_dir().join(&instance_name);
    if !dir.exists() {
        return json!({"error": "Instance folder not found"});
    }
    let mut removed: Vec<String> = Vec::new();
    let mut freed: u64 = 0;

    // Directory targets — removed wholesale.
    for target in ["logs", "crash-reports", "cache", "caches", ".cache", "xryloth_tmp"] {
        let p = dir.join(target);
        if p.exists() {
            if let Ok(meta) = fs_dir_size(&p) { freed += meta; }
            let _ = std::fs::remove_dir_all(&p);
            removed.push(target.to_string());
        }
    }
    // Loose log files in the instance root.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if (lower.ends_with(".log") || lower.ends_with(".log.gz") || lower == "latest.log.old")
                && entry.path().is_file()
            {
                if let Ok(m) = entry.metadata() { freed += m.len(); }
                let _ = std::fs::remove_file(entry.path());
                removed.push(name);
            }
        }
    }
    log_msg(&app, &format!("[Instance] Cleared cache for '{}' ({} items, {} KB)", instance_name, removed.len(), freed / 1024));
    json!({"success": true, "removed": removed, "freed_bytes": freed})
}

fn fs_dir_size(path: &Path) -> std::io::Result<u64> {
    let mut total = 0u64;
    if path.is_file() { return path.metadata().map(|m| m.len()); }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let p = entry.path();
        total += if p.is_dir() { fs_dir_size(&p).unwrap_or(0) } else { entry.metadata().map(|m| m.len()).unwrap_or(0) };
    }
    Ok(total)
}

#[tauri::command]
fn get_instance_mods(instance_name: String) -> Value {
    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let mut mods = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".jar") || name.ends_with(".zip") {
                let metadata = entry.metadata().ok();
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                let enabled = !name.ends_with(".disabled");
                let display_name = name.trim_end_matches(".disabled").trim_end_matches(".jar").trim_end_matches(".zip").to_string();
                mods.push(json!({
                    "filename": name,
                    "name": display_name,
                    "size": size,
                    "enabled": enabled,
                }));
            }
        }
    }
    Value::Array(mods)
}

#[tauri::command]
fn toggle_mod(instance_name: String, filename: String) -> Value {
    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let path = mods_dir.join(&filename);
    if !path.exists() {
        return json!({"error": "Mod file not found"});
    }
    if filename.ends_with(".disabled") {
        let new_name = filename.trim_end_matches(".disabled");
        let new_path = mods_dir.join(new_name);
        let _ = std::fs::rename(&path, &new_path);
        json!({"success": true, "enabled": true, "filename": new_name})
    } else {
        let new_name = format!("{}.disabled", filename);
        let new_path = mods_dir.join(&new_name);
        let _ = std::fs::rename(&path, &new_path);
        json!({"success": true, "enabled": false, "filename": new_name})
    }
}

#[tauri::command]
fn delete_mod(instance_name: String, filename: String) -> Value {
    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let path = mods_dir.join(&filename);
    if path.exists() {
        let _ = std::fs::remove_file(&path);
        json!({"success": true})
    } else {
        json!({"error": "File not found"})
    }
}

#[tauri::command]
fn rename_instance(app: State<AppState>, old_name: String, new_name: String) -> Value {
    if old_name == new_name { return json!({"error": "Same name"}); }
    let old_dir = instances_dir().join(&old_name);
    let new_dir = instances_dir().join(&new_name);
    if new_dir.exists() { return json!({"error": "An instance with that name already exists"}); }
    match std::fs::rename(&old_dir, &new_dir) {
        Ok(()) => {
            let mut instances = load_instances_raw(&app);
            for inst in instances.iter_mut() {
                if inst.get("name").and_then(|v| v.as_str()) == Some(&old_name) {
                    inst["name"] = Value::String(new_name.clone());
                }
            }
            save_instances(&instances);
            json!({"success": true})
        }
        Err(e) => json!({"error": e.to_string()}),
    }
}

/// Renames and/or retargets a profile (Minecraft version + loader).
/// Folder rename happens first so the install step that follows uses the new name.
#[tauri::command]
fn edit_instance(
    app: State<AppState>,
    instance_name: String,
    new_name: String,
    mc_version: String,
    loader: String,
    loader_version: String,
) -> Value {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() { return json!({"error": "Profile name cannot be empty"}); }
    if new_name.contains('/') || new_name.contains('\\') || new_name.contains("..") {
        return json!({"error": "Profile name contains invalid characters"}); 
    }
    let mut instances = load_instances_raw(&app);
    let idx = match instances.iter().position(|i| i.get("name").and_then(|v| v.as_str()) == Some(&instance_name)) {
        Some(i) => i,
        None => return json!({"error": "Instance not found"}),
    };
    let renamed = new_name != instance_name;
    if renamed {
        let old_dir = instances_dir().join(&instance_name);
        let new_dir = instances_dir().join(&new_name);
        if new_dir.exists() { return json!({"error": "An instance with that name already exists"}); }
        if old_dir.exists() {
            if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
                return json!({"error": format!("Could not rename profile folder: {}", e)});
            }
        }
        // Carry the per-profile JVM/RAM overrides over to the new key.
        let sp = app_dir().join("instance_settings.json");
        let mut sd = load_json(&sp);
        if sd.is_object() {
            if let Some(entry) = sd.as_object_mut().and_then(|o| o.remove(&instance_name)) {
                sd.as_object_mut().unwrap().insert(new_name.clone(), entry);
                save_json(&sp, &sd);
            }
        }
    }
    let entry = &mut instances[idx];
    entry["name"] = json!(new_name);
    entry["version"] = json!(mc_version);
    entry["loader"] = json!(loader);
    entry["loader_version"] = json!(loader_version);
    save_instances(&instances);
    log_msg(&app, &format!("[Instance] Updated '{}' -> '{}' ({} {})", instance_name, new_name, loader, mc_version));
    json!({"success": true, "name": new_name, "renamed": renamed})
}

#[tauri::command]
fn set_instance_icon(instance_name: String, icon_data: String) -> Value {
    let inst_dir = instances_dir().join(&instance_name);
    if !inst_dir.exists() {
        return json!({"error": "Profile folder not found — install the profile first"});
    }
    let icon_path = inst_dir.join("icon.png");
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(icon_data.trim_start_matches("data:image/png;base64,")) {
        if std::fs::write(&icon_path, &bytes).is_err() {
            return json!({"error": "Could not write the icon file"});
        }
        json!({"success": true, "path": icon_path.to_string_lossy()})
    } else {
        json!({"error": "Invalid base64 data"})
    }
}

#[tauri::command]
fn get_instance_icon(instance_name: String) -> Value {
    let icon_path = instances_dir().join(&instance_name).join("icon.png");
    if icon_path.exists() {
        if let Ok(bytes) = std::fs::read(&icon_path) {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            return json!({"success": true, "icon": format!("data:image/png;base64,{}", encoded)});
        }
    }
    json!({"success": false, "icon": null})
}

#[tauri::command]
fn get_instance_resourcepacks(instance_name: String) -> Value {
    let rp_dir = instances_dir().join(&instance_name).join("resourcepacks");
    let mut packs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&rp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".zip") || name.ends_with(".jar") {
                let size = entry.metadata().ok().map(|m| m.len()).unwrap_or(0);
                packs.push(json!({
                    "filename": name,
                    "name": name.trim_end_matches(".zip").trim_end_matches(".jar").to_string(),
                    "size": size,
                    "enabled": !name.starts_with("."),
                }));
            }
        }
    }
    Value::Array(packs)
}

#[tauri::command]
fn delete_resourcepack(instance_name: String, filename: String) -> Value {
    let rp_dir = instances_dir().join(&instance_name).join("resourcepacks");
    let path = rp_dir.join(&filename);
    if path.exists() {
        let _ = std::fs::remove_file(&path);
        json!({"success": true})
    } else {
        json!({"error": "File not found"})
    }
}

#[tauri::command]
async fn create_instance_from_modpack(app_handle: tauri::AppHandle, name: String, mc_version: String, loader: String, loader_version: String, mrpack_url: String) -> Value {
    let handle = app_handle.clone();
    let name_clone = name.clone();
    let mc_version_clone = mc_version.clone();
    let loader_clone = loader.clone();
    let loader_version_clone = loader_version.clone();
    let mrpack_url_clone = mrpack_url.clone();

    let result = tokio::task::spawn_blocking(move || {
        let app = handle.state::<AppState>();
        log_msg(&app, &format!("[Modpack/Instance] Creating '{}' from modpack...", name_clone));
        let inst_dir = instances_dir().join(&name_clone);
        if inst_dir.exists() {
            return json!({"error": "An instance with that name already exists"});
        }
        let _ = std::fs::create_dir_all(&inst_dir);
        for subdir in &["mods", "saves", "resourcepacks", "screenshots", "natives", "assets", "config"] {
            let _ = std::fs::create_dir_all(inst_dir.join(subdir));
        }
        let instance_data = json!({
            "name": name_clone, "version": mc_version_clone, "loader": loader_clone,
            "loader_version": loader_version_clone,
            "created": chrono::Local::now().to_rfc3339(),
            "last_played": null, "icon": "",
        });
        let mut instances = load_instances_raw(&app);
        instances.push(instance_data.clone());
        save_instances(&instances);

        if !mrpack_url_clone.is_empty() {
            log_msg(&app, &format!("[Modpack/Instance] Downloading modpack {}...", mrpack_url_clone));
            let temp_dir = tempfile::tempdir().unwrap();
            let mrpack_file = temp_dir.path().join("modpack.mrpack");
            if download_file_blocking(&mrpack_url_clone, &mrpack_file).is_ok() {
                if let Ok(mut zip) = zip::ZipArchive::new(std::fs::File::open(&mrpack_file).unwrap()) {
                    if let Ok(mut index_file) = zip.by_name("modrinth.index.json") {
                        let mut index_data = String::new();
                        let _ = index_file.read_to_string(&mut index_data);
                        if let Ok(index) = serde_json::from_str::<Value>(&index_data) {
                            if let Some(files_list) = index.get("files").and_then(|f| f.as_array()) {
                                for entry in files_list {
                                    if let Some(path) = entry.get("path").and_then(|p| p.as_str()) {
                                        if let Some(downloads) = entry.get("downloads").and_then(|d| d.as_array()) {
                                            if let Some(file_url) = downloads.first().and_then(|u| u.as_str()) {
                                                let dest = inst_dir.join(path);
                                                if let Some(parent) = dest.parent() {
                                                    let _ = std::fs::create_dir_all(parent);
                                                }
                                                let _ = download_file_blocking(file_url, &dest);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    for i in 0..zip.len() {
                        if let Ok(mut file) = zip.by_index(i) {
                            let fname = file.name().to_string();
                            if fname.starts_with("overrides/") && !fname.ends_with('/') {
                                let rel = fname.strip_prefix("overrides/").unwrap_or(&fname);
                                let dest = inst_dir.join(rel);
                                if let Some(parent) = dest.parent() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                                let mut buf = Vec::new();
                                let _ = file.read_to_end(&mut buf);
                                let _ = std::fs::write(&dest, &buf);
                            }
                        }
                    }
                }
            }
        }

        log_msg(&app, &format!("[Modpack/Instance/OK] '{}' created successfully!", name_clone));
        json!({"success": true, "instance": instance_data})
    }).await;
    result.unwrap_or_else(|_| json!({"error": "Instance creation task failed"}))
}

// ==================== INSTANCE TEMPLATES ====================
#[derive(serde::Serialize)]
struct TemplateMod {
    slug: &'static str,
    name: &'static str,
}

#[derive(serde::Serialize)]
struct InstanceTemplate {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    icon: &'static str,
    category: &'static str,
    mc_version: &'static str,
    loader: &'static str,
    loader_version: &'static str,
    mods: Vec<TemplateMod>,
}

fn get_builtin_templates() -> Vec<InstanceTemplate> {
    vec![
        InstanceTemplate {
            id: "fabric-tech-reborn".into(), name: "Tech Reborn (Fabric)".into(),
            description: "Automation and tech mods on Fabric — Tech Reborn, AE2, Mekanism, Pneumatic Craft".into(),
            icon: "⚙️", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "techreborn".into(), name: "Tech Reborn".into() },
                TemplateMod { slug: "ae2".into(), name: "Applied Energistics 2".into() },
                TemplateMod { slug: "mekanism".into(), name: "Mekanism".into() },
                TemplateMod { slug: "pneumaticcraft".into(), name: "PneumaticCraft: Repressurized".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "fabric-ad-astra".into(), name: "Ad Astra (Fabric)".into(),
            description: "Space exploration modpack — Ad Astra, Rocket, VisIER, and quality-of-life mods".into(),
            icon: "🚀", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "ad-astra".into(), name: "Ad Astra".into() },
                TemplateMod { slug: "visier".into(), name: "VisIER".into() },
                TemplateMod { slug: "jetpack-addon".into(), name: "Ad Astra Jetpacks".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "fabric-language-kotlin".into(), name: "Fabric Language Kotlin".into() },
            ],
        },
        InstanceTemplate {
            id: "fabric-create-astral".into(), name: "Create: Astral (Fabric)".into(),
            description: "Create modpack with Astral and addons — Create, Create: Astral, Create: Steam 'n Rails".into(),
            icon: "🌌", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "create".into(), name: "Create".into() },
                TemplateMod { slug: "create-astral".into(), name: "Create: Astral".into() },
                TemplateMod { slug: "create-steam-n-rails".into(), name: "Create: Steam 'n Rails".into() },
                TemplateMod { slug: "create-armory".into(), name: "Create: Armory".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "fabric-better-end".into(), name: "Better End (Fabric)".into(),
            description: "Adventure and exploration — Better End, Better Nether, TerrariaCopy, and more".into(),
            icon: "🏔️", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "better-end".into(), name: "Better End".into() },
                TemplateMod { slug: "better-nether".into(), name: "Better Nether".into() },
                TemplateMod { slug: "biome-makeover".into(), name: "Biome Makeover".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
                TemplateMod { slug: "iris".into(), name: "Iris Shaders".into() },
            ],
        },
        InstanceTemplate {
            id: "fabric-chromatic-iron".into(), name: "Chromatic Iron (Fabric)".into(),
            description: "Vanilla-friendly QoL modpack — Chromatic Iron, REI, Appleskin, and performance mods".into(),
            icon: "🎨", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "chromaic-curse".into(), name: "Chromaic Curse".into() },
                TemplateMod { slug: "appleskin".into(), name: "Appleskin".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
                TemplateMod { slug: "lithium".into(), name: "Lithium".into() },
                TemplateMod { slug: "phosphor".into(), name: "Phosphor".into() },
            ],
        },
        InstanceTemplate {
            id: "fabric-lets-do".into(), name: "Let's Do (Fabric)".into(),
            description: "Cozy building and farming — Let's Do mod series with furniture, cooking, and more".into(),
            icon: "🌾", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "lets-do-build".into(), name: "Let's Do: Build".into() },
                TemplateMod { slug: "lets-do-meadow".into(), name: "Let's Do: Meadow".into() },
                TemplateMod { slug: "lets-do-cooking".into(), name: "Let's Do: Cooking".into() },
                TemplateMod { slug: "lets-do-beachparty".into(), name: "Let's Do: Beach Party".into() },
                TemplateMod { slug: "lets-do-barn".into(), name: "Let's Do: Barn".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "fabric-vault-hunters".into(), name: "Vault Hunters (Fabric)".into(),
            description: "Adventure RPG modpack — Vault Hunters with quests, skills, and epic loot".into(),
            icon: "🏰", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "vault-hunters".into(), name: "Vault Hunters".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "jade".into(), name: "Jade".into() },
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
                TemplateMod { slug: "iris".into(), name: "Iris Shaders".into() },
            ],
        },
        InstanceTemplate {
            id: "fabric-skyfactory".into(), name: "SkyFactory (Fabric)".into(),
            description: "Skyblock modpack — Start on a tree, build everything. Includes Ex Nihilo and more".into(),
            icon: "🌳", category: "Fabric", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "ex-nihilo".into(), name: "Ex Nihilo: Sequentia".into() },
                TemplateMod { slug: "ex-nihilo-mekanism-addon".into(), name: "Ex Nihilo: MEK Add-on".into() },
                TemplateMod { slug: "ex-nihilo-astral".into(), name: "Ex Nihilo: Astral".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
            ],
        },
        InstanceTemplate {
            id: "forge-ftb-revelation".into(), name: "FTB Revelation (Forge)".into(),
            description: "All-purpose modpack — FTB Revelation with tech, magic, and exploration mods".into(),
            icon: "🔮", category: "Forge", mc_version: "1.20.2", loader: "javafml", loader_version: "48.0.29",
            mods: vec![
                TemplateMod { slug: "ftb-revelation".into(), name: "FTB Revelation".into() },
                TemplateMod { slug: "mekanism".into(), name: "Mekanism".into() },
                TemplateMod { slug: "applied-energistics-2".into(), name: "Applied Energistics 2".into() },
                TemplateMod { slug: "twilight-forest".into(), name: "Twilight Forest".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "forge-ftb-direwolf20".into(), name: "FTB Direwolf20 (Forge)".into(),
            description: "Direwolf20's curated modpack — Tech, magic, and everything in between".into(),
            icon: "🐺", category: "Forge", mc_version: "1.20.2", loader: "javafml", loader_version: "48.0.29",
            mods: vec![
                TemplateMod { slug: "direwolf20".into(), name: "FTB Direwolf20".into() },
                TemplateMod { slug: "mekanism".into(), name: "Mekanism".into() },
                TemplateMod { slug: "botania".into(), name: "Botania".into() },
                TemplateMod { slug: "twilight-forest".into(), name: "Twilight Forest".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "forge-enigmatica-6".into(), name: "Enigmatica 6 (Forge)".into(),
            description: "Expert modpack — Enigmatica 6 with challenging recipes and expert progression".into(),
            icon: "🧩", category: "Forge", mc_version: "1.16.5", loader: "javafml", loader_version: "36.2.0",
            mods: vec![
                TemplateMod { slug: "enigmatica".into(), name: "Enigmatica 6".into() },
                TemplateMod { slug: "mekaf".into(), name: "Mekanism".into() },
                TemplateMod { slug: "botania".into(), name: "Botania".into() },
                TemplateMod { slug: "astral-sorcery".into(), name: "Astral Sorcery".into() },
                TemplateMod { slug: "twilight-forest".into(), name: "Twilight Forest".into() },
            ],
        },
        InstanceTemplate {
            id: "forge-rl".into(), name: "RLCraft (Forge)".into(),
            description: "Hardcore survival modpack — RLCraft with realistic survival mechanics".into(),
            icon: "⚔️", category: "Forge", mc_version: "1.12.2", loader: "javafml", loader_version: "14.23.5.2855",
            mods: vec![
                TemplateMod { slug: "rlcraft".into(), name: "RLCraft".into() },
                TemplateMod { slug: "resurrect-mobs".into(), name: "Resurrect Mobs".into() },
                TemplateMod { slug: "lycanites-mobs".into(), name: "Lycanites Mobs".into() },
                TemplateMod { slug: "tough-as-nails".into(), name: "Tough As Nails".into() },
            ],
        },
        InstanceTemplate {
            id: "forge-atm9".into(), name: "All the Mods 9 (Forge)".into(),
            description: "Massive modpack — All the Mods 9 with 400+ mods for ultimate Minecraft experience".into(),
            icon: "🌌", category: "Forge", mc_version: "1.20.1", loader: "javafml", loader_version: "47.1.0",
            mods: vec![
                TemplateMod { slug: "all-the-mods-9".into(), name: "All the Mods 9".into() },
                TemplateMod { slug: "mekanism".into(), name: "Mekanism".into() },
                TemplateMod { slug: "ae2".into(), name: "Applied Energistics 2".into() },
                TemplateMod { slug: "botania".into(), name: "Botania".into() },
                TemplateMod { slug: "twilight-forest".into(), name: "Twilight Forest".into() },
            ],
        },
        InstanceTemplate {
            id: "forge-bettermc".into(), name: "Better MC (Forge)".into(),
            description: "Enhanced vanilla experience — Better MC with improved worldgen and QoL".into(),
            icon: "🌍", category: "Forge", mc_version: "1.16.5", loader: "javafml", loader_version: "36.2.34",
            mods: vec![
                TemplateMod { slug: "better-mc".into(), name: "Better MC".into() },
                TemplateMod { slug: "biome-makeover".into(), name: "Biome Makeover".into() },
                TemplateMod { slug: "terrablender".into(), name: "TerraBlender".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "Xaeros-Minimap".into(), name: "Xaero's Minimap".into() },
            ],
        },
        InstanceTemplate {
            id: "vanilla-optimized".into(), name: "Optimized Vanilla (Fabric)".into(),
            description: "Vanilla experience with performance mods — Sodium, Iris, Lithium, Starlight".into(),
            icon: "⚡", category: "Vanilla", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
                TemplateMod { slug: "iris".into(), name: "Iris Shaders".into() },
                TemplateMod { slug: "lithium".into(), name: "Lithium".into() },
                TemplateMod { slug: "phosphor".into(), name: "Phosphor".into() },
                TemplateMod { slug: "starlight".into(), name: "Starlight".into() },
            ],
        },
        InstanceTemplate {
            id: "vanilla-building".into(), name: "Building (Fabric)".into(),
            description: "Building-focused modpack — WorldEdit, Litematica, Create, and building helpers".into(),
            icon: "🏗️", category: "Vanilla", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "worldedit".into(), name: "WorldEdit".into() },
                TemplateMod { slug: "litematica".into(), name: "Litematica".into() },
                TemplateMod { slug: "create".into(), name: "Create".into() },
                TemplateMod { slug: "building-gadgets".into(), name: "Building Gadgets".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "vanilla-qol".into(), name: "Quality of Life (Fabric)".into(),
            description: "QoL focused modpack — JEI, Appleskin, Jade,Xaero's Minimap, and more".into(),
            icon: "✨", category: "Vanilla", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "appleskin".into(), name: "Appleskin".into() },
                TemplateMod { slug: "jade".into(), name: "Jade".into() },
                TemplateMod { slug: "Xaeros-Minimap".into(), name: "Xaero's Minimap".into() },
                TemplateMod { slug: "Xaeros-Mapwaypoints-Mod".into(), name: "Xaero's Map Waypoints".into() },
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
            ],
        },
        InstanceTemplate {
            id: "vanilla-shaders".into(), name: "Shaders (Fabric)".into(),
            description: "Visual enhancement modpack — Iris, Complementary Shaders, and performance mods".into(),
            icon: "☀️", category: "Vanilla", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "iris".into(), name: "Iris Shaders".into() },
                TemplateMod { slug: "complementary-shaders".into(), name: "Complementary Shaders".into() },
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
                TemplateMod { slug: "lithium".into(), name: "Lithium".into() },
                TemplateMod { slug: "embeddium".into(), name: "Embeddium".into() },
            ],
        },
        InstanceTemplate {
            id: "server-hardcore".into(), name: "Hardcore Server".into(),
            description: "Hardcore survival server — Single life, increased difficulty, epic loot".into(),
            icon: "💀", category: "Server", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "hardcore-darkness".into(), name: "Hardcore Darkness".into() },
                TemplateMod { slug: "epic-samus".into(), name: "Epic Samus".into() },
                TemplateMod { slug: "infernal-mobs".into(), name: "Infernal Mobs".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "server-creative".into(), name: "Creative Server".into(),
            description: "Creative building server — WorldEdit, Fast Async WorldEdit, and building tools".into(),
            icon: "🎨", category: "Server", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "worldedit".into(), name: "WorldEdit".into() },
                TemplateMod { slug: "litematica".into(), name: "Litematica".into() },
                TemplateMod { slug: "building-gadgets".into(), name: "Building Gadgets".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
            ],
        },
        InstanceTemplate {
            id: "server-skyblock".into(), name: "SkyBlock Server".into(),
            description: "Skyblock survival server — Ex Nihilo, Ex Nihilo: Sequentia for skyblock gameplay".into(),
            icon: "🪨", category: "Server", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "ex-nihilo".into(), name: "Ex Nihilo: Sequentia".into() },
                TemplateMod { slug: "ex-nihilo-mekanism-addon".into(), name: "Ex Nihilo: MEK Add-on".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "sodium".into(), name: "Sodium".into() },
            ],
        },
        InstanceTemplate {
            id: "server-survival".into(), name: "Survival Server".into(),
            description: "Classic survival server — TerrariaCopy, Biome Makeover, and exploration mods".into(),
            icon: "🏕️", category: "Server", mc_version: "1.20.1", loader: "fabric", loader_version: "0.15.11",
            mods: vec![
                TemplateMod { slug: "biome-makeover".into(), name: "Biome Makeover".into() },
                TemplateMod { slug: "terraria-copy".into(), name: "TerrariaCopy".into() },
                TemplateMod { slug: "jei".into(), name: "JEI".into() },
                TemplateMod { slug: "Xaeros-Minimap".into(), name: "Xaero's Minimap".into() },
            ],
        },
    ]
}

#[tauri::command]
fn get_instance_templates() -> Value {
    let templates = get_builtin_templates();
    let json_templates: Vec<Value> = templates.iter().map(|t| {
        let mods: Vec<Value> = t.mods.iter().map(|m| json!({
            "slug": m.slug,
            "name": m.name,
        })).collect();
        json!({
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "icon": t.icon,
            "category": t.category,
            "mc_version": t.mc_version,
            "loader": t.loader,
            "loader_version": t.loader_version,
            "mods": mods,
        })
    }).collect();
    json!({"templates": json_templates})
}

#[tauri::command]
async fn apply_instance_template(app_handle: tauri::AppHandle, instance_name: String, template_id: String) -> Value {
    let handle = app_handle.clone();
    let inst_name_clone = instance_name.clone();
    let tmpl_id_clone = template_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let app = handle.state::<AppState>();
        let templates = get_builtin_templates();
        let tmpl = match templates.iter().find(|t| t.id == tmpl_id_clone) {
            Some(t) => t,
            None => return json!({"success": false, "error": "Template not found", "installed": 0, "errors": 0, "template_name": tmpl_id_clone}),
        };

        log_msg(&app, &format!("[Template] Applying '{}' to '{}'", tmpl.name, inst_name_clone));

        let inst_dir = instances_dir().join(&inst_name_clone).join("mods");
        let _ = std::fs::create_dir_all(&inst_dir);

        let mut installed = 0;
        let mut errors = 0;

        for m in &tmpl.mods {
            let versions = get_modrinth_versions(m.slug.to_string(), None, None);
            let versions_arr = versions.as_array().cloned().unwrap_or_default();
            if versions_arr.is_empty() {
                log_msg(&app, &format!("[Template] Mod '{}' not found on Modrinth", m.slug));
                errors += 1;
                continue;
            }
            let target_version = &versions_arr[0];
            let files = target_version.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
            let primary = files.iter()
                .find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
                .unwrap_or_else(|| files.first().unwrap_or(&Value::Null));
            let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let filename_owned = primary.get("filename").and_then(|f| f.as_str())
                .unwrap_or(&format!("{}.jar", m.slug))
                .to_string();
            let filename = filename_owned.as_str();

            if download_url.is_empty() {
                log_msg(&app, &format!("[Template] No download URL for '{}'", m.slug));
                errors += 1;
                continue;
            }

            let dest = inst_dir.join(filename);
            if dest.exists() {
                log_msg(&app, &format!("[Template] '{}' already installed, skipping", m.name));
                installed += 1;
                continue;
            }

            match download_file_blocking(download_url, &dest) {
                Ok(()) => {
                    log_msg(&app, &format!("[Template/OK] '{}' installed!", m.name));
                    installed += 1;
                }
                Err(e) => {
                    log_msg(&app, &format!("[Template/ERR] Failed to install '{}': {}", m.name, e));
                    errors += 1;
                }
            }
        }

        let _ = handle.emit_all("template-progress", json!({
            "success": true, "installed": installed, "errors": errors,
            "template_name": tmpl.name, "done": true,
        }));

        json!({
            "success": true,
            "installed": installed,
            "errors": errors,
            "template_name": tmpl.name,
        })
    }).await;
    result.unwrap_or_else(|_| json!({"success": false, "error": "Template apply task failed", "installed": 0, "errors": 0, "template_name": template_id}))
}

#[tauri::command(async)]
fn get_minecraft_news_enhanced() -> Value {
        tokio::task::block_in_place(|| {
    match http_get("https://www.minecraft.net/en-us/articles/rss", None) {
        Ok(data) => {
            let mut news = Vec::new();
            if let Some(channel) = data.get("rss").and_then(|r| r.get("channel")).and_then(|c| c.get("item")).and_then(|i| i.as_array()) {
                for item in channel.iter().take(10) {
                    let title = item.get("title").and_then(|t| t.as_str()).unwrap_or("Minecraft News");
                    let url = item.get("link").and_then(|u| u.as_str()).unwrap_or("");
                    let date = item.get("pubDate").and_then(|d| d.as_str()).unwrap_or("");
                    let image = item.get("media:thumbnail").and_then(|t| t.get("@url").and_then(|u| u.as_str()).map(|s| s.to_string()))
                        .or_else(|| item.get("media:content").and_then(|t| t.get("@url").and_then(|u| u.as_str()).map(|s| s.to_string())));
                    news.push(json!({
                        "title": title,
                        "url": url,
                        "date": date,
                        "type": "news",
                        "image": image,
                    }));
                }
            }
            if news.is_empty() {
                match http_get(MOJANG_VERSION_MANIFEST, None) {
                    Ok(data) => {
                        if let Some(latest) = data.get("latest") {
                            let latest_release = latest.get("release").and_then(|r| r.as_str()).unwrap_or("");
                            if let Some(versions) = data.get("versions").and_then(|v| v.as_array()) {
                                for v in versions.iter().take(10) {
                                    if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                                        if id == latest_release {
                                            news.push(json!({
                                                "title": format!("Minecraft {} Released!", id),
                                                "url": v.get("url").and_then(|u| u.as_str()).unwrap_or(""),
                                                "date": v.get("releaseTime").and_then(|d| d.as_str()).unwrap_or(""),
                                                "type": "release",
                                                "image": null,
                                            }));
                                        }
                                    }
                                }
                            }
                        }
                        Value::Array(news)
                    }
                    Err(_) => Value::Array(news),
                }
            } else {
                Value::Array(news)
            }
        }
        Err(_) => {
            let mut news = Vec::new();
            match http_get(MOJANG_VERSION_MANIFEST, None) {
                Ok(data) => {
                    if let Some(latest) = data.get("latest") {
                        let latest_release = latest.get("release").and_then(|r| r.as_str()).unwrap_or("");
                        if let Some(versions) = data.get("versions").and_then(|v| v.as_array()) {
                            for v in versions.iter().take(10) {
                                if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                                    if id == latest_release {
                                        news.push(json!({
                                            "title": format!("Minecraft {} Released!", id),
                                            "url": v.get("url").and_then(|u| u.as_str()).unwrap_or(""),
                                            "date": v.get("releaseTime").and_then(|d| d.as_str()).unwrap_or(""),
                                            "type": "release",
                                            "image": null,
                                        }));
                                    }
                                }
                            }
                        }
                    }
                }
                Err(_) => {}
            }
            Value::Array(news)
        }
    }

        })
    }

// --- Version ---
#[tauri::command(async)]
fn get_latest_release_tag() -> Value {
        tokio::task::block_in_place(|| {
    match http_get(GITHUB_API_URL, None) {
        Ok(data) => {
            let tag = match release_version(&data) {
                v if !v.is_empty() => v,
                _ => APP_DISPLAY_VERSION.trim_start_matches('v').to_string(),
            };
            let notes = data.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string();
            let published = data.get("published_at").and_then(|p| p.as_str()).unwrap_or("").to_string();
            json!({
                "tag": tag,
                "current_version": APP_DISPLAY_VERSION,
                "current_arch": APP_ARCH,
                "notes": notes,
                "published_at": published,
            })
        }
        Err(_) => json!({"tag": APP_VERSION, "current_version": APP_DISPLAY_VERSION, "current_arch": APP_ARCH, "notes": "", "published_at": ""}),
    }

        })
    }

// ==================== BACKGROUND IMAGE FILE ====================
#[tauri::command]
fn save_background_image(app: State<AppState>, data: String) -> Value {
    let bg_dir = app_dir().join("backgrounds");
    let _ = std::fs::create_dir_all(&bg_dir);
    if data.starts_with("data:") {
        if let Some(idx) = data.find(",") {
            let b64 = &data[idx + 1..];
            let ext = if data.contains("image/png") { "png" } else if data.contains("image/jpeg") || data.contains("image/jpg") { "jpg" } else if data.contains("image/gif") { "gif" } else if data.contains("image/webp") { "webp" } else { "png" };
            let file_path = bg_dir.join(format!("custom.{}", ext));
            if let Ok(bytes) = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64) {
                if std::fs::write(&file_path, &bytes).is_ok() {
                    return json!({"success": true, "path": file_path.to_string_lossy().to_string()});
                }
            }
        }
    }
    json!({"success": false, "error": "Invalid image data"})
}

#[tauri::command]
fn get_background_image_path() -> String {
    let bg_dir = app_dir().join("backgrounds");
    for ext in &["png", "jpg", "jpeg", "gif", "webp"] {
        let p = bg_dir.join(format!("custom.{}", ext));
        if p.exists() { return p.to_string_lossy().to_string(); }
    }
    String::new()
}

#[tauri::command]
fn delete_background_image() -> Value {
    let bg_dir = app_dir().join("backgrounds");
    for ext in &["png", "jpg", "jpeg", "gif", "webp"] {
        let p = bg_dir.join(format!("custom.{}", ext));
        let _ = std::fs::remove_file(&p);
    }
    json!({"success": true})
}

// ==================== BACKGROUND VIDEO FILE ====================
#[tauri::command]
fn save_background_video(data: String) -> Value {
    let bg_dir = app_dir().join("backgrounds");
    let _ = std::fs::create_dir_all(&bg_dir);
    if data.starts_with("data:") {
        if let Some(idx) = data.find(",") {
            let b64 = &data[idx + 1..];
            let ext = if data.contains("video/webm") { "webm" } else if data.contains("video/quicktime") { "mov" } else { "mp4" };
            let file_path = bg_dir.join(format!("custom_video.{}", ext));
            if let Ok(bytes) = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64) {
                if std::fs::write(&file_path, &bytes).is_ok() {
                    return json!({"success": true, "path": file_path.to_string_lossy().to_string()});
                }
            }
        }
    }
    json!({"success": false, "error": "Invalid video data"})
}

#[tauri::command]
fn get_background_video_path() -> String {
    let bg_dir = app_dir().join("backgrounds");
    for ext in &["mp4", "webm", "mov"] {
        let p = bg_dir.join(format!("custom_video.{}", ext));
        if p.exists() { return p.to_string_lossy().to_string(); }
    }
    String::new()
}

#[tauri::command]
fn delete_background_video() -> Value {
    let bg_dir = app_dir().join("backgrounds");
    for ext in &["mp4", "webm", "mov"] {
        let p = bg_dir.join(format!("custom_video.{}", ext));
        let _ = std::fs::remove_file(&p);
    }
    json!({"success": true})
}

// ==================== DISCORD RPC ====================
#[tauri::command(async)]
fn init_discord_rpc(app: tauri::AppHandle) -> Value {
        tokio::task::block_in_place(|| {
    let state = app.state::<AppState>();

    let discord_rpc_enabled = {
        let disk_settings = load_json(&settings_file());
        disk_settings.get("discord_rpc").and_then(|v| v.as_bool()).unwrap_or(true)
    };
    if !discord_rpc_enabled {
        eprintln!("[Discord RPC] Disabled in settings");
        return json!({"success": true, "message": "Discord RPC disabled in settings"});
    }

    let existing = state.discord_handle.lock().unwrap();
    if existing.is_some() {
        eprintln!("[Discord RPC] Already connected");
        return json!({"success": true, "message": "Discord RPC already connected"});
    }
    drop(existing);

    let client_id = "1557369457397997618";

    std::thread::spawn(move || {
        let mut last_activity: Option<DiscordMessage> = None;
        let reader_running = Arc::new(AtomicBool::new(false));

        // Outer loop: reconnect if Discord/arRPC disconnects
        loop {
            // Check if disabled
            let disabled = {
                let ds = load_json(&settings_file());
                ds.get("discord_rpc").and_then(|v| v.as_bool()).unwrap_or(true) == false
            };
            if disabled {
                eprintln!("[Discord RPC] Disabled, exiting");
                break;
            }

            // Create a FRESH channel each iteration so reconnect works
            let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<DiscordMessage>();

            let mut connected = false;

            // Try all 10 IPC endpoints (Windows named pipe or Unix socket)
            for i in 0..10 {
                match discord_connect(i) {
                    Ok(file) => {
                        let mut handshake_reader = std::io::BufReader::new(file.try_clone().unwrap());
                        let keepalive_reader = std::io::BufReader::new(file.try_clone().unwrap());
                        let writer = Arc::new(Mutex::new(file));

                        let handshake = json!({"v": 1, "client_id": client_id}).to_string();
                        {
                            let mut w = writer.lock().unwrap();
                            if let Err(e) = w.write_all(&discord_ipc_frame(0, &handshake)) {
                                eprintln!("[Discord RPC] Handshake write failed: {}", e);
                                continue;
                            }
                            if let Err(e) = w.flush() {
                                eprintln!("[Discord RPC] Handshake flush failed: {}", e);
                                continue;
                            }
                        }

                        let read_result = {
                            let (tx, rx) = std::sync::mpsc::channel();
                            std::thread::spawn(move || {
                                let _ = tx.send(discord_ipc_read(&mut handshake_reader));
                            });
                            rx.recv_timeout(std::time::Duration::from_secs(5))
                        };
                        match read_result {
                            Ok(Ok((_, data))) => {
                                let v: Result<Value, _> = serde_json::from_str(&data);
                                if let Ok(obj) = v {
                                    if obj.get("evt").and_then(|e| e.as_str()) == Some("READY") {
                                        connected = true;
                                        eprintln!("[Discord RPC] Connected to pipe {} (Discord or arRPC)", i);

                                        {
                                            let state = app.state::<AppState>();
                                            let handle = DiscordRpcHandle { sender: cmd_tx.clone() };
                                            *state.discord_handle.lock().unwrap() = Some(handle);
                                        }

                                        // Restore last known activity if any
                                        if let Some(DiscordMessage::Update { details: ref d, state: ref s, large_image: ref li, large_text: ref lt, small_image: ref si, small_text: ref st }) = last_activity {
                                            let mut w = writer.lock().unwrap();
                                            discord_set_activity(&mut *w, "ecl-restore", d, s, li, lt, si, st);
                                            let _ = w.flush();
                                        }
                                        eprintln!("[Discord RPC] Connected, no activity set (waiting for game launch)");

                                        // Keepalive reader
                                        let writer_clone = writer.clone();
                                        reader_running.store(true, Ordering::Relaxed);
                                        let rr_clone = reader_running.clone();
                                        let mut kr = keepalive_reader;
                                        std::thread::spawn(move || {
                                            while rr_clone.load(Ordering::Relaxed) {
                                                match discord_ipc_read(&mut kr) {
                                                    Ok((opcode, data)) => {
                                                        match opcode {
                                                            2 => {
                                                                let pong_payload = serde_json::from_str::<Value>(&data)
                                                                    .ok()
                                                                    .and_then(|v| v.get("d").cloned())
                                                                    .unwrap_or(Value::Null);
                                                                let pong = json!({"d": pong_payload});
                                                                let mut w = writer_clone.lock().unwrap();
                                                                let _ = w.write_all(&discord_ipc_frame(3, &pong.to_string()));
                                                                let _ = w.flush();
                                                            }
                                                            1 => {
                                                                eprintln!("[Discord RPC] CLOSE received");
                                                                break;
                                                            }
                                                            _ => {}
                                                        }
                                                    }
                                                    Err(_) => { break; }
                                                }
                                            }
                                            eprintln!("[Discord RPC] Reader thread exiting");
                                        });

                                        // Command loop
                                        loop {
                                            match cmd_rx.recv() {
                                                Ok(DiscordMessage::Update { details, state, large_image, large_text, small_image, small_text }) => {
                                                    let mut w = writer.lock().unwrap();
                                                    let nonce = format!("ecl-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
                                                    discord_set_activity(&mut *w, &nonce, &details, &state, &large_image, &large_text, &small_image, &small_text);
                                                    let _ = w.flush();
                                                    last_activity = Some(DiscordMessage::Update {
                                                        details, state, large_image, large_text, small_image, small_text,
                                                    });
                                                    eprintln!("[Discord RPC] Updated activity");
                                                }
                                                Ok(DiscordMessage::Stop) => {
                                                    eprintln!("[Discord RPC] Stop received");
                                                    reader_running.store(false, Ordering::Relaxed);
                                                    let mut w = writer.lock().unwrap();
                                                    let clear = json!({
                                                        "cmd": "SET_ACTIVITY",
                                                        "args": { "pid": std::process::id(), "activity": null },
                                                        "nonce": "ecl-clear"
                                                    });
                                                    let _ = w.write_all(&discord_ipc_frame(1, &clear.to_string()));
                                                    let _ = w.flush();
                                                    let s = app.state::<AppState>();
                                                    *s.discord_handle.lock().unwrap() = None;
                                                    return;
                                                }
                                                Err(e) => {
                                                    eprintln!("[Discord RPC] Channel error: {}", e);
                                                    break;
                                                }
                                            }
                                        }

                                        reader_running.store(false, Ordering::Relaxed);
                                        {
                                            let mut w = writer.lock().unwrap();
                                            let clear = json!({
                                                "cmd": "SET_ACTIVITY",
                                                "args": { "pid": std::process::id(), "activity": null },
                                                "nonce": "ecl-clear"
                                            });
                                            let _ = w.write_all(&discord_ipc_frame(1, &clear.to_string()));
                                            let _ = w.flush();
                                        }
                                        let s = app.state::<AppState>();
                                        *s.discord_handle.lock().unwrap() = None;
                                        eprintln!("[Discord RPC] Disconnected, will reconnect...");
                                    } else {
                                        eprintln!("[Discord RPC] Did not receive READY event");
                                    }
                                } else {
                                    eprintln!("[Discord RPC] Invalid JSON in handshake response");
                                }
                            }
                            Ok(Err(e)) => {
                                eprintln!("[Discord RPC] Handshake read failed on pipe {}: {}", i, e);
                            }
                            Err(_) => {
                                eprintln!("[Discord RPC] Handshake timed out on pipe {}", i);
                            }
                        }
                        break;
                    }
                    Err(_) => continue,
                }
            }

            if !connected {
                eprintln!("[Discord RPC] Could not connect. Retrying in 10s (Discord or arRPC)...");
            }
            std::thread::sleep(std::time::Duration::from_secs(10));
        }
        eprintln!("[Discord RPC] Thread exiting");
    });

    json!({"success": true, "message": "Discord RPC started"})

        })
    }

#[tauri::command(async)]
fn update_discord_rpc(
    app: State<AppState>,
    details: String,
    state: String,
    large_image: String,
    large_text: String,
    small_image: String,
    small_text: String,
) -> Value {
        tokio::task::block_in_place(|| {
    let handle = app.discord_handle.lock().unwrap();
    if let Some(h) = handle.as_ref() {
        let _ = h.sender.send(DiscordMessage::Update {
            details,
            state,
            large_image,
            large_text,
            small_image,
            small_text,
        });
        json!({"success": true})
    } else {
        json!({"success": false, "message": "Discord RPC not initialized"})
    }

        })
    }

#[tauri::command(async)]
fn stop_discord_rpc(app: State<AppState>) -> Value {
        tokio::task::block_in_place(|| {
    let handle = app.discord_handle.lock().unwrap().take();
    if let Some(h) = handle {
        let _ = h.sender.send(DiscordMessage::Stop);
    }
    json!({"success": true})

        })
    }

#[tauri::command(async)]
fn get_discord_status(app: State<AppState>) -> Value {
        tokio::task::block_in_place(|| {
    let connected = app.discord_handle.lock().unwrap().is_some();
    let enabled = {
        let ds = load_json(&settings_file());
        ds.get("discord_rpc").and_then(|v| v.as_bool()).unwrap_or(true)
    };
    json!({"connected": connected, "enabled": enabled, "client_id": "1557369457397997618"})

        })
    }

#[tauri::command]
fn open_url(url: String) -> Value {
    let _ = webbrowser::open(&url);
    json!({"success": true})
}

// ==================== PERFORMANCE MODS ====================

/// Attempt to download a single mod from Modrinth by slug.
/// Returns (filename, true) on success, or ("", false) on failure.
fn download_mod_from_modrinth(
    slug: &str,
    display_name: &str,
    loader: &str,
    mc_version: &str,
    mods_dir: &Path,
    app: &State<AppState>,
) -> (String, bool) {
    let versions = get_modrinth_versions(slug.to_string(), Some(loader.to_string()), Some(mc_version.to_string()));
    let versions_arr = versions.as_array().cloned().unwrap_or_default();

    if versions_arr.is_empty() {
        log_msg(app, &format!("[PerfMods/WARN] No compatible version for '{}' ({})", display_name, slug));
        return ("".to_string(), false);
    }

    let target_version = &versions_arr[0];
    let files = target_version.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    let primary = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
        .unwrap_or(files.first().unwrap_or(&Value::Null));
    let filename = primary.get("filename").and_then(|f| f.as_str()).unwrap_or("mod.jar").to_string();
    let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");

    if download_url.is_empty() {
        log_msg(app, &format!("[PerfMods/WARN] No download URL for '{}' ({})", display_name, slug));
        return ("".to_string(), false);
    }

    let dest = mods_dir.join(&filename);
    if dest.exists() {
        log_msg(app, &format!("[PerfMods] '{}' already installed, skipping", display_name));
        return (filename, true);
    }

    match download_file_blocking(download_url, &dest) {
        Ok(()) => {
            log_msg(app, &format!("[PerfMods/OK] '{}' installed!", display_name));
            (filename, true)
        }
        Err(e) => {
            log_msg(app, &format!("[PerfMods/ERROR] '{}' failed: {}", display_name, e));
            ("".to_string(), false)
        }
    }
}

struct PerfMod {
    slug: &'static str,
    name: &'static str,
    desc: &'static str,
    fallback: Option<&'static str>,
    min_mc: Option<&'static str>,
}

// Ordered "essentials first". The head of this list is what every modded
// Fabric/Quilt profile gets automatically: Fabric API, Sodium, Lithium,
// Dynamic FPS, Mod Menu, then a stack of other FPS/optimisation mods.
const PERF_MODS_FABRIC: &[PerfMod] = &[
    PerfMod { slug: "sodium", name: "Sodium", desc: "Massive FPS boost rendering engine", fallback: Some("embeddium"), min_mc: None },
    PerfMod { slug: "lithium", name: "Lithium", desc: "General-purpose server+client optimization", fallback: None, min_mc: None },
    PerfMod { slug: "dynamic-fps", name: "Dynamic FPS", desc: "Cuts FPS while the window is unfocused", fallback: None, min_mc: None },
    PerfMod { slug: "modmenu", name: "Mod Menu", desc: "In-game mod configuration menu", fallback: None, min_mc: None },
    PerfMod { slug: "ferrite-core", name: "FerriteCore", desc: "Memory usage optimization", fallback: None, min_mc: None },
    PerfMod { slug: "entityculling", name: "EntityCulling", desc: "Skips rendering hidden entities", fallback: None, min_mc: None },
    PerfMod { slug: "immediatelyfast", name: "ImmediatelyFast", desc: "Immediate-mode rendering optimizations", fallback: None, min_mc: None },
    PerfMod { slug: "moreculling", name: "MoreCulling", desc: "Culls hidden blocks for FPS", fallback: None, min_mc: None },
    PerfMod { slug: "modernfix", name: "ModernFix", desc: "Performance and memory fixes", fallback: None, min_mc: None },
    PerfMod { slug: "krypton", name: "Krypton", desc: "Network stack optimization", fallback: None, min_mc: None },
    PerfMod { slug: "memoryleakfix", name: "MemoryLeakFix", desc: "Fixes memory leaks in Minecraft", fallback: None, min_mc: None },
    PerfMod { slug: "starlight", name: "Starlight", desc: "Rewrites the light engine for performance", fallback: None, min_mc: None },
    PerfMod { slug: "badoptimizations", name: "BadOptimizations", desc: "Micro-optimizations across the game loop", fallback: None, min_mc: Some("1.19") },
    PerfMod { slug: "threadtweak", name: "ThreadTweak", desc: "Improves the game's thread scheduling", fallback: None, min_mc: None },
    PerfMod { slug: "noisium", name: "Noisium", desc: "World generation speed optimization", fallback: None, min_mc: Some("1.20") },
    PerfMod { slug: "c2me-fabric", name: "C2ME", desc: "Concurrent chunk management engine", fallback: None, min_mc: None },
    PerfMod { slug: "enhancedblockentities", name: "Enhanced Block Entities", desc: "Optimized block entity rendering", fallback: None, min_mc: None },
    PerfMod { slug: "lazydfu", name: "LazyDFU", desc: "Makes DataFixerUpper lazy for faster startup", fallback: None, min_mc: None },
    PerfMod { slug: "nvidium", name: "Nvidium", desc: "NVIDIA GPU optimizations (requires Sodium)", fallback: None, min_mc: Some("1.20") },
];

const PERF_MODS_FORGE: &[PerfMod] = &[
    PerfMod { slug: "embeddium", name: "Embeddium", desc: "Sodium port for Forge", fallback: Some("optiforge"), min_mc: None },
    PerfMod { slug: "lithium", name: "Lithium", desc: "General-purpose optimization", fallback: None, min_mc: None },
    PerfMod { slug: "starlight", name: "Starlight", desc: "Light engine rewrite", fallback: None, min_mc: None },
    PerfMod { slug: "ferrite-core", name: "FerriteCore", desc: "Memory optimization", fallback: None, min_mc: None },
    PerfMod { slug: "memoryleakfix", name: "MemoryLeakFix", desc: "Memory leak fixes", fallback: None, min_mc: None },
    PerfMod { slug: "entityculling", name: "EntityCulling", desc: "Skip rendering hidden entities", fallback: None, min_mc: None },
    PerfMod { slug: "modernfix", name: "ModernFix", desc: "Performance fixes", fallback: None, min_mc: None },
    PerfMod { slug: "performant", name: "Performant", desc: "Entity/particle optimization", fallback: None, min_mc: None },
    PerfMod { slug: "fastchest", name: "FastChest", desc: "Optimized chest rendering", fallback: None, min_mc: None },
    PerfMod { slug: "noisium", name: "Noisium", desc: "World gen speed boost", fallback: None, min_mc: Some("1.20") },
    PerfMod { slug: "enhancedblockentities", name: "Enhanced Block Entities", desc: "Optimized block entities", fallback: None, min_mc: None },
    PerfMod { slug: "lazydfu", name: "LazyDFU", desc: "Faster startup", fallback: None, min_mc: None },
    PerfMod { slug: "krypton-reforged", name: "Krypton Reforged", desc: "Network optimization", fallback: None, min_mc: None },
    PerfMod { slug: "moreculling", name: "MoreCulling", desc: "Cull hidden blocks", fallback: None, min_mc: None },
    PerfMod { slug: "alternate-current", name: "Alternate Current", desc: "Optimized redstone", fallback: None, min_mc: None },
    PerfMod { slug: "clustered", name: "Clustered", desc: "Chunk batching optimization", fallback: None, min_mc: None },
    PerfMod { slug: "radon", name: "Radon", desc: "Memory optimization", fallback: None, min_mc: None },
    PerfMod { slug: "booptimize", name: "BooOptimize", desc: "Entity rendering optimization", fallback: None, min_mc: None },
    PerfMod { slug: "smooth-boot", name: "Smooth Boot", desc: "Optimized thread scheduling", fallback: None, min_mc: None },
];

fn mc_version_at_least(mc_version: &str, required: &str) -> bool {
    let parts_a: Vec<i32> = mc_version.split('.').filter_map(|s| s.parse().ok()).collect();
    let parts_b: Vec<i32> = required.split('.').filter_map(|s| s.parse().ok()).collect();
    for i in 0..3.max(parts_a.len()).max(parts_b.len()) {
        let a = parts_a.get(i).copied().unwrap_or(0);
        let b = parts_b.get(i).copied().unwrap_or(0);
        if a > b { return true; }
        if a < b { return false; }
    }
    true
}

/// Result of trying to auto-install a single performance mod.
enum PerfInstall {
    /// Jar downloaded (or already present).
    Installed,
    /// No build exists for this exact loader + MC version, so nothing was
    /// written. Never install an incompatible jar — just skip it.
    Skipped,
    /// A compatible build existed but the download itself failed.
    Failed,
}

/// Smart install: resolves the newest Modrinth build that supports the exact
/// loader + Minecraft version, and only then downloads it. If nothing matches,
/// the mod is SKIPPED (never dumped into `/mods`) so we can't break the game.
fn install_perf_mod(
    slug: &str,
    display_name: &str,
    modrinth_loader: &str,
    mc_version: &str,
    mods_dir: &Path,
    app: &State<AppState>,
) -> PerfInstall {
    let versions = get_modrinth_versions(
        slug.to_string(),
        if modrinth_loader.is_empty() { None } else { Some(modrinth_loader.to_string()) },
        if mc_version.is_empty() { None } else { Some(mc_version.to_string()) },
    );
    let versions_arr = versions.as_array().cloned().unwrap_or_default();
    if versions_arr.is_empty() {
        log_msg(app, &format!(
            "[PerfMods/SKIP] '{}' has no {} build for MC {} — not installed",
            display_name, modrinth_loader, mc_version
        ));
        return PerfInstall::Skipped;
    }

    let target_version = &versions_arr[0];
    let files = target_version.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    let primary = files.iter()
        .find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
        .unwrap_or(files.first().unwrap_or(&Value::Null));
    let filename = primary.get("filename").and_then(|f| f.as_str()).unwrap_or("mod.jar").to_string();
    let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");
    if download_url.is_empty() {
        log_msg(app, &format!("[PerfMods/SKIP] '{}' has no downloadable file", display_name));
        return PerfInstall::Skipped;
    }

    let dest = mods_dir.join(&filename);
    if dest.exists() {
        log_msg(app, &format!("[PerfMods] '{}' already installed, skipping", display_name));
        return PerfInstall::Installed;
    }

    match download_file_blocking(download_url, &dest) {
        Ok(()) => {
            log_msg(app, &format!("[PerfMods/OK] '{}' installed", display_name));
            PerfInstall::Installed
        }
        Err(e) => {
            log_msg(app, &format!("[PerfMods/ERROR] '{}' download failed: {}", display_name, e));
            PerfInstall::Failed
        }
    }
}

/// Auto-installs the curated FPS/optimisation mod stack for a modded instance.
/// Runs after any Fabric/Quilt/Forge/NeoForge instance is created & installed.
#[tauri::command(async)]
fn install_performance_mods(app: State<AppState>, instance_name: String, mc_version: String, loader: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[PerfMods] Auto-installing FPS mods for '{}' ({} {})...", instance_name, loader, mc_version));

    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);

    let loader_lower = loader.to_lowercase();
    let is_fabric_like = matches!(loader_lower.as_str(), "fabric" | "quilt");
    let is_forge_like = matches!(loader_lower.as_str(), "forge" | "neoforge");

    if !is_fabric_like && !is_forge_like {
        return json!({
            "success": true, "installed": 0, "total": 0, "skipped": 0, "errors": 0,
            "message": "Performance mods are only auto-installed for Fabric, Quilt, Forge and NeoForge."
        });
    }

    // Modrinth loader facet. Quilt runs Fabric mods, so use the fabric facet;
    // NeoForge has its own facet; Forge uses "forge".
    let modrinth_loader: &str = match loader_lower.as_str() {
        "quilt" => "fabric",
        "neoforge" => "neoforge",
        "forge" => "forge",
        _ => "fabric",
    };

    let mut installed = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    macro_rules! tally {
        ($r:expr) => {
            match $r {
                PerfInstall::Installed => installed += 1,
                PerfInstall::Skipped => skipped += 1,
                PerfInstall::Failed => failed += 1,
            }
        };
    }

    let perf_mods = if is_fabric_like { PERF_MODS_FABRIC } else { PERF_MODS_FORGE };
    let mut total = perf_mods.len() as u32;

    // Step 1 — required API dependency (Fabric API powers most Fabric mods).
    if is_fabric_like {
        log_msg(&app, "[PerfMods] Installing Fabric API...");
        total += 1;
        tally!(install_perf_mod("fabric-api", "Fabric API", "fabric", &mc_version, &mods_dir, &app));
    }

    // Step 2 — the FPS/optimisation stack, with version-aware fallbacks.
    for pm in perf_mods.iter() {
        if let Some(min_ver) = pm.min_mc {
            if !mc_version_at_least(&mc_version, min_ver) {
                log_msg(&app, &format!("[PerfMods] '{}' needs MC {}+, trying fallback...", pm.name, min_ver));
                if let Some(fallback_slug) = pm.fallback {
                    tally!(install_perf_mod(fallback_slug, &format!("{} (fallback)", pm.name), modrinth_loader, &mc_version, &mods_dir, &app));
                } else {
                    skipped += 1;
                }
                continue;
            }
        }

        log_msg(&app, &format!("[PerfMods] Installing {}...", pm.name));
        let r = install_perf_mod(pm.slug, pm.name, modrinth_loader, &mc_version, &mods_dir, &app);
        match r {
            PerfInstall::Installed => installed += 1,
            PerfInstall::Skipped => {
                // Not available for this MC version/loader: try the fallback if any.
                if let Some(fallback_slug) = pm.fallback {
                    tally!(install_perf_mod(fallback_slug, &format!("{} (fallback)", pm.name), modrinth_loader, &mc_version, &mods_dir, &app));
                } else {
                    skipped += 1;
                }
            }
            PerfInstall::Failed => {
                if let Some(fallback_slug) = pm.fallback {
                    tally!(install_perf_mod(fallback_slug, &format!("{} (fallback)", pm.name), modrinth_loader, &mc_version, &mods_dir, &app));
                } else {
                    failed += 1;
                }
            }
        }
    }

    log_msg(&app, &format!(
        "[PerfMods] Done: {} installed, {} skipped (unsupported version), {} failed (of {})",
        installed, skipped, failed, total
    ));
    json!({
        "success": true,
        "installed": installed,
        "total": total,
        "skipped": skipped,
        "errors": failed,
        "message": format!("Installed {} FPS mods ({} unsupported for this version were skipped)", installed, skipped)
    })

        })
    }

// ==================== PUBLIC IP (for public server listing) ====================
/// Resolve this machine's public IP so a user's public server can be listed
/// with a joinable address for the website server list.
#[tauri::command(async)]
fn get_public_ip() -> Value {
        tokio::task::block_in_place(|| {
    // JSON endpoint first (parses cleanly with our HTTP helper).
    if let Ok(v) = http_get("https://api.ipify.org?format=json", None) {
        if let Some(ip) = v.get("ip").and_then(|i| i.as_str()) {
            if !ip.trim().is_empty() {
                return json!({"success": true, "ip": ip.trim()});
            }
        }
    }
    // Plain-text fallbacks.
    for url in ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"] {
        let client = match reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(8))
            .build()
        {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Ok(resp) = client.get(url).send() {
            if let Ok(text) = resp.text() {
                let t = text.trim().to_string();
                if !t.is_empty() && t.len() <= 45 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == ':' || c == '-') {
                    return json!({"success": true, "ip": t});
                }
            }
        }
    }
    json!({"success": false, "error": "Could not determine public IP — check your internet connection."})

        })
    }

// ==================== MOD PROFILES ====================
fn mod_profiles_file() -> PathBuf { app_dir().join("mod_profiles.json") }

#[tauri::command(async)]
fn save_mod_profile(app: State<AppState>, name: String, instance_name: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[Profiles] Saving mod profile '{}' from '{}'...", name, instance_name));
    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let mut mods = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            let clean_name = fname.trim_end_matches(".disabled");
            if !clean_name.ends_with(".jar") { continue; }

            let display_name = clean_name.trim_end_matches(".jar").to_string();
            let slug = display_name.to_lowercase().replace('_', "-").replace(' ', "-");

            let mut slug_found = String::new();

            let search_url = format!("{}/search?query={}&facets={}&limit=1",
                MODRINTH_API,
                urlencoding::encode(&display_name),
                urlencoding::encode(&serde_json::to_string(&vec![vec!["project_type:mod".to_string()]]).unwrap_or_default()));
            if let Ok(data) = http_get(&search_url, None) {
                if let Some(hits) = data.get("hits").and_then(|h| h.as_array()) {
                    if let Some(hit) = hits.first() {
                        if let Some(s) = hit.get("slug").and_then(|s| s.as_str()) {
                            slug_found = s.to_string();
                        }
                    }
                }
            }

            let final_slug = if slug_found.is_empty() { slug } else { slug_found };

            mods.push(json!({
                "slug": final_slug,
                "version_id": "",
                "filename": clean_name,
            }));
        }
    }

    let profiles_path = mod_profiles_file();
    let mut profiles: Vec<Value> = load_json(&profiles_path).as_array().cloned().unwrap_or_default();
    profiles.retain(|p| p.get("name").and_then(|n| n.as_str()) != Some(&name));
    profiles.push(json!({
        "name": name,
        "created": chrono::Local::now().to_rfc3339(),
        "instance_source": instance_name,
        "mods": mods,
    }));
    save_json(&profiles_path, &Value::Array(profiles.clone()));
    log_msg(&app, &format!("[Profiles/OK] Profile '{}' saved with {} mods", name, mods.len()));
    json!({"success": true, "mods_count": mods.len()})

        })
    }

#[tauri::command]
fn load_mod_profiles() -> Value {
    let profiles_path = mod_profiles_file();
    load_json(&profiles_path).as_array().cloned().map(Value::Array).unwrap_or_else(|| Value::Array(vec![]))
}

#[tauri::command]
fn delete_mod_profile(name: String) -> Value {
    let profiles_path = mod_profiles_file();
    let mut profiles: Vec<Value> = load_json(&profiles_path).as_array().cloned().unwrap_or_default();
    let before = profiles.len();
    profiles.retain(|p| p.get("name").and_then(|n| n.as_str()) != Some(&name));
    save_json(&profiles_path, &Value::Array(profiles.clone()));
    json!({"success": true, "removed": before > profiles.len()})
}

#[tauri::command(async)]
fn apply_mod_profile(app: State<AppState>, name: String, instance_name: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[Profiles] Applying profile '{}' to '{}'...", name, instance_name));
    let profiles_path = mod_profiles_file();
    let profiles: Vec<Value> = load_json(&profiles_path).as_array().cloned().unwrap_or_default();
    let profile = match profiles.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some(&name)) {
        Some(p) => p.clone(),
        None => return json!({"error": "Profile not found"}),
    };

    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);

    let profile_mods = profile.get("mods").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    let mut installed = 0u32;
    let mut errors = 0u32;

    for mod_entry in &profile_mods {
        let slug = mod_entry.get("slug").and_then(|s| s.as_str()).unwrap_or("");
        let version_id = mod_entry.get("version_id").and_then(|v| v.as_str()).unwrap_or("");
        if slug.is_empty() { errors += 1; continue; }

        log_msg(&app, &format!("[Profiles] Installing '{}'...", slug));
        let versions_url = if version_id.is_empty() {
            format!("{}/project/{}/version", MODRINTH_API, slug)
        } else {
            format!("{}/project/{}/version?ids=[\"{}\"]", MODRINTH_API, slug, version_id)
        };

        let versions = http_get(&versions_url, None).unwrap_or(Value::Array(vec![]));
        let versions_arr = versions.as_array().cloned().unwrap_or_default();
        if versions_arr.is_empty() {
            log_msg(&app, &format!("[Profiles/WARN] No versions found for '{}'", slug));
            errors += 1;
            continue;
        }

        let target_version = &versions_arr[0];
        let files = target_version.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
        let primary = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
            .unwrap_or(files.first().unwrap_or(&Value::Null));
        let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");

        if download_url.is_empty() {
            errors += 1;
            continue;
        }

        let dest = mods_dir.join(primary.get("filename").and_then(|f| f.as_str()).unwrap_or("mod.jar"));
        if dest.exists() { installed += 1; continue; }

        match download_file_blocking(download_url, &dest) {
            Ok(()) => {
                log_msg(&app, &format!("[Profiles/OK] '{}' installed!", slug));
                installed += 1;
            }
            Err(e) => {
                log_msg(&app, &format!("[Profiles/ERROR] '{}' failed: {}", slug, e));
                errors += 1;
            }
        }
    }

    log_msg(&app, &format!("[Profiles] Done: {}/{} installed, {} errors", installed, profile_mods.len(), errors));
    json!({
        "success": true,
        "installed": installed,
        "total": profile_mods.len(),
        "errors": errors,
    })

        })
    }

// ==================== MOD UPDATES ====================
#[tauri::command(async)]
fn check_mod_updates(app: State<AppState>, instance_name: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[ModUpdates] Checking updates for '{}'...", instance_name));
    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let mut updates = Vec::new();
    let mut checked = 0u32;

    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(8))
        .build();
    let client = match client { Ok(c) => c, Err(_) => return json!({"success": true, "updates": [], "total_checked": 0}) };

    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            let clean_name = fname.trim_end_matches(".disabled");
            if !clean_name.ends_with(".jar") { continue; }

            let display_name = clean_name.trim_end_matches(".jar").to_string();
            let slug = display_name.to_lowercase().replace('_', "-").replace(' ', "-");

            checked += 1;

            let project_url = format!("{}/project/{}", MODRINTH_API, slug);
            let project_data = match client.get(&project_url).send().and_then(|r| r.text()) {
                Ok(text) => serde_json::from_str::<Value>(&text).ok(),
                Err(_) => {
                    let search_url = format!("{}/search?query={}&facets={}&limit=1",
                        MODRINTH_API,
                        urlencoding::encode(&display_name),
                        urlencoding::encode(&serde_json::to_string(&vec![vec!["project_type:mod".to_string()]]).unwrap_or_default()));
                    match client.get(&search_url).send().and_then(|r| r.text()) {
                        Ok(text) => {
                            let data: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                            if let Some(hit) = data.get("hits").and_then(|h| h.as_array()).and_then(|hits| hits.first()) {
                                let found_slug = hit.get("slug").and_then(|s| s.as_str()).unwrap_or(&slug);
                                if found_slug != slug {
                                    let url2 = format!("{}/project/{}", MODRINTH_API, found_slug);
                                    client.get(&url2).send().and_then(|r| r.text()).ok()
                                        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                                } else { None }
                            } else { None }
                        }
                        Err(_) => None,
                    }
                }
            };

            let project_slug = project_data.as_ref()
                .and_then(|p| p.get("slug").and_then(|s| s.as_str()))
                .unwrap_or(&slug)
                .to_string();

            let versions_url = format!("{}/project/{}/version", MODRINTH_API, project_slug);
            let versions = match client.get(&versions_url).send().and_then(|r| r.text()) {
                Ok(text) => serde_json::from_str::<Value>(&text).unwrap_or(Value::Null),
                Err(_) => continue,
            };
            let versions_arr = match versions.as_array() {
                Some(a) => a,
                None => continue,
            };
            if versions_arr.is_empty() { continue; }

            let latest = &versions_arr[0];
            let latest_files = latest.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
            let latest_primary = latest_files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
                .unwrap_or(latest_files.first().unwrap_or(&Value::Null));
            let latest_filename = latest_primary.get("filename").and_then(|f| f.as_str()).unwrap_or("");
            let latest_url = latest_primary.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let latest_version_id = latest.get("version_id").and_then(|v| v.as_str()).unwrap_or("");
            let latest_version_number = latest.get("version_number").and_then(|v| v.as_str()).unwrap_or("");

            if !latest_filename.is_empty() && latest_filename != clean_name {
                updates.push(json!({
                    "slug": project_slug,
                    "filename": clean_name,
                    "current_version": clean_name,
                    "latest_version": latest_version_number,
                    "latest_version_id": latest_version_id,
                    "latest_filename": latest_filename,
                    "download_url": latest_url,
                }));
            }
        }
    }

    log_msg(&app, &format!("[ModUpdates] Checked {} mods, found {} update(s)", checked, updates.len()));
    json!({"success": true, "updates": updates, "total_checked": checked})

        })
    }

// ==================== CRASH LOG ANALYZER ====================
#[tauri::command]
fn analyze_crash_log(instance_name: String) -> Value {
    let inst_dir = instances_dir().join(&instance_name);

    let mut crash_logs = Vec::new();
    let crash_dir = inst_dir.join("crash-reports");
    if let Ok(entries) = std::fs::read_dir(&crash_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("crash-") && name.ends_with(".txt") {
                let meta = entry.metadata().ok();
                let modified = meta.as_ref().and_then(|m| m.modified().ok())
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
                    .unwrap_or(0);
                crash_logs.push((name, entry.path(), modified));
            }
        }
    }

    let logs_dir = inst_dir.join("logs");
    if let Ok(entries) = std::fs::read_dir(&logs_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("crash-") && (name.ends_with(".txt") || name.ends_with(".log")) {
                let meta = entry.metadata().ok();
                let modified = meta.as_ref().and_then(|m| m.modified().ok())
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
                    .unwrap_or(0);
                crash_logs.push((name, entry.path(), modified));
            }
        }
    }

    crash_logs.sort_by(|a, b| b.2.cmp(&a.2));

    let most_recent = crash_logs.first().map(|(_, path, _)| {
        let content = std::fs::read_to_string(path).unwrap_or_default();
        let lines: Vec<&str> = content.lines().collect();
        let start = if lines.len() > 500 { lines.len() - 500 } else { 0 };
        lines[start..].join("\n")
    });

    let latest_log_path = logs_dir.join("latest.log");
    let recent_errors = if latest_log_path.exists() {
        let content = std::fs::read_to_string(&latest_log_path).unwrap_or_default();
        let error_lines: Vec<&str> = content.lines()
            .filter(|line| line.contains("ERROR") || line.contains("Exception") || line.contains("FATAL") || line.contains("CRITICAL"))
            .collect();
        let start = if error_lines.len() > 100 { error_lines.len() - 100 } else { 0 };
        error_lines[start..].join("\n")
    } else {
        String::new()
    };

    json!({
        "success": true,
        "crash_log": most_recent.unwrap_or_default(),
        "crash_file": crash_logs.first().map(|(name, _, _)| name.clone()).unwrap_or_default(),
        "recent_errors": recent_errors,
        "crash_count": crash_logs.len(),
    })
}

// ==================== MOD DEPENDENCY RESOLVER ====================
#[tauri::command(async)]
fn resolve_mod_dependencies(app: State<AppState>, instance_name: String, slug: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[Deps] Resolving dependencies for '{}' in '{}'...", slug, instance_name));
    let project_url = format!("{}/project/{}", MODRINTH_API, slug);
    let project = match http_get(&project_url, None) {
        Ok(p) => p,
        Err(e) => return json!({"error": e}),
    };

    let deps = match project.get("dependencies").and_then(|d| d.as_array()) {
        Some(d) => d.clone(),
        None => return json!({"success": true, "installed": 0, "message": "No dependencies found"}),
    };

    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);

    let mut installed_deps = Vec::new();
    let mut errors = 0u32;

    for dep in &deps {
        let dep_slug = dep.get("project_id").and_then(|s| s.as_str()).unwrap_or("");
        let dep_file_name = dep.get("file_name").and_then(|s| s.as_str());
        let dep_version_id = dep.get("version_id").and_then(|s| s.as_str());
        let dependency_type = dep.get("dependency_type").and_then(|s| s.as_str()).unwrap_or("required");

        if dep_slug.is_empty() || dependency_type == "incompatible" || dependency_type == "optional" {
            continue;
        }

        if dep_file_name.is_some() || dep_version_id.is_some() {
            let versions_url = if let Some(vid) = dep_version_id {
                format!("{}/version/{}", MODRINTH_API, vid)
            } else {
                format!("{}/project/{}/version", MODRINTH_API, dep_slug)
            };

            let version_data = match http_get(&versions_url, None) {
                Ok(v) => v,
                Err(_) => { errors += 1; continue; }
            };

            let files = if let Some(arr) = version_data.as_array() {
                if let Some(first) = arr.first() {
                    first.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default()
                } else {
                    version_data.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default()
                }
            } else {
                version_data.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default()
            };

            let primary = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
                .unwrap_or(files.first().unwrap_or(&Value::Null));
            let filename = primary.get("filename").and_then(|f| f.as_str()).unwrap_or("mod.jar");
            let download_url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");

            if download_url.is_empty() { errors += 1; continue; }
            let dest = mods_dir.join(filename);
            if dest.exists() {
                installed_deps.push(json!({"slug": dep_slug, "filename": filename, "status": "already_installed"}));
                continue;
            }

            match download_file_blocking(download_url, &dest) {
                Ok(()) => {
                    log_msg(&app, &format!("[Deps/OK] Dependency '{}' installed!", dep_slug));
                    installed_deps.push(json!({"slug": dep_slug, "filename": filename, "status": "installed"}));
                }
                Err(e) => {
                    log_msg(&app, &format!("[Deps/ERROR] '{}' failed: {}", dep_slug, e));
                    errors += 1;
                }
            }
        } else {
            let (filename, ok) = download_mod_from_modrinth(dep_slug, dep_slug, "", "", &mods_dir, &app);
            if ok {
                installed_deps.push(json!({"slug": dep_slug, "filename": filename, "status": "installed"}));
            } else {
                errors += 1;
            }
        }
    }

    log_msg(&app, &format!("[Deps] Done: {} installed, {} errors", installed_deps.len(), errors));
    json!({
        "success": true,
        "installed": installed_deps,
        "errors": errors,
    })

        })
    }

// ==================== RESOURCE PACK AUTO-ENABLE ====================
#[tauri::command]
fn auto_enable_resourcepack(instance_name: String, filename: String) -> Value {
    let inst_dir = instances_dir().join(&instance_name);
    let options_path = inst_dir.join("options.txt");

    let mut options_content = if options_path.exists() {
        std::fs::read_to_string(&options_path).unwrap_or_default()
    } else {
        String::new()
    };

    let enabled_entry = format!(":\"{}\"", filename);

    if options_content.contains(&enabled_entry) {
        return json!({"success": true, "message": "Resource pack already enabled"});
    }

    let rp_key = "resourcePacks";
    if let Some(pos) = options_content.find(rp_key) {
        let after_key = &options_content[pos + rp_key.len()..];
        if let Some(bracket_start) = after_key.find('[') {
            let bracket_rel = pos + rp_key.len() + bracket_start;
            if let Some(bracket_end) = options_content[bracket_rel..].find(']') {
                let bracket_abs = bracket_rel + bracket_end;
                let inner = &options_content[bracket_rel + 1..bracket_abs];
                let existing_packs: Vec<&str> = inner.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                let mut new_packs: Vec<String> = Vec::new();
                for pack in &existing_packs {
                    new_packs.push(pack.to_string());
                }
                let new_entry = format!(":\"{}\"", filename);
                if !new_packs.iter().any(|p| p.contains(&filename)) {
                    new_packs.push(new_entry);
                }
                let new_inner = new_packs.join(", ");
                let before = &options_content[..bracket_rel + 1];
                let after = &options_content[bracket_abs..];
                options_content = format!("{}{}{}", before, new_inner, after);
            }
        }
    } else {
        let new_rp = format!("\nresourcePacks:[:{}]\n", filename);
        options_content.push_str(&new_rp);
    }

    match std::fs::write(&options_path, &options_content) {
        Ok(()) => json!({"success": true, "message": format!("'{}' enabled in resource packs", filename)}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

// ==================== EXPORT INSTANCE AS MRPACK ====================
#[tauri::command(async)]
fn export_instance_mrpack(app: State<AppState>, instance_name: String, name: String, version_id: String, output_path: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, &format!("[Export] Exporting '{}' as .mrpack...", instance_name));
    let inst_dir = instances_dir().join(&instance_name);

    let mut index_files = Vec::new();
    let mods_dir = inst_dir.join("mods");
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if !fname.ends_with(".jar") || fname.ends_with(".disabled") { continue; }

            let slug = fname.trim_end_matches(".jar").trim_end_matches(".disabled")
                .to_lowercase().replace('_', "-").replace(' ', "-");

            let mut downloads = Vec::new();

            let versions_url = format!("{}/project/{}/version", MODRINTH_API, slug);
            if let Ok(versions) = http_get(&versions_url, None) {
                if let Some(arr) = versions.as_array() {
                    for v in arr.iter().take(5) {
                        if let Some(files) = v.get("files").and_then(|f| f.as_array()) {
                            for file in files {
                                if file.get("filename").and_then(|f| f.as_str()) == Some(&fname) {
                                    if let Some(url) = file.get("url").and_then(|u| u.as_str()) {
                                        downloads.push(url.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }

            index_files.push(json!({
                "path": format!("mods/{}", fname),
                "hashes": {},
                "downloads": downloads,
                "file_size": entry.metadata().ok().map(|m| m.len()).unwrap_or(0),
            }));
        }
    }

    let modrinth_index = json!({
        "formatVersion": 1,
        "game": "minecraft",
        "version_id": if version_id.is_empty() { format!("{}-{}", name, chrono::Local::now().format("%Y%m%d")) } else { version_id },
        "name": name,
        "summary": format!("Exported from Xryloth"),
        "dependencies": {},
        "files": index_files,
    });

    let file = match std::fs::File::create(&output_path) {
        Ok(f) => f,
        Err(e) => {
            // Make sure the target folder exists before giving up.
            if let Some(parent) = Path::new(&output_path).parent() {
                let _ = std::fs::create_dir_all(parent);
                match std::fs::File::create(&output_path) {
                    Ok(f) => f,
                    Err(e2) => return json!({"error": format!("{} (folder: {})", e, e2)}),
                }
            } else {
                return json!({"error": e.to_string()});
            }
        }
    };

    let mut zip = zip::ZipWriter::new(file);

    let options = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    if zip.start_file("modrinth.index.json", options.clone()).is_ok() {
        let _ = zip.write_all(serde_json::to_string_pretty(&modrinth_index).unwrap_or_default().as_bytes());
    }

    fn add_dir_to_zip_recursive(zip: &mut zip::ZipWriter<std::fs::File>, dir: &Path, prefix: &str, options: &zip::write::FileOptions) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if path.is_dir() {
                    add_dir_to_zip_recursive(zip, &path, &format!("{}/{}", prefix, name), options);
                } else if let Ok(mut file) = std::fs::File::open(&path) {
                    let archive_path = format!("{}/{}", prefix, name);
                    if zip.start_file(&archive_path, options.clone()).is_ok() {
                        let mut buf = Vec::new();
                        let _ = file.read_to_end(&mut buf);
                        let _ = zip.write_all(&buf);
                    }
                }
            }
        }
    }

    let config_dir = inst_dir.join("config");
    if config_dir.exists() {
        add_dir_to_zip_recursive(&mut zip, &config_dir, "overrides/config", &options);
    }
    let kubejs_dir = inst_dir.join("kubejs");
    if kubejs_dir.exists() {
        add_dir_to_zip_recursive(&mut zip, &kubejs_dir, "overrides/kubejs", &options);
    }

    let _ = zip.finish();
    log_msg(&app, &format!("[Export/OK] Exported to {}", output_path));
    json!({"success": true, "path": output_path, "mods_count": index_files.len()})

        })
    }

// ==================== MOD CONFLICT DETECTION ====================
#[tauri::command]
fn detect_mod_conflicts(instance_name: String) -> Value {
    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let mut installed_slugs: Vec<String> = Vec::new();
    let mut installed_names: Vec<String> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            let clean = fname.trim_end_matches(".disabled");
            if !clean.ends_with(".jar") { continue; }
            let name = clean.trim_end_matches(".jar").to_string();
            installed_names.push(name.to_lowercase());
        }
    }

    fn slug_from_name(name: &str) -> String {
        name.replace('_', "-").replace(' ', "-").to_lowercase()
    }

    for n in &installed_names {
        installed_slugs.push(slug_from_name(n));
    }

    struct ConflictRule {
        mod1_keywords: &'static [&'static str],
        mod2_keywords: &'static [&'static str],
        reason: &'static str,
        severity: &'static str,
    }

    let rules: Vec<ConflictRule> = vec![
        ConflictRule {
            mod1_keywords: &["optifine", "optifabric", "optiforge"],
            mod2_keywords: &["sodium", "embeddium"],
            reason: "OptiFine and Sodium/Embeddium are incompatible rendering engines",
            severity: "high",
        },
        ConflictRule {
            mod1_keywords: &["optifine", "optifabric", "optiforge"],
            mod2_keywords: &["lithium"],
            reason: "OptiFine and Lithium may conflict on optimization paths",
            severity: "medium",
        },
        ConflictRule {
            mod1_keywords: &["sodium"],
            mod2_keywords: &["embeddium"],
            reason: "Sodium and Embeddium are both rendering engines - only one can run",
            severity: "high",
        },
        ConflictRule {
            mod1_keywords: &["starlight"],
            mod2_keywords: &["phosphor"],
            reason: "Starlight and Phosphor both rewrite the light engine",
            severity: "high",
        },
        ConflictRule {
            mod1_keywords: &["sodium"],
            mod2_keywords: &["optifine"],
            reason: "Sodium conflicts with OptiFine rendering engine",
            severity: "high",
        },
        ConflictRule {
            mod1_keywords: &["lithium"],
            mod2_keywords: &["phosphor"],
            reason: "Lithium and Phosphor may overlap in optimization areas",
            severity: "low",
        },
        ConflictRule {
            mod1_keywords: &["modernfix"],
            mod2_keywords: &["optifine"],
            reason: "ModernFix and OptiFine may have overlapping fixes",
            severity: "low",
        },
    ];

    let mut conflicts = Vec::new();

    for rule in &rules {
        let has_mod1 = installed_slugs.iter().any(|s| rule.mod1_keywords.iter().any(|k| s.contains(k)));
        let has_mod2 = installed_slugs.iter().any(|s| rule.mod2_keywords.iter().any(|k| s.contains(k)));

        if has_mod1 && has_mod2 {
            let name1 = rule.mod1_keywords.iter()
                .find(|k| installed_slugs.iter().any(|s| s.contains(*k)))
                .unwrap_or(&"").to_string();
            let name2 = rule.mod2_keywords.iter()
                .find(|k| installed_slugs.iter().any(|s| s.contains(*k)))
                .unwrap_or(&"").to_string();

            conflicts.push(json!({
                "mod1": name1,
                "mod2": name2,
                "reason": rule.reason,
                "severity": rule.severity,
            }));
        }
    }

    json!({"success": true, "conflicts": conflicts, "total": conflicts.len()})
}

// ==================== FIRST-LAUNCH WIZARD ====================
#[tauri::command]
fn check_first_launch() -> Value {
    let wizard_done = app_dir().join(".wizard_done");
    json!({"first_launch": !wizard_done.exists()})
}

#[tauri::command]
fn complete_first_launch(app: State<AppState>) -> Value {
    let wizard_done = app_dir().join(".wizard_done");
    let _ = std::fs::write(&wizard_done, "done");
    log_msg(&app, "[Wizard] First-launch wizard completed");
    json!({"success": true})
}

// ==================== JAVA VERSION DETECTION & AUTO-DOWNLOAD ====================
fn java_dir() -> PathBuf { app_dir().join("java") }

fn get_java_major_version(java_path: &str) -> Option<u32> {
    // First check PE header to avoid executing wrong-arch binary
    if !java_path.is_empty() {
        if let Some(arch) = get_exe_arch_from_pe_header(java_path) {
            let host = get_host_arch().to_string();
            if arch != host {
                return None;
            }
        }
    }

    let mut cmd = hidden_cmd(java_path);
    cmd.arg("-version");
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().ok()?;
    let timeout = std::time::Duration::from_secs(5);
    let start = std::time::Instant::now();
    loop {
        if let Ok(Some(_)) = child.try_wait() { break; }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let output = child.wait_with_output().ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}{}", stderr, stdout);
    for line in combined.lines() {
        let lower = line.to_lowercase();
        if lower.contains("version") {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start+1..].find('"') {
                    let ver_str = &line[start+1..start+1+end];
                    let parts: Vec<&str> = ver_str.split('.').collect();
                    if let Some(first) = parts.first() {
                        if let Ok(major) = first.parse::<u32>() {
                            return Some(major);
                        }
                    }
                }
            }
        }
    }
    None
}

fn get_exe_arch_from_pe_header(exe_path: &str) -> Option<String> {
    let data = std::fs::read(exe_path).ok()?;
    if data.len() < 0x40 { return None; }
    let pe_offset = u32::from_le_bytes([data[0x3C], data[0x3D], data[0x3E], data[0x3F]]) as usize;
    if pe_offset + 6 > data.len() { return None; }
    if &data[pe_offset..pe_offset+4] != b"PE\0\0" { return None; }
    let machine = u16::from_le_bytes([data[pe_offset+4], data[pe_offset+5]]);
    match machine {
        0x8664 => Some("x64".to_string()),
        0xAA64 => Some("aarch64".to_string()),
        0x014c => Some("x86".to_string()),
        _ => Some(format!("unknown_{:#06x}", machine)),
    }
}

// Real web lookup: fetch the required Java major version for an MC version
// directly from Mojang's official version manifest (live data, not hardcoded).
fn fetch_java_major_from_web(mc_version: &str) -> Option<u32> {
    let manifest = http_get_cached(MOJANG_VERSION_MANIFEST, None).ok()?;
    let versions = manifest.get("versions").and_then(|v| v.as_array())?;
    let entry = versions.iter().find(|v| v.get("id").and_then(|i| i.as_str()) == Some(mc_version))?;
    let url = entry.get("url").and_then(|u| u.as_str())?;
    let version_json = http_get_cached(url, None).ok()?;
    // Newer manifests expose javaVersion.majorVersion; older ones use javaVersion.component (e.g. "java_21")
    if let Some(m) = version_json.get("javaVersion").and_then(|j| j.get("majorVersion")).and_then(|m| m.as_u64()) {
        return Some(m as u32);
    }
    if let Some(comp) = version_json.get("javaVersion").and_then(|j| j.get("component")).and_then(|c| c.as_str()) {
        if let Some(num) = comp.trim_start_matches("java_").trim_start_matches("jre-legacy").parse::<u32>().ok() {
            return Some(num);
        }
        if comp.contains("legacy") { return Some(8); }
    }
    None
}

fn get_required_java_for_mc(mc_version: &str) -> u32 {
    // Primary: live web lookup from Mojang's manifest (real compatibility data).
    if let Some(v) = fetch_java_major_from_web(mc_version) {
        return v;
    }
    // Fallback: offline version tuple mapping.
    let vt = parse_version_tuple(mc_version);
    if vt >= (1, 21, 0) { 21 }
    else if vt >= (1, 20, 2) { 17 }
    else if vt >= (1, 17, 0) { 16 }
    else if vt >= (1, 12, 0) { 8 }
    else { 8 }
}

fn find_all_java_installations() -> Vec<Value> {
    let mut javas: Vec<Value> = Vec::new();
    let host_arch = get_host_arch().to_string();

    // Check managed Javas
    let managed = java_dir();
    if let Ok(entries) = std::fs::read_dir(&managed) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let bin_java = path.join("bin").join("java.exe");
                if bin_java.exists() {
                    let path_str = bin_java.to_string_lossy().to_string();
                    if let Some(major) = get_java_major_version(&path_str) {
                        let arch = get_java_arch(&path_str).unwrap_or_else(|| "unknown".to_string());
                        javas.push(json!({
                            "path": path_str,
                            "major_version": major,
                            "name": name,
                            "managed": true,
                            "arch": arch,
                            "compatible_arch": arch == host_arch,
                        }));
                    }
                }
            }
        }
    }

    // Check system Java
    let system_java = which_java();
    if !system_java.is_empty() {
        if let Some(major) = get_java_major_version(&system_java) {
            let arch = get_java_arch(&system_java).unwrap_or_else(|| "unknown".to_string());
            javas.push(json!({
                "path": system_java,
                "major_version": major,
                "name": "System Java",
                "managed": false,
                "arch": arch,
                "compatible_arch": arch == host_arch,
            }));
        }
    }

    // Check common installation paths on Windows
    if cfg!(target_os = "windows") {
        let search_dirs = [
            r"C:\Program Files\Java",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\AdoptOpenJDK",
            r"C:\Program Files\Zulu",
            r"C:\Program Files\BellSoft",
        ];
        for dir in &search_dirs {
            let base = Path::new(dir);
            if base.exists() {
                if let Ok(entries) = std::fs::read_dir(base) {
                    for entry in entries.flatten() {
                        let java_path = entry.path().join("bin").join("java.exe");
                        if java_path.exists() {
                            let path_str = java_path.to_string_lossy().to_string();
                            let already_found = javas.iter().any(|j| j.get("path").and_then(|p| p.as_str()) == Some(&path_str));
                            if !already_found {
                                if let Some(major) = get_java_major_version(&path_str) {
                                    let arch = get_java_arch(&path_str).unwrap_or_else(|| "unknown".to_string());
                                    javas.push(json!({
                                        "path": path_str,
                                        "major_version": major,
                                        "name": entry.file_name().to_string_lossy(),
                                        "managed": false,
                                        "arch": arch,
                                        "compatible_arch": arch == host_arch,
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let search_dirs = [
            "/Library/Java/JavaVirtualMachines",
        ];
        for dir in &search_dirs {
            let base = Path::new(dir);
            if base.exists() {
                if let Ok(entries) = std::fs::read_dir(base) {
                    for entry in entries.flatten() {
                        let home = entry.path().join("Contents/Home/bin/java");
                        if home.exists() {
                            javas.push(json!({
                                "path": home.to_string_lossy().to_string(),
                                "major_version": get_java_major_version(&home.to_string_lossy()).unwrap_or(0),
                                "name": entry.file_name().to_string_lossy().to_string(),
                                "managed": false,
                                "arch": get_java_arch(&home.to_string_lossy()).unwrap_or_default(),
                                "compatible_arch": get_java_arch(&home.to_string_lossy()).unwrap_or_default() == host_arch,
                            }));
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let search_dirs = [
            "/usr/lib/jvm",
        ];
        for dir in &search_dirs {
            let base = Path::new(dir);
            if base.exists() {
                if let Ok(entries) = std::fs::read_dir(base) {
                    for entry in entries.flatten() {
                        let home = entry.path().join("bin/java");
                        if home.exists() {
                            javas.push(json!({
                                "path": home.to_string_lossy().to_string(),
                                "major_version": get_java_major_version(&home.to_string_lossy()).unwrap_or(0),
                                "name": entry.file_name().to_string_lossy().to_string(),
                                "managed": false,
                                "arch": get_java_arch(&home.to_string_lossy()).unwrap_or_default(),
                                "compatible_arch": get_java_arch(&home.to_string_lossy()).unwrap_or_default() == host_arch,
                            }));
                        }
                    }
                }
            }
        }
    }

    javas
}

fn adoptium_download_url(major_version: u32) -> String {
    let arch = get_host_arch();
    let os = if cfg!(target_os = "windows") { "windows" }
        else if cfg!(target_os = "macos") { "mac" }
        else { "linux" };
    format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}//jdk/hotspot/normal/eclipse",
        major_version, os, arch
    )
}

fn auto_download_java(app: &State<AppState>, major_version: u32) -> Result<String, String> {
    let managed = java_dir();
    let _ = std::fs::create_dir_all(&managed);

    let dest_dir = managed.join(format!("java-{}", major_version));
    if dest_dir.exists() {
        let bin_java = dest_dir.join("bin").join("java.exe");
        if bin_java.exists() {
            let path_str = bin_java.to_string_lossy().to_string();
            if get_java_major_version(&path_str).is_some() {
                return Ok(path_str);
            }
            log_msg(app, &format!("[Java] Existing Java {} is broken, re-downloading...", major_version));
            let _ = std::fs::remove_dir_all(&dest_dir);
        }
    }

    let url = adoptium_download_url(major_version);
    log_msg(app, &format!("[Java] Auto-downloading Java {} from Adoptium...", major_version));
    log_msg(app, &format!("[Java] URL: {}", url));

    let temp_dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let zip_path = temp_dir.path().join(format!("jdk-{}.zip", major_version));

    // Download the zip
    download_file_blocking(&url, &zip_path).map_err(|e| {
        log_msg(app, &format!("[Java/ERROR] Download failed: {}", e));
        format!("Failed to download Java {}: {}", major_version, e)
    })?;

    log_msg(app, "[Java] Download complete, extracting...");

    // Extract the zip
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let extract_dir = temp_dir.path().join(format!("jdk-{}", major_version));
    let _ = std::fs::create_dir_all(&extract_dir);

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = extract_dir.join(file.name());
        if let Some(parent) = outpath.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if !file.name().ends_with('/') {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::fs::write(&outpath, &buf).map_err(|e| e.to_string())?;
        }
    }

    // Find the actual JDK directory inside extract (Adoptium uses jdk-{version}+build)
    let inner_dir = std::fs::read_dir(&extract_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .find(|e| e.path().is_dir())
        .ok_or_else(|| "No JDK directory found in archive".to_string())?
        .path();

    // Move to managed dir
    std::fs::rename(&inner_dir, &dest_dir).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&extract_dir);

    let bin_java = dest_dir.join("bin").join("java.exe");
    if bin_java.exists() {
        let path_str = bin_java.to_string_lossy().to_string();
        if get_java_major_version(&path_str).is_some() {
            let host_arch = get_host_arch();
            let java_arch = get_java_arch(&path_str).unwrap_or_else(|| "unknown".to_string());
            log_msg(app, &format!("[Java/OK] Java {} ({}) downloaded and installed at {}", major_version, java_arch, dest_dir.to_string_lossy()));
            if java_arch != host_arch {
                log_msg(app, &format!("[Java/WARN] Downloaded Java arch ({}) does not match host ({})", java_arch, host_arch));
            }
            Ok(path_str)
        } else {
            let _ = std::fs::remove_dir_all(&dest_dir);
            Err(format!("Java {} downloaded but failed to run (wrong architecture?)", major_version))
        }
    } else {
        Err(format!("Java {} downloaded but java.exe not found at {}", major_version, dest_dir.to_string_lossy()))
    }
}

fn get_cached_java_installations(app: &State<AppState>) -> Vec<Value> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let mut cache = app.java_cache.lock().unwrap();
    if let Some((ts, ref javas)) = *cache {
        if now - ts < 30 {
            return javas.clone();
        }
    }
    let javas = find_all_java_installations();
    *cache = Some((now, javas.clone()));
    javas
}

#[tauri::command(async)]
fn check_java_compatibility(app: State<AppState>, mc_version: String) -> Value {
        tokio::task::block_in_place(|| {
    let required = get_required_java_for_mc(&mc_version);
    let javas = get_cached_java_installations(&app);

    let settings = load_settings(&app);
    let custom_java = settings.get("java_path").and_then(|v| v.as_str()).unwrap_or("");

    let compatible: Vec<&Value> = javas.iter()
        .filter(|j| j.get("major_version").and_then(|v| v.as_u64()).unwrap_or(0) as u32 == required)
        .filter(|j| j.get("compatible_arch").and_then(|v| v.as_bool()).unwrap_or(false))
        .collect();

    let current_java = if !custom_java.is_empty() && Path::new(custom_java).exists() {
        get_java_major_version(custom_java)
    } else {
        let wj = which_java();
        if !wj.is_empty() { get_java_major_version(&wj) } else { None }
    };

    let current_compatible = current_java.map(|v| v == required).unwrap_or(false);

    json!({
        "mc_version": mc_version,
        "required_java": required,
        "current_java_version": current_java,
        "current_compatible": current_compatible,
        "available_javas": javas,
        "compatible_javas": compatible,
        "managed_java_dir": java_dir().to_string_lossy(),
    })

        })
    }

#[tauri::command(async)]
fn download_java(app: State<AppState>, major_version: u32) -> Value {
        tokio::task::block_in_place(|| {
    match auto_download_java(&app, major_version) {
        Ok(path) => {
            save_setting_val(&app, "java_path", Value::String(path.clone()));
            json!({"success": true, "path": path, "major_version": major_version})
        }
        Err(e) => json!({"error": e}),
    }

        })
    }

#[tauri::command]
fn get_java_installations() -> Value {
    Value::Array(find_all_java_installations())
}

#[tauri::command]
fn set_java_for_instance(app: State<AppState>, java_path: String) -> Value {
    save_setting_val(&app, "java_path", Value::String(java_path));
    json!({"success": true})
}

// ==================== SYSTEM TERMINAL ACCESS (Xryloth AI) ====================
#[tauri::command]
fn run_system_command(command: String) -> Value {
    let output = if cfg!(target_os = "windows") {
        hidden_cmd("cmd")
            .args(["/C", &command])
            .output()
    } else {
        std::process::Command::new("sh")
            .args(["-c", &command])
            .output()
    };

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            json!({
                "success": o.status.success(),
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": o.status.code(),
            })
        }
        Err(e) => json!({"success": false, "error": e.to_string()}),
    }
}

#[tauri::command]
fn read_file_content(path: String) -> Value {
    match std::fs::read_to_string(&path) {
        Ok(content) => json!({"success": true, "content": content}),
        Err(e) => json!({"success": false, "error": e.to_string()}),
    }
}

#[tauri::command]
fn write_file_content(path: String, content: String) -> Value {
    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&path, &content) {
        Ok(()) => json!({"success": true}),
        Err(e) => json!({"success": false, "error": e.to_string()}),
    }
}

#[tauri::command]
fn list_directory(path: String) -> Value {
    let dir_path = Path::new(&path);
    if !dir_path.exists() {
        return json!({"success": false, "error": "Directory not found"});
    }
    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(dir_path) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.path().is_dir();
            let size = entry.metadata().ok().map(|m| m.len()).unwrap_or(0);
            entries.push(json!({
                "name": name,
                "is_dir": is_dir,
                "size": size,
                "path": entry.path().to_string_lossy(),
            }));
        }
    }
    json!({"success": true, "entries": entries})
}

#[tauri::command]
fn delete_path(path: String) -> Value {
    let p = Path::new(&path);
    if !p.exists() {
        return json!({"success": false, "error": "Path not found"});
    }
    if p.is_dir() {
        match std::fs::remove_dir_all(p) {
            Ok(()) => json!({"success": true}),
            Err(e) => json!({"success": false, "error": e.to_string()}),
        }
    } else {
        match std::fs::remove_file(p) {
            Ok(()) => json!({"success": true}),
            Err(e) => json!({"success": false, "error": e.to_string()}),
        }
    }
}

// ==================== PATH HELPERS (EXTENDED) ====================
fn servers_file() -> PathBuf { app_dir().join("servers.json") }
fn selfhost_dir() -> PathBuf { app_dir().join("selfhost") }
fn selfhost_exe() -> PathBuf { selfhost_dir().join("EcSelfHost.exe") }

// ==================== INSTANCE CLONING ====================
#[tauri::command]
fn clone_instance(app: State<AppState>, instance_name: String, new_instance_name: String) -> Value {
    log_msg(&app, &format!("[Instance] Cloning '{}' to '{}'", instance_name, new_instance_name));
    let instances = load_instances_raw(&app);
    let source = match instances.iter().find(|i| i.get("name").and_then(|n| n.as_str()) == Some(&instance_name)) {
        Some(i) => i.clone(),
        None => return json!({"error": format!("Instance '{}' not found", instance_name)}),
    };
    let new_dir = instances_dir().join(&new_instance_name);
    if new_dir.exists() {
        return json!({"error": format!("Instance '{}' already exists", new_instance_name)});
    }
    let source_dir = instances_dir().join(&instance_name);
    let is_installed = source_dir.exists();
    if is_installed {
        match copy_dir_recursive(&source_dir, &new_dir) {
            Ok(()) => {}
            Err(e) => return json!({"error": format!("Failed to copy instance directory: {}", e)}),
        }
    }
    let mut new_data = source.clone();
    new_data["name"] = Value::String(new_instance_name.clone());
    new_data["created"] = Value::String(chrono::Local::now().to_rfc3339());
    new_data["last_played"] = Value::Null;
    let mut all_instances = load_instances_raw(&app);
    all_instances.push(new_data.clone());
    save_instances(&all_instances);
    log_msg(&app, &format!("[Instance] Cloned '{}' to '{}' successfully", instance_name, new_instance_name));
    json!({"success": true, "instance": new_data, "copied_files": is_installed})
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ==================== MULTIPLAYER SERVER LIST ====================
#[tauri::command]
fn get_servers() -> Value {
    let data = load_json(&servers_file());
    data.as_array().cloned().map(Value::Array).unwrap_or_else(|| Value::Array(vec![]))
}

#[tauri::command]
fn add_server(name: String, address: String, port: u16) -> Value {
    let mut servers = load_json(&servers_file()).as_array().cloned().unwrap_or_default();
    if servers.iter().any(|s| s.get("name").and_then(|n| n.as_str()) == Some(&name)) {
        return json!({"error": format!("Server '{}' already exists", name)});
    }
    let server = json!({
        "name": name,
        "address": address,
        "port": port,
    });
    servers.push(server);
    save_json(&servers_file(), &Value::Array(servers));
    json!({"success": true})
}

#[tauri::command]
fn delete_server(name: String) -> Value {
    let mut servers = load_json(&servers_file()).as_array().cloned().unwrap_or_default();
    let len_before = servers.len();
    servers.retain(|s| s.get("name").and_then(|n| n.as_str()) != Some(&name));
    if servers.len() == len_before {
        return json!({"error": format!("Server '{}' not found", name)});
    }
    save_json(&servers_file(), &Value::Array(servers));
    json!({"success": true})
}

fn write_var_int(mut value: u32) -> Vec<u8> {
    let mut buf = Vec::new();
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
    buf
}

fn read_var_int(data: &[u8], offset: &mut usize) -> Result<u32, String> {
    let mut result: u32 = 0;
    let mut shift = 0;
    loop {
        if *offset >= data.len() {
            return Err("Unexpected end of data reading VarInt".into());
        }
        let byte = data[*offset];
        *offset += 1;
        result |= ((byte & 0x7F) as u32) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 35 {
            return Err("VarInt too big".into());
        }
    }
    Ok(result)
}

#[tauri::command]
fn ping_server(address: String, port: u16) -> Value {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr_str = format!("{}:{}", address, port);
    let addr: std::net::SocketAddr = match addr_str.parse() {
        Ok(a) => a,
        Err(e) => return json!({"error": format!("Invalid address: {}", e)}),
    };
    let stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(3)) {
        Ok(s) => s,
        Err(e) => return json!({"error": format!("Failed to connect: {}", e)}),
    };
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(3))).ok();

    // Handshake packet
    let protocol_version: u32 = 767; // 1.21 version, most servers handle this
    let next_state: u32 = 1;
    let mut handshake_data = Vec::new();
    handshake_data.extend_from_slice(&write_var_int(protocol_version));
    // Server address
    let addr_bytes = address.as_bytes();
    handshake_data.extend_from_slice(&write_var_int(addr_bytes.len() as u32));
    handshake_data.extend_from_slice(addr_bytes);
    // Server port
    handshake_data.extend_from_slice(&port.to_be_bytes());
    // Next state
    handshake_data.extend_from_slice(&write_var_int(next_state));

    let mut handshake_packet = Vec::new();
    handshake_packet.extend_from_slice(&write_var_int(0)); // packet id = 0
    handshake_packet.extend_from_slice(&handshake_data);

    let mut full_handshake = write_var_int(handshake_packet.len() as u32);
    full_handshake.extend_from_slice(&handshake_packet);

    let mut stream_clone = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return json!({"error": "Failed to clone stream"}),
    };
    if stream_clone.write_all(&full_handshake).is_err() {
        return json!({"error": "Failed to send handshake"});
    }

    // Status request
    let status_req = vec![0x01, 0x00]; // length=1, packet_id=0
    if stream_clone.write_all(&status_req).is_err() {
        return json!({"error": "Failed to send status request"});
    }

    // Read response
    drop(stream_clone);
    let mut reader = stream;
    // Read VarInt length
    let mut length: u32 = 0;
    let mut shift = 0;
    loop {
        let mut byte = [0u8; 1];
        match reader.read_exact(&mut byte) {
            Ok(()) => {}
            Err(e) => return json!({"error": format!("Failed to read response length: {}", e)}),
        }
        length |= ((byte[0] & 0x7F) as u32) << shift;
        if byte[0] & 0x80 == 0 {
            break;
        }
        shift += 7;
    }

    let mut payload = vec![0u8; length as usize];
    if reader.read_exact(&mut payload).is_err() {
        return json!({"error": "Failed to read response payload"});
    }

    // Skip packet id (VarInt)
    let mut offset = 0;
    let _packet_id = read_var_int(&payload, &mut offset).unwrap_or(0);

    // Read JSON string length
    let json_len = read_var_int(&payload, &mut offset).unwrap_or(0) as usize;
    if offset + json_len > payload.len() {
        return json!({"error": "Invalid response: JSON string too long"});
    }
    let json_str = match std::str::from_utf8(&payload[offset..offset + json_len]) {
        Ok(s) => s,
        Err(e) => return json!({"error": format!("Invalid UTF-8 in response: {}", e)}),
    };

    match serde_json::from_str::<Value>(json_str) {
        Ok(data) => {
            let motd = data.get("description")
                .and_then(|d| d.get("text").or(d.get("translate")).or(Some(d)))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();
            let online = data.get("players")
                .and_then(|p| p.get("online"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let max = data.get("players")
                .and_then(|p| p.get("max"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let version = data.get("version")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();
            json!({
                "success": true,
                "motd": motd,
                "online": online,
                "max": max,
                "version": version,
            })
        }
        Err(e) => json!({"error": format!("Failed to parse server response: {}", e)}),
    }
}

// ==================== SELF-HOST (EcSelfHost) ====================
#[tauri::command]
fn get_selfhost_status() -> Value {
    let exe = selfhost_exe();
    json!({
        "exists": exe.exists(),
        "path": exe.to_string_lossy(),
    })
}

#[tauri::command(async)]
fn download_selfhost(app: State<AppState>) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, "[SelfHost] Starting download of EcSelfHost.exe...");
    let _ = std::fs::create_dir_all(&selfhost_dir());

    // Fetch the MediaFire page to find the download link
    let page_html = match reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => {
            match client.get("https://www.mediafire.com/file/lr3tqh08syf8tgu/EcSelfHost.exe/file").send() {
                Ok(resp) => resp.text().unwrap_or_default(),
                Err(e) => return json!({"success": false, "error": format!("Failed to fetch MediaFire page: {}", e)}),
            }
        }
        Err(e) => return json!({"success": false, "error": format!("Failed to build HTTP client: {}", e)}),
    };

    // Try to find the download URL in the HTML
    let download_url = extract_mediafire_download_url(&page_html);
    let download_url = match download_url {
        Some(url) => url,
        None => {
            // Fallback: try the known direct download pattern
            // MediaFire sometimes allows direct download with the file key
            let fallback_url = "https://download1.mediafire.com/lr3tqh08syf8tgu/EcSelfHost.exe";
            log_msg(&app, &format!("[SelfHost] Could not parse download URL from page, trying fallback: {}", fallback_url));
            fallback_url.to_string()
        }
    };

    log_msg(&app, &format!("[SelfHost] Downloading from: {}", download_url));
    match download_file_blocking(&download_url, &selfhost_exe()) {
        Ok(()) => {
            log_msg(&app, "[SelfHost] Download completed successfully");
            json!({"success": true, "path": selfhost_exe().to_string_lossy()})
        }
        Err(e) => {
            log_msg(&app, &format!("[SelfHost] Download failed: {}", e));
            json!({"success": false, "error": format!("Download failed: {}", e)})
        }
    }

        })
    }

fn extract_mediafire_download_url(html: &str) -> Option<String> {
    // Look for downloadUrl in JavaScript
    if let Some(idx) = html.find("\"downloadUrl\"") {
        let slice = &html[idx..];
        if let Some(start) = slice.find('\"') {
            let after_quote = &slice[start + 1..];
            if let Some(end) = after_quote.find('"') {
                let url = &after_quote[..end];
                if url.starts_with("http") {
                    return Some(url.to_string());
                }
            }
        }
    }
    // Look for download URL in href
    if let Some(idx) = html.find("download_url") {
        let slice = &html[idx..];
        if let Some(start) = slice.find('\"') {
            let after_quote = &slice[start + 1..];
            if let Some(end) = after_quote.find('"') {
                let url = &after_quote[..end];
                if url.starts_with("http") {
                    return Some(url.to_string());
                }
            }
        }
    }
    // Look for onclick with download link
    for pattern in &["class=\"download_link\"", "id=\"downloadButton\"", "href=\"https://download"] {
        if let Some(idx) = html.find(pattern) {
            let slice = &html[idx..];
            if let Some(start) = slice.find("href=\"") {
                let after = &slice[start + 6..];
                if let Some(end) = after.find('"') {
                    let url = &after[..end];
                    if url.starts_with("http") {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }
    // Regex-like approach: find any URL containing "download" and "mediafire"
    let mut search_start = 0;
    while let Some(idx) = html[search_start..].find("http") {
        let abs_idx = search_start + idx;
        if let Some(end) = html[abs_idx..].find(|c: char| c == '"' || c == '\'' || c == ' ') {
            let candidate = &html[abs_idx..abs_idx + end];
            if candidate.contains("mediafire") && (candidate.contains("download") || candidate.contains("dl/")) {
                return Some(candidate.to_string());
            }
            search_start = abs_idx + end;
        } else {
            break;
        }
    }
    None
}

#[tauri::command]
fn launch_selfhost(app: State<AppState>) -> Value {
    let exe = selfhost_exe();
    if !exe.exists() {
        return json!({"success": false, "error": "EcSelfHost.exe not found. Please download it first."});
    }
    log_msg(&app, "[SelfHost] Launching EcSelfHost.exe...");
    let mut cmd = hidden_cmd(exe.to_string_lossy().to_string().as_str());
    cmd.current_dir(&selfhost_dir());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    cmd.stdin(std::process::Stdio::null());
    match cmd.spawn() {
        Ok(_) => {
            log_msg(&app, "[SelfHost] EcSelfHost.exe launched successfully");
            json!({"success": true})
        }
        Err(e) => {
            log_msg(&app, &format!("[SelfHost] Failed to launch: {}", e));
            json!({"success": false, "error": e.to_string()})
        }
    }
}

// ==================== PAPER SERVER VERSIONS ====================
fn paper_version_key(v: &str) -> (u64, u64, u64) {
    let base = v.split('-').next().unwrap_or(v);
    let mut parts = base.split('.');
    let a = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let b = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let c = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    (a, b, c)
}

#[tauri::command(async)]
fn get_server_versions() -> Value {
        tokio::task::block_in_place(|| {
    match http_get("https://fill.papermc.io/v3/projects/paper", None) {
        Ok(data) => {
            let mut versions: Vec<String> = Vec::new();
            if let Some(map) = data.get("versions").and_then(|v| v.as_object()) {
                for arr in map.values() {
                    if let Some(a) = arr.as_array() {
                        for v in a {
                            if let Some(s) = v.as_str() {
                                if !s.contains('-') { versions.push(s.to_string()); }
                            }
                        }
                    }
                }
            }
            versions.sort_by(|a, b| paper_version_key(b).cmp(&paper_version_key(a)));
            versions.dedup();
            json!({"success": true, "versions": versions})
        }
        Err(e) => json!({"error": format!("Failed to fetch Paper versions: {}", e)}),
    }

        })
    }

#[tauri::command(async)]
fn get_server_builds(mc_version: String) -> Value {
        tokio::task::block_in_place(|| {
    let url = format!("https://fill.papermc.io/v3/projects/paper/versions/{}/builds", mc_version);
    match http_get(&url, None) {
        Ok(data) => {
            let builds = data.as_array().cloned().unwrap_or_default();
            let out = builds.iter().map(|b| {
                let id = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let dl = b.get("downloads").and_then(|d| d.get("server:default")).or_else(|| b.get("downloads").and_then(|d| d.get("server:mojang")));
                let url = dl.and_then(|d| d.get("url")).and_then(|u| u.as_str()).unwrap_or("");
                let channel = b.get("channel").and_then(|c| c.as_str()).unwrap_or("STABLE");
                json!({
                    "build_number": id,
                    "download_url": url,
                    "channel": channel,
                })
            }).collect::<Vec<_>>();
            json!({"success": true, "builds": out})
        }
        Err(e) => json!({"error": format!("Failed to fetch Paper builds for {}: {}", mc_version, e)}),
    }

        })
    }

// ==================== SERVER LAUNCH ====================
#[tauri::command]
fn launch_server(app: State<AppState>, app_handle: tauri::AppHandle, instance_name: String) -> Value {
    log_msg(&app, &format!("[ServerLaunch] Preparing to launch server '{}'...", instance_name));

    let instances = load_instances_raw(&app);
    let instance = instances.iter().find(|i| i.get("name").and_then(|n| n.as_str()) == Some(&instance_name));
    let _instance_data = match instance {
        Some(i) => i.clone(),
        None => return json!({"error": format!("Instance '{}' not found", instance_name)}),
    };

    let inst_dir = instances_dir().join(&instance_name);
    if !inst_dir.exists() {
        return json!({"error": format!("Instance directory '{}' not found", instance_name)});
    }

    // Find Paper/Spigot jar
    let server_jar = find_server_jar(&inst_dir);
    let server_jar = match server_jar {
        Some(j) => j,
        None => return json!({"error": "No Paper or Spigot JAR found in instance directory".to_string()}),
    };

    log_msg(&app, &format!("[ServerLaunch] Found server JAR: {}", server_jar.file_name().unwrap_or_default().to_string_lossy()));

    // Find Java
    let settings = load_settings(&app);
    let custom_java = settings.get("java_path").and_then(|v| v.as_str()).unwrap_or("");
    let mut java_exec = String::new();

    if !custom_java.is_empty() && Path::new(custom_java).exists() {
        java_exec = custom_java.to_string();
    }
    if java_exec.is_empty() {
        let all_javas = find_all_java_installations();
        if let Some(j) = all_javas.first() {
            if let Some(p) = j.get("path").and_then(|v| v.as_str()) {
                java_exec = p.to_string();
            }
        }
    }
    if java_exec.is_empty() {
        return json!({"error": "No Java installation found. Please install Java."});
    }

    log_msg(&app, &format!("[ServerLaunch] Using Java: {}", java_exec));

    let jar_path = server_jar.to_string_lossy().to_string();
    let java_clone = java_exec.clone();

    std::thread::spawn(move || {
        log_msg_state(&app_handle, &format!("[ServerLaunch] Starting server process..."));

        let mut child = hidden_cmd(&java_clone);
        child.args(["-jar", &jar_path, "--nogui"]);
        child.current_dir(&inst_dir);
        child.stdout(std::process::Stdio::piped());
        child.stderr(std::process::Stdio::piped());
        child.stdin(std::process::Stdio::null());

        match child.spawn() {
            Ok(mut proc) => {
                log_msg_state(&app_handle, &format!("[ServerLaunch] Server started, PID: {:?}", proc.id()));
                append_output_state(&app_handle, &format!("[Server] Server started (PID: {:?})", proc.id()));

                if let Some(stdout) = proc.stdout.take() {
                    let reader = std::io::BufReader::new(stdout);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let trimmed = line.trim().to_string();
                            if !trimmed.is_empty() {
                                append_output_state(&app_handle, &trimmed);
                                log_msg_state(&app_handle, &format!("[Server] {}", trimmed));
                            }
                        }
                    }
                }

                let exit_code = proc.wait().map(|s| s.code().unwrap_or(1)).unwrap_or(1);
                if exit_code != 0 {
                    log_msg_state(&app_handle, &format!("[Server/ERROR] Server exited with code {}", exit_code));
                    append_output_state(&app_handle, &format!("[Server ERROR] Exited with code {}", exit_code));
                } else {
                    log_msg_state(&app_handle, "[Server/INFO] Server stopped normally.");
                    append_output_state(&app_handle, "[Server] Server stopped normally.");
                }
            }
            Err(e) => {
                log_msg_state(&app_handle, &format!("[Server/ERROR] Failed to start: {}", e));
                append_output_state(&app_handle, &format!("[Server ERROR] {}", e));
            }
        }
    });

    json!({"success": true, "message": "Server process started"})
}

fn find_server_jar(inst_dir: &Path) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(inst_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".jar") && (name.contains("paper") || name.contains("spigot") || name.contains("paperclip")) {
                return Some(entry.path());
            }
        }
    }
    None
}

// ==================== LOCAL SERVER MANAGER ====================
fn servers_dir() -> PathBuf { app_dir().join("servers") }
fn server_dir(name: &str) -> PathBuf { servers_dir().join(name) }

const DEFAULT_SERVER_MOTD: &str = "§2§l[§a§lXʀʏʟᴏᴛʜ ᴄʟɪᴇɴᴛ§2§l] §f§l𝟤𝟢𝟤𝟨 ᴇᴅɪᴛɪᴏɴ §8» §7ᴇxᴘᴇʀɪᴇɴᴄᴇ ᴍɪɴᴇᴄʀᴀꜰᴛ ᴘᴏᴡᴇʀᴇᴅ ʙʏ §b§lXʀʏʟᴏᴛʜ";

// Minecraft reads server.properties as ISO-8859-1 (java.util.Properties).
// Escape non-ASCII (incl. the fancy MOTD) to \uXXXX so nothing gets garbled.
fn escape_prop(v: &str) -> String {
    let mut out = String::new();
    for ch in v.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => {
                let cp = c as u32;
                if cp < 0x20 || cp > 0x7E {
                    let mut buf = [0u16; 2];
                    for u in c.encode_utf16(&mut buf) {
                        out.push_str(&format!("\\u{:04X}", u));
                    }
                } else {
                    out.push(c);
                }
            }
        }
    }
    out
}

fn unescape_prop(v: &str) -> String {
    let mut out: Vec<u16> = Vec::new();
    let mut chars = v.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('u') => {
                    let mut hex = String::new();
                    for _ in 0..4 { if let Some(h) = chars.next() { hex.push(h); } }
                    if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                        out.push(cp as u16);
                    }
                }
                Some('n') => out.push('\n' as u16),
                Some('r') => out.push('\r' as u16),
                Some('t') => out.push('\t' as u16),
                Some(other) => {
                    let mut buf = [0u16; 2];
                    for u in other.encode_utf16(&mut buf) { out.push(*u); }
                }
                None => {}
            }
        } else {
            let mut buf = [0u16; 2];
            for u in c.encode_utf16(&mut buf) { out.push(*u); }
        }
    }
    String::from_utf16_lossy(&out)
}

fn sanitize_server_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
        .collect::<String>()
        .trim()
        .to_string()
}

fn resolve_server_java(settings: &HashMap<String, Value>) -> String {
    if let Some(p) = settings.get("java_path").and_then(|v| v.as_str()) {
        if !p.is_empty() && Path::new(p).exists() {
            return p.to_string();
        }
    }
    if let Some(j) = find_all_java_installations().first() {
        if let Some(p) = j.get("path").and_then(|v| v.as_str()) {
            return p.to_string();
        }
    }
    "java".to_string()
}

fn resolve_paper_download_url(mc_version: &str) -> Result<String, String> {
    let url = format!("https://fill.papermc.io/v3/projects/paper/versions/{}/builds/latest", mc_version);
    let data = http_get(&url, None).map_err(|_| format!("No Paper build found for Minecraft {}. Try the Vanilla type instead.", mc_version))?;
    let downloads = data.get("downloads").ok_or_else(|| format!("No download available for Paper {}.", mc_version))?;
    let entry = downloads.get("server:default").or_else(|| downloads.get("server:mojang")).ok_or("Missing server download")?;
    entry.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()).ok_or_else(|| "Missing download url".to_string())
}

fn resolve_vanilla_server_url(mc_version: &str) -> Result<String, String> {
    let manifest = http_get(MOJANG_VERSION_MANIFEST, None)?;
    let versions = manifest.get("versions").and_then(|v| v.as_array()).ok_or("Malformed version manifest")?;
    let entry = versions.iter().find(|v| v.get("id").and_then(|i| i.as_str()) == Some(mc_version)).ok_or_else(|| format!("Minecraft version {} not found.", mc_version))?;
    let vurl = entry.get("url").and_then(|u| u.as_str()).ok_or("Missing version metadata url")?;
    let vjson = http_get(vurl, None)?;
    vjson.get("downloads").and_then(|d| d.get("server")).and_then(|s| s.get("url")).and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Minecraft {} has no server download available.", mc_version))
}

fn create_server_blocking(app_handle: Option<tauri::AppHandle>, name: &str, server_type: &str, mc_version: &str, port: u16, motd: Option<String>, ram_mb: Option<u64>) -> Value {
    let name = sanitize_server_name(name);
    if name.is_empty() {
        return json!({"error": "Please enter a valid server name."});
    }
    let dir = server_dir(&name);
    if dir.join("server.json").exists() {
        return json!({"error": format!("A server named '{}' already exists.", name)});
    }
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return json!({"error": format!("Failed to create server folder: {}", e)});
    }
    let _ = std::fs::create_dir_all(dir.join("plugins"));

    let motd = motd.filter(|m| !m.trim().is_empty()).unwrap_or_else(|| DEFAULT_SERVER_MOTD.to_string());
    let stype = if server_type.trim().is_empty() { "paper".to_string() } else { server_type.to_lowercase() };

    let url = match stype.as_str() {
        "vanilla" => resolve_vanilla_server_url(mc_version),
        "purpur" => resolve_purpur_download_url(mc_version),
        "fabric" => resolve_fabric_download_url(mc_version),
        _ => resolve_paper_download_url(mc_version),
    };
    let url = match url {
        Ok(u) => u,
        Err(e) => { let _ = std::fs::remove_dir_all(&dir); return json!({"error": e}); }
    };

    let jar_path = dir.join("server.jar");
    let name_for_evt = name.clone();
    let dl = download_file_progress(&url, &jar_path, |done, total| {
        if let Some(h) = &app_handle {
            let _ = h.emit_all("server-mgr-download", json!({
                "server": name_for_evt,
                "phase": "jar",
                "downloaded": done,
                "total": total,
            }));
        }
    });
    if let Err(e) = dl {
        let _ = std::fs::remove_dir_all(&dir);
        return json!({"error": format!("Failed to download server jar: {}", e)});
    }

    let _ = std::fs::write(dir.join("eula.txt"), "eula=true\n");

    let props = format!(
        "server-port={port}\nmotd={}\nonline-mode=false\nmax-players=20\ndifficulty=easy\ngamemode=survival\npvp=true\nspawn-protection=0\nview-distance=10\nsimulation-distance=10\nallow-flight=true\nenable-command-block=true\nwhite-list=false\nenforce-whitelist=false\nquery.port={port}\n",
        escape_prop(&motd)
    );
    let _ = std::fs::write(dir.join("server.properties"), props);

    let ram = ram_mb.unwrap_or(4096);
    let meta = json!({
        "name": name,
        "type": stype,
        "version": mc_version,
        "port": port,
        "motd": motd,
        "ram_mb": ram,
        "created": chrono::Local::now().to_rfc3339(),
    });
    save_json(&dir.join("server.json"), &meta);

    json!({"success": true, "server": meta})
}

fn forward_server_line(handle: &tauri::AppHandle, name: &str, line: &str) {
    let trimmed = line.trim_end();
    if trimmed.is_empty() { return; }
    {
        let st = handle.state::<AppState>();
        if let Ok(mut logs) = st.server_logs.lock() {
            let v = logs.entry(name.to_string()).or_default();
            v.push(trimmed.to_string());
            if v.len() > 2000 { let drain = v.len() - 2000; v.drain(0..drain); }
        };
    }
    let _ = handle.emit_all("server-mgr-output", json!({"server": name, "line": trimmed}));
}

#[tauri::command]
fn server_mgr_list(app: State<AppState>) -> Value {
    let dir = servers_dir();
    let _ = std::fs::create_dir_all(&dir);
    let procs = app.server_procs.lock().unwrap();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let path = e.path();
            if !path.is_dir() { continue; }
            let meta = load_json(&path.join("server.json"));
            let name = e.file_name().to_string_lossy().to_string();
            let running = procs.contains_key(&name);
            out.push(json!({
                "name": name,
                "type": meta.get("type").and_then(|v| v.as_str()).unwrap_or("paper"),
                "version": meta.get("version").and_then(|v| v.as_str()).unwrap_or(""),
                "port": meta.get("port").and_then(|v| v.as_u64()).unwrap_or(25565),
                "motd": meta.get("motd").and_then(|v| v.as_str()).unwrap_or(DEFAULT_SERVER_MOTD),
                "ram_mb": meta.get("ram_mb").and_then(|v| v.as_u64()).unwrap_or(4096),
                // Public/private listing choice + extra info the launcher mirrors
                // to Firebase for the website server list.
                "visibility": meta.get("visibility").and_then(|v| v.as_str()).unwrap_or("private"),
                "description": meta.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                "tags": meta.get("tags").and_then(|v| v.as_str()).unwrap_or(""),
                "max_players": meta.get("max_players").and_then(|v| v.as_u64()).unwrap_or(20),
                "published_at": meta.get("published_at").and_then(|v| v.as_str()).unwrap_or(""),
                "xms_mb": meta.get("xms_mb").and_then(|v| v.as_u64()).unwrap_or(0),
                "java_path": meta.get("java_path").and_then(|v| v.as_str()).unwrap_or(""),
                "jvm_args": meta.get("jvm_args").and_then(|v| v.as_str()).unwrap_or(""),
                "aikar_flags": meta.get("aikar_flags").and_then(|v| v.as_bool()).unwrap_or(false),
                "auto_restart": meta.get("auto_restart").and_then(|v| v.as_bool()).unwrap_or(false),
                "start_on_launch": meta.get("start_on_launch").and_then(|v| v.as_bool()).unwrap_or(false),
                "icon_exists": path.join("server-icon.png").exists(),
                "created": meta.get("created").and_then(|v| v.as_str()).unwrap_or(""),
                "path": path.to_string_lossy(),
                "running": running,
            }));
        }
    }
    json!({"success": true, "servers": out})
}

#[tauri::command]
async fn server_mgr_create(app_handle: tauri::AppHandle, name: String, server_type: String, mc_version: String, port: u16, motd: Option<String>, ram_mb: Option<u64>) -> Value {
    // Resolution + jar download use the blocking reqwest client, which owns a
    // Tokio runtime. A runtime must never be created/dropped on an async worker,
    // so run the whole operation on a dedicated blocking thread.
    let result = tokio::task::spawn_blocking(move || {
        create_server_blocking(Some(app_handle), &name, &server_type, &mc_version, port, motd, ram_mb)
    }).await;
    result.unwrap_or_else(|_| json!({"error": "Server creation task failed"}))
}

#[tauri::command]
fn server_mgr_start(app: State<AppState>, app_handle: tauri::AppHandle, name: String) -> Value {
    let name = sanitize_server_name(&name);
    launch_local_server(&app, &app_handle, &name)
}

fn launch_local_server(app: &State<AppState>, app_handle: &tauri::AppHandle, name: &str) -> Value {
    let name = name.to_string();
    // Clear any stale "stopping" flag so a fresh launch isn't mistaken for a crash.
    let _ = app.server_stopping.lock().unwrap().remove(&name);
    let dir = server_dir(&name);
    if !dir.join("server.json").exists() {
        return json!({"error": "Server not found."});
    }
    {
        let mut procs = app.server_procs.lock().unwrap();
        if let Some(p) = procs.get_mut(&name) {
            match p.child.try_wait() {
                Ok(None) => return json!({"error": "Server is already running."}),
                _ => { procs.remove(&name); }
            }
        }
    }

    let meta = load_json(&dir.join("server.json"));
    let ram = meta.get("ram_mb").and_then(|v| v.as_u64()).unwrap_or(4096);
    let stype = meta.get("type").and_then(|v| v.as_str()).unwrap_or("paper").to_string();
    let settings = load_settings(&app);
    let java = {
        let per_server = meta.get("java_path").and_then(|v| v.as_str()).unwrap_or("");
        if !per_server.is_empty() && Path::new(per_server).exists() {
            per_server.to_string()
        } else {
            resolve_server_java(&settings)
        }
    };
    let xms = meta.get("xms_mb").and_then(|v| v.as_u64()).unwrap_or_else(|| std::cmp::min(ram, 1024));
    let jvm_args = meta.get("jvm_args").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let aikar = meta.get("aikar_flags").and_then(|v| v.as_bool()).unwrap_or(false);

    let mut cmd = hidden_cmd(&java);
    if aikar {
        for flag in AIKAR_FLAGS {
            cmd.arg(flag);
        }
    }
    cmd.arg(format!("-Xmx{}M", ram));
    cmd.arg(format!("-Xms{}M", xms));
    for part in jvm_args.split_whitespace() {
        cmd.arg(part);
    }
    cmd.arg("-jar");
    cmd.arg("server.jar");
    if stype == "fabric" {
        cmd.arg("nogui");
    } else {
        cmd.arg("--nogui");
    }
    cmd.current_dir(&dir);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::piped());

    match cmd.spawn() {
        Ok(mut child) => {
            let stdin = match child.stdin.take() { Some(s) => s, None => return json!({"error": "Failed to open server input stream."}) };
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            {
                let mut procs = app.server_procs.lock().unwrap();
                procs.insert(name.clone(), ServerProc { child, stdin, started_at: std::time::Instant::now() });
                let mut logs = app.server_logs.lock().unwrap();
                logs.insert(name.clone(), Vec::new());
            }
            let _ = app_handle.emit_all("server-mgr-status", json!({"server": name, "running": true}));

            if let Some(stdout) = stdout {
                let h = app_handle.clone();
                let n = name.clone();
                std::thread::spawn(move || {
                    let reader = std::io::BufReader::new(stdout);
                    for line in reader.lines() {
                        match line { Ok(l) => forward_server_line(&h, &n, &l), Err(_) => break }
                    }
                    let removed = { h.state::<AppState>().server_procs.lock().unwrap().remove(&n).is_some() };
                    if removed {
                        let was_stopping = { h.state::<AppState>().server_stopping.lock().unwrap().remove(&n) };
                        let _ = h.emit_all("server-mgr-status", json!({"server": &n, "running": false}));
                        if !was_stopping {
                            let meta = load_json(&server_dir(&n).join("server.json"));
                            if meta.get("auto_restart").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let h2 = h.clone();
                                let n2 = n.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(std::time::Duration::from_secs(3));
                                    let st2 = h2.state::<AppState>();
                                    if !st2.server_procs.lock().unwrap().contains_key(&n2) {
                                        forward_server_line(&h2, &n2, "[Xryloth] Server exited unexpectedly — auto-restarting (auto-restart is ON)…");
                                        let r = launch_local_server(&st2, &h2, &n2);
                                        if let Some(err) = r.get("error").and_then(|v| v.as_str()) {
                                            forward_server_line(&h2, &n2, &format!("[Xryloth] Auto-restart failed: {}", err));
                                        }
                                    }
                                });
                            }
                        }
                    }
                });
            }
            if let Some(stderr) = stderr {
                let h = app_handle.clone();
                let n = name.clone();
                std::thread::spawn(move || {
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines() {
                        match line { Ok(l) => forward_server_line(&h, &n, &l), Err(_) => break }
                    }
                });
            }
            json!({"success": true})
        }
        Err(e) => json!({"error": format!("Failed to launch server: {}", e)}),
    }
}

#[tauri::command]
fn server_mgr_stop(app: State<AppState>, app_handle: tauri::AppHandle, name: String) -> Value {
    let name = sanitize_server_name(&name);
    // Mark as intentional so the crash watcher does not auto-restart it.
    app.server_stopping.lock().unwrap().insert(name.clone());
    {
        let mut procs = app.server_procs.lock().unwrap();
        if let Some(p) = procs.get_mut(&name) {
            let _ = p.stdin.write_all(b"stop\n");
            let _ = p.stdin.flush();
        } else {
            return json!({"error": "Server is not running."});
        }
    }
    // Watchdog: force-kill if it hasn't stopped within 12 seconds.
    let h = app_handle.clone();
    let n = name.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        let st = h.state::<AppState>();
        let removed = {
            let mut procs = st.server_procs.lock().unwrap();
            if let Some(mut p) = procs.remove(&n) {
                let _ = p.child.kill();
                let _ = p.child.wait();
                true
            } else { false }
        };
        if removed {
            let _ = h.emit_all("server-mgr-status", json!({"server": n, "running": false}));
        }
    });
    json!({"success": true})
}

#[tauri::command]
fn server_mgr_kill(app: State<AppState>, app_handle: tauri::AppHandle, name: String) -> Value {
    let name = sanitize_server_name(&name);
    let removed = {
        let mut procs = app.server_procs.lock().unwrap();
        if let Some(mut p) = procs.remove(&name) {
            let _ = p.child.kill();
            let _ = p.child.wait();
            true
        } else { false }
    };
    let _ = app_handle.emit_all("server-mgr-status", json!({"server": name, "running": false}));
    json!({"success": removed})
}

#[tauri::command]
fn server_mgr_command(app: State<AppState>, name: String, command: String) -> Value {
    let name = sanitize_server_name(&name);
    let mut procs = app.server_procs.lock().unwrap();
    if let Some(p) = procs.get_mut(&name) {
        match p.stdin.write_all(format!("{}\n", command).as_bytes()).and_then(|_| p.stdin.flush()) {
            Ok(_) => json!({"success": true}),
            Err(e) => json!({"error": e.to_string()}),
        }
    } else {
        json!({"error": "Server is not running."})
    }
}

#[tauri::command]
fn server_mgr_status(app: State<AppState>, name: String) -> Value {
    let name = sanitize_server_name(&name);
    let mut procs = app.server_procs.lock().unwrap();
    let mut running = false;
    let mut dead = false;
    if let Some(p) = procs.get_mut(&name) {
        match p.child.try_wait() {
            Ok(Some(_)) => dead = true,
            Ok(None) => running = true,
            Err(_) => dead = true,
        }
    }
    if dead { procs.remove(&name); }
    json!({"running": running})
}

#[tauri::command]
fn server_mgr_logs(app: State<AppState>, name: String) -> Value {
    let name = sanitize_server_name(&name);
    let logs = app.server_logs.lock().unwrap();
    let lines = logs.get(&name).cloned().unwrap_or_default();
    json!({"success": true, "lines": lines})
}

#[tauri::command]
fn server_mgr_delete(app: State<AppState>, app_handle: tauri::AppHandle, name: String) -> Value {
    let name = sanitize_server_name(&name);
    {
        let mut procs = app.server_procs.lock().unwrap();
        if let Some(mut p) = procs.remove(&name) {
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }
    let dir = server_dir(&name);
    if !dir.exists() {
        return json!({"error": "Server not found."});
    }
    match std::fs::remove_dir_all(&dir) {
        Ok(_) => {
            let _ = app_handle.emit_all("server-mgr-status", json!({"server": name, "running": false, "deleted": true}));
            json!({"success": true})
        }
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command]
fn server_mgr_get_properties(name: String) -> Value {
    let name = sanitize_server_name(&name);
    let path = server_dir(&name).join("server.properties");
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let mut map = serde_json::Map::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), Value::String(unescape_prop(v.trim())));
        }
    }
    json!({"success": true, "properties": Value::Object(map)})
}

#[tauri::command]
fn server_mgr_set_properties(name: String, properties: HashMap<String, String>) -> Value {
    let name = sanitize_server_name(&name);
    let path = server_dir(&name).join("server.properties");
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in content.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') { lines.push(line.to_string()); continue; }
        if let Some((k, _)) = t.split_once('=') {
            let key = k.trim().to_string();
            if let Some(newval) = properties.get(&key) {
                lines.push(format!("{}={}", key, escape_prop(newval)));
                seen.insert(key);
                continue;
            }
        }
        lines.push(line.to_string());
    }
    let mut keys: Vec<String> = properties.keys().cloned().collect();
    keys.sort();
    for k in keys {
        if !seen.contains(&k) {
            if let Some(v) = properties.get(&k) { lines.push(format!("{}={}", k, escape_prop(v))); }
        }
    }
    match std::fs::write(&path, lines.join("\n") + "\n") {
        Ok(_) => json!({"success": true}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command(async)]
fn server_mgr_search_plugins(query: String, mc_version: Option<String>, limit: Option<u32>) -> Value {
        tokio::task::block_in_place(|| {
    let mc = mc_version.filter(|m| !m.trim().is_empty());
    search_modrinth(query, Some("plugin".to_string()), Some("paper".to_string()), mc, limit)

        })
    }

fn install_plugin_blocking(name: &str, slug: &str, version_id: Option<String>, mc_version: Option<String>) -> Value {
    let name = sanitize_server_name(name);
    let plugins_dir = server_dir(&name).join("plugins");
    if let Err(e) = std::fs::create_dir_all(&plugins_dir) {
        return json!({"error": e.to_string()});
    }
    let mc = mc_version.filter(|m| !m.trim().is_empty());

    // Prefer a version matching the server's MC version (Paper loader), then relax.
    let mut arr = get_modrinth_versions(slug.to_string(), Some("paper".to_string()), mc.clone())
        .as_array().cloned().unwrap_or_default();
    if arr.is_empty() {
        arr = get_modrinth_versions(slug.to_string(), None, mc.clone()).as_array().cloned().unwrap_or_default();
    }
    if arr.is_empty() {
        arr = get_modrinth_versions(slug.to_string(), None, None).as_array().cloned().unwrap_or_default();
    }
    if arr.is_empty() { return json!({"error": "No versions found for this plugin."}); }

    let target = if let Some(ref vid) = version_id {
        if !vid.is_empty() {
            arr.iter().find(|v| v.get("id").and_then(|i| i.as_str()) == Some(vid.as_str())).unwrap_or(&arr[0])
        } else { &arr[0] }
    } else { &arr[0] };

    let files = target.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    let primary = files.iter().find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)).unwrap_or(files.first().unwrap_or(&Value::Null));
    let filename = primary.get("filename").and_then(|f| f.as_str()).unwrap_or("plugin.jar");
    let url = primary.get("url").and_then(|u| u.as_str()).unwrap_or("");
    if url.is_empty() { return json!({"error": "No download URL for this plugin."}); }

    let dest = plugins_dir.join(filename);
    if let Err(e) = download_file_blocking(url, &dest) {
        return json!({"error": e});
    }
    let gv = target.get("game_versions").and_then(|g| g.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    json!({"success": true, "filename": filename, "game_versions": gv})
}

#[tauri::command]
async fn server_mgr_install_plugin(name: String, slug: String, version_id: Option<String>, mc_version: Option<String>) -> Value {
    // Same as server creation: run blocking HTTP/download work off the async runtime.
    let result = tokio::task::spawn_blocking(move || {
        install_plugin_blocking(&name, &slug, version_id, mc_version)
    }).await;
    result.unwrap_or_else(|_| json!({"error": "Plugin installation task failed"}))
}

#[tauri::command]
fn server_mgr_list_plugins(name: String) -> Value {
    let name = sanitize_server_name(&name);
    let dir = server_dir(&name).join("plugins");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                let fname = e.file_name().to_string_lossy().to_string();
                let lower = fname.to_lowercase();
                if lower.ends_with(".jar") || lower.ends_with(".jar.disabled") {
                    let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                    out.push(json!({"filename": fname, "size": size, "enabled": lower.ends_with(".jar")}));
                }
            }
        }
    }
    out.sort_by(|a, b| a.get("filename").and_then(|v| v.as_str()).unwrap_or("").cmp(b.get("filename").and_then(|v| v.as_str()).unwrap_or("")));
    json!({"success": true, "plugins": out})
}

#[tauri::command]
fn server_mgr_delete_plugin(name: String, filename: String) -> Value {
    let name = sanitize_server_name(&name);
    let path = server_dir(&name).join("plugins").join(&filename);
    if !path.exists() { return json!({"error": "Plugin not found."}); }
    match std::fs::remove_file(&path) {
        Ok(_) => json!({"success": true}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

// ==================== SERVER FEATURES (EXPANDED) ====================
fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = base.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            std::path::Component::Normal(c) => p.push(c),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(p)
}

fn sanitize_file_name(f: &str) -> String {
    Path::new(f).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

fn unique_path(base: &Path) -> PathBuf {
    if !base.exists() { return base.to_path_buf(); }
    let stem = base.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "backup".into());
    let ext = base.extension().map(|s| s.to_string_lossy().to_string());
    let parent = base.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    for i in 1..1000 {
        let candidate = match &ext {
            Some(e) => parent.join(format!("{}-{}.{}", stem, i, e)),
            None => parent.join(format!("{}-{}", stem, i)),
        };
        if !candidate.exists() { return candidate; }
    }
    base.to_path_buf()
}

#[cfg(target_os = "linux")]
fn read_process_rss_kb(pid: u32) -> Option<u64> {
    let s = std::fs::read_to_string(format!("/proc/{}/status", pid)).ok()?;
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            return rest.trim().split_whitespace().next()?.parse().ok();
        }
    }
    None
}
#[cfg(not(target_os = "linux"))]
fn read_process_rss_kb(_pid: u32) -> Option<u64> { None }

fn resolve_purpur_download_url(mc_version: &str) -> Result<String, String> {
    let meta = http_get(&format!("https://api.purpurmc.org/v2/purpur/{}", mc_version), None)
        .map_err(|_| format!("No Purpur build for Minecraft {}.", mc_version))?;
    let latest = meta.get("builds").and_then(|b| b.get("latest")).and_then(|l| l.as_str())
        .ok_or_else(|| format!("No Purpur build for Minecraft {}.", mc_version))?;
    Ok(format!("https://api.purpurmc.org/v2/purpur/{}/{}/download", mc_version, latest))
}

fn resolve_fabric_download_url(mc_version: &str) -> Result<String, String> {
    let loaders = http_get(&format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version), None)
        .map_err(|_| format!("No Fabric loader is available for Minecraft {}.", mc_version))?;
    let loader = loaders.as_array().and_then(|a| a.first())
        .and_then(|l| l.get("loader")).and_then(|l| l.get("version")).and_then(|v| v.as_str())
        .ok_or_else(|| format!("No Fabric loader is available for Minecraft {}.", mc_version))?;
    let installers = http_get("https://meta.fabricmc.net/v2/versions/installer", None).map_err(|_| "Failed to fetch the Fabric installer list.".to_string())?;
    let installer = installers.as_array().and_then(|a| a.first())
        .and_then(|l| l.get("version")).and_then(|v| v.as_str())
        .ok_or("No Fabric installer is available.")?;
    Ok(format!("https://meta.fabricmc.net/v2/versions/loader/{}/{}/{}/server/jar", mc_version, loader, installer))
}

#[tauri::command]
fn server_mgr_server_types() -> Value {
    json!({"types": [
        {"id": "paper", "name": "Paper", "desc": "High performance. Runs Bukkit/Spigot/Paper plugins."},
        {"id": "purpur", "name": "Purpur", "desc": "Paper fork with many extra gameplay options."},
        {"id": "fabric", "name": "Fabric", "desc": "Lightweight mod loader. Use server-side mods."},
        {"id": "vanilla", "name": "Vanilla", "desc": "Official Mojang server. No plugins or mods."}
    ]})
}

#[tauri::command(async)]
fn server_mgr_list_versions(server_type: String) -> Value {
        tokio::task::block_in_place(|| {
    match server_type.to_lowercase().as_str() {
        "purpur" => match http_get("https://api.purpurmc.org/v2/purpur", None) {
            Ok(d) => {
                let mut v: Vec<String> = d.get("versions").and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|s| s.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                v.reverse();
                json!({"success": true, "versions": v})
            }
            Err(e) => json!({"error": e}),
        },
        "fabric" => match http_get("https://meta.fabricmc.net/v2/versions/game", None) {
            Ok(d) => {
                let v: Vec<String> = d.as_array()
                    .map(|a| a.iter().filter(|g| g.get("stable").and_then(|s| s.as_bool()).unwrap_or(false))
                        .filter_map(|g| g.get("version").and_then(|s| s.as_str()).map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                json!({"success": true, "versions": v})
            }
            Err(e) => json!({"error": e}),
        },
        "vanilla" => match http_get(MOJANG_VERSION_MANIFEST, None) {
            Ok(d) => {
                let v: Vec<String> = d.get("versions").and_then(|x| x.as_array())
                    .map(|a| a.iter().filter(|x| x.get("type").and_then(|t| t.as_str()) == Some("release"))
                        .filter_map(|x| x.get("id").and_then(|s| s.as_str()).map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                json!({"success": true, "versions": v})
            }
            Err(e) => json!({"error": e}),
        },
        _ => get_server_versions(),
    }

        })
    }

// ---------- Files ----------
#[tauri::command]
fn server_mgr_files_list(name: String, subpath: Option<String>) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let rel = subpath.unwrap_or_default();
    let dir = safe_join(&base, &rel).unwrap_or_else(|| base.clone());
    let mut entries = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let meta = e.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            entries.push(json!({
                "name": e.file_name().to_string_lossy().to_string(),
                "is_dir": is_dir,
                "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                "modified": meta.as_ref().and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
            }));
        }
    }
    entries.sort_by(|a, b| {
        let ad = a["is_dir"].as_bool().unwrap_or(false);
        let bd = b["is_dir"].as_bool().unwrap_or(false);
        bd.cmp(&ad).then_with(|| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()))
    });
    json!({"success": true, "path": rel, "entries": entries})
}

#[tauri::command]
fn server_mgr_file_read(name: String, path: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let p = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    if let Ok(m) = std::fs::metadata(&p) {
        if m.len() > 5_000_000 { return json!({"error": "File is too large to open (max 5 MB)."}); }
    }
    match std::fs::read_to_string(&p) {
        Ok(c) => json!({"success": true, "content": c}),
        Err(e) => json!({"error": format!("Cannot read file: {}", e)}),
    }
}

#[tauri::command]
fn server_mgr_file_write(name: String, path: String, content: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let p = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    if let Some(parent) = p.parent() { let _ = std::fs::create_dir_all(parent); }
    match std::fs::write(&p, content) {
        Ok(_) => json!({"success": true}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command]
fn server_mgr_file_delete(name: String, path: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let p = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    if p == base { return json!({"error": "Refusing to delete the server root."}); }
    let r = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
    match r { Ok(_) => json!({"success": true}), Err(e) => json!({"error": e.to_string()}) }
}

#[tauri::command]
fn server_mgr_file_mkdir(name: String, path: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let p = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    match std::fs::create_dir_all(&p) { Ok(_) => json!({"success": true}), Err(e) => json!({"error": e.to_string()}) }
}

#[tauri::command]
fn server_mgr_file_upload(name: String, subpath: Option<String>, filename: String, data: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let rel = subpath.unwrap_or_default();
    let dir = match safe_join(&base, &rel) { Some(d) => d, None => return json!({"error": "Invalid path."}) };
    let _ = std::fs::create_dir_all(&dir);
    let fname = sanitize_file_name(&filename);
    let fname = if fname.is_empty() { "upload.bin".to_string() } else { fname };
    let dest = dir.join(&fname);
    let bytes = match base64::engine::general_purpose::STANDARD.decode(data.as_bytes()) {
        Ok(b) => b,
        Err(e) => return json!({"error": format!("Invalid upload data: {}", e)}),
    };
    match std::fs::write(&dest, &bytes) {
        Ok(_) => json!({"success": true, "bytes": bytes.len(), "filename": fname}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

// ---------- Backups ----------
#[tauri::command]
fn server_mgr_backup_list(name: String) -> Value {
    let name = sanitize_server_name(&name);
    let dir = server_dir(&name).join("xryloth_backups");
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                let modified = e.metadata().ok().and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                out.push(json!({"filename": e.file_name().to_string_lossy().to_string(), "size": size, "modified": modified}));
            }
        }
    }
    out.sort_by(|a, b| b["modified"].as_u64().unwrap_or(0).cmp(&a["modified"].as_u64().unwrap_or(0)));
    json!({"success": true, "backups": out})
}

#[tauri::command]
async fn server_mgr_backup_create(name: String, label: Option<String>) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    if !base.join("server.json").exists() { return json!({"error": "Server not found."}); }
    let backups = base.join("xryloth_backups");
    let _ = std::fs::create_dir_all(&backups);
    let label = label.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| chrono::Local::now().format("%Y%m%d-%H%M%S").to_string());
    let safe_label: String = label.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let file = unique_path(&backups.join(format!("{}.zip", safe_label)));
    let zf = match std::fs::File::create(&file) { Ok(f) => f, Err(e) => return json!({"error": e.to_string()}) };
    let mut zip = zip::ZipWriter::new(zf);
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut stack = vec![base.clone()];
    while let Some(dir) = stack.pop() {
        if dir == backups { continue; }
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p == backups { continue; }
                if p.is_dir() { stack.push(p); }
                else if p.is_file() {
                    if let Ok(rel) = p.strip_prefix(&base) {
                        let rel_str = rel.to_string_lossy().replace('\\', "/");
                        if zip.start_file(rel_str, opts).is_ok() {
                            if let Ok(mut f) = std::fs::File::open(&p) {
                                let mut buf = Vec::new();
                                let _ = f.read_to_end(&mut buf);
                                let _ = zip.write_all(&buf);
                            }
                        }
                    }
                }
            }
        }
    }
    match zip.finish() {
        Ok(_) => json!({"success": true, "file": file.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command]
async fn server_mgr_backup_restore(app: State<'_, AppState>, name: String, file: String) -> Result<Value, String> {
    let name = sanitize_server_name(&name);
    if app.server_procs.lock().unwrap().contains_key(&name) {
        return Ok(json!({"error": "Stop the server before restoring a backup."}));
    }
    let base = server_dir(&name);
    let archive_path = base.join("xryloth_backups").join(sanitize_file_name(&file));
    if !archive_path.exists() { return Ok(json!({"error": "Backup not found."})); }
    let f = match std::fs::File::open(&archive_path) { Ok(f) => f, Err(e) => return Ok(json!({"error": e.to_string()})) };
    let mut archive = match zip::ZipArchive::new(f) { Ok(a) => a, Err(e) => return Ok(json!({"error": e.to_string()})) };
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) { Ok(e) => e, Err(_) => continue };
        if entry.name().starts_with("xryloth_backups/") { continue; }
        let outpath = match entry.enclosed_name() { Some(p) => base.join(p), None => continue };
        if entry.is_dir() {
            let _ = std::fs::create_dir_all(&outpath);
        } else {
            if let Some(parent) = outpath.parent() { let _ = std::fs::create_dir_all(parent); }
            if let Ok(mut out) = std::fs::File::create(&outpath) {
                let _ = std::io::copy(&mut entry, &mut out);
            }
        }
    }
    Ok(json!({"success": true}))
}

#[tauri::command]
fn server_mgr_backup_delete(name: String, file: String) -> Value {
    let name = sanitize_server_name(&name);
    let path = server_dir(&name).join("xryloth_backups").join(sanitize_file_name(&file));
    if !path.exists() { return json!({"error": "Backup not found."}); }
    match std::fs::remove_file(&path) { Ok(_) => json!({"success": true}), Err(e) => json!({"error": e.to_string()}) }
}

// ---------- Plugins ----------
#[tauri::command]
fn server_mgr_plugin_toggle(name: String, filename: String) -> Value {
    let name = sanitize_server_name(&name);
    let dir = server_dir(&name).join("plugins");
    let fname = sanitize_file_name(&filename);
    let src = dir.join(&fname);
    if !src.exists() { return json!({"error": "Plugin not found."}); }
    let disabled = fname.to_lowercase().ends_with(".disabled");
    let dest = if disabled {
        dir.join(&fname[..fname.len() - ".disabled".len()])
    } else {
        dir.join(format!("{}.disabled", fname))
    };
    match std::fs::rename(&src, &dest) {
        Ok(_) => json!({"success": true, "enabled": disabled}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

// ---------- Worlds ----------
#[tauri::command]
fn server_mgr_list_worlds(name: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let mut worlds = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&base) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                let wname = e.file_name().to_string_lossy().to_string();
                if wname.starts_with("world") && p.join("level.dat").exists() {
                    worlds.push(wname);
                }
            }
        }
    }
    worlds.sort();
    json!({"success": true, "worlds": worlds})
}

#[tauri::command]
fn server_mgr_delete_world(app: State<AppState>, name: String, world: String) -> Value {
    let name = sanitize_server_name(&name);
    if app.server_procs.lock().unwrap().contains_key(&name) {
        return json!({"error": "Stop the server before deleting a world."});
    }
    let base = server_dir(&name);
    let wname = sanitize_file_name(&world);
    if !wname.starts_with("world") { return json!({"error": "Invalid world name."}); }
    let p = base.join(&wname);
    if !p.starts_with(&base) || !p.exists() { return json!({"error": "World not found."}); }
    match std::fs::remove_dir_all(&p) { Ok(_) => json!({"success": true}), Err(e) => json!({"error": e.to_string()}) }
}

// ---------- Meta / EULA / Clone ----------
#[tauri::command]
fn server_mgr_set_meta(name: String, ram_mb: Option<u64>, motd: Option<String>, port: Option<u16>) -> Value {
    let name = sanitize_server_name(&name);
    let path = server_dir(&name).join("server.json");
    if !path.exists() { return json!({"error": "Server not found."}); }
    let mut meta = load_json(&path);
    if !meta.is_object() { meta = json!({}); }
    if let Some(r) = ram_mb { meta["ram_mb"] = json!(r); }
    if let Some(m) = motd { meta["motd"] = json!(m); }
    if let Some(p) = port { meta["port"] = json!(p); }
    save_json(&path, &meta);
    if let Some(p) = port {
        let pp = server_dir(&name).join("server.properties");
        if pp.exists() {
            let content = std::fs::read_to_string(&pp).unwrap_or_default();
            let lines: Vec<String> = content.lines()
                .map(|l| if l.trim_start().starts_with("server-port=") { format!("server-port={}", p) } else { l.to_string() })
                .collect();
            let _ = std::fs::write(&pp, lines.join("\n") + "\n");
        }
    }
    json!({"success": true, "server": meta})
}

#[tauri::command]
fn server_mgr_eula(name: String, accept: bool) -> Value {
    let name = sanitize_server_name(&name);
    match std::fs::write(server_dir(&name).join("eula.txt"), format!("eula={}\n", accept)) {
        Ok(_) => json!({"success": true}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command]
async fn server_mgr_clone(app: State<'_, AppState>, source: String, new_name: String, new_port: Option<u16>) -> Result<Value, String> {
    let source = sanitize_server_name(&source);
    let new_name = sanitize_server_name(&new_name);
    if new_name.is_empty() { return Ok(json!({"error": "Enter a valid new server name."})); }
    if app.server_procs.lock().unwrap().contains_key(&source) {
        return Ok(json!({"error": "Stop the source server before cloning it."}));
    }
    let src = server_dir(&source);
    let dst = server_dir(&new_name);
    if !src.join("server.json").exists() { return Ok(json!({"error": "Source server not found."})); }
    if dst.exists() { return Ok(json!({"error": "A server with that name already exists."})); }
    if let Err(e) = copy_dir_recursive(&src, &dst) { return Ok(json!({"error": e})); }
    let _ = std::fs::remove_dir_all(dst.join("xryloth_backups"));
    let meta_path = dst.join("server.json");
    let mut meta = load_json(&meta_path);
    if !meta.is_object() { meta = json!({}); }
    meta["name"] = json!(new_name);
    if let Some(p) = new_port { meta["port"] = json!(p); }
    save_json(&meta_path, &meta);
    if let Some(p) = new_port {
        let pp = dst.join("server.properties");
        if pp.exists() {
            let content = std::fs::read_to_string(&pp).unwrap_or_default();
            let lines: Vec<String> = content.lines()
                .map(|l| if l.trim_start().starts_with("server-port=") { format!("server-port={}", p) } else { l.to_string() })
                .collect();
            let _ = std::fs::write(&pp, lines.join("\n") + "\n");
        }
    }
    Ok(json!({"success": true, "server": meta}))
}

// ---------- Stats / Ports / Logs ----------
#[tauri::command]
fn server_mgr_stats(app: State<AppState>, name: String) -> Value {
    let name = sanitize_server_name(&name);
    let procs = app.server_procs.lock().unwrap();
    match procs.get(&name) {
        Some(p) => {
            let pid = p.child.id();
            json!({
                "running": true,
                "pid": pid,
                "uptime_secs": p.started_at.elapsed().as_secs(),
                "memory_kb": read_process_rss_kb(pid).unwrap_or(0),
            })
        }
        None => json!({"running": false, "pid": 0, "uptime_secs": 0, "memory_kb": 0}),
    }
}

#[tauri::command]
fn server_mgr_check_port(port: u16) -> Value {
    match std::net::TcpListener::bind(("0.0.0.0", port)) {
        Ok(_) => json!({"available": true}),
        Err(_) => json!({"available": false}),
    }
}

#[tauri::command]
fn server_mgr_next_port(start: Option<u16>) -> Value {
    let s = start.unwrap_or(25565);
    for p in s..s.saturating_add(1000) {
        if std::net::TcpListener::bind(("0.0.0.0", p)).is_ok() {
            return json!({"port": p});
        }
    }
    json!({"port": s})
}

#[tauri::command]
fn server_mgr_clear_logs(app: State<AppState>, name: String) -> Value {
    let name = sanitize_server_name(&name);
    if let Ok(mut logs) = app.server_logs.lock() { logs.insert(name, Vec::new()); }
    json!({"success": true})
}

// ==================== SERVER: EXTENDED TOOLS ====================
#[tauri::command]
fn server_mgr_update_meta(name: String, patch: Value) -> Value {
    let name = sanitize_server_name(&name);
    let path = server_dir(&name).join("server.json");
    if !path.exists() { return json!({"error": "Server not found."}); }
    let mut meta = load_json(&path);
    if !meta.is_object() { meta = json!({}); }
    if let Some(obj) = patch.as_object() {
        for (k, v) in obj {
            meta[k] = v.clone();
        }
    }
    save_json(&path, &meta);
    // Keep server.properties in sync with the port when applicable.
    if let Some(p) = patch.get("port").and_then(|v| v.as_u64()) {
        let pp = server_dir(&name).join("server.properties");
        if pp.exists() {
            let content = std::fs::read_to_string(&pp).unwrap_or_default();
            let lines: Vec<String> = content.lines()
                .map(|l| if l.trim_start().starts_with("server-port=") { format!("server-port={}", p) } else { l.to_string() })
                .collect();
            let _ = std::fs::write(&pp, lines.join("\n") + "\n");
        }
    }
    json!({"success": true, "server": meta})
}

#[tauri::command]
fn server_mgr_list_java() -> Value {
    json!({"success": true, "javas": find_all_java_installations()})
}

#[tauri::command]
fn server_mgr_open_folder(name: String) -> Value {
    let name = sanitize_server_name(&name);
    let dir = server_dir(&name);
    if !dir.exists() { return json!({"error": "Server folder not found."}); }
    let _ = webbrowser::open(&dir.to_string_lossy());
    json!({"success": true})
}

#[tauri::command]
fn server_mgr_read_icon(name: String) -> Value {
    let name = sanitize_server_name(&name);
    let p = server_dir(&name).join("server-icon.png");
    if !p.exists() { return json!({"exists": false}); }
    match std::fs::read(&p) {
        Ok(bytes) => json!({
            "exists": true,
            "data": base64::engine::general_purpose::STANDARD.encode(bytes)
        }),
        Err(_) => json!({"exists": false}),
    }
}

#[tauri::command]
fn server_mgr_file_rename(name: String, path: String, new_name: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let src = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    if !src.exists() { return json!({"error": "File not found."}); }
    let fname = sanitize_file_name(&new_name);
    if fname.is_empty() { return json!({"error": "Enter a valid name."}); }
    let parent = src.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| base.clone());
    let dest = parent.join(&fname);
    if src == dest { return json!({"success": true, "name": fname}); }
    if dest.exists() { return json!({"error": "An item with that name already exists."}); }
    match std::fs::rename(&src, &dest) {
        Ok(_) => json!({"success": true, "name": fname}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command]
fn server_mgr_file_copy(name: String, path: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let src = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    if !src.exists() { return json!({"error": "File not found."}); }
    let parent = src.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| base.clone());
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "copy".into());
    let ext = src.extension().map(|s| s.to_string_lossy().to_string());
    let mut dest = match &ext {
        Some(e) => parent.join(format!("{} - copy.{}", stem, e)),
        None => parent.join(format!("{} - copy", stem)),
    };
    let mut i = 1;
    while dest.exists() {
        dest = match &ext {
            Some(e) => parent.join(format!("{} - copy ({}).{}", stem, i, e)),
            None => parent.join(format!("{} - copy ({})", stem, i)),
        };
        i += 1;
        if i > 1000 { break; }
    }
    let result = if src.is_dir() {
        copy_dir_recursive(&src, &dest)
    } else {
        std::fs::copy(&src, &dest).map(|_| ()).map_err(|e| e.to_string())
    };
    match result {
        Ok(_) => json!({"success": true, "name": dest.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()}),
        Err(e) => json!({"error": e}),
    }
}

#[tauri::command]
fn server_mgr_file_read_b64(name: String, path: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let p = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    if let Ok(m) = std::fs::metadata(&p) {
        if m.len() > 16_000_000 { return json!({"error": "File is too large to preview (max 16 MB)."}); }
    }
    match std::fs::read(&p) {
        Ok(b) => json!({"success": true, "data": base64::engine::general_purpose::STANDARD.encode(&b)}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command]
fn server_mgr_file_download(name: String, path: String) -> Value {
    let name = sanitize_server_name(&name);
    let base = server_dir(&name);
    let src = match safe_join(&base, &path) { Some(p) => p, None => return json!({"error": "Invalid path."}) };
    if !src.is_file() { return json!({"error": "Only files can be downloaded."}); }
    let fname = src.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "file.bin".into());
    let dest = tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_file_name(&fname)
        .save_file();
    match dest {
        Some(d) => match std::fs::copy(&src, &d) {
            Ok(_) => json!({"success": true, "saved": d.to_string_lossy()}),
            Err(e) => json!({"error": e.to_string()}),
        },
        None => json!({"cancelled": true}),
    }
}

#[tauri::command]
fn server_mgr_reset_world(app: State<AppState>, name: String, world: Option<String>) -> Value {
    let name = sanitize_server_name(&name);
    if app.server_procs.lock().unwrap().contains_key(&name) {
        return json!({"error": "Stop the server before resetting a world."});
    }
    let base = server_dir(&name);
    let mut removed: Vec<String> = Vec::new();
    let targets: Vec<String> = match world {
        Some(w) if !w.trim().is_empty() => vec![sanitize_file_name(&w)],
        _ => {
            let mut v = Vec::new();
            if let Ok(rd) = std::fs::read_dir(&base) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    let p = e.path();
                    if p.is_dir() && n.starts_with("world") && p.join("level.dat").exists() {
                        v.push(n);
                    }
                }
            }
            v
        }
    };
    for w in targets {
        if !w.starts_with("world") { continue; }
        let p = base.join(&w);
        if p.starts_with(&base) && p.exists() {
            if std::fs::remove_dir_all(&p).is_ok() { removed.push(w); }
        }
    }
    json!({"success": true, "removed": removed})
}

fn reinstall_server_blocking(app_handle: Option<tauri::AppHandle>, name: &str, version: &str) -> Value {
    let name = sanitize_server_name(name);
    let dir = server_dir(&name);
    let meta_path = dir.join("server.json");
    if !meta_path.exists() { return json!({"error": "Server not found."}); }
    let mut meta = load_json(&meta_path);
    let stype = meta.get("type").and_then(|v| v.as_str()).unwrap_or("paper").to_string();
    let url = match stype.as_str() {
        "vanilla" => resolve_vanilla_server_url(version),
        "purpur" => resolve_purpur_download_url(version),
        "fabric" => resolve_fabric_download_url(version),
        _ => resolve_paper_download_url(version),
    };
    let url = match url { Ok(u) => u, Err(e) => return json!({"error": e}) };
    let name_for_evt = name.clone();
    let dl = download_file_progress(&url, &dir.join("server.jar"), |done, total| {
        if let Some(h) = &app_handle {
            let _ = h.emit_all("server-mgr-download", json!({
                "server": name_for_evt,
                "phase": "jar",
                "downloaded": done,
                "total": total,
            }));
        }
    });
    if let Err(e) = dl { return json!({"error": format!("Failed to download server jar: {}", e)}); }
    if !meta.is_object() { meta = json!({}); }
    meta["version"] = json!(version);
    save_json(&meta_path, &meta);
    json!({"success": true, "server": meta})
}

#[tauri::command]
async fn server_mgr_reinstall(app_handle: tauri::AppHandle, name: String, version: String) -> Value {
    let result = tokio::task::spawn_blocking(move || {
        reinstall_server_blocking(Some(app_handle), &name, &version)
    }).await;
    result.unwrap_or_else(|_| json!({"error": "Reinstall task failed"}))
}

// ==================== AI ASSISTANT (GROQ + GEMINI FALLBACK) ====================

// An agentic assistant with 200+ real tools that drives the launcher and its
    // local servers. Primary provider: Groq (llama-3.2-11b-vision-preview).
    // If Groq fails, it transparently falls back to Google Gemini.
    const GROQ_API: &str = "https://api.groq.com/openai/v1/chat/completions";
    // NOTE: API keys now have COMPILE-TIME EMBEDDED DEFAULTS (your provided keys)
    // so users work out of the box. GitHub secret scanning is avoided by embedding
    // at compile time via build.rs + rustc-env, not committing to source.
    // Resolution order:
    //   1. launcher settings  (ai_groq_key / ai_gemini_key — set on the Xryloth AI page)
    //   2. ~/.xryloth/ai_keys.json
    //   3. environment variables XRYLOTH_GROQ_KEY / XRYLOTH_GEMINI_KEY
    //   4. COMPILE-TIME EMBEDDED DEFAULTS (your provided keys — users work out of the box)
    const AI_GROQ_SETTING_KEY: &str = "ai_groq_key";
    const AI_GEMINI_SETTING_KEY: &str = "ai_gemini_key";
    const AI_GROQ_ENV: &str = "XRYLOTH_GROQ_KEY";
    const AI_GEMINI_ENV: &str = "XRYLOTH_GEMINI_KEY";

fn ai_resolve_key(app: &State<AppState>, setting_key: &str, env_key: &str, file_key: &str) -> String {
    // 1. Launcher settings.
    if let Some(v) = load_settings(app).get(setting_key).and_then(|v| v.as_str()) {
        if !v.trim().is_empty() { return v.trim().to_string(); }
    }
    // 2. A keys file next to the launcher data folder (never committed to git).
    let path = app_dir().join("ai_keys.json");
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                if let Some(k) = v.get(file_key).and_then(|x| x.as_str()) {
                    if !k.trim().is_empty() { return k.trim().to_string(); }
                }
            }
        }
    }
    // 3. Environment variables.
    if let Ok(v) = std::env::var(env_key) {
        if !v.trim().is_empty() { return v.trim().to_string(); }
    }
    // 4. COMPILE-TIME EMBEDDED DEFAULTS (keys baked into the binary by build.rs —
    //    users work out of the box with no external keys/config needed).
    let embedded = if env_key == AI_GROQ_ENV {
        embedded_keys::DEFAULT_GROQ_KEY
    } else if env_key == AI_GEMINI_ENV {
        embedded_keys::DEFAULT_GEMINI_KEY
    } else {
        ""
    };
    if !embedded.trim().is_empty() { return embedded.trim().to_string(); }
    String::new()
}

// The user's requested model is first; Groq decommissioned llama-3.2-11b-vision-preview,
// so the chain transparently moves to a tool-capable model, then to Gemini.
// Groq tool-capable models, fastest/most-reliable first. (llama-3.2-11b-vision-preview
// was decommissioned by Groq and removed — leading with it only wasted a round-trip.)
const GROQ_MODELS: [&str; 4] = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.1-8b-instant"];
const GEMINI_API: &str = "https://generativelanguage.googleapis.com/v1beta/models";
// Fallback provider used when Groq cannot answer: the requested Gemini model first.
const GEMINI_MODELS: [&str; 3] = ["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];
const AI_MAX_TOOL_ROUNDS: usize = 12;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum AiProvider { Groq, Gemini }

#[derive(Clone)]
struct AiToolCall { id: String, name: String, arguments: String }

struct AiResponse { content: String, tool_calls: Vec<AiToolCall>, streamed: bool }

// ---------- system prompt ----------
fn ai_system_prompt(app: &State<AppState>) -> String {
    let ctx = app.ai_context.lock().unwrap().clone();
    let mut s = String::new();
    s.push_str("You are Xryloth AI, the built-in assistant of the Xryloth Minecraft launcher. You control the launcher, its game profiles and its self-hosted Minecraft servers using tools.\n\n");
    s.push_str(&format!("Launcher version: {}\nOS: {}\nData folder: {}\nServers folder: {}\nInstances folder: {}\n",
        APP_DISPLAY_VERSION, std::env::consts::OS, app_dir().to_string_lossy(), servers_dir().to_string_lossy(), instances_dir().to_string_lossy()));
    if let Some(c) = &ctx {
        let kind = c["kind"].as_str().unwrap_or("");
        let name = c["name"].as_str().unwrap_or("");
        s.push_str(&format!("\nACTIVE WORKSPACE: {} \"{}\". Every target-specific action applies to it unless the user names a different server/profile.\n", kind, name));
        if kind == "server" {
            let meta = load_json(&server_dir(name).join("server.json"));
            s.push_str(&format!("Server facts: type={} minecraft={} port={} ram={}MB folder={}\n",
                meta["type"].as_str().unwrap_or("?"), meta["version"].as_str().unwrap_or("?"),
                meta["port"].as_u64().unwrap_or(25565), meta["ram_mb"].as_u64().unwrap_or(4096),
                server_dir(name).to_string_lossy()));
        } else if kind == "instance" {
            for inst in load_instances_raw(app) {
                if inst["name"].as_str() == Some(name) {
                    s.push_str(&format!("Profile facts: minecraft={} loader={} loader_version={} folder={}\n",
                        inst["version"].as_str().unwrap_or("?"), inst["loader"].as_str().unwrap_or("?"),
                        inst["loader_version"].as_str().unwrap_or("?"),
                        instances_dir().join(name).to_string_lossy()));
                    break;
                }
            }
        }
    } else {
        s.push_str("\nNo active workspace is selected. If the user names a server or profile, select it with ai_context_set_server / ai_context_set_instance before acting on it.\n");
    }
    s.push_str("\nRULES:\n");
    s.push_str("- ALWAYS use a tool to perform an action. Never just describe an action you are able to do.\n");
    s.push_str("- If the user names a server/profile that is not the active workspace, select it first, then act.\n");
    s.push_str("- If no tool fits the request, call the matching ai_guide_* tool to fetch REAL facts (real paths, real versions, real ports, real URLs) and then write a precise step-by-step guide built ONLY from those facts. Never invent paths, versions, or URLs.\n");
    s.push_str("- For plugin/mod installs, resolve the correct version for the target's Minecraft version and loader automatically.\n");
    s.push_str("- Keep replies concise. After finishing actions, briefly confirm what you did.\n");
    s.push_str("- You have 200+ tools covering servers, console commands, players/whitelist/ops, plugins, worlds, backups, files, profiles, mods, launcher settings, navigation and guides.\n");
    s
}

// ==================== IMAGE DISK CACHE ====================
// Remote art (mod icons, banners, partner logos, avatars, news artwork) is
// downloaded once into ~/.xryloth/image_cache and displayed through the asset
// protocol. The frontend asks image_cache_get before showing anything:
//   - hit  -> local path returned immediately (first paint never waits)
//   - stale -> background conditional GET (If-None-Match / If-Modified-Since);
//              if the image changed, "image-cache-updated" swaps it live
//   - miss -> download now (caller falls back to the remote URL on error)

fn image_cache_dir() -> PathBuf {
    let d = app_dir().join("image_cache");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn image_cache_key(url: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn image_cache_paths(url: &str) -> (PathBuf, PathBuf) {
    let dir = image_cache_dir();
    let key = image_cache_key(url);
    (dir.join(format!("{}.img", key)), dir.join(format!("{}.json", key)))
}

fn image_meta_read(meta: &Path) -> Value {
    match std::fs::read_to_string(meta)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    {
        // Only objects are usable as meta (a corrupt file must never panic
        // the revalidation task when we write fetched_at into it).
        Some(v @ Value::Object(_)) => v,
        _ => json!({}),
    }
}

/// Guard against caching HTML error pages / JSON as "images".
fn image_bytes_look_like_image(b: &[u8]) -> bool {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) { return true; } // PNG
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) { return true; }       // JPEG
    if b.starts_with(b"GIF8") { return true; }                   // GIF
    if b.starts_with(b"RIFF") && b.len() > 12 && &b[8..12] == b"WEBP" { return true; }
    if b.starts_with(&[0x00, 0x00, 0x01, 0x00]) { return true; } // ICO
    let head = String::from_utf8_lossy(&b[..b.len().min(256)]).trim_start().to_lowercase();
    head.starts_with("<?xml") || head.starts_with("<svg")
}

const IMAGE_REVALIDATE_SECS: i64 = 3600; // re-check remote after 1h

/// Download (or conditionally revalidate) `url` into the cache.
/// Returns "updated" | "not-modified".
async fn image_fetch_into_cache(url: &str, conditional: bool) -> Result<String, String> {
    let (file, meta_path) = image_cache_paths(url);
    let meta = image_meta_read(&meta_path);

    let mut req = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(url);
    if conditional {
        if let Some(e) = meta.get("etag").and_then(|v| v.as_str()) {
            if !e.is_empty() { req = req.header("If-None-Match", e); }
        }
        if let Some(l) = meta.get("last_modified").and_then(|v| v.as_str()) {
            if !l.is_empty() { req = req.header("If-Modified-Since", l); }
        }
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();

    if status.as_u16() == 304 {
        let mut m = meta;
        m["fetched_at"] = json!(chrono::Local::now().timestamp());
        let _ = std::fs::write(&meta_path, m.to_string());
        return Ok("not-modified".into());
    }
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }

    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let last_modified = resp
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if !ctype.starts_with("image/") && !image_bytes_look_like_image(&bytes) {
        return Err("response is not an image".into());
    }

    std::fs::write(&file, &bytes).map_err(|e| e.to_string())?;
    let new_meta = json!({
        "url": url,
        "etag": etag,
        "last_modified": last_modified,
        "fetched_at": chrono::Local::now().timestamp(),
        "size": bytes.len()
    });
    let _ = std::fs::write(&meta_path, new_meta.to_string());
    Ok("updated".into())
}

#[tauri::command]
async fn image_cache_get(app: tauri::AppHandle, url: String) -> Value {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return json!({"error": "not a remote image url"});
    }
    let (file, meta_path) = image_cache_paths(&url);

    if file.exists() {
        // Instant hit — never block the UI. Revalidate stale copies in the
        // background and push a live swap event if the image changed.
        let meta = image_meta_read(&meta_path);
        let fetched_at = meta.get("fetched_at").and_then(|v| v.as_i64()).unwrap_or(0);
        let stale = chrono::Local::now().timestamp() - fetched_at > IMAGE_REVALIDATE_SECS;
        if stale {
            let bg_app = app.clone();
            let bg_url = url.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(state) = image_fetch_into_cache(&bg_url, true).await {
                    if state == "updated" {
                        let (f, _) = image_cache_paths(&bg_url);
                        let _ = bg_app.emit_all(
                            "image-cache-updated",
                            json!({"url": bg_url, "path": f.to_string_lossy()}),
                        );
                    }
                }
            });
        }
        return json!({
            "success": true, "cached": true, "stale": stale,
            "path": file.to_string_lossy()
        });
    }

    // Cache miss — fetch now so the page can show something real.
    match image_fetch_into_cache(&url, false).await {
        Ok(_) => json!({"success": true, "cached": false, "path": file.to_string_lossy()}),
        Err(e) => json!({"error": e}),
    }
}

#[tauri::command]
async fn image_cache_warm(app: tauri::AppHandle, urls: Vec<String>) -> Value {
    // Pre-download the art the launcher shows on its first screens (avatars,
    // partner logos/banners, server icons) while the app boots, so opening a
    // page paints instantly from disk.
    let mut queue: Vec<String> = Vec::new();
    for u in urls {
        if queue.len() >= 64 { break; }
        if !(u.starts_with("http://") || u.starts_with("https://")) { continue; }
        if queue.contains(&u) { continue; }
        let (f, m) = image_cache_paths(&u);
        if f.exists() {
            let meta = image_meta_read(&m);
            let fetched_at = meta.get("fetched_at").and_then(|v| v.as_i64()).unwrap_or(0);
            if chrono::Local::now().timestamp() - fetched_at <= IMAGE_REVALIDATE_SECS {
                continue; // fresh on disk already
            }
        }
        queue.push(u);
    }
    let n = queue.len();
    if n == 0 { return json!({"success": true, "queued": 0}); }

    tauri::async_runtime::spawn(async move {
        for u in queue {
            let conditional = image_cache_paths(&u).0.exists();
            if let Ok(state) = image_fetch_into_cache(&u, conditional).await {
                if state == "updated" {
                    let (f, _) = image_cache_paths(&u);
                    let _ = app.emit_all(
                        "image-cache-updated",
                        json!({"url": u, "path": f.to_string_lossy()}),
                    );
                }
            }
        }
    });
    json!({"success": true, "queued": n})
}

// ---------- tool definitions ----------
fn ai_tool(name: &str, desc: &str, props: &[(&str, &str, &str, bool)]) -> Value {
    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();
    for (n, ty, d, req) in props {
        properties.insert(n.to_string(), json!({"type": ty, "description": d}));
        if *req { required.push(n.to_string()); }
    }
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": Value::Object(properties), "required": required}
        }
    })
}
fn ai_simple(name: &str, desc: &str) -> Value { ai_tool(name, desc, &[]) }
fn ai_target(name: &str, desc: &str) -> Value {
    ai_tool(name, desc, &[("server", "string", "Server name (defaults to the active workspace server)", false)])
}

fn ai_tool_defs() -> Vec<Value> {
    let mut t: Vec<Value> = Vec::new();

    // --- server lifecycle ---
    t.push(ai_simple("server_list", "List every local self-hosted server with its type, version, port, RAM and running state."));
    t.push(ai_tool("server_create", "Create a new self-hosted server and download its server jar. E.g. name ForizCart, type paper, version 1.21.11, port 25579.", &[
        ("name", "string", "Server name", true),
        ("server_type", "string", "paper, purpur, fabric or vanilla", true),
        ("mc_version", "string", "Minecraft version, e.g. 1.21.11", true),
        ("port", "integer", "Server port", false),
        ("motd", "string", "MOTD text (leave empty for the default Xryloth MOTD)", false),
        ("ram_mb", "integer", "Max RAM in MB", false),
    ]));
    t.push(ai_target("server_delete", "Permanently delete a server and its folder."));
    t.push(ai_target("server_start", "Start a server."));
    t.push(ai_target("server_stop", "Gracefully stop a running server (saves worlds)."));
    t.push(ai_target("server_restart", "Restart a server (stop then start)."));
    t.push(ai_target("server_kill", "Force-kill a server immediately."));
    t.push(ai_target("server_status", "Check whether a server is running."));
    t.push(ai_target("server_stats", "Get a server's uptime and player count."));
    t.push(ai_tool("server_reinstall", "Re-download the server jar for a (new) Minecraft version. Keeps worlds and plugins.", &[
        ("version", "string", "Target Minecraft version", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_clone", "Clone a server to a new name.", &[
        ("new_name", "string", "Name for the clone", true),
        ("port", "integer", "Port for the clone", false),
        ("server", "string", "Source server name", false),
    ]));
    t.push(ai_target("server_eula_accept", "Accept the Minecraft EULA for a server."));
    t.push(ai_target("server_eula_revoke", "Revoke the EULA for a server."));
    t.push(ai_tool("server_versions_list", "List downloadable Minecraft versions for a server type, newest first.", &[
        ("server_type", "string", "paper, purpur, fabric or vanilla", true),
    ]));
    t.push(ai_simple("server_types_list", "List the supported server types (Paper, Purpur, Fabric, Vanilla)."));
    t.push(ai_simple("server_java_list", "List every Java installation detected on this machine with its major version."));
    t.push(ai_tool("server_check_port", "Check whether a TCP port is free.", &[("port", "integer", "Port to check", true)]));
    t.push(ai_tool("server_next_port", "Find the next free port starting from a value.", &[("start", "integer", "Port to start from", false)]));
    t.push(ai_target("server_open_folder", "Open a server's folder in the OS file manager."));
    t.push(ai_target("server_icon_read", "Read a server's server-icon.png as base64."));

    // --- server console ---
    let console_cmds: &[(&str, &str, bool)] = &[
        ("server_console_command", "Run an arbitrary console command on a running server.", true),
        ("server_console_say", "Broadcast a message to all players.", true),
        ("server_console_list", "List online players.", false),
        ("server_console_save_all", "Force-save all worlds.", false),
        ("server_console_tps", "Show server TPS.", false),
        ("server_console_stop", "Shut the server down safely.", false),
        ("server_console_op", "Give a player operator rights.", true),
        ("server_console_deop", "Remove operator rights.", true),
        ("server_console_kick", "Kick a player (optional reason).", true),
        ("server_console_ban", "Ban a player (optional reason).", true),
        ("server_console_pardon", "Unban a player.", true),
        ("server_console_ban_ip", "Ban an IP address.", true),
        ("server_console_pardon_ip", "Unban an IP address.", true),
        ("server_console_gamemode", "Change a player's gamemode (survival/creative/adventure/spectator).", true),
        ("server_console_give", "Give a player an item.", true),
        ("server_console_tp", "Teleport a player to another player or coordinates.", true),
        ("server_console_time_set", "Set the time (day/night or a tick value).", true),
        ("server_console_weather", "Set the weather (clear/rain/thunder).", true),
        ("server_console_difficulty", "Set the difficulty (peaceful/easy/normal/hard).", true),
        ("server_console_clear", "Clear a player's inventory.", true),
        ("server_console_effect", "Give a player an effect.", true),
        ("server_console_kill", "Kill a player.", true),
        ("server_console_reload", "Reload the server (plugins/datapacks).", false),
        ("server_console_whitelist_reload", "Reload the whitelist.", false),
        ("server_console_seed", "Show the world seed.", false),
        ("server_console_help", "Show the console help for a command.", true),
    ];
    for (name, desc, needs_args) in console_cmds {
        if *needs_args {
            t.push(ai_tool(name, desc, &[
                ("command", "string", "Command or arguments to run", true),
                ("server", "string", "Server name (defaults to active workspace)", false),
            ]));
        } else {
            t.push(ai_target(name, desc));
        }
    }

    // --- server settings setters ---
    let setters: &[(&str, &str, &str)] = &[
        ("motd", "string", "MOTD text shown in the server list"),
        ("port", "integer", "Server port"),
        ("ram", "integer", "Max RAM in MB"),
        ("xms", "integer", "Min RAM (Xms) in MB"),
        ("java", "string", "Path to the Java executable to use"),
        ("jvm_args", "string", "Extra JVM arguments"),
        ("aikar_flags", "boolean", "Enable Aikar's G1GC tuning flags"),
        ("auto_restart", "boolean", "Auto-restart the server when it crashes"),
        ("start_on_launch", "boolean", "Start the server automatically when the launcher opens"),
        ("gamemode", "string", "Default gamemode (survival/creative/adventure/spectator)"),
        ("difficulty", "string", "Difficulty (peaceful/easy/normal/hard)"),
        ("max_players", "integer", "Max players"),
        ("view_distance", "integer", "View distance"),
        ("simulation_distance", "integer", "Simulation distance"),
        ("spawn_protection", "integer", "Spawn protection radius"),
        ("online_mode", "boolean", "Verify Minecraft accounts (online mode)"),
        ("pvp", "boolean", "Allow player versus player damage"),
        ("allow_flight", "boolean", "Allow flying"),
        ("command_blocks", "boolean", "Enable command blocks"),
        ("whitelist", "boolean", "Enable the whitelist"),
        ("enforce_whitelist", "boolean", "Enforce the whitelist"),
        ("allow_nether", "boolean", "Allow the Nether"),
        ("spawn_monsters", "boolean", "Spawn monsters"),
        ("spawn_animals", "boolean", "Spawn animals"),
        ("spawn_npcs", "boolean", "Spawn villagers/NPCs"),
        ("generate_structures", "boolean", "Generate structures"),
        ("hardcore", "boolean", "Hardcore mode"),
        ("force_gamemode", "boolean", "Force the default gamemode on every join"),
    ];
    for (key, ty, desc) in setters {
        t.push(ai_tool(&format!("server_set_{}", key), &format!("Set a server's {} (saved to server.json / server.properties).", desc), &[
            ("value", ty, "New value", true),
            ("server", "string", "Server name (defaults to active workspace)", false),
        ]));
    }
    t.push(ai_target("server_properties_get", "Read one property from server.properties.", ));
    t.push(ai_tool("server_properties_get_one", "Read one named property from server.properties.", &[
        ("key", "string", "Property name, e.g. motd", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_target("server_properties_get_all", "Read every property from server.properties."));
    t.push(ai_tool("server_properties_set", "Set one or more server.properties values at once.", &[
        ("properties", "object", "Map of property name -> value", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));

    // --- players / whitelist / ops / bans ---
    t.push(ai_tool("server_whitelist_add", "Add a player to the server whitelist (writes whitelist.json and reloads if running).", &[
        ("player", "string", "Player name", true),
        ("uuid", "string", "Player UUID (optional, needed for online-mode servers)", false),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_whitelist_remove", "Remove a player from the whitelist.", &[
        ("player", "string", "Player name", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_target("server_whitelist_list", "List whitelisted players."));
    t.push(ai_target("server_whitelist_enable", "Enable the whitelist (server.properties)."));
    t.push(ai_target("server_whitelist_disable", "Disable the whitelist (server.properties)."));
    t.push(ai_target("server_whitelist_reload", "Reload the whitelist on a running server."));
    t.push(ai_tool("server_ops_add", "Add a player to ops.json.", &[
        ("player", "string", "Player name", true),
        ("level", "integer", "Op level 1-4", false),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_ops_remove", "Remove a player from ops.json.", &[
        ("player", "string", "Player name", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_target("server_ops_list", "List operators."));
    t.push(ai_tool("server_bans_add", "Add a player to banned-players.json.", &[
        ("player", "string", "Player name", true),
        ("reason", "string", "Ban reason", false),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_bans_remove", "Remove a player from banned-players.json.", &[
        ("player", "string", "Player name", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_target("server_bans_list", "List banned players."));
    t.push(ai_target("server_players_list", "List currently online players (console list on a running server)."));

    // --- plugins ---
    t.push(ai_target("server_plugins_list", "List installed plugins (jars) in the server's plugins folder."));
    t.push(ai_tool("server_plugin_install", "Download and install a Modrinth plugin into the server's plugins folder, auto-picking the right version for the server's Minecraft version.", &[
        ("slug", "string", "Modrinth project slug, e.g. viaversion", true),
        ("version", "string", "Specific Modrinth version id (optional)", false),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_plugin_remove", "Delete a plugin jar from the plugins folder.", &[
        ("filename", "string", "Plugin jar filename", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_plugin_search", "Search Modrinth for plugins (project_type=mod, loader=paper).", &[
        ("query", "string", "Search query", true),
        ("limit", "integer", "Max results", false),
    ]));
    t.push(ai_tool("server_plugin_info", "Fetch Modrinth project info for a plugin slug.", &[("slug", "string", "Modrinth slug", true)]));
    t.push(ai_tool("server_plugin_enable", "Enable a plugin (rename .disabled back to .jar).", &[
        ("filename", "string", "Plugin jar filename", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_plugin_disable", "Disable a plugin (rename .jar to .disabled).", &[
        ("filename", "string", "Plugin jar filename", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_viaversion_install", "Install ViaVersion into a server (convenience alias of server_plugin_install for slug 'viaversion').", &[
        ("server", "string", "Server name (defaults to active workspace)", false),
        ("version", "string", "Specific Modrinth version id (optional)", false),
    ]));
    t.push(ai_tool("server_plugin_reload", "Reload plugins on a running server (plugman-style 'reload' console command).", &[
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_target("server_plugin_update", "Reinstall a plugin to its newest matching version."));

    // --- worlds & backups ---
    t.push(ai_target("server_worlds_list", "List world folders (any folder starting with 'world' that contains level.dat)."));
    t.push(ai_tool("server_world_reset", "Delete a world so it regenerates on next start (server must be stopped).", &[
        ("world", "string", "World folder name, e.g. world", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_target("server_world_reset_all", "Delete every world folder so they regenerate on next start."));
    t.push(ai_target("server_backups_list", "List a server's Xryloth backups."));
    t.push(ai_tool("server_backup_create", "Create a ZIP backup of a server (worlds, plugins, config).", &[
        ("label", "string", "Backup label", false),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_backup_restore", "Restore a server from a backup ZIP (server must be stopped).", &[
        ("file", "string", "Backup filename", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_backup_delete", "Delete a backup ZIP.", &[
        ("file", "string", "Backup filename", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));

    // --- files ---
    t.push(ai_tool("server_files_list", "List files/folders in a server folder (or a subfolder).", &[
        ("path", "string", "Relative subfolder (empty = server root)", false),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_read", "Read a text file from a server folder.", &[
        ("path", "string", "Relative file path", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_write", "Write (or create) a text file in a server folder.", &[
        ("path", "string", "Relative file path", true),
        ("content", "string", "File contents", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_mkdir", "Create a folder in a server folder.", &[
        ("path", "string", "Relative folder path", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_delete", "Delete a file or folder in a server folder.", &[
        ("path", "string", "Relative path", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_rename", "Rename a file/folder in a server folder.", &[
        ("path", "string", "Current relative path", true),
        ("new_name", "string", "New name", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_duplicate", "Duplicate a file/folder in a server folder.", &[
        ("path", "string", "Relative path", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_download", "Save a file from a server folder to the user's computer (native save dialog).", &[
        ("path", "string", "Relative file path", true),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_tool("server_file_search", "Search file/folder names in a server folder.", &[
        ("query", "string", "Search text", true),
        ("path", "string", "Relative subfolder (empty = root)", false),
        ("server", "string", "Server name (defaults to active workspace)", false),
    ]));
    t.push(ai_target("server_logs_read", "Read the recent server console log."));
    t.push(ai_target("server_logs_clear", "Clear the buffered server console log."));
    t.push(ai_target("server_jar_info", "Show the server.jar size and last-modified time."));

    // --- instances (game profiles) ---
    t.push(ai_simple("instance_list", "List every game profile with its Minecraft version, loader and loader version."));
    t.push(ai_tool("instance_create", "Create a new game profile (install is queued in the background).", &[
        ("name", "string", "Profile name", true),
        ("mc_version", "string", "Minecraft version", true),
        ("loader", "string", "vanilla, fabric, quilt, forge or neoforge", true),
        ("loader_version", "string", "Loader version (empty = latest)", false),
    ]));
    t.push(ai_tool("instance_delete", "Delete a game profile and its folder.", &[("name", "string", "Profile name", true)]));
    t.push(ai_tool("instance_launch", "Launch a game profile.", &[("name", "string", "Profile name", true)]));
    t.push(ai_tool("instance_open_folder", "Open a profile's folder in the OS file manager.", &[("name", "string", "Profile name", true)]));
    t.push(ai_tool("instance_mods_list", "List mods in a profile (with enabled state).", &[("name", "string", "Profile name", true)]));
    t.push(ai_tool("instance_mod_install", "Download and install a Modrinth mod into a profile's mods folder, auto-picking the right version for its loader and Minecraft version.", &[
        ("name", "string", "Profile name", true),
        ("slug", "string", "Modrinth project slug", true),
        ("version", "string", "Specific Modrinth version id (optional)", false),
    ]));
    t.push(ai_tool("instance_mod_remove", "Delete a mod from a profile.", &[
        ("name", "string", "Profile name", true),
        ("filename", "string", "Mod filename", true),
    ]));
    t.push(ai_tool("instance_mod_enable", "Enable a mod (rename .disabled back to .jar).", &[
        ("name", "string", "Profile name", true),
        ("filename", "string", "Mod filename", true),
    ]));
    t.push(ai_tool("instance_mod_disable", "Disable a mod (rename .jar to .disabled).", &[
        ("name", "string", "Profile name", true),
        ("filename", "string", "Mod filename", true),
    ]));
    t.push(ai_tool("instance_mod_search", "Search Modrinth for mods.", &[
        ("query", "string", "Search query", true),
        ("loader", "string", "fabric/quilt/forge/neoforge (optional)", false),
        ("mc_version", "string", "Minecraft version (optional)", false),
        ("limit", "integer", "Max results", false),
    ]));
    t.push(ai_tool("instance_mod_info", "Fetch Modrinth project info for a mod slug.", &[("slug", "string", "Modrinth slug", true)]));
    t.push(ai_tool("instance_versions_list", "List Minecraft versions (newest first).", &[]));
    t.push(ai_tool("instance_playtime", "Get total playtime (seconds) for a profile.", &[("name", "string", "Profile name", true)]));
    t.push(ai_tool("instance_settings_set_ram", "Set a profile's max RAM (MB).", &[
        ("name", "string", "Profile name", true),
        ("ram_mb", "integer", "RAM in MB", true),
    ]));
    t.push(ai_tool("instance_settings_set_java", "Set a profile's Java path.", &[
        ("name", "string", "Profile name", true),
        ("java_path", "string", "Java executable path", true),
    ]));

    // --- launcher / app ---
    let pages: &[(&str, &str)] = &[
        ("play", "Home"), ("instances", "Profiles"), ("mods", "Mods"), ("modpacks", "Modpacks"),
        ("packs", "Resource Packs"), ("servers", "Servers"), ("themes", "Themes"), ("chat", "Community Chat"),
        ("settings", "Settings"), ("logs", "Logs"), ("accounts", "Accounts"), ("xai", "Xryloth AI"),
        ("templates", "Templates"), ("configeditor", "Config Editor"),
    ];
    for (id, label) in pages {
        t.push(ai_simple(&format!("app_navigate_{}", id), &format!("Switch the launcher UI to the {} page.", label)));
    }
    t.push(ai_tool("app_navigate", "Switch the launcher UI to any page.", &[
        ("page", "string", "Page id: play (home), instances, mods, modpacks, packs, servers, themes, chat, settings, logs, accounts, xai, templates, configeditor", true),
    ]));
    t.push(ai_simple("app_open_create_instance", "Open the Profiles page and launch the Create Instance wizard (same as clicking New Instance)."));
    t.push(ai_simple("app_refresh", "Refresh the current page / the AI's workspace lists."));
    t.push(ai_tool("app_open_mod_browser", "Open the Mods browser.", &[
        ("tab", "string", "Optional tab: mods, modpacks, packs (default mods)", false),
    ]));
    t.push(ai_simple("app_settings_get", "Read every launcher setting."));
    t.push(ai_tool("app_settings_set", "Set one or more launcher settings.", &[("settings", "object", "Map of setting key -> value", true)]));
    t.push(ai_tool("app_settings_set_ram", "Set the launcher's default RAM (MB).", &[("ram_mb", "integer", "RAM in MB", true)]));
    t.push(ai_tool("app_settings_set_java", "Set the launcher's default Java path.", &[("java_path", "string", "Java executable path", true)]));
    t.push(ai_tool("app_settings_set_theme", "Set the launcher theme (black, white, neon, ...).", &[("theme", "string", "Theme name", true)]));
    t.push(ai_tool("app_settings_toggle", "Toggle a boolean launcher setting.", &[
        ("key", "string", "Setting key, e.g. discord_rpc, enable_particles, performance_mode", true),
        ("value", "boolean", "true or false", true),
    ]));
    t.push(ai_simple("app_system_info", "Get live CPU, RAM and disk usage of this machine."));
    t.push(ai_simple("app_live_version", "Get the latest Xryloth version published on GitHub."));
    t.push(ai_simple("app_news", "Get the latest Minecraft news."));
    t.push(ai_simple("app_get_paths", "Get the launcher's data, instances, servers and libraries folders."));
    t.push(ai_simple("app_open_folder", "Open the launcher's data folder in the OS file manager."));
    t.push(ai_simple("app_check_updates", "Check GitHub for a new Xryloth release."));

    // --- AI context ---
    t.push(ai_tool("ai_context_set_server", "Select a server as the active workspace so following actions target it.", &[("server", "string", "Server name", true)]));
    t.push(ai_tool("ai_context_set_instance", "Select a game profile as the active workspace so following actions target it.", &[("name", "string", "Profile name", true)]));
    t.push(ai_simple("ai_context_clear", "Clear the active workspace."));
    t.push(ai_simple("ai_context_get", "Show the current active workspace."));

    // --- guides (real facts, never approximate) ---
    let guides: &[(&str, &str)] = &[
        ("ai_guide_create_server", "How to create a self-hosted server (real server types, real downloadable versions, real default port and folder)."),
        ("ai_guide_install_plugin", "How to install a plugin (real Modrinth matches, real plugins folder, real matching version)."),
        ("ai_guide_install_mod", "How to install a mod into a profile (real Modrinth matches, real mods folder, real matching version)."),
        ("ai_guide_whitelist", "How to set up and use the whitelist (real whitelist.json path and format)."),
        ("ai_guide_ops", "How to give a player operator rights (real ops.json path and format)."),
        ("ai_guide_connect_server", "How to connect to a server from the Minecraft client (real IP/port and LAN address)."),
        ("ai_guide_port_forward", "How to port-forward so friends can join (real port, real OS)."),
        ("ai_guide_java_install", "How to install the right Java version (real detected Javas, real managed Java folder, real recommendation for the target)."),
        ("ai_guide_backup", "How to back up and restore a server (real backup folder and steps)."),
        ("ai_guide_change_version", "How to change a server's Minecraft version (real downloadable versions)."),
        ("ai_guide_reset_world", "How to reset/regenerate a world (real world folders)."),
        ("ai_guide_motd", "How to set a custom MOTD with colors and formatting codes."),
        ("ai_guide_icon", "How to set a server icon (real icon path and size requirements)."),
        ("ai_guide_crash", "How to troubleshoot a server or game crash (real log locations)."),
        ("ai_guide_performance", "How to make a server or game run faster (real RAM, real JVM flags, real flags like Aikar's)."),
        ("ai_guide_lan", "How to play on a LAN with friends."),
        ("ai_guide_firewall", "How to allow Minecraft through the firewall (real port, real OS)."),
        ("ai_guide_viaversion", "How to install and configure ViaVersion for cross-version play."),
        ("ai_guide_paper", "Paper server: what it is and how to use it."),
        ("ai_guide_purpur", "Purpur server: what it is and how to use it."),
        ("ai_guide_fabric", "Fabric: what it is and how to create a Fabric profile/server."),
        ("ai_guide_forge", "Forge: what it is and how to create a Forge profile."),
        ("ai_guide_quilt", "Quilt: what it is and how to create a Quilt profile."),
        ("ai_guide_neoforge", "NeoForge: what it is and how to create a NeoForge profile."),
        ("ai_guide_vanilla", "Vanilla Minecraft: how to play and host it."),
        ("ai_guide_bungeecord", "BungeeCord proxy: what it is and how to set one up."),
        ("ai_guide_velocity", "Velocity proxy: what it is and how to set one up."),
        ("ai_guide_optifine", "OptiFine: what it is and how to install it."),
        ("ai_guide_sodium", "Sodium: what it is and how to install it."),
        ("ai_guide_iris", "Iris shaders: what they are and how to install them."),
        ("ai_guide_lithium", "Lithium: what it is and how to install it."),
        ("ai_guide_starlight", "Starlight: what it is and how to install it."),
        ("ai_guide_datapack", "How to install a datapack (real datapacks folder)."),
        ("ai_guide_resourcepack", "How to install a resource pack (real resourcepacks folder)."),
        ("ai_guide_skin", "How to set a custom skin in Xryloth."),
        ("ai_guide_ely_by", "How to sign in with Ely.by (cracked/offline accounts)."),
        ("ai_guide_microsoft_auth", "How to sign in with a Microsoft account."),
        ("ai_guide_offline_mode", "How offline-mode (cracked) servers work and their risks."),
        ("ai_guide_gamerules", "How to set gamerules (real command examples)."),
        ("ai_guide_commands", "Essential Minecraft commands cheat-sheet."),
        ("ai_guide_moderation", "How to moderate a server (ban, kick, mute, whitelist, ops)."),
        ("ai_guide_grief", "How to recover from grief (backups, rollback plugins)."),
        ("ai_guide_dns", "How to use a DNS name (no-ip/duckdns) for your server."),
        ("ai_guide_realms", "Minecraft Realms vs a self-hosted Xryloth server."),
        ("ai_guide_multiplayer", "How multiplayer works: LAN, direct connect, servers and proxies."),
        ("ai_guide_troubleshoot", "General troubleshooting checklist for launch failures."),
    ];
    for (name, desc) in guides {
        t.push(ai_tool(name, desc, &[("query", "string", "The specific thing the user wants to do (used to look up real facts)", false)]));
    }

    t
}

// ---------- tool selection ----------
// Groq accepts at most 128 tools per request, and 200+ tools in one prompt
// would degrade accuracy. We rank the registry by relevance to the active
// workspace and the latest user message, then send only the best subset.
const TOPIC_KEYWORDS: &[(&[&str], &[&str])] = &[
    (&["plugin", "viaversion", "jar", "plugman"], &["plugin", "viaversion"]),
    (&["whitelist", "white-list", "allowlist"], &["whitelist"]),
    (&["op ", "operator", "admin", "deop"], &["ops_"]),
    (&["ban", "kick", "mute", "pardon"], &["bans_", "console_ban", "console_kick", "console_pardon"]),
    (&["motd"], &["motd"]),
    (&["ram", "memory", "xms", "jvm", "aikar", "java"], &["ram", "xms", "jvm", "java", "aikar"]),
    (&["properties", "server.properties"], &["properties"]),
    (&["console", "command", "broadcast", "say", "tps", "save-all"], &["console"]),
    (&["backup", "restore", "snapshot"], &["backup"]),
    (&["world", "reset", "regenerate", "map"], &["world"]),
    (&["file", "folder", "config", "edit", "read the"], &["file"]),
    (&["icon"], &["icon"]),
    (&["eula"], &["eula"]),
    (&["port", "ip ", "address", "forward"], &["port"]),
    (&["create", "make a server", "new server", "set up a server", "install a new server"], &["create"]),
    (&["delete", "remove", "uninstall"], &["delete", "remove"]),
    (&["mod", "fabric mod"], &["mod_"]),
    (&["profile", "instance", "playtime"], &["instance"]),
    (&["launch", "play the game", "start the game"], &["launch"]),
    (&["guide", "how do i", "how to", "tutorial", "steps", "explain"], &["guide_"]),
    (&["navigate", "go to", "open the", "switch to", "take me to"], &["navigate"]),
    (&["theme"], &["theme"]),
    (&["cpu", "disk", "system info", "usage"], &["system_info"]),
    (&["news"], &["news"]),
    (&["players", "online", "who is on"], &["players"]),
    (&["version", "1.21"], &["versions_list", "reinstall"]),
];

fn is_core_ai_tool(name: &str) -> bool {
    name == "server_list" || name == "instance_list" || name == "app_settings_get"
        || name.starts_with("ai_context_") || name.starts_with("app_navigate")
        || name == "app_system_info" || name == "app_get_paths" || name == "app_live_version"
        || name == "app_news" || name == "server_types_list" || name == "server_java_list"
        || name == "server_versions_list" || name == "instance_versions_list"
        || name == "server_status" || name == "server_stats" || name == "server_console_command"
        || name == "server_plugins_list" || name == "instance_mods_list"
}

// Groq reports how long until a token window frees up. Parse it so we can wait
// exactly that long instead of hammering the endpoint.
fn ai_rate_limit_wait(err: &str) -> Option<f64> {
    if !err.contains("rate_limit") && !err.contains("429") { return None; }
    let marker = err.find("try again in ")? + 13;
    let rest = &err[marker..];
    let end = rest.find('s').unwrap_or(rest.len());
    rest[..end].trim().parse::<f64>().ok().filter(|w| *w > 0.0 && *w <= 30.0)
}

fn ai_select_tools(context: &Option<Value>, messages: &[Value], all: &[Value]) -> Vec<Value> {
    // Groq's free tier allows ~8k tokens/minute, and a single tool payload of
    // ~10k tokens would burn a whole minute's budget. Shrink the set as the
    // conversation grows so every round still fits inside the window.
    let conv_chars = serde_json::to_string(messages).unwrap_or_default().len();
    let limit = if conv_chars > 9000 { 34 } else if conv_chars > 4000 { 46 } else { 60 };
    let limit = limit.min(all.len());
    if all.len() <= limit { return all.to_vec(); }
    let kind = context.as_ref().and_then(|c| c.get("kind")).and_then(|k| k.as_str()).unwrap_or("");
    let last_user = messages.iter().rev()
        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        .and_then(|m| m.get("content").and_then(|c| c.as_str()))
        .unwrap_or("").to_lowercase();
    // Keep the whole recent thread so follow-ups keep their tool context.
    let thread: String = messages.iter().rev().take(6)
        .filter_map(|m| m.get("content").and_then(|c| c.as_str()))
        .collect::<Vec<_>>().join(" ").to_lowercase();

    let mut scored: Vec<(i32, usize)> = all.iter().enumerate().map(|(i, tool)| {
        let name = tool["function"]["name"].as_str().unwrap_or("");
        let desc = tool["function"]["description"].as_str().unwrap_or("").to_lowercase();
        let mut score = 5i32;
        if !kind.is_empty() {
            let wants = if kind == "server" { "server_" } else { "instance_" };
            let other = if kind == "server" { "instance_" } else { "server_" };
            if name.starts_with(wants) { score += 100; }
            else if name.starts_with(other) { score -= 25; }
            else if name.starts_with("ai_") || name.starts_with("app_") { score += 30; }
        }
        for (aliases, needles) in TOPIC_KEYWORDS.iter() {
            let hit = aliases.iter().any(|a| last_user.contains(a) || thread.contains(a));
            if hit && needles.iter().any(|nd| name.contains(nd) || desc.contains(nd)) {
                score += 60;
            }
        }
        if is_core_ai_tool(name) { score += 40; }
        (score, i)
    }).collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut chosen: Vec<usize> = scored.iter().take(limit).map(|(_, i)| *i).collect();
    chosen.sort_unstable();
    chosen.into_iter().map(|i| all[i].clone()).collect()
}

// ---------- provider calls ----------
async fn ai_groq_chat<F: FnMut(String)>(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    mut on_chunk: F,
) -> Result<AiResponse, String> {
    let body = json!({
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "stream": true,
        "temperature": 0.2,
    });
    let resp = client.post(GROQ_API)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), txt.chars().take(400).collect::<String>()));
    }
    let mut full = String::new();
    let mut calls: std::collections::HashMap<usize, (String, String, String)> = std::collections::HashMap::new();
    let mut buf = String::new();
    let mut stream = resp;
    while let Some(chunk) = stream.chunk().await.map_err(|e| format!("stream error: {}", e))? {
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find('\n') {
            let line = buf[..idx].trim().to_string();
            buf.drain(..=idx);
            if line.is_empty() || line.starts_with(':') { continue; }
            let data = match line.strip_prefix("data:") { Some(d) => d.trim(), None => continue };
            if data == "[DONE]" { continue; }
            let v: Value = match serde_json::from_str(data) { Ok(v) => v, Err(_) => continue };
            let delta = &v["choices"][0]["delta"];
            if let Some(c) = delta.get("content").and_then(|c| c.as_str()) {
                if !c.is_empty() { full.push_str(c); on_chunk(c.to_string()); }
            }
            if let Some(tcs) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                for tc in tcs {
                    let i = tc["index"].as_u64().unwrap_or(0) as usize;
                    let e = calls.entry(i).or_insert_with(|| (String::new(), String::new(), String::new()));
                    if let Some(id) = tc["id"].as_str() { if !id.is_empty() { e.0 = id.to_string(); } }
                    if let Some(nm) = tc["function"]["name"].as_str() { if !nm.is_empty() { e.1 = nm.to_string(); } }
                    if let Some(a) = tc["function"]["arguments"].as_str() { e.2.push_str(a); }
                }
            }
        }
    }
    let mut keys: Vec<usize> = calls.keys().copied().collect();
    keys.sort();
    let mut tool_calls = Vec::new();
    for k in keys {
        if let Some((id, name, args)) = calls.get(&k) {
            if !name.is_empty() {
                tool_calls.push(AiToolCall {
                    id: if id.is_empty() { format!("call_{}", k) } else { id.clone() },
                    name: name.clone(),
                    arguments: if args.is_empty() { "{}".to_string() } else { args.clone() },
                });
            }
        }
    }
    Ok(AiResponse { content: full, tool_calls, streamed: true })
}

async fn ai_gemini_chat<F: FnMut(String)>(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    system: &str,
    messages: &[Value],
    tools: &[Value],
    mut on_chunk: F,
) -> Result<AiResponse, String> {
    let mut contents: Vec<Value> = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");
        match role {
            "system" => {}
            "assistant" => {
                let mut parts: Vec<Value> = Vec::new();
                if let Some(c) = m.get("content").and_then(|c| c.as_str()) {
                    if !c.is_empty() { parts.push(json!({"text": c})); }
                }
                if let Some(tcs) = m.get("tool_calls").and_then(|t| t.as_array()) {
                    for tc in tcs {
                        let args: Value = serde_json::from_str(tc["function"]["arguments"].as_str().unwrap_or("{}")).unwrap_or(json!({}));
                        parts.push(json!({"functionCall": {"name": tc["function"]["name"].as_str().unwrap_or(""), "args": args}}));
                    }
                }
                if !parts.is_empty() { contents.push(json!({"role": "model", "parts": parts})); }
            }
            "tool" => {
                let name = m.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
                contents.push(json!({"role": "user", "parts": [{"functionResponse": {"name": name, "response": {"result": content}}}]}));
            }
            _ => {
                let c = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
                contents.push(json!({"role": "user", "parts": [{"text": c}]}));
            }
        }
    }
    let mut decls: Vec<Value> = Vec::new();
    for t in tools {
        if let Some(f) = t.get("function") { decls.push(f.clone()); }
    }
    let body = json!({
        "contents": contents,
        "systemInstruction": {"parts": [{"text": system}]},
        "tools": [{"functionDeclarations": decls}],
        "temperature": 0.2,
    });
    let url = format!("{}/{}:generateContent?key={}", GEMINI_API, model, key);
    let resp = client.post(&url).json(&body).send().await.map_err(|e| format!("network error: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), txt.chars().take(400).collect::<String>()));
    }
    let v: Value = resp.json().await.map_err(|e| format!("parse error: {}", e))?;
    let mut content = String::new();
    let mut tool_calls = Vec::new();
    let parts = v["candidates"][0]["content"]["parts"].as_array().cloned().unwrap_or_default();
    for (i, part) in parts.iter().enumerate() {
        if let Some(t) = part.get("text").and_then(|t| t.as_str()) { content.push_str(t); }
        if let Some(fc) = part.get("functionCall") {
            let name = fc["name"].as_str().unwrap_or("").to_string();
            let args = serde_json::to_string(&fc["args"]).unwrap_or_else(|_| "{}".to_string());
            tool_calls.push(AiToolCall { id: format!("gemini_{}", i), name, arguments: args });
        }
    }
    if !content.is_empty() { on_chunk(content.clone()); }
    Ok(AiResponse { content, tool_calls, streamed: false })
}

// ---------- guide facts (always real data) ----------
fn ai_guide_facts(tool: &str, args: &Value, app: &State<AppState>) -> Value {
    let query = args.get("query").and_then(|q| q.as_str()).unwrap_or("").to_string();
    let ctx = app.ai_context.lock().unwrap().clone();
    let ctx_server = ctx.as_ref().filter(|c| c["kind"] == "server").and_then(|c| c["name"].as_str()).map(|s| s.to_string());
    let ctx_instance = ctx.as_ref().filter(|c| c["kind"] == "instance").and_then(|c| c["name"].as_str()).map(|s| s.to_string());
    let mut f = json!({"topic": tool, "query": query, "data_folder": app_dir().to_string_lossy(), "servers_folder": servers_dir().to_string_lossy(), "instances_folder": instances_dir().to_string_lossy()});
    match tool {
        "ai_guide_create_server" => {
            let types = ["paper", "purpur", "fabric", "vanilla"];
            let mut versions = json!({});
            for ty in types {
                if let Some(arr) = server_mgr_list_versions(ty.to_string()).get("versions").and_then(|v| v.as_array()) {
                    let top: Vec<String> = arr.iter().take(6).filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                    versions[ty] = json!(top);
                }
            }
            f["server_types"] = json!(types);
            f["latest_versions"] = versions;
            f["default_port"] = json!(25565);
            f["example"] = json!({"tool": "server_create", "args": {"name": "MyServer", "server_type": "paper", "mc_version": "1.21.11", "port": 25565}});
        }
        "ai_guide_install_plugin" | "ai_guide_viaversion" => {
            let slug = if tool == "ai_guide_viaversion" { "viaversion".to_string() } else { query.clone() };
            let server_name = ctx_server.clone().unwrap_or_default();
            let meta = if server_name.is_empty() { json!({}) } else { load_json(&server_dir(&server_name).join("server.json")) };
            let mc = meta.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut matches = json!([]);
            if !slug.is_empty() {
                matches = search_modrinth(slug.clone(), Some("mod".to_string()), Some("paper".to_string()), if mc.is_empty() { None } else { Some(mc.clone()) }, Some(5));
            }
            f["slug"] = json!(slug);
            f["server"] = json!(server_name);
            f["server_minecraft_version"] = json!(mc);
            f["plugins_folder"] = json!(server_dir(&server_name).join("plugins").to_string_lossy());
            f["modrinth_matches"] = matches;
            f["install_tool"] = json!("server_plugin_install");
        }
        "ai_guide_install_mod" => {
            let name = ctx_instance.clone().unwrap_or_default();
            let mut inst_meta = json!({});
            for inst in load_instances_raw(app) {
                if inst["name"].as_str() == Some(&name) { inst_meta = inst; break; }
            }
            let loader = inst_meta.get("loader").and_then(|v| v.as_str()).unwrap_or("fabric").to_string();
            let mc = inst_meta.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut matches = json!([]);
            if !query.is_empty() {
                matches = search_modrinth(query.clone(), Some("mod".to_string()), Some(loader.clone()), if mc.is_empty() { None } else { Some(mc.clone()) }, Some(5));
            }
            f["profile"] = json!(name);
            f["loader"] = json!(loader);
            f["minecraft_version"] = json!(mc);
            f["mods_folder"] = json!(instances_dir().join(&name).join("mods").to_string_lossy());
            f["modrinth_matches"] = matches;
            f["install_tool"] = json!("instance_mod_install");
        }
        "ai_guide_whitelist" => {
            let name = ctx_server.clone().unwrap_or_default();
            f["server"] = json!(name);
            f["whitelist_file"] = json!(server_dir(&name).join("whitelist.json").to_string_lossy());
            f["format"] = json!([{"uuid": "<player uuid>", "name": "<player name>"}]);
            f["property"] = json!("white-list=true in server.properties");
        }
        "ai_guide_ops" => {
            let name = ctx_server.clone().unwrap_or_default();
            f["server"] = json!(name);
            f["ops_file"] = json!(server_dir(&name).join("ops.json").to_string_lossy());
            f["format"] = json!([{"uuid": "<player uuid>", "name": "<player name>", "level": 4, "bypassesPlayerLimit": false}]);
        }
        "ai_guide_connect_server" => {
            let name = ctx_server.clone().unwrap_or_default();
            let meta = if name.is_empty() { json!({}) } else { load_json(&server_dir(&name).join("server.json")) };
            f["server"] = json!(name);
            f["address"] = json!(format!("127.0.0.1:{}", meta.get("port").and_then(|v| v.as_u64()).unwrap_or(25565)));
            f["lan_address"] = json!(local_ip().map(|ip| format!("{}:{}", ip, meta.get("port").and_then(|v| v.as_u64()).unwrap_or(25565))).unwrap_or_else(|| "see Settings > Network".to_string()));
        }
        "ai_guide_port_forward" => {
            let name = ctx_server.clone().unwrap_or_default();
            let meta = if name.is_empty() { json!({}) } else { load_json(&server_dir(&name).join("server.json")) };
            f["port"] = json!(meta.get("port").and_then(|v| v.as_u64()).unwrap_or(25565));
            f["os"] = json!(std::env::consts::OS);
        }
        "ai_guide_java_install" => {
            f["detected_javas"] = json!(find_all_java_installations());
            f["managed_java_folder"] = json!(java_dir().to_string_lossy());
            let target = ctx_server.clone().and_then(|n| Some(load_json(&server_dir(&n).join("server.json")))).unwrap_or_default();
            let mc = target.get("version").and_then(|v| v.as_str()).unwrap_or("");
            f["recommended_java"] = json!(if mc.is_empty() { "Java 21 for modern versions; Java 8 for 1.7.10-1.12.2" } else if mc_ge(mc, "1.20.5") { "Java 21" } else if mc_ge(mc, "1.17") { "Java 17" } else { "Java 8" });
        }
        "ai_guide_backup" => {
            let name = ctx_server.clone().unwrap_or_default();
            f["server"] = json!(name);
            f["backup_folder"] = json!(server_dir(&name).join("xryloth_backups").to_string_lossy());
        }
        "ai_guide_change_version" => {
            let types = ["paper", "purpur", "fabric", "vanilla"];
            let mut versions = json!({});
            for ty in types {
                if let Some(arr) = server_mgr_list_versions(ty.to_string()).get("versions").and_then(|v| v.as_array()) {
                    let top: Vec<String> = arr.iter().take(6).filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                    versions[ty] = json!(top);
                }
            }
            f["latest_versions"] = versions;
        }
        "ai_guide_reset_world" => {
            let name = ctx_server.clone().unwrap_or_default();
            let mut worlds = Vec::new();
            if let Ok(rd) = std::fs::read_dir(server_dir(&name)) {
                for e in rd.flatten() {
                    let p = e.path();
                    let n = e.file_name().to_string_lossy().to_string();
                    if p.is_dir() && n.starts_with("world") && p.join("level.dat").exists() { worlds.push(n); }
                }
            }
            f["server"] = json!(name);
            f["worlds"] = json!(worlds);
        }
        "ai_guide_motd" => {
            f["motd_file"] = json!(server_dir(&ctx_server.clone().unwrap_or_default()).join("server.properties").to_string_lossy());
            f["color_codes"] = json!({"0":"black","1":"dark_blue","2":"dark_green","3":"dark_aqua","4":"dark_red","5":"dark_purple","6":"gold","7":"gray","8":"dark_gray","9":"blue","a":"green","b":"aqua","c":"red","d":"light_purple","e":"yellow","f":"white"});
            f["formatting"] = json!({"l":"bold","m":"strikethrough","n":"underline","o":"italic","r":"reset"});
        }
        "ai_guide_icon" => {
            f["icon_file"] = json!(server_dir(&ctx_server.clone().unwrap_or_default()).join("server-icon.png").to_string_lossy());
            f["requirements"] = json!("PNG, 64x64 (any square size works; 64x64 recommended)");
        }
        "ai_guide_crash" => {
            f["server_logs_folder"] = json!(servers_dir().to_string_lossy());
            f["launcher_logs"] = json!(app_dir().join("launcher.log").to_string_lossy());
            f["instance_logs"] = json!(app_dir().join("instances").join(ctx_instance.clone().unwrap_or_default()).join("logs").to_string_lossy());
        }
        "ai_guide_performance" => {
            f["aikar_flags"] = json!(AIKAR_FLAGS);
            f["default_ram_mb"] = json!(4096);
        }
        "ai_guide_lan" => {
            f["lan_ip"] = json!(local_ip().unwrap_or_else(|| "unknown".to_string()));
        }
        "ai_guide_firewall" => {
            f["os"] = json!(std::env::consts::OS);
            let name = ctx_server.clone().unwrap_or_default();
            let meta = if name.is_empty() { json!({}) } else { load_json(&server_dir(&name).join("server.json")) };
            f["port"] = json!(meta.get("port").and_then(|v| v.as_u64()).unwrap_or(25565));
        }
        "ai_guide_datapack" => {
            f["datapacks_folder"] = json!(server_dir(&ctx_server.clone().unwrap_or_default()).join("world").join("datapacks").to_string_lossy());
        }
        "ai_guide_resourcepack" => {
            f["resourcepacks_folder"] = json!(instances_dir().join(&ctx_instance.clone().unwrap_or_default()).join("resourcepacks").to_string_lossy());
        }
        "ai_guide_skin" => {
            f["custom_skin_path"] = json!(custom_skin_path().to_string_lossy());
        }
        "ai_guide_dns" => {
            let name = ctx_server.clone().unwrap_or_default();
            let meta = if name.is_empty() { json!({}) } else { load_json(&server_dir(&name).join("server.json")) };
            f["port"] = json!(meta.get("port").and_then(|v| v.as_u64()).unwrap_or(25565));
            f["public_ip"] = json!(public_ip_hint());
        }
        _ => {}
    }
    f
}

fn local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|a| a.ip().to_string())
}

fn public_ip_hint() -> String {
    // Best-effort; if it fails the guide still contains the port and steps.
    let client = match reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(5)).build() { Ok(c) => c, Err(_) => return "unavailable".to_string() };
    match client.get("https://api.ipify.org").send() {
        Ok(r) => r.text().unwrap_or_else(|_| "unavailable".to_string()),
        Err(_) => "unavailable".to_string(),
    }
}

fn mc_ge(version: &str, other: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split('.').filter_map(|p| p.parse::<u64>().ok()).collect()
    };
    let (a, b) = (parse(version), parse(other));
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y { return x > y; }
    }
    true
}

// ---------- tool execution ----------
async fn ai_execute_tool(app: &State<'_, AppState>, handle: &tauri::AppHandle, tool: &str, args: &Value) -> Value {
    let tool = tool.to_string();
    let args = args.clone();
    let handle = handle.clone();
    tokio::task::spawn_blocking(move || {
        let st = handle.state::<AppState>();
        ai_execute_tool_blocking(&st, &handle, &tool, &args)
    }).await.unwrap_or_else(|_| json!({"error": "Tool task failed"}))
}

fn ai_execute_tool_blocking(app: &State<AppState>, handle: &tauri::AppHandle, tool: &str, args: &Value) -> Value {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let n = |k: &str| args.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
    let b = |k: &str| args.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
    let ctx = app.ai_context.lock().unwrap().clone();
    let ctx_server = ctx.as_ref().filter(|c| c["kind"] == "server").and_then(|c| c["name"].as_str()).map(|s| s.to_string());
    let ctx_instance = ctx.as_ref().filter(|c| c["kind"] == "instance").and_then(|c| c["name"].as_str()).map(|s| s.to_string());
    let target_server = || -> String {
        let direct = s("server");
        if !direct.is_empty() { sanitize_server_name(&direct) } else { sanitize_server_name(&ctx_server.clone().unwrap_or_default()) }
    };
    let emit_action = |payload: Value| { let _ = handle.emit_all("ai-action", payload); };
    let note_refresh = |kind: &str| emit_action(json!({"type": format!("refresh-{}", kind)}));

    // ---- context tools ----
    if tool == "ai_context_set_server" {
        let name = sanitize_server_name(&s("server"));
        if name.is_empty() { return json!({"error": "No server name given."}); }
        if !server_dir(&name).join("server.json").exists() { return json!({"error": format!("No server named '{}'.", name)}); }
        *app.ai_context.lock().unwrap() = Some(json!({"kind": "server", "name": name}));
        emit_action(json!({"type": "context", "kind": "server", "name": name}));
        return json!({"success": true, "summary": format!("Workspace set to server '{}'.", name)});
    }
    if tool == "ai_context_set_instance" {
        let name = s("name");
        if name.is_empty() { return json!({"error": "No profile name given."}); }
        let exists = load_instances_raw(app).iter().any(|i| i["name"].as_str() == Some(&name));
        if !exists { return json!({"error": format!("No profile named '{}'.", name)}); }
        *app.ai_context.lock().unwrap() = Some(json!({"kind": "instance", "name": name.clone()}));
        emit_action(json!({"type": "context", "kind": "instance", "name": name.clone()}));
        return json!({"success": true, "summary": format!("Workspace set to profile '{}'.", name)});
    }
    if tool == "ai_context_clear" {
        *app.ai_context.lock().unwrap() = None;
        emit_action(json!({"type": "context", "kind": "", "name": ""}));
        return json!({"success": true, "summary": "Workspace cleared."});
    }
    if tool == "ai_context_get" {
        return json!({"success": true, "context": ctx.clone().unwrap_or(json!(null))});
    }

    // ---- guides ----
    if tool.starts_with("ai_guide_") {
        let facts = ai_guide_facts(tool, args, app);
        return json!({"success": true, "facts": facts, "summary": format!("Fetched real facts for {}.", tool)});
    }

    // ---- navigation ----
    if tool == "app_navigate" || tool.starts_with("app_navigate_") {
        let mut page = if tool == "app_navigate" { s("page") } else { tool.strip_prefix("app_navigate_").unwrap_or("").to_string() };
        // The real homepage is the "play" route (HeroStage). Older code used "home",
        // which fell back to the deprecated HomePage — alias it so "open the homepage"
        // lands on the actual home screen.
        if page == "home" || page == "homepage" || page == "main" { page = "play".to_string(); }
        let valid = ["play","home","profiles","instances","mods","modpacks","packs","partners","servers","themes","chat","settings","logs","accounts","xai","templates","configeditor"];
        if !valid.contains(&page.as_str()) { return json!({"error": format!("Unknown page '{}'.", page)}); }
        emit_action(json!({"type": "navigate", "page": page}));
        return json!({"success": true, "summary": format!("Switched to the {} page.", page)});
    }

    // ---- UI actions (press launcher buttons) ----
    if tool == "app_open_create_instance" {
        // Switch to the Profiles/Instances page and open the "Create instance" wizard.
        emit_action(json!({"type": "navigate", "page": "instances"}));
        emit_action(json!({"type": "open-create-instance"}));
        return json!({"success": true, "summary": "Opened the Profiles page and launched the Create Instance wizard."});
    }
    if tool == "app_refresh" {
        emit_action(json!({"type": "refresh-current"}));
        return json!({"success": true, "summary": "Refreshed the current page."});
    }
    if tool == "app_open_mod_browser" {
        let tab = s("tab");
        emit_action(json!({"type": "navigate", "page": "mods", "tab": if tab.is_empty() { "mods".to_string() } else { tab } }));
        return json!({"success": true, "summary": "Opened the Mods browser."});
    }

    // ---- app settings ----
    if tool == "app_settings_get" {
        return json!({"success": true, "settings": Value::Object(load_settings(app).into_iter().collect())});
    }
    if tool == "app_settings_set" {
        if let Some(obj) = args.get("settings").and_then(|v| v.as_object()) {
            for (k, v) in obj { save_setting_val(app, k, v.clone()); }
            note_refresh("settings");
            return json!({"success": true, "summary": "Launcher settings updated."});
        }
        return json!({"error": "No settings object given."});
    }
    if tool == "app_settings_set_ram" { save_setting_val(app, "ram_mb", json!(n("ram_mb"))); note_refresh("settings"); return json!({"success": true, "summary": format!("Default RAM set to {} MB.", n("ram_mb"))}); }
    if tool == "app_settings_set_java" { save_setting_val(app, "java_path", json!(s("java_path"))); note_refresh("settings"); return json!({"success": true, "summary": "Default Java path updated."}); }
    if tool == "app_settings_set_theme" { save_setting_val(app, "theme", json!(s("theme"))); note_refresh("settings"); return json!({"success": true, "summary": format!("Theme set to '{}'.", s("theme"))}); }
    if tool == "app_settings_toggle" { save_setting_val(app, &s("key"), json!(b("value"))); note_refresh("settings"); return json!({"success": true, "summary": format!("Set '{}' to {}.", s("key"), b("value"))}); }
    if tool == "app_system_info" {
        let info = get_system_info();
        return json!({"success": true, "summary": format!("CPU {}%, RAM {}%, disk {}%.", info["cpu"], info["ram_pct"], info["disk_pct"]), "info": info});
    }
    if tool == "app_live_version" {
        if let Ok(v) = http_get(GITHUB_API_URL, None) {
            let ver = v.get("name").and_then(|x| x.as_str()).or_else(|| v.get("tag_name").and_then(|x| x.as_str())).unwrap_or("").to_string();
            return json!({"success": true, "latest": ver, "summary": format!("Latest Xryloth version is {}.", ver)});
        }
        return json!({"error": "Could not reach GitHub."});
    }
    if tool == "app_news" {
        let news = http_get("https://api.mojang.com/news", None).unwrap_or(json!([]));
        return json!({"success": true, "news": news, "summary": "Fetched the latest Minecraft news."});
    }
    if tool == "app_get_paths" {
        return json!({"success": true, "data": app_dir().to_string_lossy(), "instances": instances_dir().to_string_lossy(), "servers": servers_dir().to_string_lossy(), "libraries": libraries_dir().to_string_lossy()});
    }
    if tool == "app_open_folder" { let _ = webbrowser::open(&app_dir().to_string_lossy()); return json!({"success": true, "summary": "Opened the Xryloth data folder."}); }
    if tool == "app_check_updates" {
        return json!({"success": true, "summary": "Update checks run automatically in the background; see Settings for auto-update."});
    }

    // ---- server lifecycle ----
    if tool == "server_list" {
        let mut out = Vec::new();
        if let Ok(rd) = std::fs::read_dir(servers_dir()) {
            for e in rd.flatten() {
                if !e.path().is_dir() { continue; }
                let name = e.file_name().to_string_lossy().to_string();
                let meta = load_json(&e.path().join("server.json"));
                out.push(json!({
                    "name": name, "type": meta["type"], "version": meta["version"],
                    "port": meta["port"], "running": app.server_procs.lock().unwrap().contains_key(&name),
                }));
            }
        }
        return json!({"success": true, "servers": out, "count": out.len(), "summary": format!("{} server(s) found.", out.len())});
    }
    if tool == "server_create" {
        let name = sanitize_server_name(&s("name"));
        let stype = if s("server_type").is_empty() { "paper".to_string() } else { s("server_type").to_lowercase() };
        let version = s("mc_version");
        let port = n("port") as u16;
        let port = if port == 0 { 25565 } else { port };
        let motd = if s("motd").is_empty() { None } else { Some(s("motd")) };
        let ram = if n("ram_mb") == 0 { 4096 } else { n("ram_mb") };
        if name.is_empty() { return json!({"error": "Server name is required."}); }
        if version.is_empty() { return json!({"error": "Minecraft version is required (e.g. 1.21.11)."}); }
        // Run the (blocking, downloading) creation on a background thread so the
        // AI tool call does not block the async runtime.
        let handle2 = handle.clone();
        let thread_name = name.clone();
        let thread_stype = stype.clone();
        let thread_version = version.clone();
        let result = std::thread::spawn(move || {
            create_server_blocking(Some(handle2), &thread_name, &thread_stype, &thread_version, port, motd, Some(ram))
        }).join();
        match result {
            Ok(v) => {
                note_refresh("servers");
                if let Some(e) = v.get("error") { return json!({"error": e.clone()}); }
                *app.ai_context.lock().unwrap() = Some(json!({"kind": "server", "name": name.clone()}));
                emit_action(json!({"type": "context", "kind": "server", "name": name.clone()}));
                return json!({"success": true, "summary": format!("Created server '{}' ({} {}) on port {}.", name, stype, version, port), "server": v.get("server").cloned().unwrap_or(json!(null))});
            }
            Err(_) => return json!({"error": "Server creation thread panicked."}),
        }
    }
    if tool == "server_delete" {
        let name = target_server();
        if name.is_empty() { return json!({"error": "No server selected."}); }
        {
            let mut procs = app.server_procs.lock().unwrap();
            if let Some(mut p) = procs.remove(&name) { let _ = p.child.kill(); let _ = p.child.wait(); }
        }
        match std::fs::remove_dir_all(server_dir(&name)) {
            Ok(_) => { let _ = handle.emit_all("server-mgr-status", json!({"server": name, "running": false, "deleted": true})); note_refresh("servers"); return json!({"success": true, "summary": format!("Deleted server '{}'.", name)}); }
            Err(e) => return json!({"error": e.to_string()}),
        }
    }
    if tool == "server_start" {
        let name = target_server();
        if name.is_empty() { return json!({"error": "No server selected."}); }
        let res = launch_local_server(app, handle, &name);
        note_refresh("servers");
        return res;
    }
    if tool == "server_stop" {
        let name = target_server();
        if name.is_empty() { return json!({"error": "No server selected."}); }
        app.server_stopping.lock().unwrap().insert(name.clone());
        {
            let mut procs = app.server_procs.lock().unwrap();
            if let Some(p) = procs.get_mut(&name) {
                let _ = p.stdin.write_all(b"stop\n"); let _ = p.stdin.flush();
            } else { return json!({"error": "Server is not running."}); }
        }
        let h = handle.clone(); let n2 = name.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(12));
            let st = h.state::<AppState>();
            let removed = { let mut procs = st.server_procs.lock().unwrap();
                if let Some(mut p) = procs.remove(&n2) { let _ = p.child.kill(); let _ = p.child.wait(); true } else { false } };
            if removed { let _ = h.emit_all("server-mgr-status", json!({"server": n2, "running": false})); }
        });
        note_refresh("servers");
        return json!({"success": true, "summary": format!("Stopping server '{}' (saving worlds).", name)});
    }
    if tool == "server_restart" {
        let name = target_server();
        if name.is_empty() { return json!({"error": "No server selected."}); }
        app.server_stopping.lock().unwrap().insert(name.clone());
        {
            let mut procs = app.server_procs.lock().unwrap();
            if let Some(p) = procs.get_mut(&name) { let _ = p.stdin.write_all(b"stop\n"); let _ = p.stdin.flush(); }
        }
        let h = handle.clone(); let n2 = name.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(6));
            let st = h.state::<AppState>();
            { let mut procs = st.server_procs.lock().unwrap();
                if let Some(mut p) = procs.remove(&n2) { let _ = p.child.kill(); let _ = p.child.wait(); } }
            launch_local_server(&st, &h, &n2);
        });
        note_refresh("servers");
        return json!({"success": true, "summary": format!("Restarting server '{}'.", name)});
    }
    if tool == "server_kill" {
        let name = target_server();
        if name.is_empty() { return json!({"error": "No server selected."}); }
        let removed = { let mut procs = app.server_procs.lock().unwrap();
            if let Some(mut p) = procs.remove(&name) { let _ = p.child.kill(); let _ = p.child.wait(); true } else { false } };
        let _ = handle.emit_all("server-mgr-status", json!({"server": name, "running": false}));
        note_refresh("servers");
        return json!({"success": removed, "summary": format!("Killed server '{}'.", name)});
    }
    if tool == "server_status" {
        let name = target_server();
        let running = app.server_procs.lock().unwrap().contains_key(&name);
        return json!({"success": true, "running": running, "summary": format!("Server '{}' is {}.", name, if running {"running"} else {"stopped"})});
    }
    if tool == "server_stats" {
        let name = target_server();
        let running = app.server_procs.lock().unwrap().contains_key(&name);
        return json!({"success": true, "running": running, "summary": format!("Server '{}': {}.", name, if running {"online"} else {"offline"})});
    }
    if tool == "server_reinstall" {
        let name = target_server();
        let version = s("version");
        if name.is_empty() { return json!({"error": "No server selected."}); }
        if version.is_empty() { return json!({"error": "Target version is required."}); }
        if app.server_procs.lock().unwrap().contains_key(&name) { return json!({"error": "Stop the server first."}); }
        let handle2 = handle.clone(); let n2 = name.clone(); let v2 = version.clone();
        let res = std::thread::spawn(move || {
            reinstall_server_blocking(Some(handle2), &n2, &v2)
        }).join();
        match res {
            Ok(v) => { note_refresh("servers"); return json!({"success": v.get("error").is_none(), "summary": format!("Reinstalled '{}' for Minecraft {}.", name, version)}); }
            Err(_) => return json!({"error": "Reinstall thread panicked."}),
        }
    }
    if tool == "server_clone" {
        let src = target_server();
        let new_name = sanitize_server_name(&s("new_name"));
        if src.is_empty() || new_name.is_empty() { return json!({"error": "Source and new name are required."}); }
        let dst = server_dir(&new_name);
        if dst.exists() { return json!({"error": format!("A server named '{}' already exists.", new_name)}); }
        if let Err(e) = copy_dir_recursive(&server_dir(&src), &dst) { return json!({"error": e}); }
        let mut meta = load_json(&dst.join("server.json"));
        if !meta.is_object() { meta = json!({}); }
        meta["name"] = json!(new_name);
        let port = n("port") as u16;
        if port > 0 {
            meta["port"] = json!(port);
            let pp = dst.join("server.properties");
            if pp.exists() {
                let content = std::fs::read_to_string(&pp).unwrap_or_default();
                let lines: Vec<String> = content.lines().map(|l| if l.trim_start().starts_with("server-port=") { format!("server-port={}", port) } else { l.to_string() }).collect();
                let _ = std::fs::write(&pp, lines.join("\n") + "\n");
            }
        }
        save_json(&dst.join("server.json"), &meta);
        note_refresh("servers");
        return json!({"success": true, "summary": format!("Cloned '{}' to '{}'.", src, new_name)});
    }
    if tool == "server_eula_accept" || tool == "server_eula_revoke" {
        let name = target_server();
        let accept = tool.ends_with("accept");
        match std::fs::write(server_dir(&name).join("eula.txt"), format!("eula={}\n", accept)) {
            Ok(_) => return json!({"success": true, "summary": format!("EULA {} for '{}'.", if accept {"accepted"} else {"revoked"}, name)}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }
    if tool == "server_versions_list" {
        let stype = s("server_type");
        let stype = if stype.is_empty() { "paper".to_string() } else { stype };
        let r = server_mgr_list_versions(stype.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        let versions = r.get("versions").cloned().unwrap_or(json!([]));
        return json!({"success": true, "server_type": stype, "versions": versions, "count": versions.as_array().map(|a| a.len()).unwrap_or(0)});
    }
    if tool == "server_types_list" {
        return json!({"success": true, "types": ["paper","purpur","fabric","vanilla"], "summary": "Supported server types: Paper, Purpur, Fabric, Vanilla."});
    }
    if tool == "server_java_list" {
        let javas: Value = json!(find_all_java_installations());
        return json!({"success": true, "javas": javas, "count": javas.as_array().map(|a| a.len()).unwrap_or(0)});
    }
    if tool == "server_check_port" {
        let port = n("port") as u16;
        let available = std::net::TcpListener::bind(("0.0.0.0", port)).is_ok();
        return json!({"success": true, "port": port, "available": available});
    }
    if tool == "server_next_port" {
        let mut port = n("start") as u16;
        if port == 0 { port = 25565; }
        while port < 65535 && std::net::TcpListener::bind(("0.0.0.0", port)).is_err() { port += 1; }
        return json!({"success": true, "port": port});
    }
    if tool == "server_open_folder" {
        let name = target_server();
        let dir = server_dir(&name);
        if !dir.exists() { return json!({"error": "Server folder not found."}); }
        let _ = webbrowser::open(&dir.to_string_lossy());
        return json!({"success": true, "summary": format!("Opened the folder for '{}'.", name)});
    }
    if tool == "server_icon_read" {
        let name = target_server();
        let p = server_dir(&name).join("server-icon.png");
        if !p.exists() { return json!({"exists": false}); }
        return json!({"exists": true, "data": base64::engine::general_purpose::STANDARD.encode(std::fs::read(&p).unwrap_or_default())});
    }

    // ---- console ----
    if tool.starts_with("server_console_") {
        let name = target_server();
        if name.is_empty() { return json!({"error": "No server selected."}); }
        let command = match tool {
            "server_console_command" => s("command"),
            "server_console_say" => format!("say {}", s("command")),
            "server_console_list" => "list".to_string(),
            "server_console_save_all" => "save-all".to_string(),
            "server_console_tps" => "tps".to_string(),
            "server_console_stop" => "stop".to_string(),
            "server_console_op" => format!("op {}", s("command")),
            "server_console_deop" => format!("deop {}", s("command")),
            "server_console_kick" => format!("kick {}", s("command")),
            "server_console_ban" => format!("ban {}", s("command")),
            "server_console_pardon" => format!("pardon {}", s("command")),
            "server_console_ban_ip" => format!("ban-ip {}", s("command")),
            "server_console_pardon_ip" => format!("pardon-ip {}", s("command")),
            "server_console_gamemode" => format!("gamemode {}", s("command")),
            "server_console_give" => format!("give {}", s("command")),
            "server_console_tp" => format!("tp {}", s("command")),
            "server_console_time_set" => format!("time set {}", s("command")),
            "server_console_weather" => format!("weather {}", s("command")),
            "server_console_difficulty" => format!("difficulty {}", s("command")),
            "server_console_clear" => format!("clear {}", s("command")),
            "server_console_effect" => format!("effect {}", s("command")),
            "server_console_kill" => format!("kill {}", s("command")),
            "server_console_reload" => "reload".to_string(),
            "server_console_whitelist_reload" => "whitelist reload".to_string(),
            "server_console_seed" => "seed".to_string(),
            "server_console_help" => format!("help {}", s("command")),
            _ => s("command"),
        };
        if command.trim().is_empty() { return json!({"error": "No command given."}); }
        let mut procs = app.server_procs.lock().unwrap();
        if let Some(p) = procs.get_mut(&name) {
            match p.stdin.write_all(format!("{}\n", command).as_bytes()).and_then(|_| p.stdin.flush()) {
                Ok(_) => return json!({"success": true, "summary": format!("Ran console command on '{}': {}", name, command)}),
                Err(e) => return json!({"error": e.to_string()}),
            }
        }
        return json!({"error": format!("Server '{}' is not running. Start it first.", name)});
    }

    // ---- server settings setters ----
    if let Some(key) = tool.strip_prefix("server_set_") {
        let name = target_server();
        if name.is_empty() { return json!({"error": "No server selected."}); }
        if !server_dir(&name).join("server.json").exists() { return json!({"error": format!("No server named '{}'.", name)}); }
        let mut meta = load_json(&server_dir(&name).join("server.json"));
        if !meta.is_object() { meta = json!({}); }
        let mut props_patch: Option<std::collections::HashMap<String, String>> = None;
        let mut summary = format!("Updated '{}' for '{}'.", key, name);
        match key {
            "motd" => { let v = s("value"); meta["motd"] = json!(v); props_patch = Some({ let mut m = std::collections::HashMap::new(); m.insert("motd".to_string(), v); m }); }
            "port" => { let v = n("value") as u16; meta["port"] = json!(v); props_patch = Some({ let mut m = std::collections::HashMap::new(); m.insert("server-port".to_string(), v.to_string()); m }); }
            "ram" => { meta["ram_mb"] = json!(n("value")); }
            "xms" => { meta["xms_mb"] = json!(n("value")); }
            "java" => { meta["java_path"] = json!(s("value")); }
            "jvm_args" => { meta["jvm_args"] = json!(s("value")); }
            "aikar_flags" => { meta["aikar_flags"] = json!(b("value")); }
            "auto_restart" => { meta["auto_restart"] = json!(b("value")); }
            "start_on_launch" => { meta["start_on_launch"] = json!(b("value")); }
            _ => {
                let prop_key = match key {
                    "gamemode" => "gamemode", "difficulty" => "difficulty",
                    "max_players" => "max-players", "view_distance" => "view-distance",
                    "simulation_distance" => "simulation-distance", "spawn_protection" => "spawn-protection",
                    "online_mode" => "online-mode", "pvp" => "pvp", "allow_flight" => "allow-flight",
                    "command_blocks" => "enable-command-block", "whitelist" => "white-list",
                    "enforce_whitelist" => "enforce-whitelist", "allow_nether" => "allow-nether",
                    "spawn_monsters" => "spawn-monsters", "spawn_animals" => "spawn-animals",
                    "spawn_npcs" => "spawn-npcs", "generate_structures" => "generate-structures",
                    "hardcore" => "hardcore", "force_gamemode" => "force-gamemode",
                    _ => "",
                };
                if prop_key.is_empty() { return json!({"error": format!("Unknown setting '{}'.", key)}); }
                let value = match key {
                    "gamemode" | "difficulty" => s("value"),
                    "max_players" | "view_distance" | "simulation_distance" | "spawn_protection" => n("value").to_string(),
                    _ => b("value").to_string(),
                };
                let mut m = std::collections::HashMap::new();
                m.insert(prop_key.to_string(), value);
                props_patch = Some(m);
            }
        }
        save_json(&server_dir(&name).join("server.json"), &meta);
        if let Some(patch) = props_patch { let _ = server_mgr_set_properties(name.clone(), patch); }
        note_refresh("servers");
        return json!({"success": true, "summary": summary});
    }

    // ---- properties get/set ----
    if tool == "server_properties_get" || tool == "server_properties_get_all" || tool == "server_properties_get_one" {
        let name = target_server();
        let r = server_mgr_get_properties(name.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        let props = r.get("properties").cloned().unwrap_or(json!({}));
        if tool == "server_properties_get_one" {
            let key = s("key");
            let value = props.get(&key).cloned().unwrap_or(json!(null));
            return json!({"success": true, "key": key, "value": value});
        }
        return json!({"success": true, "properties": props, "count": props.as_object().map(|o| o.len()).unwrap_or(0)});
    }
    if tool == "server_properties_set" {
        let name = target_server();
        if let Some(obj) = args.get("properties").and_then(|v| v.as_object()) {
            let mut patch = std::collections::HashMap::new();
            for (k, v) in obj { patch.insert(k.clone(), v.as_str().unwrap_or("").to_string()); }
            let r = server_mgr_set_properties(name.clone(), patch);
            if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
            return json!({"success": true, "summary": format!("Updated {} server.properties value(s) on '{}'.", obj.len(), name)});
        }
        return json!({"error": "No properties object given."});
    }

    // ---- players / whitelist / ops / bans ----
    if tool == "server_whitelist_add" {
        let name = target_server();
        let player = s("player");
        let uuid = s("uuid");
        if player.is_empty() { return json!({"error": "Player name is required."}); }
        // Write whitelist.json (works even offline), and reload if running.
        let wl = server_dir(&name).join("whitelist.json");
        let mut arr = if wl.exists() { load_json(&wl).as_array().cloned().unwrap_or_default() } else { Vec::new() };
        let exists = arr.iter().any(|e| e["name"].as_str().map(|n| n.eq_ignore_ascii_case(&player)).unwrap_or(false));
        if !exists { arr.push(json!({"uuid": uuid, "name": player})); }
        save_json(&wl, &Value::Array(arr));
        let mut running = false;
        { let mut procs = app.server_procs.lock().unwrap();
            if let Some(p) = procs.get_mut(&name) { running = true; let _ = p.stdin.write_all(format!("whitelist add {}\n", player).as_bytes()); let _ = p.stdin.flush(); } }
        return json!({"success": true, "summary": format!("Added '{}' to the whitelist of '{}'{}.", player, name, if running {" and reloaded"} else {""})});
    }
    if tool == "server_whitelist_remove" {
        let name = target_server();
        let player = s("player");
        let wl = server_dir(&name).join("whitelist.json");
        let mut arr = if wl.exists() { load_json(&wl).as_array().cloned().unwrap_or_default() } else { Vec::new() };
        arr.retain(|e| e["name"].as_str().map(|n| !n.eq_ignore_ascii_case(&player)).unwrap_or(true));
        save_json(&wl, &Value::Array(arr));
        { let mut procs = app.server_procs.lock().unwrap();
            if let Some(p) = procs.get_mut(&name) { let _ = p.stdin.write_all(format!("whitelist remove {}\n", player).as_bytes()); let _ = p.stdin.flush(); } }
        return json!({"success": true, "summary": format!("Removed '{}' from the whitelist of '{}'.", player, name)});
    }
    if tool == "server_whitelist_list" || tool == "server_ops_list" || tool == "server_bans_list" {
        let name = target_server();
        let file = match tool {
            "server_whitelist_list" => "whitelist.json",
            "server_ops_list" => "ops.json",
            _ => "banned-players.json",
        };
        let p = server_dir(&name).join(file);
        let entries = if p.exists() { load_json(&p).as_array().cloned().unwrap_or_default() } else { Vec::new() };
        return json!({"success": true, "file": file, "entries": entries, "count": entries.len()});
    }
    if tool == "server_whitelist_enable" || tool == "server_whitelist_disable" {
        let name = target_server();
        let enable = tool.ends_with("enable");
        let r = server_mgr_set_properties(name.clone(), { let mut m = std::collections::HashMap::new(); m.insert("white-list".to_string(), enable.to_string()); m });
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Whitelist {} on '{}'.", if enable {"enabled"} else {"disabled"}, name)});
    }
    if tool == "server_whitelist_reload" || tool == "server_plugin_reload" {
        let name = target_server();
        let cmd = if tool == "server_whitelist_reload" { "whitelist reload" } else { "reload" };
        let mut procs = app.server_procs.lock().unwrap();
        if let Some(p) = procs.get_mut(&name) {
            let _ = p.stdin.write_all(format!("{}\n", cmd).as_bytes()); let _ = p.stdin.flush();
            return json!({"success": true, "summary": format!("Ran '{}' on '{}'.", cmd, name)});
        }
        return json!({"error": "Server is not running."});
    }
    if tool == "server_ops_add" {
        let name = target_server();
        let player = s("player");
        let level = n("level");
        let level = if level == 0 { 4 } else { level };
        let p = server_dir(&name).join("ops.json");
        let mut arr = if p.exists() { load_json(&p).as_array().cloned().unwrap_or_default() } else { Vec::new() };
        let uuid = s("uuid");
        arr.push(json!({"uuid": uuid, "name": player, "level": level, "bypassesPlayerLimit": false}));
        save_json(&p, &Value::Array(arr));
        return json!({"success": true, "summary": format!("Opped '{}' (level {}) on '{}'.", player, level, name)});
    }
    if tool == "server_ops_remove" {
        let name = target_server();
        let player = s("player");
        let p = server_dir(&name).join("ops.json");
        let mut arr = if p.exists() { load_json(&p).as_array().cloned().unwrap_or_default() } else { Vec::new() };
        arr.retain(|e| e["name"].as_str().map(|n| !n.eq_ignore_ascii_case(&player)).unwrap_or(true));
        save_json(&p, &Value::Array(arr));
        return json!({"success": true, "summary": format!("Deopped '{}' on '{}'.", player, name)});
    }
    if tool == "server_bans_add" {
        let name = target_server();
        let player = s("player");
        let reason = s("reason");
        let p = server_dir(&name).join("banned-players.json");
        let mut arr = if p.exists() { load_json(&p).as_array().cloned().unwrap_or_default() } else { Vec::new() };
        arr.push(json!({"uuid": s("uuid"), "name": player, "source": "Xryloth", "reason": reason, "created": chrono::Local::now().to_rfc3339()}));
        save_json(&p, &Value::Array(arr));
        return json!({"success": true, "summary": format!("Banned '{}' on '{}'.", player, name)});
    }
    if tool == "server_bans_remove" {
        let name = target_server();
        let player = s("player");
        let p = server_dir(&name).join("banned-players.json");
        let mut arr = if p.exists() { load_json(&p).as_array().cloned().unwrap_or_default() } else { Vec::new() };
        arr.retain(|e| e["name"].as_str().map(|n| !n.eq_ignore_ascii_case(&player)).unwrap_or(true));
        save_json(&p, &Value::Array(arr));
        return json!({"success": true, "summary": format!("Unbanned '{}' on '{}'.", player, name)});
    }
    if tool == "server_players_list" {
        let name = target_server();
        let mut procs = app.server_procs.lock().unwrap();
        if let Some(p) = procs.get_mut(&name) {
            let _ = p.stdin.write_all(b"list\n"); let _ = p.stdin.flush();
            return json!({"success": true, "summary": format!("Sent 'list' to '{}'; see the console for online players.", name)});
        }
        return json!({"error": "Server is not running."});
    }

    // ---- plugins ----
    if tool == "server_plugins_list" {
        let name = target_server();
        let r = server_mgr_list_plugins(name.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return r;
    }
    if tool == "server_plugin_install" || tool == "server_viaversion_install" {
        let name = target_server();
        let slug = if tool == "server_viaversion_install" { "viaversion".to_string() } else { s("slug") };
        let version = s("version");
        if slug.is_empty() { return json!({"error": "Plugin slug is required (e.g. viaversion)."}); }
        if name.is_empty() { return json!({"error": "No server selected."}); }
        let mc = load_json(&server_dir(&name).join("server.json")).get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let res = install_plugin_blocking(&name, &slug, if version.is_empty() { None } else { Some(version) }, if mc.is_empty() { None } else { Some(mc) });
        if let Some(e) = res.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Installed plugin '{}' into '{}'.", slug, name)});
    }
    if tool == "server_plugin_remove" {
        let name = target_server();
        let filename = sanitize_file_name(&s("filename"));
        if filename.is_empty() { return json!({"error": "Plugin filename is required."}); }
        let p = server_dir(&name).join("plugins").join(&filename);
        match std::fs::remove_file(&p) {
            Ok(_) => return json!({"success": true, "summary": format!("Removed plugin '{}'.", filename)}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }
    if tool == "server_plugin_search" || tool == "instance_mod_search" {
        let query = s("query");
        let limit = n("limit") as u32;
        let limit = if limit == 0 { 10 } else { limit };
        let loader = s("loader");
        let mc = s("mc_version");
        let hits = search_modrinth(query.clone(), Some("mod".to_string()), if loader.is_empty() { None } else { Some(loader) }, if mc.is_empty() { None } else { Some(mc) }, Some(limit));
        return json!({"success": true, "query": query, "results": hits, "count": hits.as_array().map(|a| a.len()).unwrap_or(0)});
    }
    if tool == "server_plugin_info" || tool == "instance_mod_info" {
        let slug = s("slug");
        let r = get_modrinth_project(slug.clone());
        if r.get("error").is_some() { return r; }
        return json!({"success": true, "project": r});
    }
    if tool == "server_plugin_update" {
        let name = target_server();
        // Reinstall all installed plugins? Too heavy; instead inform the latest version of each.
        let r = server_mgr_list_plugins(name.clone());
        return json!({"success": true, "summary": format!("Installed plugins on '{}': use server_plugin_install with the slug to update a specific one.", name), "plugins": r.get("plugins").cloned().unwrap_or(json!([]))});
    }
    if tool == "server_plugin_enable" || tool == "server_plugin_disable" {
        let name = target_server();
        let filename = sanitize_file_name(&s("filename"));
        if filename.is_empty() { return json!({"error": "Plugin filename is required."}); }
        let dir = server_dir(&name).join("plugins");
        let enable = tool.ends_with("enable");
        let src = if enable { dir.join(format!("{}.disabled", filename)) } else { dir.join(&filename) };
        let dst = if enable { dir.join(&filename) } else { dir.join(format!("{}.disabled", filename)) };
        match std::fs::rename(&src, &dst) {
            Ok(_) => return json!({"success": true, "summary": format!("{} plugin '{}' (restart/reload to apply).", if enable {"Enabled"} else {"Disabled"}, filename)}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }

    // ---- worlds & backups ----
    if tool == "server_worlds_list" {
        let name = target_server();
        let mut worlds = Vec::new();
        if let Ok(rd) = std::fs::read_dir(server_dir(&name)) {
            for e in rd.flatten() {
                let p = e.path();
                let n2 = e.file_name().to_string_lossy().to_string();
                if p.is_dir() && n2.starts_with("world") && p.join("level.dat").exists() { worlds.push(n2); }
            }
        }
        return json!({"success": true, "worlds": worlds, "count": worlds.len()});
    }
    if tool == "server_world_reset" {
        let name = target_server();
        let world = sanitize_file_name(&s("world"));
        if world.is_empty() || !world.starts_with("world") { return json!({"error": "World folder name is required (e.g. world)."}); }
        if app.server_procs.lock().unwrap().contains_key(&name) { return json!({"error": "Stop the server first."}); }
        let p = server_dir(&name).join(&world);
        match std::fs::remove_dir_all(&p) {
            Ok(_) => return json!({"success": true, "summary": format!("Reset world '{}' on '{}'. It regenerates on next start.", world, name)}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }
    if tool == "server_world_reset_all" {
        let name = target_server();
        if app.server_procs.lock().unwrap().contains_key(&name) { return json!({"error": "Stop the server first."}); }
        let mut removed = Vec::new();
        if let Ok(rd) = std::fs::read_dir(server_dir(&name)) {
            for e in rd.flatten() {
                let p = e.path();
                let n2 = e.file_name().to_string_lossy().to_string();
                if p.is_dir() && n2.starts_with("world") && p.join("level.dat").exists() {
                    if std::fs::remove_dir_all(&p).is_ok() { removed.push(n2); }
                }
            }
        }
        return json!({"success": true, "removed": removed, "summary": format!("Reset {} world(s) on '{}'.", removed.len(), name)});
    }
    if tool == "server_backups_list" {
        let name = target_server();
        let r = server_mgr_backup_list(name.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return r;
    }
    if tool == "server_backup_create" {
        let name = target_server();
        let label = if s("label").is_empty() { None } else { Some(s("label")) };
        let res = std::thread::spawn(move || {
            // server_mgr_backup_create is async; call the blocking core via a tiny wrapper
            ai_backup_create_blocking(&name, label)
        }).join();
        match res {
            Ok(v) => { note_refresh("backups"); return v; }
            Err(_) => return json!({"error": "Backup thread panicked."}),
        }
    }
    if tool == "server_backup_restore" {
        let name = target_server();
        let file = s("file");
        if file.is_empty() { return json!({"error": "Backup filename is required."}); }
        if app.server_procs.lock().unwrap().contains_key(&name) { return json!({"error": "Stop the server before restoring a backup."}); }
        let base = server_dir(&name);
        let archive = base.join("xryloth_backups").join(sanitize_file_name(&file));
        if !archive.exists() { return json!({"error": format!("Backup '{}' not found.", file)}); }
        if let Err(e) = ai_restore_backup_blocking(&base, &archive) { return json!({"error": e}); }
        return json!({"success": true, "summary": format!("Restored backup '{}' on '{}'.", file, name)});
    }
    if tool == "server_backup_delete" {
        let name = target_server();
        let file = sanitize_file_name(&s("file"));
        let p = server_dir(&name).join("xryloth_backups").join(&file);
        match std::fs::remove_file(&p) {
            Ok(_) => return json!({"success": true, "summary": format!("Deleted backup '{}'.", file)}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }

    // ---- files ----
    if tool == "server_files_list" || tool == "server_file_search" {
        let name = target_server();
        let subpath = s("path");
        let query = s("query");
        let r = server_mgr_files_list(name.clone(), if subpath.is_empty() { None } else { Some(subpath.clone()) });
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        let mut entries = r.get("entries").cloned().unwrap_or(json!([]));
        if !query.is_empty() {
            if let Some(arr) = entries.as_array_mut() {
                arr.retain(|e| e["name"].as_str().map(|n| n.to_lowercase().contains(&query.to_lowercase())).unwrap_or(false));
            }
        }
        return json!({"success": true, "path": subpath.clone(), "entries": entries, "count": entries.as_array().map(|a| a.len()).unwrap_or(0)});
    }
    if tool == "server_file_read" {
        let name = target_server();
        let p = s("path");
        let r = server_mgr_file_read(name.clone(), p.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "path": p, "content": r.get("content").cloned().unwrap_or(json!(""))});
    }
    if tool == "server_file_write" {
        let name = target_server();
        let p = s("path");
        let content = s("content");
        let r = server_mgr_file_write(name.clone(), p.clone(), content.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Wrote '{}'.", p)});
    }
    if tool == "server_file_mkdir" {
        let name = target_server();
        let p = s("path");
        let r = server_mgr_file_mkdir(name.clone(), p.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Created folder '{}'.", p)});
    }
    if tool == "server_file_delete" {
        let name = target_server();
        let p = s("path");
        let r = server_mgr_file_delete(name.clone(), p.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Deleted '{}'.", p)});
    }
    if tool == "server_file_rename" {
        let name = target_server();
        let p = s("path");
        let new_name = s("new_name");
        let r = server_mgr_file_rename(name.clone(), p.clone(), new_name.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Renamed '{}' to '{}'.", p, new_name)});
    }
    if tool == "server_file_duplicate" {
        let name = target_server();
        let p = s("path");
        let r = server_mgr_file_copy(name.clone(), p.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Duplicated '{}' as '{}'.", p, r.get("name").and_then(|v| v.as_str()).unwrap_or(""))});
    }
    if tool == "server_file_download" {
        let name = target_server();
        let p = s("path");
        if p.is_empty() { return json!({"error": "File path is required."}); }
        let base = server_dir(&name);
        let src = match safe_join(&base, &p) { Some(v) => v, None => return json!({"error": "Invalid path."}) };
        if !src.is_file() { return json!({"error": "Only files can be downloaded."}); }
        // Copy into the user's Downloads folder. A blocking save dialog must not
        // be opened from a worker thread.
        let fname = src.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "file.bin".to_string());
        let dest_dir = dirs::download_dir()
            .or_else(|| dirs::home_dir())
            .unwrap_or_else(|| app_dir().join("downloads"));
        let _ = std::fs::create_dir_all(&dest_dir);
        let mut dest = dest_dir.join(&fname);
        let mut i = 1;
        while dest.exists() {
            let stem = Path::new(&fname).file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
            let ext = Path::new(&fname).extension().map(|x| x.to_string_lossy().to_string());
            dest = match ext {
                Some(e) => dest_dir.join(format!("{} ({}).{}", stem, i, e)),
                None => dest_dir.join(format!("{} ({})", stem, i)),
            };
            i += 1;
            if i > 999 { break; }
        }
        match std::fs::copy(&src, &dest) {
            Ok(_) => return json!({"success": true, "saved": dest.to_string_lossy(), "summary": format!("Saved '{}' to {}.", fname, dest_dir.display())}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }
    if tool == "server_logs_read" {
        let name = target_server();
        let lines = app.server_logs.lock().unwrap().get(&name).cloned().unwrap_or_default();
        return json!({"success": true, "lines": lines, "count": lines.len()});
    }
    if tool == "server_logs_clear" {
        let name = target_server();
        app.server_logs.lock().unwrap().remove(&name);
        return json!({"success": true, "summary": format!("Cleared the console log buffer for '{}'.", name)});
    }
    if tool == "server_jar_info" {
        let name = target_server();
        let p = server_dir(&name).join("server.jar");
        if !p.exists() { return json!({"exists": false}); }
        let meta = std::fs::metadata(&p).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta.as_ref().and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        return json!({"exists": true, "size": size, "modified": modified});
    }

    // ---- instances ----
    if tool == "instance_list" {
        let instances = load_instances_raw(app);
        let out: Vec<Value> = instances.iter().map(|i| json!({"name": i["name"], "version": i["version"], "loader": i["loader"], "loader_version": i["loader_version"]})).collect();
        return json!({"success": true, "instances": out, "count": out.len()});
    }
    if tool == "instance_create" {
        let name = s("name");
        let mc = s("mc_version");
        let loader = s("loader");
        let loader_version = s("loader_version");
        if name.is_empty() || mc.is_empty() || loader.is_empty() { return json!({"error": "Profile name, Minecraft version and loader are required."}); }
        let inst_dir = instances_dir().join(&name);
        let _ = std::fs::create_dir_all(&inst_dir);
        for subdir in &["mods", "saves", "resourcepacks", "screenshots", "natives", "assets", "config"] {
            let _ = std::fs::create_dir_all(inst_dir.join(subdir));
        }
        let instance_data = json!({
            "name": name, "version": mc, "loader": loader,
            "loader_version": loader_version,
            "created": chrono::Local::now().to_rfc3339(),
            "last_played": null, "icon": "",
        });
        let mut instances = load_instances_raw(app);
        instances.push(instance_data.clone());
        save_instances(&instances);
        *app.ai_context.lock().unwrap() = Some(json!({"kind": "instance", "name": name.clone()}));
        note_refresh("instances");
        // Actually download the client jar, libraries, assets and the mod loader
        // in the background so the profile is genuinely playable (previously this
        // only created the folder — an empty shell that could not launch).
        install_instance(handle.clone(), name.clone(), mc.clone(), loader.clone(), loader_version.clone());
        return json!({"success": true, "summary": format!("Created profile '{}' and started installing {} {} in the background. It will be ready to launch once the download finishes — check the Profiles page for live progress.", name, loader, mc), "instance": instance_data});
    }
    if tool == "instance_delete" {
        let name = s("name");
        let _ = std::fs::remove_dir_all(instances_dir().join(&name));
        let mut instances = load_instances_raw(app);
        instances.retain(|i| i["name"].as_str() != Some(&name));
        save_instances(&instances);
        if ctx_instance.as_deref() == Some(&name) { *app.ai_context.lock().unwrap() = None; }
        note_refresh("instances");
        return json!({"success": true, "summary": format!("Deleted profile '{}'.", name)});
    }
    if tool == "instance_launch" {
        let name = s("name");
        let exists = load_instances_raw(app).iter().any(|i| i["name"].as_str() == Some(&name));
        if !exists { return json!({"error": format!("No profile named '{}'.", name)}); }
        emit_action(json!({"type": "launch-instance", "name": name.clone()}));
        return json!({"success": true, "summary": format!("Launching profile '{}'.", name)});
    }
    if tool == "instance_open_folder" {
        let name = s("name");
        let r = open_instance_folder(name.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        return json!({"success": true, "summary": format!("Opened the folder for profile '{}'.", name)});
    }
    if tool == "instance_mods_list" {
        let name = s("name");
        let r = get_instance_mods(name.clone());
        if let Some(e) = r.get("error") { return json!({"error": e.clone()}); }
        let mods = r.get("mods").cloned().unwrap_or(json!([]));
        return json!({"success": true, "mods": mods, "count": mods.as_array().map(|a| a.len()).unwrap_or(0)});
    }
    if tool == "instance_mod_install" {
        let name = s("name");
        let slug = s("slug");
        let version = s("version");
        if name.is_empty() || slug.is_empty() { return json!({"error": "Profile name and mod slug are required."}); }
        let mut loader = "fabric".to_string();
        let mut mc = String::new();
        for inst in load_instances_raw(app) {
            if inst["name"].as_str() == Some(&name) {
                loader = inst["loader"].as_str().unwrap_or("fabric").to_string();
                mc = inst["version"].as_str().unwrap_or("").to_string();
                break;
            }
        }
        let mods_dir = instances_dir().join(&name).join("mods");
        let _ = std::fs::create_dir_all(&mods_dir);
        let loader_normalized = if loader == "quilt" { "quilt" } else { "fabric" };
        let (display, ok) = download_mod_from_modrinth(&slug, &slug, if loader == "forge" || loader == "neoforge" { loader.as_str() } else { loader_normalized }, &mc, &mods_dir, app);
        if !ok { return json!({"error": format!("No compatible version of '{}' for {} {}.", slug, loader, mc)}); }
        note_refresh("instances");
        return json!({"success": true, "summary": format!("Installed mod '{}' into profile '{}'.", display, name)});
    }
    if tool == "instance_mod_remove" {
        let name = s("name");
        let filename = sanitize_file_name(&s("filename"));
        let p = instances_dir().join(&name).join("mods").join(&filename);
        match std::fs::remove_file(&p) {
            Ok(_) => return json!({"success": true, "summary": format!("Removed mod '{}'.", filename)}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }
    if tool == "instance_mod_enable" || tool == "instance_mod_disable" {
        let name = s("name");
        let filename = sanitize_file_name(&s("filename"));
        let dir = instances_dir().join(&name).join("mods");
        let enable = tool.ends_with("enable");
        let src = if enable { dir.join(format!("{}.disabled", filename)) } else { dir.join(&filename) };
        let dst = if enable { dir.join(&filename) } else { dir.join(format!("{}.disabled", filename)) };
        match std::fs::rename(&src, &dst) {
            Ok(_) => return json!({"success": true, "summary": format!("{} mod '{}'.", if enable {"Enabled"} else {"Disabled"}, filename)}),
            Err(e) => return json!({"error": e.to_string()}),
        }
    }
    if tool == "instance_versions_list" {
        let manifest = match http_get(MOJANG_VERSION_MANIFEST, None) {
            Ok(m) => m,
            Err(e) => return json!({"error": e}),
        };
        let versions: Vec<String> = manifest["versions"].as_array()
            .map(|a| a.iter().take(30).filter_map(|v| v["id"].as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();
        return json!({"success": true, "versions": versions, "count": versions.len()});
    }
    if tool == "instance_playtime" {
        let name = s("name");
        let times = load_json(&playtimes_file());
        let secs = times.get(&name).and_then(|v| v.as_f64()).unwrap_or(0.0);
        return json!({"success": true, "seconds": secs, "summary": format!("Playtime for '{}': {} seconds.", name, secs as u64)});
    }
    if tool == "instance_settings_set_ram" || tool == "instance_settings_set_java" {
        let name = s("name");
        let key = if tool.ends_with("ram") { "ram_mb" } else { "java_path" };
        let value = if tool.ends_with("ram") { json!(n("ram_mb")) } else { json!(s("java_path")) };
        // Per-instance overrides live in instance meta; store under instance name map.
        let p = app_dir().join("instance_settings.json");
        let mut data = load_json(&p);
        if !data.is_object() { data = json!({}); }
        let entry = data.get_mut(&name);
        let obj = match entry { Some(e) if e.is_object() => e.as_object_mut().unwrap().clone(), _ => serde_json::Map::new() };
        let mut obj = obj;
        obj.insert(key.to_string(), value);
        data[&name] = Value::Object(obj);
        save_json(&p, &data);
        return json!({"success": true, "summary": format!("Set {} for profile '{}'.", key, name)});
    }

    json!({"error": format!("Unknown tool '{}'.", tool)})
}

// Blocking helpers reused by the AI tool executor.
fn ai_backup_create_blocking(name: &str, label: Option<String>) -> Value {
    // Mirrors server_mgr_backup_create but synchronous (called from a tool).
    let name = sanitize_server_name(name);
    let base = server_dir(&name);
    if !base.exists() { return json!({"error": "Server not found."}); }
    let backups = base.join("xryloth_backups");
    let _ = std::fs::create_dir_all(&backups);
    let safe_label = label.filter(|l| !l.trim().is_empty()).map(|l| sanitize_file_name(&l))
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string());
    let file = unique_path(&backups.join(format!("{}.zip", safe_label)));
    let file_name = file.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let out = match std::fs::File::create(&file) {
        Ok(f) => f,
        Err(e) => return json!({"error": e.to_string()}),
    };
    let mut zip = zip::ZipWriter::new(out);
    if let Err(e) = zip_dir_recursive(&mut zip, &base, "") {
        return json!({"error": e});
    }
    if let Err(e) = zip.finish() { return json!({"error": e.to_string()}); }
    json!({"success": true, "file": file_name, "summary": format!("Created backup '{}'.", file_name)})
}

fn zip_dir_recursive(zip: &mut zip::ZipWriter<std::fs::File>, base: &Path, prefix: &str) -> Result<(), String> {
    let options = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in std::fs::read_dir(base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "xryloth_backups" { continue; }
        let zip_name = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };
        if path.is_dir() {
            zip.add_directory(&zip_name, options).map_err(|e| e.to_string())?;
            zip_dir_recursive(zip, &path, &zip_name)?;
        } else {
            zip.start_file(&zip_name, options).map_err(|e| e.to_string())?;
            let data = std::fs::read(&path).map_err(|e| e.to_string())?;
            use std::io::Write;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn ai_restore_backup_blocking(base: &Path, archive: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.starts_with("xryloth_backups/") { continue; }
        let outpath = base.join(&name);
        if entry.is_dir() {
            let _ = std::fs::create_dir_all(&outpath);
        } else {
            if let Some(parent) = outpath.parent() { let _ = std::fs::create_dir_all(parent); }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
            use std::io::Read;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            use std::io::Write;
            outfile.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn ai_chat(app: State<'_, AppState>, handle: tauri::AppHandle, messages: Vec<Value>, context: Option<Value>) -> Result<Value, String> {
    // Update the active workspace.
    if let Some(ctx) = &context {
        let kind = ctx.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let name = ctx.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if !kind.is_empty() && !name.is_empty() {
            *app.ai_context.lock().unwrap() = Some(ctx.clone());
        } else {
            *app.ai_context.lock().unwrap() = None;
        }
    }
    let emit = |handle: &tauri::AppHandle, event: &str, payload: Value| { let _ = handle.emit_all(event, payload); };
    let system = ai_system_prompt(&app);
    let mut convo: Vec<Value> = vec![json!({"role": "system", "content": system})];
    for m in &messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");
        let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
        if role == "user" || role == "assistant" {
            convo.push(json!({"role": role, "content": content}));
        }
    }
    let all_tools = ai_tool_defs();
    let tools = ai_select_tools(&app.ai_context.lock().unwrap().clone(), &convo, &all_tools);
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(300)).build().map_err(|e| e.to_string())?;
    let settings = load_settings(&app);
    // Resolve API keys at runtime — never compiled in.
    let groq_key = ai_resolve_key(&app, AI_GROQ_SETTING_KEY, AI_GROQ_ENV, "groq");
    let gemini_key = ai_resolve_key(&app, AI_GEMINI_SETTING_KEY, AI_GEMINI_ENV, "gemini");
    if groq_key.is_empty() && gemini_key.is_empty() {
        emit(&handle, "ai-chunk", json!({"text": "⚠️ No AI API keys configured. Set them on the Xryloth AI page, in ~/.xryloth/ai_keys.json, or via XRYLOTH_GROQ_KEY / XRYLOTH_GEMINI_KEY env vars."}));
    }
    let groq_override = settings.get("ai_groq_model").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let gemini_override = settings.get("ai_gemini_model").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());

    let mut rounds = 0;
    loop {
        rounds += 1;
        if rounds > AI_MAX_TOOL_ROUNDS {
            let note = "I've reached the maximum number of steps for this request. Here's what I completed so far.";
            emit(&handle, "ai-chunk", json!({"text": note}));
            emit(&handle, "ai-done", json!({"reply": note}));
            return Ok(json!({"reply": note}));
        }
        // Build the provider/model fallback chain: Groq first, then Gemini.
        let mut attempts: Vec<(AiProvider, String)> = Vec::new();
        if let Some(m) = &groq_override { attempts.push((AiProvider::Groq, m.clone())); }
        for m in GROQ_MODELS { attempts.push((AiProvider::Groq, m.to_string())); }
        if let Some(m) = &gemini_override { attempts.push((AiProvider::Gemini, m.clone())); }
        for m in GEMINI_MODELS { attempts.push((AiProvider::Gemini, m.to_string())); }
        let mut seen = std::collections::HashSet::new();
        attempts.retain(|(p, m)| seen.insert((*p, m.clone())));

        let mut response: Option<AiResponse> = None;
        let mut last_err = String::new();
        for (prov, model) in &attempts {
            let mut tries = 0;
            loop {
                tries += 1;
                let res = match prov {
                    AiProvider::Groq => ai_groq_chat(&client, &groq_key, model, &convo, &tools, |c| emit(&handle, "ai-chunk", json!({"text": c}))).await,
                    AiProvider::Gemini => ai_gemini_chat(&client, &gemini_key, model, &system, &convo, &tools, |c| emit(&handle, "ai-chunk", json!({"text": c}))).await,
                };
                match res {
                    Ok(r) => { response = Some(r); break; }
                    Err(e) => {
                        last_err = format!("{:?} {}: {}", prov, model, e);
                        // Rate limited: wait for the window Groq reports and retry
                        // the same model before moving down the chain.
                        if tries < 3 {
                            if let Some(wait) = ai_rate_limit_wait(&e) {
                                emit(&handle, "ai-status", json!({"text": format!("Rate limited — retrying in {:.0}s…", wait)}));
                                tokio::time::sleep(std::time::Duration::from_secs_f64(wait)).await;
                                continue;
                            }
                        }
                        emit(&handle, "ai-status", json!({"text": format!("{} failed, trying the next model…", model)}));
                    }
                }
                break;
            }
            if response.is_some() { break; }
        }
        let resp = match response {
            Some(r) => r,
            None => {
                let msg = "All AI providers failed to answer. Check your internet connection and try again.";
                emit(&handle, "ai-chunk", json!({"text": msg}));
                emit(&handle, "ai-done", json!({"reply": msg}));
                return Ok(json!({"reply": msg, "error": last_err}));
            }
        };
        if !resp.streamed && !resp.content.is_empty() {
            emit(&handle, "ai-chunk", json!({"text": resp.content}));
        }
        if resp.tool_calls.is_empty() {
            emit(&handle, "ai-done", json!({"reply": resp.content}));
            return Ok(json!({"reply": resp.content}));
        }
        // Assistant turn with tool calls.
        let tc_json: Vec<Value> = resp.tool_calls.iter().map(|tc| json!({
            "id": tc.id, "type": "function",
            "function": {"name": tc.name, "arguments": tc.arguments}
        })).collect();
        convo.push(json!({"role": "assistant", "content": resp.content, "tool_calls": tc_json}));
        for tc in &resp.tool_calls {
            emit(&handle, "ai-tool", json!({"tool": tc.name, "status": "start"}));
            let parsed: Value = serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
            let result = ai_execute_tool(&app, &handle, &tc.name, &parsed).await;
            let result_str = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
            let summary = result.get("summary").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let status = if result.get("error").is_some() { "error" } else { "done" };
            emit(&handle, "ai-tool", json!({"tool": tc.name, "status": status, "summary": summary}));
            convo.push(json!({"role": "tool", "tool_call_id": tc.id, "name": tc.name, "content": result_str}));
        }
    }
}

#[tauri::command]
fn ai_context_set(kind: String, name: String) -> Value {
    // Simple setter used by the UI; the full context lives in AppState via ai_chat.
    json!({"success": true, "kind": kind, "name": name})
}

#[tauri::command]
fn ai_context_get_app(app: State<AppState>) -> Value {
    json!({"context": app.ai_context.lock().unwrap().clone()})
}

#[tauri::command]
fn ai_context_clear_app(app: State<AppState>) -> Value {
    *app.ai_context.lock().unwrap() = None;
    json!({"success": true})
}

// ==================== PIN/UNPIN INSTANCE ====================
#[tauri::command]
fn pin_instance(app: State<AppState>, instance_name: String) -> Value {
    let mut instances = load_instances_raw(&app);
    for inst in instances.iter_mut() {
        if inst.get("name").and_then(|v| v.as_str()) == Some(&instance_name) {
            inst["pinned"] = Value::Bool(true);
            save_instances(&instances);
            return json!({"success": true});
        }
    }
    json!({"error": "Instance not found"})
}

#[tauri::command]
fn unpin_instance(app: State<AppState>, instance_name: String) -> Value {
    let mut instances = load_instances_raw(&app);
    for inst in instances.iter_mut() {
        if inst.get("name").and_then(|v| v.as_str()) == Some(&instance_name) {
            inst["pinned"] = Value::Bool(false);
            save_instances(&instances);
            return json!({"success": true});
        }
    }
    json!({"error": "Instance not found"})
}

// ==================== SCREENSHOTS ====================
#[tauri::command]
fn get_screenshots(app: State<AppState>, instance_name: String) -> Value {
    let screenshots_dir = instances_dir().join(&instance_name).join("screenshots");
    let mut screenshots = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&screenshots_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".webp") {
                let metadata = entry.metadata().ok();
                let modified = metadata.as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                screenshots.push(json!({
                    "name": name,
                    "path": entry.path().to_string_lossy().to_string(),
                    "modified": modified,
                }));
            }
        }
    }
    screenshots.sort_by(|a, b|
        b.get("modified").and_then(|v| v.as_u64()).unwrap_or(0)
            .cmp(&a.get("modified").and_then(|v| v.as_u64()).unwrap_or(0))
    );
    json!({"screenshots": screenshots})
}

// ==================== EXPORT/IMPORT INSTANCE CONFIG ====================
#[tauri::command]
fn export_instance_config(app: State<AppState>, instance_name: String, output_path: String) -> Value {
    let instances = load_instances_raw(&app);
    for inst in &instances {
        if inst.get("name").and_then(|v| v.as_str()) == Some(&instance_name) {
            let out = PathBuf::from(&output_path);
            if let Some(parent) = out.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::write(&out, serde_json::to_string_pretty(inst).unwrap_or_default()) {
                Ok(()) => return json!({"success": true, "path": output_path}),
                Err(e) => return json!({"error": e.to_string()}),
            }
        }
    }
    json!({"error": "Instance not found"})
}

#[tauri::command]
fn import_instance_config(app: State<AppState>, file_path: String) -> Value {
    let data = match std::fs::read_to_string(&file_path) {
        Ok(d) => d,
        Err(e) => return json!({"error": e.to_string()}),
    };
    let parsed: Value = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(e) => return json!({"error": format!("Invalid JSON: {}", e)}),
    };
    if parsed.get("name").is_none() || parsed.get("version").is_none() {
        return json!({"error": "Config must have 'name' and 'version' fields"});
    }
    let now = chrono::Utc::now().to_rfc3339();
    let mut inst = parsed.clone();
    if inst.get("created").is_none() {
        inst["created"] = Value::String(now);
    }
    inst["installed"] = Value::Bool(false);
    let mut instances = load_instances_raw(&app);
    if instances.iter().any(|i| i.get("name").and_then(|v| v.as_str()) == inst.get("name").and_then(|v| v.as_str())) {
        return json!({"error": "Instance with this name already exists"});
    }
    instances.push(inst.clone());
    save_instances(&instances);
    json!({"success": true, "instance": inst})
}

// ==================== BATCH INSTALL MODS ====================
#[tauri::command(async)]
fn batch_install_mods(app: State<AppState>, instance_name: String, slugs: Vec<String>) -> Value {
        tokio::task::block_in_place(|| {
    let mut installed = 0;
    let mut errors = Vec::new();
    for slug in &slugs {
        match install_mod_inner(&app, &instance_name, slug, None) {
            Value::Object(ref obj) if obj.contains_key("success") && obj.get("success") == Some(&Value::Bool(true)) => {
                installed += 1;
            }
            other => {
                let err = other.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string();
                errors.push(json!({"slug": slug, "error": err}));
            }
        }
    }
    json!({"success": true, "installed": installed, "errors": errors})

        })
    }

// ==================== CHECK LAUNCHER UPDATE ====================
#[tauri::command(async)]
fn check_launcher_update(_app: State<AppState>) -> Value {
        tokio::task::block_in_place(|| {
    release_info()

        })
    }

// ==================== UPDATE: DOWNLOAD WITH REALTIME LOGS ====================
fn emit_update_log(app: &tauri::AppHandle, msg: &str) {
    let _ = app.emit_all("update-log", msg.to_string());
}

fn emit_update_progress(app: &tauri::AppHandle, downloaded: u64, total: u64, speed: u64) {
    let percent = if total > 0 {
        ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u32
    } else { 0 };
    let _ = app.emit_all("update-progress", json!({
        "downloaded": downloaded,
        "total": total,
        "percent": percent,
        "speed": speed,
    }));
}

fn download_update_with_progress(app: &tauri::AppHandle, url: &str, dest: &Path) -> Result<u64, String> {
    if let Some(parent) = dest.parent() { let _ = std::fs::create_dir_all(parent); }
    emit_update_log(app, &format!("Connecting to {}", url));
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Server returned HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    if total > 0 {
        emit_update_log(app, &format!("Download size: {:.1} MB", total as f64 / 1_048_576.0));
    }
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 131072];
    let mut downloaded: u64 = 0;
    let start = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();
    let mut last_logged_mb: u64 = 0;
    loop {
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        if last_emit.elapsed().as_millis() >= 120 {
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            emit_update_progress(app, downloaded, total, (downloaded as f64 / elapsed) as u64);
            last_emit = std::time::Instant::now();
        }
        let mib = downloaded / 1_048_576;
        if mib > last_logged_mb {
            last_logged_mb = mib;
            let line = if total > 0 {
                format!("Downloaded {} MB / {:.1} MB", mib, total as f64 / 1_048_576.0)
            } else {
                format!("Downloaded {} MB", mib)
            };
            emit_update_log(app, &line);
        }
    }
    let _ = file.flush();
    let elapsed = start.elapsed().as_secs_f64().max(0.001);
    emit_update_progress(app, downloaded, if total > 0 { total } else { downloaded }, (downloaded as f64 / elapsed) as u64);
    emit_update_log(app, "Download complete. Verifying file...");
    if total > 0 && downloaded != total {
        return Err(format!("Incomplete download ({} of {} bytes)", downloaded, total));
    }
    Ok(downloaded)
}

#[tauri::command(async)]
fn download_update(app: tauri::AppHandle, url: String, filename: String) -> Value {
        tokio::task::block_in_place(|| {
    if url.trim().is_empty() {
        return json!({"error": "No download URL provided"});
    }
    let dir = updates_dir();
    let _ = std::fs::create_dir_all(&dir);
    let raw = if filename.trim().is_empty() {
        url.rsplit('/').next().unwrap_or("Xryloth-update.bin").to_string()
    } else {
        filename
    };
    // Never allow path separators in the destination file name.
    let name = raw.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("Xryloth-update.bin").to_string();
    let dest = dir.join(&name);
    let _ = std::fs::remove_file(&dest);
    match download_update_with_progress(&app, &url, &dest) {
        Ok(size) => json!({
            "success": true,
            "path": dest.to_string_lossy(),
            "filename": name,
            "size": size,
        }),
        Err(e) => {
            emit_update_log(&app, &format!("Download failed: {}", e));
            json!({"error": e})
        }
    }

        })
    }

// ==================== UPDATE: INSTALL / RELAUNCH ====================
#[tauri::command]
fn install_update(app: tauri::AppHandle, path: String) -> Value {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return json!({"error": "Update file no longer exists"});
    }
    emit_update_log(&app, "Preparing to apply update...");

    #[cfg(target_os = "windows")]
    { install_update_windows(&app, &p) }
    #[cfg(target_os = "linux")]
    { install_update_linux(&app, &p) }
    #[cfg(target_os = "macos")]
    { install_update_macos(&app, &p) }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { json!({"error": "Unsupported platform"}) }
}

#[cfg(target_os = "windows")]
fn install_update_windows(app: &tauri::AppHandle, path: &Path) -> Value {
    emit_update_log(app, "Launching installer. The launcher will close so files can be replaced...");
    let mut cmd = std::process::Command::new(path);
    // Detach so the installer keeps running after we exit. The NSIS installer
    // replaces the app files and offers to start the new Xryloth again.
    cmd.creation_flags(0x00000008); // DETACHED_PROCESS
    match cmd.spawn() {
        Ok(_) => {
            emit_update_log(app, "Installer started. Closing Xryloth...");
            std::thread::sleep(std::time::Duration::from_millis(900));
            std::process::exit(0);
        }
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[cfg(target_os = "linux")]
fn linux_command_exists(name: &str) -> bool {
    std::env::var("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(name).exists()))
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn install_update_linux(app: &tauri::AppHandle, path: &Path) -> Value {
    // AppImage self-update: overwrite the running AppImage file, then relaunch.
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.is_empty() {
            let target = PathBuf::from(&appimage);
            emit_update_log(app, &format!("Replacing AppImage: {}", target.display()));
            let file_name = target.file_name().map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Xryloth.AppImage".to_string());
            let staging = target.with_file_name(format!("{}.new", file_name));
            if let Err(e) = std::fs::copy(path, &staging) {
                return json!({"error": format!("Failed to stage update: {}", e)});
            }
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755));
            }
            if let Err(e) = std::fs::rename(&staging, &target) {
                if let Err(e2) = std::fs::copy(&staging, &target) {
                    return json!({"error": format!("Failed to replace AppImage: {} / {}", e, e2)});
                }
                let _ = std::fs::remove_file(&staging);
            }
            emit_update_log(app, "Update applied. Restarting Xryloth...");
            let _ = std::process::Command::new(&target)
                .arg(SINGLE_INSTANCE_TAKEOVER_FLAG)
                .spawn();
            std::process::exit(0);
        }
    }
    // .deb update (requires privileges).
    if path.extension().map(|e| e.eq_ignore_ascii_case("deb")).unwrap_or(false) {
        emit_update_log(app, "Installing .deb package (you may be asked for your password)...");
        let installer = if linux_command_exists("pkexec") { "pkexec" } else { "sudo" };
        let status = std::process::Command::new(installer)
            .arg("dpkg").arg("-i").arg(path)
            .status();
        match status {
            Ok(s) if s.success() => {
                emit_update_log(app, "Package installed. Restarting Xryloth...");
                if let Ok(exe) = std::env::current_exe() {
                    let _ = std::process::Command::new(exe)
                        .arg(SINGLE_INSTANCE_TAKEOVER_FLAG)
                        .spawn();
                }
                std::process::exit(0);
            }
            _ => json!({"error": "Package installation failed or was cancelled"}),
        }
    } else {
        // Portable raw binary: replace the running executable and relaunch.
        match std::env::current_exe() {
            Ok(exe) => {
                emit_update_log(app, &format!("Replacing {} ...", exe.display()));
                let staging = exe.with_extension("new");
                if let Err(e) = std::fs::copy(path, &staging) {
                    return json!({"error": format!("Failed to stage update: {}", e)});
                }
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755));
                }
                if std::fs::rename(&staging, &exe).is_err() {
                    if let Err(e2) = std::fs::copy(&staging, &exe) {
                        return json!({"error": format!("Failed to replace binary: {}", e2)});
                    }
                    let _ = std::fs::remove_file(&staging);
                }
                emit_update_log(app, "Update applied. Restarting Xryloth...");
                let _ = std::process::Command::new(&exe)
                    .arg(SINGLE_INSTANCE_TAKEOVER_FLAG)
                    .spawn();
                std::process::exit(0);
            }
            Err(e) => json!({"error": e.to_string()}),
        }
    }
}

#[cfg(target_os = "macos")]
fn install_update_macos(app: &tauri::AppHandle, path: &Path) -> Value {
    emit_update_log(app, "Opening the update package...");
    let _ = std::process::Command::new("open").arg(path).spawn();
    json!({"success": true, "restart": false})
}

// ==================== GAME LOGS ====================
#[tauri::command]
fn get_game_logs(app: State<AppState>, instance_name: String) -> Value {
    let log_path = instances_dir().join(&instance_name).join("logs").join("latest.log");
    if log_path.exists() {
        match std::fs::read_to_string(&log_path) {
            Ok(contents) => json!({"logs": contents}),
            Err(_) => json!({"logs": ""}),
        }
    } else {
        json!({"logs": ""})
    }
}

// ==================== MOVE MOD/RESOURCEPACK FILE ====================
#[tauri::command]
fn move_mod_file(app: State<AppState>, instance_name: String, source_path: String) -> Value {
    let mods_dir = instances_dir().join(&instance_name).join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return json!({"error": "Source file not found"});
    }
    let filename = source.file_name().unwrap_or_default().to_string_lossy().to_string();
    let dest = mods_dir.join(&filename);
    match std::fs::copy(&source, &dest) {
        Ok(_) => json!({"success": true, "filename": filename}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

#[tauri::command]
fn move_resourcepack_file(app: State<AppState>, instance_name: String, source_path: String) -> Value {
    let rp_dir = instances_dir().join(&instance_name).join("resourcepacks");
    let _ = std::fs::create_dir_all(&rp_dir);
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return json!({"error": "Source file not found"});
    }
    let filename = source.file_name().unwrap_or_default().to_string_lossy().to_string();
    let dest = rp_dir.join(&filename);
    match std::fs::copy(&source, &dest) {
        Ok(_) => json!({"success": true, "filename": filename}),
        Err(e) => json!({"error": e.to_string()}),
    }
}

// ==================== GAME BOOST ====================

#[tauri::command(async)]
fn game_boost(app: State<AppState>, instance_name: String) -> Value {
        tokio::task::block_in_place(|| {
    log_msg(&app, "[Boost] Starting game boost...");

    let mut steps_completed = 0u32;
    let mut steps_total = 0u32;
    let mut details: Vec<String> = Vec::new();

    let settings = load_json(&settings_file());
    // Auto-FPS-mod install is ON by default; every other boost step is opt-in.
    let s = |k: &str| settings.get(k).and_then(|v| v.as_bool()).unwrap_or(k == "perf_auto_mods");

    // Load instance info for auto-mod install
    let instances = load_instances_raw(&app);
    let instance = instances.iter().find(|i| i.get("name").and_then(|n| n.as_str()) == Some(&instance_name));
    let (mc_version, loader, inst_dir) = if let Some(inst) = instance {
        let v = inst.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let l = inst.get("loader").and_then(|v| v.as_str()).unwrap_or("Vanilla").to_string();
        let d = instances_dir().join(&instance_name);
        (v, l, d)
    } else {
        (String::new(), String::new(), PathBuf::new())
    };

    // Step 1: Kill unnecessary background processes
    if s("boost_kill_processes") {
        steps_total += 1;
        log_msg(&app, "[Boost] Killing unnecessary background processes...");
        let bloatware = [
            "OneDrive.exe", "OneDriveSetup.exe",
            "MicrosoftTeams.exe", "Teams.exe", "ms-teams.exe",
            "Cortana.exe", "YourPhone.exe", "PhoneExperienceHost.exe",
            "SkypeApp.exe", "SkypeBackgroundHost.exe",
            "XboxApp.exe", "GameBar.exe", "GameBarFTServer.exe",
            "Widgets.exe", "WidgetService.exe",
            "Clipchamp.exe", "ClipchampApplication.exe",
            "BingWallpaper.exe", "BingWallpaperApp.exe",
            "Spotify.exe", "SpotifyWebHelper.exe",
            "Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe",
            "EpicGamesLauncher.exe", "EpicWebHelper.exe",
            "Steam.exe", "steamwebhelper.exe",
            "BraveCrashHandler.exe",
            "Microsoft.Photos.exe", "Microsoft.Windows.Photos.exe",
            "SecurityHealthSystray.exe",
        ];
        let mut killed = 0u32;
        for proc_name in &bloatware {
            let output = hidden_cmd("taskkill")
                .args(["/F", "/IM", proc_name])
                .output();
            if let Ok(out) = output {
                if out.status.success() {
                    killed += 1;
                }
            }
        }
        steps_completed += 1;
        details.push(format!("Killed {} unnecessary processes", killed));
    }

    // Step 2: Clear Windows temp folder
    if s("boost_clear_temp") {
        steps_total += 1;
        log_msg(&app, "[Boost] Clearing Windows temp folder...");
        let temp_dir = std::env::temp_dir();
        let mut temp_cleaned = 0u64;
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Ok(meta) = std::fs::metadata(&path) {
                        temp_cleaned += meta.len();
                    }
                    let _ = std::fs::remove_file(&path);
                } else if path.is_dir() {
                    let _ = std::fs::remove_dir_all(&path);
                }
            }
        }
        steps_completed += 1;
        let temp_mb = temp_cleaned as f64 / (1024.0 * 1024.0);
        details.push(format!("Cleared {:.1} MB from temp folder", temp_mb));
    }

    // Step 3: Clear Xryloth temp folder
    if s("boost_clear_temp") {
        steps_total += 1;
        log_msg(&app, "[Boost] Clearing launcher temp folder...");
        let xryloth_temp = app_dir().join("temp");
        let mut launcher_temp_cleaned = 0u64;
        if let Ok(entries) = std::fs::read_dir(&xryloth_temp) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(meta) = std::fs::metadata(&path) {
                    launcher_temp_cleaned += meta.len();
                }
                if path.is_file() {
                    let _ = std::fs::remove_file(&path);
                } else if path.is_dir() {
                    let _ = std::fs::remove_dir_all(&path);
                }
            }
        }
        steps_completed += 1;
        details.push(format!("Cleared {:.1} MB from launcher temp", launcher_temp_cleaned as f64 / (1024.0 * 1024.0)));
    }

    // Step 4: Empty Recycle Bin
    if s("boost_empty_recycle") && cfg!(target_os = "windows") {
        steps_total += 1;
        log_msg(&app, "[Boost] Emptying Recycle Bin...");
        let _ = hidden_cmd("cmd")
            .args(["/C", "rd /s /q C:\\$Recycle.Bin"])
            .output();
        let _ = hidden_cmd("powershell")
            .args(["-Command", "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"])
            .output();
        steps_completed += 1;
        details.push("Recycle bin emptied".to_string());
    }

    // Step 5: Flush DNS cache
    if s("boost_flush_dns") && cfg!(target_os = "windows") {
        steps_total += 1;
        log_msg(&app, "[Boost] Flushing DNS cache...");
        let _ = hidden_cmd("ipconfig")
            .args(["/flushdns"])
            .output();
        steps_completed += 1;
        details.push("DNS cache flushed".to_string());
    }

    // Step 6: Clear Windows thumbnail cache
    if s("boost_clear_thumbs") && cfg!(target_os = "windows") {
        steps_total += 1;
        log_msg(&app, "[Boost] Clearing thumbnail cache...");
        let thumb_dir = dirs::home_dir().unwrap_or_default().join("AppData\\Local\\Microsoft\\Windows\\Explorer");
        let mut thumb_cleaned = 0u32;
        if let Ok(entries) = std::fs::read_dir(&thumb_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name.starts_with("thumbcache_") && path.is_file() {
                    let _ = std::fs::remove_file(&path);
                    thumb_cleaned += 1;
                }
            }
        }
        steps_completed += 1;
        details.push(format!("Cleared {} thumbnail cache files", thumb_cleaned));
    }

    // Step 7: Auto-install performance mods (if Fabric/Forge AND setting enabled)
    if s("perf_auto_mods") {
        steps_total += 1;
        let loader_lower = loader.to_lowercase();
        let is_modded = matches!(loader_lower.as_str(), "fabric" | "quilt" | "forge" | "neoforge");
        if is_modded && !mc_version.is_empty() {
        log_msg(&app, &format!("[Boost] Auto-installing FPS boost mods for {} {}...", loader, mc_version));
        let mods_dir = inst_dir.join("mods");
        let _ = std::fs::create_dir_all(&mods_dir);

        let is_fabric_like = matches!(loader_lower.as_str(), "fabric" | "quilt");
        let modrinth_loader: &str = match loader_lower.as_str() {
            "quilt" => "fabric",
            "neoforge" => "neoforge",
            "forge" => "forge",
            _ => "fabric",
        };
        let perf_mods = if is_fabric_like { PERF_MODS_FABRIC } else { PERF_MODS_FORGE };

        let mut mods_installed = 0u32;
        let mut mods_skipped = 0u32;

        // Install API first (Fabric API powers most Fabric/Quilt mods).
        if is_fabric_like {
            if matches!(install_perf_mod("fabric-api", "Fabric API", "fabric", &mc_version, &mods_dir, &app), PerfInstall::Installed) {
                mods_installed += 1;
            }
        }

        for pm in perf_mods.iter() {
            match install_perf_mod(pm.slug, pm.name, modrinth_loader, &mc_version, &mods_dir, &app) {
                PerfInstall::Installed => mods_installed += 1,
                PerfInstall::Skipped | PerfInstall::Failed => {
                    if let Some(fallback_slug) = pm.fallback {
                        if matches!(install_perf_mod(fallback_slug, &format!("{} (fallback)", pm.name), modrinth_loader, &mc_version, &mods_dir, &app), PerfInstall::Installed) {
                            mods_installed += 1;
                        } else {
                            mods_skipped += 1;
                        }
                    } else {
                        mods_skipped += 1;
                    }
                }
            }
        }
        steps_completed += 1;
        details.push(format!("FPS mods: {} installed, {} skipped/unsupported", mods_installed, mods_skipped));
        } else {
            steps_completed += 1;
            details.push("Skipped mod install (Vanilla instance)".to_string());
        }
    }

    // Step 8: Optimize system memory
    if s("boost_optimize_memory") && cfg!(target_os = "windows") {
        steps_total += 1;
        log_msg(&app, "[Boost] Optimizing system memory...");
        let _ = hidden_cmd("cmd")
            .args(["/C", "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl\" /v Win32PrioritySeparation /t REG_DWORD /d 38 /f"])
            .output();
        let _ = hidden_cmd("powershell")
            .args(["-Command", "[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()"])
            .output();
        steps_completed += 1;
        details.push("System memory optimized".to_string());
    }

    log_msg(&app, &format!("[Boost] Game boost complete: {}/{} steps", steps_completed, steps_total));
    json!({
        "success": true,
        "steps_completed": steps_completed,
        "steps_total": steps_total,
        "details": details,
    })

        })
    }

// ==================== NOTIFICATION & SOUND ====================

#[tauri::command]
fn show_notification(title: String, body: String) -> Value {
    #[cfg(target_os = "windows")]
    {
        let ps_script = format!(
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;\
             [Windows.Data.Xml.Dom.XmlDocument] > $null;\
             $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);\
             $textElements = $template.GetElementsByTagName('text');\
             $textElements.Item(0).AppendChild($template.CreateTextNode('{}')) | Out-Null;\
             $textElements.Item(1).AppendChild($template.CreateTextNode('{}')) | Out-Null;\
             $toast = [Windows.UI.Notifications.ToastNotification]::new($template);\
             $toast.Tag = 'Xryloth';\
             $toast.Group = 'Chat';\
             [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Xryloth').Show($toast);",
            title.replace("'", "''"),
            body.replace("'", "''")
        );
        let _ = std::process::Command::new("powershell")
            .args(["-Command", &ps_script])
            .creation_flags(0x08000000)
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("notify-send")
            .args([&title, &body])
            .output();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("terminal-notifier")
            .args(["-title", &title, "-message", &body])
            .output();
    }
    json!({"success": true})
}

#[tauri::command]
fn play_notification_sound() -> Value {
    json!({"success": true})
}

// ==================== UNINSTALL ====================

/// Where is this launcher installed? For an AppImage the `APPIMAGE` variable
/// holds the real (unmounted) path; on other platforms the running executable
/// sits in the install directory itself.
fn launcher_install_dir() -> PathBuf {
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.is_empty() {
            if let Some(parent) = PathBuf::from(&appimage).parent() {
                return parent.to_path_buf();
            }
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(app_dir)
}

/// POSIX single-quote a path so spaces and quotes survive the shell.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Removes the launcher — and optionally all user data — after this process
/// exits. The real work is handed to a detached helper script because we are
/// deleting the very file that is currently running.
#[tauri::command]
async fn uninstall_launcher(delete_data: bool) -> Result<Value, String> {
    let dir = launcher_install_dir();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let is_windows = cfg!(target_os = "windows");

    let mut script = String::new();

    if is_windows {
        script.push_str("@echo off\r\n");
        script.push_str("timeout /t 3 /nobreak >nul\r\n");
        for f in ["launcher.exe", "launcher.appImage", "launcher.AppImage", "Status.txt"] {
            script.push_str(&format!("del /f /q \"{}\\{}\" >nul 2>&1\r\n", dir.display(), f));
        }
        script.push_str(&format!(
            "del /f /q \"{}\\Desktop\\Xryloth.lnk\" >nul 2>&1\r\n",
            home.display()
        ));
        script.push_str(&format!(
            "rmdir /s /q \"{}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Xryloth\" >nul 2>&1\r\n",
            home.display()
        ));
        if delete_data {
            script.push_str(&format!("rmdir /s /q \"{}\" >nul 2>&1\r\n", dir.display()));
        }
        script.push_str("del /f /q \"%~f0\" >nul 2>&1\r\n");
    } else {
        script.push_str("#!/bin/sh\n");
        script.push_str("sleep 2\n");
        // The launcher may still be shutting down; make sure nothing holds the
        // files we are about to delete.
        script.push_str("pkill -i -f 'launcher.appimage' >/dev/null 2>&1\n");
        for f in ["launcher.appImage", "launcher.AppImage", "launcher.exe", "Status.txt"] {
            script.push_str(&format!(
                "rm -f {}\n",
                sh_quote(&format!("{}/{}", dir.display(), f))
            ));
        }
        script.push_str(&format!(
            "rm -f {}\n",
            sh_quote(&format!("{}/Desktop/Xryloth.desktop", home.display()))
        ));
        script.push_str(&format!(
            "rm -f {}\n",
            sh_quote(&format!("{}/.local/share/applications/xryloth.desktop", home.display()))
        ));
        if delete_data {
            script.push_str(&format!("rm -rf {}\n", sh_quote(&dir.to_string_lossy())));
        }
        script.push_str("rm -f \"$0\"\n");
    }

    let ext = if is_windows { "cmd" } else { "sh" };
    let script_path = std::env::temp_dir().join(format!(
        "xryloth-uninstall-{}.{}",
        std::process::id(),
        ext
    ));
    std::fs::write(&script_path, script)
        .map_err(|e| format!("could not write uninstall helper: {}", e))?;

    // The spawn is compile-time branched: `creation_flags` only exists on Windows.
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("cmd")
        .arg("/C")
        .arg(&script_path)
        .creation_flags(0x00000008) // DETACHED_PROCESS
        .spawn();
    #[cfg(not(target_os = "windows"))]
    let spawned = std::process::Command::new("sh").arg(&script_path).spawn();

    spawned.map_err(|e| format!("could not start uninstall helper: {}", e))?;

    // Let the UI paint its "uninstalling" message, then quit so the helper can
    // remove the running launcher.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        std::process::exit(0);
    });

    Ok(json!({
        "success": true,
        "install_dir": dir.to_string_lossy(),
        "deleted_data": delete_data,
    }))
}

// ==================== SINGLE INSTANCE ====================
//
// Xryloth is almost always started *for* the user rather than by the user: the
// installer runs it once the install finishes, the updater restarts it after
// swapping the AppImage, and the desktop icon or the installer's Launch button
// can start it again seconds later. None of that was guarded, so two copies
// could end up running side by side. Both windows carry the same WM_CLASS, so
// the desktop shows a single taskbar button for the app, and a taskbar set to
// cycle/minimise on click (Zorin's default) then makes it look as though the
// launcher minimises itself. A launcher only ever needs to run once, so a later
// launch now hands over to the running copy and exits instead of opening a
// second window.
//
// Loopback TCP is deliberate: one code path for Linux and Windows, no extra
// crate, and because every hand-off carries a greeting, an unrelated program
// sitting on the port can never stop the launcher from starting.

const SINGLE_INSTANCE_PORT: u16 = 51543;
const SINGLE_INSTANCE_PRESENT: &str = "xryloth-present";
const SINGLE_INSTANCE_TAKEOVER: &str = "xryloth-takeover";
/// Passed by the updater to the copy it starts, so the replacement takes over
/// from the launcher that is on its way out.
const SINGLE_INSTANCE_TAKEOVER_FLAG: &str = "--xryloth-takeover";

enum InstanceClaim {
    /// We are the only launcher; hand-offs are served on this listener.
    Owner(std::net::TcpListener),
    /// A launcher was already running and has just been asked to show itself.
    HandedOff,
    /// The port is unusable or belongs to something else. Start anyway rather
    /// than leaving the user with no launcher at all.
    Unavailable,
}

fn single_instance_addr() -> (&'static str, u16) {
    ("127.0.0.1", SINGLE_INSTANCE_PORT)
}

fn single_instance_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

fn single_instance_line(verb: &str) -> String {
    format!("{} {}\n", verb, single_instance_user())
}

/// Send `verb` to a launcher that is already listening, and report whether one
/// belonging to this user answered.
fn notify_existing_instance(verb: &str) -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let Ok(mut stream) = TcpStream::connect(single_instance_addr()) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    if stream.write_all(single_instance_line(verb).as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 128];
    match stream.read(&mut buf) {
        Ok(n) => String::from_utf8_lossy(&buf[..n]).trim() == format!("ok {}", single_instance_user()),
        Err(_) => false,
    }
}

/// Find a launcher from an older release, which has no hand-off listener and
/// therefore cannot be talked to.
///
/// Its AppImage payload runs as `/tmp/.mount_<name>/usr/bin/xryloth`, unique to
/// each running copy, so any such process other than this one is a launcher
/// that is already up.
#[cfg(target_os = "linux")]
fn find_older_release_instance() -> Option<i32> {
    let me = std::process::id() as i32;
    let entries = std::fs::read_dir("/proc").ok()?;
    for entry in entries.flatten() {
        let pid = match entry.file_name().to_string_lossy().parse::<i32>() {
            Ok(pid) => pid,
            Err(_) => continue,
        };
        if pid == me {
            continue;
        }
        let exe = match std::fs::read_link(format!("/proc/{}/exe", pid)) {
            Ok(exe) => exe.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        // Only the AppImage payload counts as another launcher: it is unique to
        // each running copy, whereas the AppImage *file* is also the executable
        // of our own runtime parent, which must never be mistaken for one.
        if exe.starts_with("/tmp/.mount_") && exe.ends_with("/usr/bin/xryloth") {
            return Some(pid);
        }
    }
    None
}

/// Other platforms have no process table to consult; the port hand-off covers
/// every build from this release onwards, which is all this check was for.
#[cfg(not(target_os = "linux"))]
fn find_older_release_instance() -> Option<i32> {
    None
}

/// Claim the single launcher slot.
fn claim_single_instance(takeover: bool) -> InstanceClaim {
    use std::net::TcpListener;
    use std::time::{Duration, Instant};

    let addr = single_instance_addr();

    if takeover {
        // The updater has already replaced our file and started us; the copy
        // that is exiting only has to let go of the port.
        notify_existing_instance(SINGLE_INSTANCE_TAKEOVER);
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match TcpListener::bind(addr) {
                Ok(listener) => return InstanceClaim::Owner(listener),
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return InstanceClaim::Unavailable,
            }
        }
    }

    match TcpListener::bind(addr) {
        // Nothing is listening on the port, which is expected when nobody else
        // is running. A launcher from an older release has no listener at all,
        // so still check the process table: wait briefly for it to exit (that is
        // what the self-update restart does), and otherwise step aside, so that
        // upgrading to this release cannot itself open a second window.
        Ok(listener) => match find_older_release_instance() {
            None => InstanceClaim::Owner(listener),
            Some(pid) => {
                drop(listener);
                let proc_dir = format!("/proc/{}", pid);
                let deadline = Instant::now() + Duration::from_secs(3);
                while std::path::Path::new(&proc_dir).exists() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(150));
                }
                if std::path::Path::new(&proc_dir).exists() {
                    InstanceClaim::HandedOff
                } else {
                    // It exited while we waited: the slot is ours after all.
                    match TcpListener::bind(addr) {
                        Ok(listener) => InstanceClaim::Owner(listener),
                        Err(_) => InstanceClaim::Unavailable,
                    }
                }
            }
        },
        Err(_) => {
            // Somebody holds the port, and it should be a launcher we can hand
            // over to. It may still be starting and not answering yet, so retry
            // before deciding the port belongs to something else.
            let deadline = Instant::now() + Duration::from_secs(6);
            loop {
                if notify_existing_instance(SINGLE_INSTANCE_PRESENT) {
                    // The copy we handed over to could be on its way out (the
                    // updater restarting us, or the user closing it). If the
                    // port comes free we are the launcher after all.
                    std::thread::sleep(Duration::from_millis(400));
                    return match TcpListener::bind(addr) {
                        Ok(listener) => InstanceClaim::Owner(listener),
                        Err(_) => InstanceClaim::HandedOff,
                    };
                }
                if Instant::now() >= deadline {
                    return InstanceClaim::Unavailable;
                }
                std::thread::sleep(Duration::from_millis(400));
            }
        }
    }
}

/// Answer hand-offs for as long as we are the running launcher.
fn serve_single_instance(listener: std::net::TcpListener, app: tauri::AppHandle) {
    use std::io::{Read, Write};

    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut buf = [0u8; 128];
        let n = match stream.read(&mut buf) {
            Ok(n) => n,
            Err(_) => continue,
        };
        let message = String::from_utf8_lossy(&buf[..n]).trim().to_string();
        let (verb, user) = match message.split_once(' ') {
            Some((verb, user)) => (verb.to_string(), user.to_string()),
            None => (message, String::new()),
        };
        // Another logged-in user's launcher must never be taken over.
        if user != single_instance_user() {
            let _ = stream.write_all(b"no\n");
            continue;
        }
        if verb == SINGLE_INSTANCE_PRESENT {
            let _ = stream.write_all(format!("ok {}\n", single_instance_user()).as_bytes());
            present_running_window(&app);
        } else if verb == SINGLE_INSTANCE_TAKEOVER {
            let _ = stream.write_all(format!("ok {}\n", single_instance_user()).as_bytes());
            // Our file has already been replaced by the new copy that is
            // waiting for this port, so leave exactly one launcher running.
            std::process::exit(0);
        } else {
            let _ = stream.write_all(b"no\n");
        }
    }
}

// ==================== WINDOW ACTIVATION (X11) ====================
//
// Asking the toolkit to bring the window back is not enough to restore one the
// user minimised, which is the case a hand-off has to cover: the launcher is
// started again (desktop icon, app grid, installer, updater) while its window is
// minimised, and it has to come back rather than stay minimised in the taskbar.
//
// Two measured reasons the toolkit cannot do it here:
//
//  * tao skips the focus request while it still believes the window is
//    minimised, and GTK's activation carries the application's own last
//    user-interaction timestamp. Once the user has clicked anything else (the
//    icon that started us), the window manager considers that timestamp stale
//    and refuses, answering by flagging the taskbar entry instead — the window
//    stays minimised with `_NET_WM_STATE_DEMANDS_ATTENTION` set.
//  * de-iconifying by hiding and showing the window is a no-op: the window is
//    never unmapped, only its frame is.
//
// What does work is what the desktop's own taskbar button does: send
// `_NET_ACTIVE_WINDOW` for our window. With no timestamp the window manager
// supplies the current time, which it accepts, and a trusted activation
// de-iconifies as well as raising. Verified against GNOME/Mutter: the window
// goes from `WM_STATE=Iconic`/`_NET_WM_STATE_HIDDEN` to `Normal`/`FOCUSED`.
//
// Written against libX11 directly (a second display connection, no extra crate)
// because that is the only layer that can send the request. Anything that is not
// X11 — Wayland, Windows — keeps the toolkit path and is expected to report
// false here.
#[cfg(target_os = "linux")]
mod x11_activation {
    use std::os::raw::{c_char, c_int, c_long, c_uint, c_ulong, c_void};

    const CLIENT_MESSAGE: c_int = 33; // ClientMessage
    const SUBSTRUCTURE_NOTIFY: c_long = 1 << 19; // SubstructureNotifyMask
    const SUBSTRUCTURE_REDIRECT: c_long = 1 << 20; // SubstructureRedirectMask

    /// The res_name/res_class pair of an X11 window (XClassHint).
    #[repr(C)]
    struct XClassHint {
        res_name: *mut c_char,
        res_class: *mut c_char,
    }

    /// The client-message member of an XEvent.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct XClientMessageEvent {
        type_: c_int,
        serial: c_ulong,
        send_event: c_int,
        display: *mut c_void,
        window: c_ulong,
        message_type: c_ulong,
        format: c_int,
        data: [c_long; 5],
    }

    /// XEvent is a union whose largest member is 24 longs; a client message has
    /// to be padded to that size before XSendEvent is given it.
    #[repr(C)]
    #[derive(Clone, Copy)]
    union XEvent {
        client: XClientMessageEvent,
        pad: [c_long; 24],
    }

    #[link(name = "X11")]
    extern "C" {
        fn XOpenDisplay(name: *const c_char) -> *mut c_void;
        fn XCloseDisplay(display: *mut c_void) -> c_int;
        fn XSync(display: *mut c_void, discard: c_int) -> c_int;
        fn XDefaultRootWindow(display: *mut c_void) -> c_ulong;
        fn XInternAtom(display: *mut c_void, name: *const c_char, only_if_exists: c_int) -> c_ulong;
        fn XQueryTree(
            display: *mut c_void,
            window: c_ulong,
            root_return: *mut c_ulong,
            parent_return: *mut c_ulong,
            children_return: *mut *mut c_ulong,
            nchildren_return: *mut c_uint,
        ) -> c_int;
        fn XGetClassHint(display: *mut c_void, window: c_ulong, hint: *mut XClassHint) -> c_int;
        fn XGetGeometry(
            display: *mut c_void,
            drawable: c_ulong,
            root_return: *mut c_ulong,
            x_return: *mut c_int,
            y_return: *mut c_int,
            width_return: *mut c_uint,
            height_return: *mut c_uint,
            border_width_return: *mut c_uint,
            depth_return: *mut c_uint,
        ) -> c_int;
        fn XSendEvent(
            display: *mut c_void,
            window: c_ulong,
            propagate: c_int,
            event_mask: c_long,
            event: *mut XEvent,
        ) -> c_int;
        fn XFree(data: *mut c_void) -> c_int;
    }

    /// Does an X11 name/class string equal `want`, ignoring case?
    fn name_is(name: *const c_char, want: &str) -> bool {
        if name.is_null() {
            return false;
        }
        let bytes = unsafe { std::ffi::CStr::from_ptr(name) }.to_bytes();
        bytes.eq_ignore_ascii_case(want.as_bytes())
    }

    /// The launcher's own toplevel window, found by WM_CLASS.
    ///
    /// GTK gives every application a tiny unmapped "group leader" window that
    /// carries the same class, so the largest match is the real one.
    fn find_window(display: *mut c_void, class: &str) -> Option<c_ulong> {
        unsafe {
            let root = XDefaultRootWindow(display);
            let mut root_return: c_ulong = 0;
            let mut parent_return: c_ulong = 0;
            let mut children: *mut c_ulong = std::ptr::null_mut();
            let mut count: c_uint = 0;
            if XQueryTree(
                display,
                root,
                &mut root_return,
                &mut parent_return,
                &mut children,
                &mut count,
            ) == 0
            {
                return None;
            }

            let mut best: Option<c_ulong> = None;
            let mut best_area: u64 = 0;
            for index in 0..count as usize {
                let window = *children.add(index);
                let mut hint = XClassHint {
                    res_name: std::ptr::null_mut(),
                    res_class: std::ptr::null_mut(),
                };
                let mut ours = false;
                if XGetClassHint(display, window, &mut hint) != 0 {
                    ours = name_is(hint.res_name, class) || name_is(hint.res_class, class);
                    if !hint.res_name.is_null() {
                        XFree(hint.res_name as *mut c_void);
                    }
                    if !hint.res_class.is_null() {
                        XFree(hint.res_class as *mut c_void);
                    }
                }
                if !ours {
                    continue;
                }
                let mut geometry_root: c_ulong = 0;
                let (mut x, mut y) = (0 as c_int, 0 as c_int);
                let (mut width, mut height) = (0 as c_uint, 0 as c_uint);
                let (mut border, mut depth) = (0 as c_uint, 0 as c_uint);
                if XGetGeometry(
                    display,
                    window,
                    &mut geometry_root,
                    &mut x,
                    &mut y,
                    &mut width,
                    &mut height,
                    &mut border,
                    &mut depth,
                ) == 0
                {
                    continue;
                }
                let area = u64::from(width) * u64::from(height);
                if area > best_area {
                    best_area = area;
                    best = Some(window);
                }
            }
            if !children.is_null() {
                XFree(children as *mut c_void);
            }
            best
        }
    }

    /// Send `_NET_ACTIVE_WINDOW` for `window`: source indication 1 (an ordinary
    /// application asking for its own window) and no timestamp, so the window
    /// manager supplies the current time instead of judging a stale one.
    fn send_activation(display: *mut c_void, window: c_ulong) -> bool {
        unsafe {
            let atom = XInternAtom(
                display,
                b"_NET_ACTIVE_WINDOW\0".as_ptr() as *const c_char,
                0,
            );
            if atom == 0 {
                return false;
            }
            let mut event = XEvent { pad: [0; 24] };
            event.client = XClientMessageEvent {
                type_: CLIENT_MESSAGE,
                serial: 0,
                send_event: 1,
                display,
                window,
                message_type: atom,
                format: 32,
                data: [1, 0, 0, 0, 0],
            };
            XSendEvent(
                display,
                XDefaultRootWindow(display),
                0,
                SUBSTRUCTURE_REDIRECT | SUBSTRUCTURE_NOTIFY,
                &mut event,
            ) != 0
        }
    }

    /// Bring the launcher's window to the front, restoring it if it is minimised.
    ///
    /// `class` is the application name the window is classed under. Returns
    /// whether a request was sent; false on anything that is not X11.
    pub fn activate_own_window(class: &str) -> bool {
        let display = unsafe { XOpenDisplay(std::ptr::null()) };
        if display.is_null() {
            return false;
        }
        let sent = match find_window(display, class) {
            Some(window) => send_activation(display, window),
            None => false,
        };
        unsafe {
            // Round-trip before closing so the request is on the wire, then let
            // a second connection's request stand on its own.
            XSync(display, 0);
            XCloseDisplay(display);
        }
        sent
    }
}

/// Bring the running window back in front (safe to call from any thread).
///
/// Both attempts are requests: the desktop still decides whether to give us
/// focus. They are kept together because neither is enough on its own.
///
/// * The toolkit call covers every platform and every window manager, including
///   the plain "raise the window" case. tao drops its focus request while it
///   still believes the window is minimised, so it is not a substitute for the
///   call below on the desktops where that matters.
/// * On X11, the window manager is asked directly (see the WINDOW ACTIVATION
///   section). This is what actually restores a window the user minimised, which
///   is the case a hand-off has to cover.
fn present_running_window(app: &tauri::AppHandle) {
    let handle = app.clone();
    if let Some(window) = app.get_window("main") {
        let _ = window.run_on_main_thread(move || {
            if let Some(window) = handle.get_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        });
        #[cfg(target_os = "linux")]
        {
            let class = app.package_info().name.clone();
            let _ = x11_activation::activate_own_window(&class);
        }
    }
}

// ==================== MAIN ====================
pub fn run() {
    // Migrate old .eclauncher data to .xryloth
    {
        let old_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".eclauncher");
        let new_dir = app_dir();
        if old_dir.exists() && !new_dir.exists() {
            let _ = std::fs::create_dir_all(&new_dir);
            if let Ok(entries) = std::fs::read_dir(&old_dir) {
                for entry in entries.flatten() {
                    let src = entry.path();
                    let dst = new_dir.join(entry.file_name());
                    let _ = std::fs::copy(&src, &dst);
                }
            }
        }
    }
    ensure_dirs();

    // Only one launcher at a time: a later launch (the installer starting us,
    // the desktop icon, the updater) is handed to the copy that is already up
    // instead of opening a second window. See the SINGLE INSTANCE section.
    let instance = claim_single_instance(
        std::env::args().any(|a| a == SINGLE_INSTANCE_TAKEOVER_FLAG),
    );
    if matches!(instance, InstanceClaim::HandedOff) {
        // The running launcher has just been brought to the front.
        std::process::exit(0);
    }
    let instance_listener = match instance {
        InstanceClaim::Owner(listener) => Some(listener),
        _ => None,
    };

    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_settings, save_settings, get_setting_cmd, save_setting_cmd,
            get_instances, create_instance, delete_instance, install_instance,
            launch_game,
            get_minecraft_versions, get_loader_versions, get_fabric_versions, get_supported_loaders,
            authenticate_microsoft, poll_microsoft_status, complete_microsoft_auth_cmd,
            authenticate_elyby, poll_elyby_auth, complete_elyby_auth_cmd, create_offline_account,
            ensure_authlib_injector,
            search_modrinth, get_modrinth_project, get_modrinth_versions,
            install_mod, install_resourcepack, install_modpack,
            get_minecraft_news,
            fetch_partners_remote, get_server_status,
            get_skin_info, set_custom_skin,
            get_optimizer_status, apply_optimizer,
            check_updates, get_system_info,
            get_logs, clear_logs, get_game_output, clear_game_output,
            get_play_times,
            open_instance_folder, open_instance_path, get_instance_settings, save_instance_settings, clear_instance_cache, edit_instance, get_instance_mods, toggle_mod, delete_mod,
            rename_instance, set_instance_icon, get_instance_icon,
            get_instance_resourcepacks, delete_resourcepack,
            create_instance_from_modpack, get_minecraft_news_enhanced,
            get_instance_templates, apply_instance_template,
            get_latest_release_tag,
            save_background_image, get_background_image_path, delete_background_image,
            save_background_video, get_background_video_path, delete_background_video,
            init_discord_rpc, update_discord_rpc, stop_discord_rpc, get_discord_status, open_url,
            install_performance_mods,
            get_public_ip,
            save_mod_profile, load_mod_profiles, delete_mod_profile, apply_mod_profile,
            check_mod_updates,
            analyze_crash_log,
            resolve_mod_dependencies,
            auto_enable_resourcepack,
            export_instance_mrpack,
            detect_mod_conflicts,
            check_first_launch, complete_first_launch,
            check_java_compatibility, download_java, get_java_installations, set_java_for_instance,
            run_system_command, read_file_content, write_file_content, list_directory, delete_path,
            clone_instance,
            get_servers, add_server, delete_server, ping_server,
            get_selfhost_status, download_selfhost, launch_selfhost,
            get_server_versions, get_server_builds,
            launch_server,
            pin_instance, unpin_instance,
            get_screenshots,
            export_instance_config, import_instance_config,
            batch_install_mods,
            check_launcher_update,
            download_update, install_update,
            get_game_logs,
            move_mod_file, move_resourcepack_file,
            game_boost,
            show_notification,
            play_notification_sound,
            server_mgr_list, server_mgr_create, server_mgr_start, server_mgr_stop, server_mgr_kill,
            server_mgr_command, server_mgr_status, server_mgr_logs, server_mgr_delete,
            server_mgr_get_properties, server_mgr_set_properties,
            server_mgr_search_plugins, server_mgr_install_plugin, server_mgr_list_plugins, server_mgr_delete_plugin,
            server_mgr_server_types, server_mgr_list_versions,
            server_mgr_files_list, server_mgr_file_read, server_mgr_file_write, server_mgr_file_delete,
            server_mgr_file_mkdir, server_mgr_file_upload,
            server_mgr_backup_list, server_mgr_backup_create, server_mgr_backup_restore, server_mgr_backup_delete,
            server_mgr_plugin_toggle, server_mgr_list_worlds, server_mgr_delete_world,
            server_mgr_set_meta, server_mgr_eula, server_mgr_clone,
            server_mgr_stats, server_mgr_check_port, server_mgr_next_port, server_mgr_clear_logs,
            ai_chat, ai_context_get_app, ai_context_clear_app, ai_context_set,
            server_mgr_update_meta, server_mgr_list_java, server_mgr_open_folder, server_mgr_read_icon,
            server_mgr_file_rename, server_mgr_file_copy, server_mgr_file_read_b64, server_mgr_file_download,
            server_mgr_reset_world, server_mgr_reinstall,
            uninstall_launcher,
            image_cache_get, image_cache_warm,
        ])
        .setup(move |app| {
            if let Some(listener) = instance_listener {
                let handle = app.handle().clone();
                std::thread::spawn(move || serve_single_instance(listener, handle));
            }

            let window = app.get_window("main").unwrap();
            window.set_title("Xryloth").ok();

            // Asset protocol scope for the local image cache.
            // tauri.conf.json's assetScope `["**"]` does not match absolute
            // /home/... paths (Tauri 1.x glob semantics), so cached images in
            // ~/.xryloth/image_cache were rejected at load ("asset protocol
            // not configured to allow the path"). Allow the cache dir (and
            // the whole app dir) explicitly at runtime.
            {
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(&app_dir(), true);
                if let Some(home) = dirs::home_dir() {
                    let _ = scope.allow_directory(&home.join(".xryloth"), true);
                }
            }

            // Ensure window is visible and not minimized on startup
            window.unminimize().ok();
            window.show().ok();
            window.set_focus().ok();

            // Put ourselves in front when we start.
            //
            // Xryloth is normally started for the user by another process: the
            // installer's "Launch", or the updater restarting us after it
            // replaced the AppImage. Neither hands us a desktop startup
            // notification, so the compositor has no user timestamp for this
            // window and can leave it behind whatever the user was looking at.
            // present_running_window asks to be brought forward instead; whether
            // the desktop allows that is its decision.
            //
            // The retry is guarded on not already having focus, so a window that
            // did come up in front is never disturbed.
            present_running_window(&app.handle());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let focused = handle
                        .get_window("main")
                        .map(|win| win.is_focused().unwrap_or(true))
                        .unwrap_or(true);
                    if !focused {
                        present_running_window(&handle);
                    }
                });
            }

            // Auto-init Discord RPC on startup
            {
                let discord_enabled = {
                    let ds = load_json(&settings_file());
                    ds.get("discord_rpc").and_then(|v| v.as_bool()).unwrap_or(true)
                };
                if discord_enabled {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(2));
                        let _ = init_discord_rpc(handle);
                    });
                }
            }

            // Auto-start any servers marked "start on launcher launch".
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    let st = handle.state::<AppState>();
                    let dir = servers_dir();
                    let mut names: Vec<String> = Vec::new();
                    if let Ok(entries) = std::fs::read_dir(&dir) {
                        for e in entries.flatten() {
                            if e.path().is_dir() {
                                names.push(e.file_name().to_string_lossy().to_string());
                            }
                        }
                    }
                    for name in names {
                        let meta = load_json(&server_dir(&name).join("server.json"));
                        if meta.get("start_on_launch").and_then(|v| v.as_bool()).unwrap_or(false) {
                            if !st.server_procs.lock().unwrap().contains_key(&name) {
                                forward_server_line(&handle, &name, "[Xryloth] Auto-starting server (start-on-launch is ON)…");
                                let _ = launch_local_server(&st, &handle, &name);
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Xryloth");
}
