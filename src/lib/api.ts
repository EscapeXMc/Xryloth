import { invoke as tauriInvoke } from "@tauri-apps/api/tauri";
import { isTauri } from "./tauri";
import type { Settings, Instance, ModrinthHit, LoaderVersion, NewsItem, SystemInfo, ModProfile, ModUpdate, ModDependency, ModConflict, CrashLogInfo, MrpackExportResult, UpdateInfo, ServerStatus } from "./types";

// Guard every backend call: outside the Tauri shell `window.__TAURI_IPC__`
// does not exist, so calling `invoke` directly throws
// "TypeError: window.__TAURI_IPC__ is not a function". Reject with a clear,
// catchable error instead.
function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(
      new Error(`Tauri backend unavailable (command "${cmd}"). Run Xryloth as a desktop app, not in a browser.`)
    );
  }
  return tauriInvoke<T>(cmd, args);
}

export const api = {
  settings: {
    get: () => invoke<Settings>("get_settings"),
    save: (settings: Record<string, any>) => invoke("save_settings", { settings }),
    getOne: (key: string, def?: any) => invoke<any>("get_setting_cmd", { key, default: def }),
    saveOne: (key: string, value: any) => invoke("save_setting_cmd", { key, value }),
  },
  instances: {
    get: () => invoke<Instance[]>("get_instances"),
    create: (name: string, mc_version: string, loader: string, loader_version: string) =>
      invoke("create_instance", { name, mcVersion: mc_version, loader, loaderVersion: loader_version }),
    delete: (name: string) => invoke("delete_instance", { name }),
    install: (instance_name: string, mc_version: string, loader: string, loader_version: string) =>
      invoke("install_instance", { instanceName: instance_name, mcVersion: mc_version, loader, loaderVersion: loader_version }),
    launch: (instance_name: string) =>
      invoke("launch_game", { instanceName: instance_name }),
    openFolder: (name: string) => invoke("open_instance_folder", { instanceName: name }),
    // Opens a sub-folder of an instance (mods / screenshots / config) in the OS file explorer
    openPath: (name: string, subFolder: string) =>
      invoke<{ success?: boolean; path?: string; error?: string }>("open_instance_path", { instanceName: name, subFolder }),
    // Clears logs / crash-reports / caches for a single profile (never touches mods or worlds)
    clearCache: (name: string) =>
      invoke<{ success?: boolean; removed?: string[]; freed_bytes?: number; error?: string }>("clear_instance_cache", { instanceName: name }),
    getMods: (name: string) => invoke<any[]>("get_instance_mods", { instanceName: name }),
    toggleMod: (instanceName: string, filename: string) =>
      invoke<{success:boolean;enabled:boolean;filename:string}>("toggle_mod", { instanceName, filename }),
    deleteMod: (instanceName: string, filename: string) =>
      invoke("delete_mod", { instanceName, filename }),
    rename: (oldName: string, newName: string) =>
      invoke("rename_instance", { oldName, newName }),
    // Rename a profile and/or change its Minecraft version + loader in one call
    edit: (instanceName: string, newName: string, mcVersion: string, loader: string, loaderVersion: string) =>
      invoke<{ success?: boolean; name?: string; renamed?: boolean; error?: string }>("edit_instance", {
        instanceName, newName, mcVersion, loader, loaderVersion,
      }),
    setIcon: (instanceName: string, iconData: string) =>
      invoke("set_instance_icon", { instanceName, iconData }),
    getIcon: (instanceName: string) =>
      invoke<{success:boolean;icon:string|null}>("get_instance_icon", { instanceName }),
    getResourcePacks: (name: string) => invoke<any[]>("get_instance_resourcepacks", { instanceName: name }),
    deleteResourcePack: (instanceName: string, filename: string) =>
      invoke("delete_resourcepack", { instanceName, filename }),
    createFromModpack: (name: string, mcVersion: string, loader: string, loaderVersion: string, mrpackUrl: string) =>
      invoke("create_instance_from_modpack", { name, mcVersion, loader, loaderVersion, mrpackUrl }),
  },
  versions: {
    getMinecraft: () => invoke<{
      all_versions: string[];
      release_versions: string[];
      version_types: Record<string, string>;
      groups: Record<string, string[]>;
      latest: { release?: string; snapshot?: string };
    }>("get_minecraft_versions"),
    getLoader: (mc_version: string, loader: string) =>
      invoke<LoaderVersion[]>("get_loader_versions", { mcVersion: mc_version, loader }),
    getFabricSupported: () => invoke<string[]>("get_fabric_versions"),
    getSupportedLoaders: (mc_version: string) => invoke<string[]>("get_supported_loaders", { mcVersion: mc_version }),
  },
   auth: {
      microsoftStart: () => invoke<{ user_code?: string; verification_uri?: string; device_code?: string; interval: number; error?: string }>("authenticate_microsoft"),
     microsoftPollStatus: () => invoke<{ status: string; result?: any }>("poll_microsoft_status"),
     microsoftPoll: (device_code: string, interval?: number) =>
       invoke<any>("poll_microsoft_status"),
     microsoftComplete: (ms_token: string, refresh_token?: string) =>
       invoke<any>("complete_microsoft_auth_cmd", { msToken: ms_token, refreshToken: refresh_token || "" }),
    elybyStart: () => invoke<{ auth_url: string }>("authenticate_elyby"),
    elybyPoll: () => invoke<any>("poll_elyby_auth"),
    elybyComplete: (code: string) => invoke<any>("complete_elyby_auth_cmd", { code }),
    createOffline: (username: string) => invoke<any>("create_offline_account", { username }),
    ensureAuthlib: () => invoke<any>("ensure_authlib_injector"),
  },
  mods: {
    search: (query: string, project_type?: string, loader?: string, mc_version?: string, limit?: number) =>
      invoke<ModrinthHit[]>("search_modrinth", { query, projectType: project_type || "mod", loader: loader || "", mcVersion: mc_version || "", limit: limit || 20 }),
    getProject: (slug: string) => invoke<any>("get_modrinth_project", { slug }),
    getVersions: (slug: string, loader?: string, mc_version?: string) =>
      invoke<any[]>("get_modrinth_versions", { slug, loader: loader || "", mcVersion: mc_version || "" }),
    install: (instance_name: string, slug: string, version_id?: string) =>
      invoke("install_mod", { instanceName: instance_name, slug, versionId: version_id || "" }),
    installResourcepack: (instance_name: string, slug: string, version_id?: string) =>
      invoke("install_resourcepack", { instanceName: instance_name, slug, versionId: version_id || "" }),
    installModpack: (instance_name: string, slug: string, version_id?: string) =>
      invoke("install_modpack", { instanceName: instance_name, slug, versionId: version_id || "" }),
  },
  news: {
    get: () => invoke<NewsItem[]>("get_minecraft_news"),
    /** Same feed plus media thumbnails, for the artwork cards on Home. */
    getEnhanced: () => invoke<NewsItem[]>("get_minecraft_news_enhanced"),
  },
  partners: {
    fetchRemote: () => invoke<Record<string, unknown>[]>("fetch_partners_remote"),
    status: (host: string, port: string) =>
      invoke<ServerStatus>("get_server_status", { host, port }),
  },
  skin: {
    getInfo: () => invoke<{ custom_skin_path: string; has_skin: boolean }>("get_skin_info"),
    set: (file_path: string) => invoke("set_custom_skin", { filePath: file_path }),
  },
  optimizer: {
    getStatus: (instance_name: string) => invoke<any>("get_optimizer_status", { instanceName: instance_name }),
    apply: (instance_name: string, settings: Record<string, any>) =>
      invoke("apply_optimizer", { instanceName: instance_name, settings }),
  },
  updates: {
    check: () => invoke<UpdateInfo>("check_updates"),
    checkLauncher: () => invoke<UpdateInfo>("check_launcher_update"),
    download: (url: string, filename: string) =>
      invoke<{ success?: boolean; path: string; filename?: string; size?: number; error?: string }>("download_update", { url, filename }),
    install: (path: string) =>
      invoke<{ success?: boolean; restart?: boolean; error?: string }>("install_update", { path }),
  },
  logs: {
    get: () => invoke<string[]>("get_logs"),
    clear: () => invoke("clear_logs"),
    getGameOutput: () => invoke<string[]>("get_game_output"),
    clearGameOutput: () => invoke("clear_game_output"),
  },
  system: {
    getInfo: () => invoke<SystemInfo>("get_system_info"),
    getPublicIp: () => invoke<{ success: boolean; ip?: string; error?: string }>("get_public_ip"),
  },
  playTimes: {
    get: () => invoke<Record<string, number>>("get_play_times"),
  },
  version: {
    getLatest: () => invoke<{ tag: string; current_version: string; notes: string; published_at: string }>("get_latest_release_tag"),
  },
  background: {
    saveFile: (data: string) => invoke<{success: boolean; path?: string}>("save_background_image", { data }),
    getFilePath: () => invoke<string>("get_background_image_path"),
    deleteFile: () => invoke("delete_background_image"),
    saveVideo: (data: string) => invoke<{success: boolean; path?: string}>("save_background_video", { data }),
    getVideoPath: () => invoke<string>("get_background_video_path"),
    deleteVideo: () => invoke("delete_background_video"),
  },
  discord: {
    init: () => invoke("init_discord_rpc"),
    status: () => invoke<{connected: boolean; enabled: boolean; client_id: string}>("get_discord_status"),
    update: (details: string, state: string, largeImage?: string, largeText?: string, smallImage?: string, smallText?: string) =>
      invoke("update_discord_rpc", {
        details,
        state,
        largeImage: largeImage || "chatgpt_image_oct_7_2026_06_05_12_pm",
        largeText: largeText || "Xryloth",
        smallImage: smallImage || "chatgpt_image_oct_7_2026_06_05_12_pm",
        smallText: smallText || "",
      }),
    stop: () => invoke("stop_discord_rpc"),
    start: (instanceName: string) => invoke("update_discord_rpc", {
      details: `Playing Minecraft`,
      state: instanceName,
      largeImage: "minecraft_logo",
      largeText: "Minecraft",
      smallImage: "chatgpt_image_oct_7_2026_06_05_12_pm",
      smallText: "Xryloth",
    }),
  },
  perfMods: {
    install: (instanceName: string, mcVersion: string, loader: string) =>
      invoke<{success: boolean; installed: number; total: number; skipped?: number; errors: number; message: string}>("install_performance_mods", {
        instanceName, mcVersion, loader,
      }),
    installXrylothMod: (instanceName: string) =>
      invoke<{success: boolean; message: string}>("install_xryloth_mod", { instanceName }),
  },
  gameBoost: {
    run: (instanceName: string) =>
      invoke<{success: boolean; steps_completed: number; steps_total: number; details: string[]}>("game_boost", {
        instanceName,
      }),
  },
  templates: {
    get: () => invoke<{templates: {id: string; name: string; description: string; icon: string; category: string; mods: {slug: string; name: string}[]}[]}>("get_instance_templates"),
    apply: (instanceName: string, templateId: string) =>
      invoke<{success: boolean; installed: number; errors: number; template_name: string}>("apply_instance_template", { instanceName, templateId }),
  },
  configEditor: {
    getFiles: (instanceName: string) =>
      invoke<{files: {name: string; path: string; size: number; type: string}[]}>("get_config_files", { instanceName }),
    readFile: (instanceName: string, filePath: string) =>
      invoke<{success: boolean; content: string; filename: string; type: string}>("read_config_file", { instanceName, filePath }),
    writeFile: (instanceName: string, filePath: string, content: string) =>
      invoke<{success: boolean; error?: string}>("write_config_file", { instanceName, filePath, content }),
  },
  openUrl: (url: string) => invoke("open_url", { url }),
  profiles: {
    save: (name: string, instanceName: string) => 
      invoke<{success: boolean}>("save_mod_profile", { name, instanceName }),
    list: () => invoke<ModProfile[]>("load_mod_profiles"),
    delete: (name: string) => invoke<{success: boolean}>("delete_mod_profile", { name }),
    apply: (name: string, instanceName: string) => 
      invoke<{success: boolean; installed: number}>("apply_mod_profile", { name, instanceName }),
  },
  modUpdates: {
    check: (instanceName: string) => invoke<ModUpdate[]>("check_mod_updates", { instanceName }),
  },
  crashLog: {
    analyze: (instanceName: string) => invoke<CrashLogInfo>("analyze_crash_log", { instanceName }),
  },
  dependencies: {
    resolve: (instanceName: string, slug: string) => 
      invoke<{success: boolean; installed: ModDependency[]}>("resolve_mod_dependencies", { instanceName, slug }),
  },
  resourcePack: {
    autoEnable: (instanceName: string, filename: string) => 
      invoke<{success: boolean}>("auto_enable_resourcepack", { instanceName, filename }),
    toggle: (instanceName: string, filename: string) =>
      invoke<{success:boolean;enabled:boolean}>("toggle_resourcepack", { instanceName, filename }),
    enable: (instanceName: string, filename: string) =>
      invoke<{success:boolean}>("enable_resourcepack", { instanceName, filename }),
    disable: (instanceName: string, filename: string) =>
      invoke<{success:boolean}>("disable_resourcepack", { instanceName, filename }),
  },
  export: {
    mrpack: (instanceName: string, name: string, versionId: string, outputPath: string) => 
      invoke<MrpackExportResult>("export_instance_mrpack", { instanceName, name, versionId, outputPath }),
  },
  conflicts: {
    detect: (instanceName: string) => invoke<ModConflict[]>("detect_mod_conflicts", { instanceName }),
  },
  wizard: {
    checkFirstLaunch: () => invoke<{first_launch: boolean}>("check_first_launch"),
    complete: () => invoke<{success: boolean}>("complete_first_launch"),
  },
  java: {
    checkCompatibility: (mcVersion: string) =>
      invoke<{mc_version: string; required_java: number; current_java_version: number | null; current_compatible: boolean; available_javas: any[]; compatible_javas: any[]}>("check_java_compatibility", { mcVersion }),
    download: (majorVersion: number) =>
      invoke<{success?: boolean; path?: string; error?: string}>("download_java", { majorVersion }),
    getInstallations: () =>
      invoke<any[]>("get_java_installations"),
    setForInstance: (javaPath: string) =>
      invoke<{success: boolean}>("set_java_for_instance", { javaPath }),
  },
  systemCmd: {
    runCommand: (command: string) =>
      invoke<{success: boolean; stdout: string; stderr: string; exit_code: number | null; error?: string}>("run_system_command", { command }),
    readFile: (path: string) =>
      invoke<{success: boolean; content?: string; error?: string}>("read_file_content", { path }),
    writeFile: (path: string, content: string) =>
      invoke<{success: boolean; error?: string}>("write_file_content", { path, content }),
    listDir: (path: string) =>
      invoke<{success: boolean; entries?: {name: string; is_dir: boolean; size: number; path: string}[]; error?: string}>("list_directory", { path }),
    deletePath: (path: string) =>
      invoke<{success: boolean; error?: string}>("delete_path", { path }),
  },
  clone: {
    instance: (instanceName: string, newInstanceName: string) =>
      invoke<{success: boolean; error?: string}>("clone_instance", { instanceName, newInstanceName }),
  },
  servers: {
    get: () => invoke<{name: string; address: string; port: number}[]>("get_servers"),
    add: (name: string, address: string, port: number) =>
      invoke<{success: boolean; error?: string}>("add_server", { name, address, port }),
    delete: (name: string) => invoke<{success: boolean}>("delete_server", { name }),
    ping: (address: string, port: number) =>
      invoke<{online: boolean; motd?: string; players?: {online: number; max: number}; version?: string; error?: string}>("ping_server", { address, port }),
  },
  selfhost: {
    getStatus: () => invoke<{exists: boolean; path: string}>("get_selfhost_status"),
    download: () => invoke<{success: boolean; path?: string; error?: string}>("download_selfhost"),
    launch: () => invoke<{success: boolean; error?: string}>("launch_selfhost"),
  },
  serverVersions: {
    getPaper: () => invoke<string[]>("get_server_versions"),
    getBuilds: (version: string) => invoke<{build_number: number; download_url: string; channel: string}[]>("get_server_builds", { version }),
  },
  launchServer: {
    start: (instanceName: string) => invoke<{success: boolean; error?: string}>("launch_server", { instanceName }),
  },
  serverMgr: {
    list: () => invoke<{ success: boolean; servers: { name: string; type: string; version: string; port: number; motd: string; ram_mb: number; created: string; path: string; running: boolean; visibility?: "public" | "private"; description?: string; tags?: string; max_players?: number; published_at?: string }[] }>("server_mgr_list"),
    create: (name: string, serverType: string, mcVersion: string, port: number, motd?: string, ramMb?: number) =>
      invoke<{ success?: boolean; server?: any; error?: string }>("server_mgr_create", { name, serverType, mcVersion, port, motd: motd || "", ramMb: ramMb || 4096 }),
    start: (name: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_start", { name }),
    stop: (name: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_stop", { name }),
    kill: (name: string) => invoke<{ success?: boolean }>("server_mgr_kill", { name }),
    command: (name: string, command: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_command", { name, command }),
    status: (name: string) => invoke<{ running: boolean }>("server_mgr_status", { name }),
    logs: (name: string) => invoke<{ success: boolean; lines: string[] }>("server_mgr_logs", { name }),
    remove: (name: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_delete", { name }),
    getProperties: (name: string) => invoke<{ success: boolean; properties: Record<string, string> }>("server_mgr_get_properties", { name }),
    setProperties: (name: string, properties: Record<string, string>) => invoke<{ success?: boolean; error?: string }>("server_mgr_set_properties", { name, properties }),
    searchPlugins: (query: string, mcVersion?: string, limit?: number) =>
      invoke<ModrinthHit[]>("server_mgr_search_plugins", { query, mcVersion: mcVersion || "", limit: limit || 20 }),
    installPlugin: (name: string, slug: string, versionId?: string, mcVersion?: string) =>
      invoke<{ success?: boolean; filename?: string; game_versions?: string; error?: string }>("server_mgr_install_plugin", { name, slug, versionId: versionId || "", mcVersion: mcVersion || "" }),
    listPlugins: (name: string) => invoke<{ success: boolean; plugins: { filename: string; size: number; enabled?: boolean }[] }>("server_mgr_list_plugins", { name }),
    deletePlugin: (name: string, filename: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_delete_plugin", { name, filename }),
    pluginToggle: (name: string, filename: string) => invoke<{ success?: boolean; enabled?: boolean; error?: string }>("server_mgr_plugin_toggle", { name, filename }),
    // Server types + per-type versions
    serverTypes: () => invoke<{ types: { id: string; name: string; desc: string }[] }>("server_mgr_server_types"),
    listVersions: (serverType: string) => invoke<{ success?: boolean; versions?: string[]; error?: string }>("server_mgr_list_versions", { serverType }),
    // Files
    filesList: (name: string, subpath?: string) => invoke<{ success: boolean; path: string; entries: { name: string; is_dir: boolean; size: number; modified: number }[] }>("server_mgr_files_list", { name, subpath: subpath || "" }),
    fileRead: (name: string, path: string) => invoke<{ success?: boolean; content?: string; error?: string }>("server_mgr_file_read", { name, path }),
    fileWrite: (name: string, path: string, content: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_file_write", { name, path, content }),
    fileDelete: (name: string, path: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_file_delete", { name, path }),
    fileMkdir: (name: string, path: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_file_mkdir", { name, path }),
    fileUpload: (name: string, subpath: string, filename: string, data: string) => invoke<{ success?: boolean; bytes?: number; filename?: string; error?: string }>("server_mgr_file_upload", { name, subpath: subpath || "", filename, data }),
    // Backups
    backupList: (name: string) => invoke<{ success: boolean; backups: { filename: string; size: number; modified: number }[] }>("server_mgr_backup_list", { name }),
    backupCreate: (name: string, label?: string) => invoke<{ success?: boolean; file?: string; error?: string }>("server_mgr_backup_create", { name, label: label || "" }),
    backupRestore: (name: string, file: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_backup_restore", { name, file }),
    backupDelete: (name: string, file: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_backup_delete", { name, file }),
    // Worlds
    listWorlds: (name: string) => invoke<{ success: boolean; worlds: string[] }>("server_mgr_list_worlds", { name }),
    deleteWorld: (name: string, world: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_delete_world", { name, world }),
    // Meta / EULA / Clone / Stats / Ports / Logs
    setMeta: (name: string, opts: { ramMb?: number; motd?: string; port?: number }) => invoke<{ success?: boolean; server?: any; error?: string }>("server_mgr_set_meta", { name, ramMb: opts.ramMb, motd: opts.motd, port: opts.port }),
    eula: (name: string, accept: boolean) => invoke<{ success?: boolean; error?: string }>("server_mgr_eula", { name, accept }),
    clone: (source: string, newName: string, newPort?: number) => invoke<{ success?: boolean; server?: any; error?: string }>("server_mgr_clone", { source, newName, newPort }),
    stats: (name: string) => invoke<{ running: boolean; pid: number; uptime_secs: number; memory_kb: number }>("server_mgr_stats", { name }),
    checkPort: (port: number) => invoke<{ available: boolean }>("server_mgr_check_port", { port }),
    nextPort: (start?: number) => invoke<{ port: number }>("server_mgr_next_port", { start }),
    clearLogs: (name: string) => invoke<{ success?: boolean }>("server_mgr_clear_logs", { name }),
    // Extended tools
    updateMeta: (name: string, patch: Record<string, any>) => invoke<{ success?: boolean; server?: any; error?: string }>("server_mgr_update_meta", { name, patch }),
    listJava: () => invoke<{ success?: boolean; javas: { path: string; major_version: number; name: string; managed?: boolean; arch?: string }[] }>("server_mgr_list_java"),
    openFolder: (name: string) => invoke<{ success?: boolean; error?: string }>("server_mgr_open_folder", { name }),
    readIcon: (name: string) => invoke<{ exists: boolean; data?: string }>("server_mgr_read_icon", { name }),
    fileRename: (name: string, path: string, newName: string) => invoke<{ success?: boolean; name?: string; error?: string }>("server_mgr_file_rename", { name, path, newName }),
    fileCopy: (name: string, path: string) => invoke<{ success?: boolean; name?: string; error?: string }>("server_mgr_file_copy", { name, path }),
    fileReadB64: (name: string, path: string) => invoke<{ success?: boolean; data?: string; error?: string }>("server_mgr_file_read_b64", { name, path }),
    fileDownload: (name: string, path: string) => invoke<{ success?: boolean; saved?: string; cancelled?: boolean; error?: string }>("server_mgr_file_download", { name, path }),
    resetWorld: (name: string, world?: string) => invoke<{ success?: boolean; removed?: string[]; error?: string }>("server_mgr_reset_world", { name, world: world || "" }),
    reinstall: (name: string, version: string) => invoke<{ success?: boolean; server?: any; error?: string }>("server_mgr_reinstall", { name, version }),
  },
  // Xryloth AI: agentic assistant powered by Groq with a Gemini fallback.
  ai: {
    chat: (messages: { role: string; content: string }[], context?: { kind: string; name: string } | null) =>
      invoke<{ reply: string; error?: string }>("ai_chat", { messages, context: context ?? null }),
    contextGet: () => invoke<{ context: { kind: string; name: string } | null }>("ai_context_get_app"),
    contextClear: () => invoke<{ success?: boolean }>("ai_context_clear_app"),
  },
  pin: {
    instance: (instanceName: string) => invoke<{success: boolean}>("pin_instance", { instanceName }),
    unpin: (instanceName: string) => invoke<{success: boolean}>("unpin_instance", { instanceName }),
  },
  screenshots: {
    get: (instanceName: string) => invoke<{screenshots: {name: string; path: string; modified: string}[]}>("get_screenshots", { instanceName }),
  },
  // Per-profile JVM & RAM overrides (fall back to global settings when unset)
  instanceSettings: {
    get: (instanceName: string) =>
      invoke<{ success?: boolean; ram_mb: number; jvm_args: string; java_path: string }>("get_instance_settings", { instanceName }),
    save: (instanceName: string, ramMb: number, jvmArgs: string, javaPath: string) =>
      invoke<{ success?: boolean; error?: string }>("save_instance_settings", {
        instanceName, ramMb, jvmArgs, javaPath,
      }),
  },
  exportConfig: {
    instance: (instanceName: string, outputPath: string) =>
      invoke<{success: boolean; path?: string; error?: string}>("export_instance_config", { instanceName, outputPath }),
  },
  importConfig: {
    instance: (filePath: string) =>
      invoke<{success: boolean; instance?: any; error?: string}>("import_instance_config", { filePath }),
  },
  batch: {
    installMods: (instanceName: string, slugs: string[]) =>
      invoke<{success: boolean; installed: number; errors: string[]}>("batch_install_mods", { instanceName, slugs }),
  },
  update: {
    checkLauncher: () =>
      invoke<{update_available: boolean; current_version: string; latest_version: string; download_url: string}>("check_launcher_update"),
  },
  gameLogs: {
    get: (instanceName: string) => invoke<{logs: string}>("get_game_logs", { instanceName }),
  },
  fileDrop: {
    moveMod: (instanceName: string, sourcePath: string) =>
      invoke<{success: boolean; filename?: string; error?: string}>("move_mod_file", { instanceName, sourcePath }),
    moveResourcepack: (instanceName: string, sourcePath: string) =>
      invoke<{success: boolean; filename?: string; error?: string}>("move_resourcepack_file", { instanceName, sourcePath }),
  },
  uninstall: {
    launcher: (deleteData: boolean) =>
      invoke<{ success: boolean; install_dir?: string; deleted_data?: boolean; error?: string }>(
        "uninstall_launcher", { deleteData }),
  },
};
