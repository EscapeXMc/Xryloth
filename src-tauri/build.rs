fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/");
    tauri_build::build();

    if target.contains("windows") {
        let arch = if target.contains("x86_64") {
            "x86_64"
        } else if target.contains("i686") {
            "i686"
        } else if target.contains("aarch64") {
            "aarch64"
        } else {
            "unknown"
        };
        println!("cargo:rustc-cfg=arch=\"{}\"", arch);
    }
}
