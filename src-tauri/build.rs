// build.rs - Embeds API keys at compile time from environment variables
// Set GROQ_API_KEY, GEMINI_API_KEY before building, or place them in the
// git-ignored file `src-tauri/secrets.json`:
//
//   {
//     "groq_api_key": "...",
//     "gemini_api_key": "..."
//   }
//
// Never commit real keys into this build script or any tracked source file.

use std::env;
use std::fs;
use std::path::Path;
use std::process::Stdio;

/// Windows application manifest.
///
/// Declaring the `Microsoft.Windows.Common-Controls` v6 dependency is REQUIRED
/// for dialogs to work: without it Windows binds the app against comctl32
/// v5.82 (the legacy System32 DLL) which does not export `TaskDialogIndirect`.
/// A missing manifest is exactly what produces the runtime error
/// "The procedure entry point TaskDialogIndirect could not be located in the
/// dynamic link library".
const WINDOWS_MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">permonitorv2,permonitor</dpiAwareness>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#;

/// True when a resource compiler is reachable, i.e. when `tauri-build`'s
/// `WindowsResource::compile()` will actually produce a `.res` (icon + version
/// info + the Common-Controls manifest). `embed-resource` probes `llvm-rc` for
/// MSVC targets and `windres` for GNU targets, and honours the `RC*` env vars.
fn resource_compiler_available() -> bool {
    let target = env::var("TARGET").unwrap_or_default();
    for key in [
        format!("RC_{}", target),
        format!("RC_{}", target.replace('-', "_")),
        "RC".to_string(),
    ] {
        if let Ok(v) = env::var(&key) {
            if !v.trim().is_empty() {
                return true;
            }
        }
    }
    let probe = |exe: &str| {
        std::process::Command::new(exe)
            .arg("/?")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
    };
    if target.ends_with("-windows-msvc") {
        probe("llvm-rc")
    } else if target.contains("-windows-") {
        probe("windres") || probe(&format!("{}-w64-mingw32-windres", target.split('-').next().unwrap_or("x86_64")))
    } else {
        false
    }
}

/// When cross-compiling Windows targets from Linux (cargo-xwin) there is often
/// no `llvm-rc`, so `tauri-build` silently emits no resources at all. In that
/// case embed the manifest ourselves directly through the linker so the app
/// still binds comctl32 v6 and dialogs keep working.
fn embed_windows_manifest_fallback() {
    let out_dir = match env::var("OUT_DIR") {
        Ok(d) => d,
        Err(_) => return,
    };
    let manifest_path = Path::new(&out_dir).join("xryloth-app.manifest");
    if fs::write(&manifest_path, WINDOWS_MANIFEST).is_err() {
        return;
    }
    println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}",
        manifest_path.display()
    );
}

/// Minimal JSON read for a single string field. Kept dependency-free so the
/// build script needs no extra build-dependencies.
fn extract_secret(text: &str, name: &str) -> Option<String> {
    let needle = format!("\"{}\"", name);
    let at = text.find(&needle)?;
    let rest = &text[at + needle.len()..];
    let colon = rest.find(':')? + 1;
    let tail = &rest[colon..];
    let open = tail.find('"')? + 1;
    let after_open = &tail[open..];
    let close = after_open.find('"')?;
    Some(after_open[..close].to_string())
}

/// Resolve a build-time secret: env var first, then the local secrets.json.
fn secret(name: &str, env_var: &str) -> String {
    if let Ok(v) = env::var(env_var) {
        if !v.is_empty() {
            return v;
        }
    }
    let manifest_dir = match env::var("CARGO_MANIFEST_DIR") {
        Ok(d) => d,
        Err(_) => return String::new(),
    };
    let secrets_path = Path::new(&manifest_dir).join("secrets.json");
    if let Ok(text) = fs::read_to_string(&secrets_path) {
        if let Some(v) = extract_secret(&text, name) {
            return v;
        }
    }
    // Also try `keys.json` next to CARGO_MANIFEST_DIR (common secret layout).
    let alt_path = Path::new(&manifest_dir).join("..").join("secrets.json");
    if let Ok(text) = fs::read_to_string(&alt_path) {
        if let Some(v) = extract_secret(&text, name) {
            return v;
        }
    }
    String::new()
}

fn main() {
    // Rerun if these env vars change
    println!("cargo:rerun-if-env-changed=GROQ_API_KEY");
    println!("cargo:rerun-if-env-changed=GEMINI_API_KEY");
    println!("cargo:rerun-if-env-changed=GITHUB_API_KEY");
    println!("cargo:rerun-if-env-changed=AI_GROQ_MODEL");
    println!("cargo:rerun-if-env-changed=AI_GEMINI_MODEL");
    // Re-embed keys whenever the local secrets file changes
    println!("cargo:rerun-if-changed=secrets.json");

    // Keys are resolved from env vars, or from the git-ignored secrets.json.
    let groq_key = secret("groq_api_key", "GROQ_API_KEY");
    let gemini_key = secret("gemini_api_key", "GEMINI_API_KEY");
    let github_api_key = secret("github_api_key", "GITHUB_API_KEY");

    let groq_model = env::var("AI_GROQ_MODEL")
        .unwrap_or_else(|_| "openai/gpt-oss-120b".to_string());
    
    let gemini_model = env::var("AI_GEMINI_MODEL")
        .unwrap_or_else(|_| "gemini-3.5-flash-lite".to_string());

    let out_dir = env::var("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("embedded_keys.rs");
    
    let content = format!(
        r#"
// Auto-generated by build.rs - DO NOT EDIT MANUALLY
// Keys embedded at compile time

pub const DEFAULT_GROQ_KEY: &str = "{}";
pub const DEFAULT_GEMINI_KEY: &str = "{}";
pub const DEFAULT_GITHUB_API_KEY: &str = "{}";
pub const DEFAULT_GROQ_MODEL: &str = "{}";
pub const DEFAULT_GEMINI_MODEL: &str = "{}";
"#,
        groq_key.replace('"', "\\\""),
        gemini_key.replace('"', "\\\""),
        github_api_key.replace('"', "\\\""),
        groq_model.replace('"', "\\\""),
        gemini_model.replace('"', "\\\"")
    );
    
    fs::write(&dest_path, content).unwrap();
    
    // Also set as env vars for runtime access
    println!("cargo:rustc-env=GROQ_API_KEY={}", groq_key);
    println!("cargo:rustc-env=GEMINI_API_KEY={}", gemini_key);
    println!("cargo:rustc-env=GITHUB_API_KEY={}", github_api_key);
    println!("cargo:rustc-env=AI_GROQ_MODEL={}", groq_model);
    println!("cargo:rustc-env=AI_GEMINI_MODEL={}", gemini_model);

    // Run Tauri's own build step. This is what compiles the Windows resource
    // (application icon + version info + application MANIFEST) and validates the
    // allowlist. Without it the .exe has NO resource directory at all, so the
    // Common-Controls v6 dependency is missing and Windows tries to bind
    // TaskDialogIndirect against the legacy comctl32 v5 — producing:
    //   "The procedure entry point TaskDialogIndirect could not be located...".
    let windows_attributes =
        tauri_build::WindowsAttributes::new().app_manifest(WINDOWS_MANIFEST);
    let attributes = tauri_build::Attributes::new().windows_attributes(windows_attributes);
    if let Err(error) = tauri_build::try_build(attributes) {
        println!("cargo:warning=tauri-build failed: {}", error);
    }

    // Belt-and-suspenders: when cross-compiling Windows targets from Linux with
    // cargo-xwin and NO resource compiler (llvm-rc) is installed, `tauri-build`
    // silently embeds no resources. Push the manifest through the linker in that
    // case so dialogs still work.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && !resource_compiler_available()
    {
        println!(
            "cargo:warning=No Windows resource compiler found; embedding the Common-Controls v6 manifest via the linker. \
             Install `llvm-rc` (apt install llvm-18-tools) to also embed the app icon and version info."
        );
        embed_windows_manifest_fallback();
    }
}