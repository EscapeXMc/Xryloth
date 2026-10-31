import { CachedImage } from "../ui/CachedImage";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { isTauri } from "../../lib/tauri";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import { Select } from "../ui/Select";
import { listen } from "@tauri-apps/api/event";
import {
  Server, Plus, Play, Square, RotateCcw, Trash2, Terminal, Settings2,
  Puzzle, Search, Download, Save, AlertCircle, Skull, X, Folder, FileText,
  Upload, Database, Users, Globe, RefreshCw, Power, Copy, ChevronRight,
  ArrowLeft, FolderPlus, Archive, Clock, Cpu, Eraser, Shield, Settings,
  HardDrive, CheckCircle2, ToggleLeft, ToggleRight, FolderOpen, FilePlus2,
  Pencil, CopyPlus, Grid3x3, List, Coffee, Palette, Wrench, CheckSquare,
  Image as ImageIcon, Lock,
} from "lucide-react";
import type { ModrinthHit } from "../../lib/types";
import { publishServer, unpublishServer, type PublicServer } from "../../lib/publicServers";
import { confirmDialog, promptDialog } from "../ui/Dialog";

type LocalServer = {
  name: string;
  type: string;
  version: string;
  port: number;
  motd: string;
  ram_mb: number;
  created: string;
  path: string;
  running: boolean;
  xms_mb?: number;
  java_path?: string;
  jvm_args?: string;
  aikar_flags?: boolean;
  auto_restart?: boolean;
  start_on_launch?: boolean;
  icon_exists?: boolean;
  visibility?: "public" | "private";
  description?: string;
  tags?: string;
  max_players?: number;
  published_at?: string;
};

type Visibility = "public" | "private";
type PublishInfo = { type: string; version: string; port: number; motd: string; ram_mb: number; description: string; tags: string; max_players: number; running: boolean };

type FileEntry = { name: string; is_dir: boolean; size: number; modified: number };
type BackupEntry = { filename: string; size: number; modified: number };
type PluginEntry = { filename: string; size: number; enabled?: boolean };
type Stats = { running: boolean; pid: number; uptime_secs: number; memory_kb: number };

const PROP_FIELDS = [
  "motd", "server-port", "max-players", "gamemode", "difficulty", "level-name",
  "level-seed", "view-distance", "simulation-distance", "spawn-protection",
  "online-mode", "pvp", "allow-flight", "enable-command-block", "white-list",
  "enforce-whitelist", "player-idle-timeout", "allow-nether", "spawn-monsters",
  "spawn-animals", "spawn-npcs", "generate-structures", "hardcore", "force-gamemode",
  "enable-rcon", "rcon.port", "rcon.password", "query.port", "enable-query",
  "prevent-proxy-connections", "network-compression-threshold", "max-world-size",
  "entity-broadcast-range-percentage", "function-permission-level", "op-permission-level",
];

const TABS = [
  { id: "console", label: "Console", Icon: Terminal },
  { id: "players", label: "Players", Icon: Users },
  { id: "properties", label: "Properties", Icon: Settings2 },
  { id: "plugins", label: "Plugins", Icon: Puzzle },
  { id: "files", label: "Files", Icon: Folder },
  { id: "backups", label: "Backups", Icon: Archive },
  { id: "worlds", label: "Worlds", Icon: Globe },
  { id: "settings", label: "Settings", Icon: Shield },
] as const;

type TabId = (typeof TABS)[number]["id"];

const FEATURES = [
  // Console
  "Live console streaming",
  "Colour-coded log levels (info / warn / error)",
  "Send any server command in real time",
  "Command history with ↑ / ↓",
  "Enter-to-send command box",
  "Console search / filter",
  "Auto-scroll toggle",
  "Clear console view",
  "Clear server log buffer",
  "Quick command buttons (list, save-all, tps…)",
  "2000-line scrollback buffer",
  "Online player count parsed from console",
  "Command input locked while offline",
  "Green highlight for server-ready lines",
  "Player-less startup guidance",
  // Players
  "Player management tab",
  "OP a player",
  "De-op a player",
  "Kick a player",
  "Ban a player",
  "Pardon a player",
  "Whitelist add",
  "Whitelist remove",
  "Creative gamemode command",
  "Survival gamemode command",
  "Online player name list",
  // Properties
  "Full server.properties editor",
  "Property search",
  "Boolean dropdowns (true / false)",
  "Curated property ordering",
  "Save properties to disk",
  "Restart-to-apply reminder",
  // Plugins
  "Modrinth plugin marketplace",
  "Plugin search by keyword",
  "Plugin icons",
  "Plugin summaries",
  "Plugin download counts",
  "Supported-version display",
  "Auto version matching for plugins",
  "Install plugin",
  "Installed plugin list with sizes",
  "Enable plugin",
  "Disable plugin (without deleting)",
  "Delete plugin",
  "Compatibility warning modal",
  "'Install Anyway' override",
  "Enter-to-search plugins",
  // Files
  "Built-in file manager",
  "Folder navigation",
  "Breadcrumb path bar",
  "Go up one level",
  "Text-file viewer & editor",
  "Save edited files",
  "Create folder",
  "Upload files (jars / packs / server-icon.png)",
  "Delete file",
  "Delete folder",
  "File size readouts",
  "5 MB editor size guard",
  "Path traversal protection",
  // Backups
  "One-click zip backups",
  "Custom backup labels",
  "Auto timestamped backup names",
  "Backup list with size & date",
  "Restore a backup",
  "Delete a backup",
  "Auto-unique backup filenames",
  "Backups excluded from backups",
  "Restore blocked while running",
  // Worlds
  "World browser",
  "Delete a world",
  "World delete blocked while running",
  // Settings
  "RAM allocation editor",
  "Server port editor",
  "MOTD editor",
  "Save server settings",
  "Accept the EULA",
  "Revoke the EULA",
  "Clone an entire server",
  "Clone with a new port",
  "Delete server with confirmation",
  "Port synced into server.properties",
  // Lifecycle
  "Start server",
  "Graceful stop",
  "Restart",
  "Force kill",
  "Watchdog graceful stop",
  "Crash / exit detection",
  "Live status events",
  "ONLINE / OFFLINE badge",
  "Per-server running dot",
  "Async jar downloads",
  "Async backup / clone operations",
  // Stats
  "Live uptime readout",
  "Memory (RSS) readout",
  "Process id (PID) readout",
  "4-second stats polling",
  // Creation
  "Named local servers",
  "Paper server type",
  "Purpur server type",
  "Fabric server type",
  "Vanilla server type",
  "Per-type Minecraft version lists",
  "Latest version preselected",
  "Deep version selection",
  "Per-server RAM limit",
  "Custom server port",
  "Port availability check",
  "Auto-find a free port",
  "MOTD set at creation",
  "Automatic server jar download",
  "Automatic EULA acceptance",
  "Isolated per-server directory",
  // UI / infra
  "Portal dropdown menus",
  "Arrow-key dropdown navigation",
  "Scroll-safe dropdowns",
  "Themed dark interface",
  "Server list sidebar",
  "Toast notifications",
  "Local-only storage",
  "Windows + Linux support",
];

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

const GAMEMODES = ["survival", "creative", "adventure", "spectator"];
const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"];
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;

function imgMime(name: string) {
  const e = name.split(".").pop()?.toLowerCase() || "";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "gif") return "image/gif";
  if (e === "webp") return "image/webp";
  if (e === "bmp") return "image/bmp";
  if (e === "ico") return "image/x-icon";
  return "image/png";
}

function fileVisual(f: FileEntry, tc: { accent: string; text_muted: string; text_sub: string; warn: string }): { Icon: any; color: string } {
  if (f.is_dir) return { Icon: Folder, color: tc.accent };
  const e = f.name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].includes(e)) return { Icon: ImageIcon, color: tc.warn };
  if (e === "jar") return { Icon: Coffee, color: tc.warn };
  if (["zip", "gz", "tar", "rar", "7z"].includes(e)) return { Icon: Archive, color: tc.text_muted };
  if (["properties", "yml", "yaml", "toml", "json", "json5", "txt", "cfg", "conf", "log"].includes(e)) return { Icon: FileText, color: tc.text_sub };
  return { Icon: FileText, color: tc.text_muted };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { themeColors } = useLauncherStore();
  return (
    <div className="mb-5">
      <p className="tinycaps text-[11px] font-bold mb-2 tracking-wide" style={{ color: themeColors.accent }}>{title}</p>
      {children}
    </div>
  );
}

function ToggleRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const { themeColors } = useLauncherStore();
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-2 py-1.5 text-left w-full">
      <span style={{ color: value ? themeColors.success : themeColors.text_muted }}>{value ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</span>
      <span className="text-xs" style={{ color: themeColors.text_sub }}>{label}</span>
      {hint && <span className="text-[10px]" style={{ color: themeColors.text_muted }}>{hint}</span>}
    </button>
  );
}

export function ServersPage() {
  const { themeColors } = useLauncherStore();
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const [tab, setTab] = useState<TabId>("console");
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [logFilter, setLogFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<Stats>({ running: false, pid: 0, uptime_secs: 0, memory_kb: 0 });

  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "paper", version: "", port: "25565", motd: "", ram: "4096", visibility: "private" as Visibility, description: "", tags: "", maxPlayers: "20" });
  const [serverTypes, setServerTypes] = useState<{ id: string; name: string; desc: string }[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [portAvailable, setPortAvailable] = useState<boolean | null>(null);
  const [download, setDownload] = useState<{ name: string; downloaded: number; total: number | null } | null>(null);

  // properties
  const [props, setProps] = useState<Record<string, string>>({});
  const [savingProps, setSavingProps] = useState(false);
  const [propSearch, setPropSearch] = useState("");

  // plugins
  const [pluginQuery, setPluginQuery] = useState("");
  const [pluginResults, setPluginResults] = useState<ModrinthHit[]>([]);
  const [pluginSearching, setPluginSearching] = useState(false);
  const [installedPlugins, setInstalledPlugins] = useState<PluginEntry[]>([]);
  const [installingPlugin, setInstallingPlugin] = useState<string | null>(null);
  const [pluginWarn, setPluginWarn] = useState<{ slug: string; title: string } | null>(null);

  // files
  const [filePath, setFilePath] = useState("");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  const [savingFile, setSavingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // backups
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupLabel, setBackupLabel] = useState("");
  const [backupBusy, setBackupBusy] = useState<string | null>(null);

  // worlds
  const [worlds, setWorlds] = useState<string[]>([]);

  // settings / clone
  const [editRam, setEditRam] = useState("4096");
  const [editMotd, setEditMotd] = useState("");
  const [editPort, setEditPort] = useState("25565");
  const [editVisibility, setEditVisibility] = useState<Visibility>("private");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [clonePort, setClonePort] = useState("");
  const [cloning, setCloning] = useState(false);

  // settings (extended)
  const [editXms, setEditXms] = useState("1024");
  const [editJava, setEditJava] = useState("");
  const [editJvmArgs, setEditJvmArgs] = useState("");
  const [aikarFlags, setAikarFlags] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [startOnLaunch, setStartOnLaunch] = useState(false);
  const [javaList, setJavaList] = useState<{ path: string; major_version: number; name: string; managed?: boolean; arch?: string }[]>([]);
  const [iconData, setIconData] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  // change version / reinstall
  const [showReinstall, setShowReinstall] = useState(false);
  const [reinstallVersion, setReinstallVersion] = useState("");
  const [reinstallVersions, setReinstallVersions] = useState<string[]>([]);
  const [reinstalling, setReinstalling] = useState(false);

  // file manager (extended)
  const [fileSearch, setFileSearch] = useState("");
  const [fileSort, setFileSort] = useState<"name" | "size" | "date">("name");
  const [fileView, setFileView] = useState<"list" | "grid">("list");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [imagePreview, setImagePreview] = useState<{ path: string; url: string } | null>(null);

  const current = servers.find((s) => s.name === selected) || null;
  const running = !!current?.running;

  const showNotice = useCallback((type: "ok" | "err", text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => setNotice((n) => (n && n.text === text ? null : n)), 4500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.serverMgr.list();
      const list = res.servers || [];
      setServers(list);
      setSelected((prev) => (prev && list.some((s) => s.name === prev) ? prev : (list[0]?.name ?? null)));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  const loadStats = useCallback(async (name: string) => {
    try { setStats(await api.serverMgr.stats(name)); } catch {}
  }, []);

  const loadFiles = useCallback(async (name: string, path: string) => {
    setFileLoading(true);
    try {
      const r = await api.serverMgr.filesList(name, path);
      setFileEntries(r.entries || []);
      setFilePath(r.path ?? path);
    } catch (e: any) { showNotice("err", String(e)); }
    setFileLoading(false);
  }, [showNotice]);

  const loadBackups = useCallback(async (name: string) => {
    try { const r = await api.serverMgr.backupList(name); setBackups(r.backups || []); } catch {}
  }, []);

  const loadWorlds = useCallback(async (name: string) => {
    try { const r = await api.serverMgr.listWorlds(name); setWorlds(r.worlds || []); } catch {}
  }, []);

  const loadPlugins = useCallback(async (name: string) => {
    try { const r = await api.serverMgr.listPlugins(name); setInstalledPlugins(r.plugins || []); } catch {}
  }, []);

  const loadProperties = useCallback(async (name: string) => {
    try { const r = await api.serverMgr.getProperties(name); setProps(r.properties || {}); } catch {}
  }, []);

  // Initial load: servers + server types
  useEffect(() => {
    if (!isTauri()) { setLoading(false); return; }
    refresh();
    api.serverMgr.serverTypes().then((r) => setServerTypes(r.types || [])).catch(() => {});
    api.serverMgr.listJava().then((r) => setJavaList(r.javas || [])).catch(() => {});
  }, [refresh]);

  // Load version list whenever the create type changes (latest first).
  useEffect(() => {
    if (!showCreate) return;
    let cancelled = false;
    api.serverMgr.listVersions(form.type).then((r) => {
      if (cancelled) return;
      const list = r.versions || [];
      setVersions(list);
      setForm((f) => ({ ...f, version: list[0] || "" }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [form.type, showCreate]);

  // port availability check (debounced)
  useEffect(() => {
    if (!showCreate) return;
    const p = parseInt(form.port);
    if (!p || p < 1 || p > 65535) { setPortAvailable(null); return; }
    const t = window.setTimeout(async () => {
      try { const r = await api.serverMgr.checkPort(p); setPortAvailable(r.available); } catch {}
    }, 350);
    return () => window.clearTimeout(t);
  }, [form.port, showCreate]);

  // WS event listeners
  useEffect(() => {
    if (!isTauri()) return;
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    // StrictMode mounts effects twice in dev. Because listen() is async, the
    // first pass's cleanup can run before its promise resolves, leaking a
    // listener and doubling every console line. Guard with `cancelled` and
    // unsubscribe immediately if the effect was torn down.
    let cancelled = false;
    (async () => {
      const a = await listen<{ server: string; line: string }>("server-mgr-output", (e) => {
        if (e.payload.server !== selectedRef.current) return;
        setLogs((prev) => {
          const next = [...prev, e.payload.line];
          return next.length > 2000 ? next.slice(next.length - 2000) : next;
        });
      });
      if (cancelled) { a(); } else { un1 = a; }
      const b = await listen<{ server: string; running: boolean; deleted?: boolean }>("server-mgr-status", (e) => {
        setServers((prev) => {
          if (e.payload.deleted) return prev.filter((s) => s.name !== e.payload.server);
          return prev.map((s) => (s.name === e.payload.server ? { ...s, running: e.payload.running } : s));
        });
      });
      if (cancelled) { b(); } else { un2 = b; }
      const c = await listen<{ server: string; downloaded: number; total: number | null }>("server-mgr-download", (e) => {
        setDownload({ name: e.payload.server, downloaded: e.payload.downloaded, total: e.payload.total ?? null });
      });
      if (cancelled) { c(); } else { un3 = c; }
    })();
    return () => { cancelled = true; un1 && un1(); un2 && un2(); un3 && un3(); };
  }, []);

  // On selection change, load everything for that server.
  useEffect(() => {
    if (!selected || !isTauri()) { setLogs([]); setProps({}); setInstalledPlugins([]); setFileEntries([]); setBackups([]); setWorlds([]); return; }
    setTab("console");
    setLogs([]);
    setCommand("");
    setPropSearch("");
    setPluginResults([]);
    setPluginQuery("");
    setFilePath("");
    setFileEntries([]);
    setFileSearch("");
    setFileSort("name");
    setSelectedFiles(new Set());
    setEditingFile(null);
    setImagePreview(null);
    api.serverMgr.readIcon(selected)
      .then((r) => setIconData(r.exists && r.data ? `data:image/png;base64,${r.data}` : null))
      .catch(() => setIconData(null));
    (async () => {
      try { const r = await api.serverMgr.logs(selected); setLogs(r.lines || []); } catch {}
      try {
        const r = await api.serverMgr.status(selected);
        setServers((prev) => prev.map((s) => (s.name === selected ? { ...s, running: r.running } : s)));
      } catch {}
      loadStats(selected);
      loadProperties(selected);
      loadPlugins(selected);
      loadFiles(selected, "");
      loadBackups(selected);
      loadWorlds(selected);
    })();
  }, [selected, loadStats, loadProperties, loadPlugins, loadFiles, loadBackups, loadWorlds]);

  // Sync the Settings tab form when the selected server changes.
  useEffect(() => {
    if (!current) return;
    setEditRam(String(current.ram_mb || 4096));
    setEditMotd(current.motd || "");
    setEditPort(String(current.port || 25565));
    setEditXms(String(current.xms_mb || Math.min(current.ram_mb || 4096, 1024)));
    setEditJava(current.java_path || "");
    setEditJvmArgs(current.jvm_args || "");
    setAikarFlags(!!current.aikar_flags);
    setAutoRestart(!!current.auto_restart);
    setStartOnLaunch(!!current.start_on_launch);
    setEditVisibility((current.visibility as Visibility) || "private");
    setEditDescription(current.description || "");
    setEditTags(current.tags || "");
  }, [current?.name, current?.ram_mb, current?.motd, current?.port, current?.xms_mb, current?.java_path, current?.jvm_args, current?.aikar_flags, current?.auto_restart, current?.start_on_launch, current?.visibility, current?.description, current?.tags]);

  // Poll stats while running.
  useEffect(() => {
    if (!selected || !running) { setStats((s) => ({ ...s, running: false })); return; }
    loadStats(selected);
    const t = window.setInterval(() => loadStats(selected), 4000);
    return () => window.clearInterval(t);
  }, [selected, running, loadStats]);

  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  const onlinePlayers = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)$/i);
      if (m) return { count: +m[1], max: +m[2], names: m[3].split(",").map((s) => s.trim()).filter(Boolean) };
    }
    return null;
  }, [logs]);

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter((l) => l.toLowerCase().includes(q));
  }, [logs, logFilter]);

  const visibleProps = useMemo(() => {
    const keys = Object.keys(props).sort((a, b) => {
      const ai = PROP_FIELDS.indexOf(a); const bi = PROP_FIELDS.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    if (!propSearch.trim()) return keys;
    const q = propSearch.toLowerCase();
    return keys.filter((k) => k.toLowerCase().includes(q) || (props[k] || "").toLowerCase().includes(q));
  }, [props, propSearch]);

  const visibleFiles = useMemo(() => {
    let list = fileEntries;
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      if (fileSort === "size") return (b.size || 0) - (a.size || 0);
      if (fileSort === "date") return (b.modified || 0) - (a.modified || 0);
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }, [fileEntries, fileSearch, fileSort]);

  // ---------- actions ----------
  const startServer = async (name: string) => {
    setBusy("start");
    try {
      const r = await api.serverMgr.start(name);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", "Server starting…"); setServers((prev) => prev.map((s) => (s.name === name ? { ...s, running: true } : s))); }
    } catch (e: any) { showNotice("err", String(e)); }
    setBusy(null);
  };
  const stopServer = async (name: string) => {
    setBusy("stop");
    try { const r = await api.serverMgr.stop(name); if (r.error) showNotice("err", r.error); else showNotice("ok", "Stopping server…"); } catch (e: any) { showNotice("err", String(e)); }
    setBusy(null);
  };
  const killServer = async (name: string) => {
    setBusy("kill");
    try {
      await api.serverMgr.kill(name);
      setServers((prev) => prev.map((s) => (s.name === name ? { ...s, running: false } : s)));
      showNotice("ok", "Server force-stopped.");
    } catch (e: any) { showNotice("err", String(e)); }
    setBusy(null);
  };
  const restartServer = async (name: string) => {
    setBusy("restart");
    try {
      await api.serverMgr.kill(name);
      await new Promise((r) => setTimeout(r, 1500));
      const r = await api.serverMgr.start(name);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", "Server restarting…"); setServers((prev) => prev.map((s) => (s.name === name ? { ...s, running: true } : s))); }
    } catch (e: any) { showNotice("err", String(e)); }
    setBusy(null);
  };
  const deleteServer = async (name: string) => {
    if (!await confirmDialog(`Delete server "${name}"?`, "This permanently removes its world and files. This action cannot be undone.", { danger: true, confirmLabel: "Delete Server" })) return;
    setBusy("delete");
    try {
      await removePublic(name);
      const r = await api.serverMgr.remove(name);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", "Server deleted."); await refresh(); }
    } catch (e: any) { showNotice("err", String(e)); }
    setBusy(null);
  };

  const sendCommand = async (cmd?: string) => {
    const c = (cmd ?? command).trim();
    if (!selected || !c) return;
    setCommand("");
    setHistory((h) => (h[h.length - 1] === c ? h : [...h, c].slice(-100)));
    setHistoryIdx(-1);
    if (/^stop$/i.test(c)) setServers((prev) => prev.map((s) => (s.name === selected ? { ...s, running: false } : s)));
    try { const r = await api.serverMgr.command(selected, c); if (r.error) showNotice("err", r.error); } catch (e: any) { showNotice("err", String(e)); }
  };

  const onCommandKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { sendCommand(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const idx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx); setCommand(history[idx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx < 0) return;
      const idx = historyIdx + 1;
      if (idx >= history.length) { setHistoryIdx(-1); setCommand(""); }
      else { setHistoryIdx(idx); setCommand(history[idx]); }
    }
  };

  const playerAction = async (action: string, needsName: boolean, extra?: string) => {
    if (needsName) {
      const name = await promptDialog("Player Name", "Enter the player name for this action:", { placeholder: "Player name", confirmLabel: "Submit" });
      if (!name) return;
      sendCommand(extra ? `${action} ${name} ${extra}` : `${action} ${name}`);
    } else {
      sendCommand(action);
    }
  };

  const setProp = (k: string, v: string) => setProps((p) => ({ ...p, [k]: v }));

  const saveProps = async () => {    if (!selected) return;
    setSavingProps(true);
    try {
      const r = await api.serverMgr.setProperties(selected, props);
      if (r.error) showNotice("err", r.error);
      else showNotice("ok", "Properties saved. Restart to apply.");
    } catch (e: any) { showNotice("err", String(e)); }
    setSavingProps(false);
  };

  // Mirror a public server to Firebase so the website's server list can show it.
  const pushPublic = async (name: string, info: PublishInfo): Promise<{ ok: boolean; error?: string }> => {
    try {
      const ipRes = await api.system.getPublicIp();
      const host = ipRes.success && ipRes.ip ? ipRes.ip : "";
      let icon = "";
      try {
        const ic = await api.serverMgr.readIcon(name);
        if (ic.exists && ic.data) icon = `data:image/png;base64,${ic.data}`;
      } catch {}
      const server: PublicServer = {
        name,
        motd: info.motd || "",
        type: info.type,
        version: info.version,
        port: info.port,
        host,
        address: host ? `${host}:${info.port}` : `:${info.port}`,
        description: info.description || "",
        tags: info.tags || "",
        ramMb: info.ram_mb,
        maxPlayers: info.max_players,
        icon: icon || undefined,
        online: info.running,
      };
      const res = await publishServer(server);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    } catch (e: any) {
      return { ok: false, error: String(e) };
    }
  };

  const removePublic = async (name: string) => {
    try { await unpublishServer(name); } catch {}
  };

  const createServer = async () => {
    setCreateErr(null);
    if (!form.name.trim()) { setCreateErr("Please enter a server name."); return; }
    if (!form.version) { setCreateErr("Please pick a Minecraft version."); return; }
    setCreating(true);
    try {
      const r = await api.serverMgr.create(form.name.trim(), form.type, form.version, parseInt(form.port) || 25565, form.motd, parseInt(form.ram) || 4096);
      if (r.error) setCreateErr(r.error);
      else {
        const created = r.server?.name || form.name.trim();
        const maxPlayers = parseInt(form.maxPlayers) || 20;
        // Persist the public/private choice + website card details.
        await api.serverMgr.updateMeta(created, {
          visibility: form.visibility,
          description: form.description,
          tags: form.tags,
          max_players: maxPlayers,
          published_at: form.visibility === "public" ? new Date().toISOString() : "",
        });
        if (form.visibility === "public") {
          const res = await pushPublic(created, {
            type: form.type, version: form.version, port: parseInt(form.port) || 25565,
            motd: form.motd, ram_mb: parseInt(form.ram) || 4096,
            description: form.description, tags: form.tags, max_players: maxPlayers, running: false,
          });
          if (res.ok) showNotice("ok", "Server created and published to the public list!");
          else showNotice("err", `Created, but publishing failed: ${res.error}`);
        } else {
          showNotice("ok", "Server created successfully! (private)");
        }
        setShowCreate(false);
        setForm({ name: "", type: "paper", version: "", port: "25565", motd: "", ram: "4096", visibility: "private", description: "", tags: "", maxPlayers: "20" });
        await refresh();
        setSelected(created);
      }
    } catch (e: any) { setCreateErr(String(e)); }
    setCreating(false);
    setDownload(null);
  };

  const searchPlugins = async () => {
    setPluginSearching(true);
    try { const hits = await api.serverMgr.searchPlugins(pluginQuery, current?.version, 24); setPluginResults(hits || []); } catch (e: any) { showNotice("err", String(e)); }
    setPluginSearching(false);
  };
  const doInstallPlugin = async (slug: string) => {
    if (!selected) return;
    setInstallingPlugin(slug);
    try {
      const r = await api.serverMgr.installPlugin(selected, slug, undefined, current?.version);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", `Installed ${r.filename}`); loadPlugins(selected); }
    } catch (e: any) { showNotice("err", String(e)); }
    setInstallingPlugin(null);
  };
  const requestInstallPlugin = (mod: ModrinthHit) => {
    const compatible = !current?.version || !mod.versions?.length || mod.versions.includes(current.version);
    if (compatible) doInstallPlugin(mod.slug);
    else setPluginWarn({ slug: mod.slug, title: mod.title });
  };
  const togglePlugin = async (p: PluginEntry) => {
    if (!selected) return;
    try {
      const r = await api.serverMgr.pluginToggle(selected, p.filename);
      if (r.error) showNotice("err", r.error); else { showNotice("ok", r.enabled ? "Plugin enabled." : "Plugin disabled."); loadPlugins(selected); }
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const deletePlugin = async (filename: string) => {
    if (!selected) return;
    try { await api.serverMgr.deletePlugin(selected, filename); loadPlugins(selected); } catch (e: any) { showNotice("err", String(e)); }
  };

  const fileFullPath = (n: string) => (filePath ? `${filePath}/${n}` : n);

  const openFile = async (entry: FileEntry) => {
    if (!selected) return;
    if (entry.is_dir) { setSelectedFiles(new Set()); loadFiles(selected, fileFullPath(entry.name)); return; }
    const p = fileFullPath(entry.name);
    try {
      if (IMG_RE.test(entry.name)) {
        const r = await api.serverMgr.fileReadB64(selected, p);
        if (r.error || !r.data) { showNotice("err", r.error || "Could not open image."); return; }
        setImagePreview({ path: p, url: `data:${imgMime(entry.name)};base64,${r.data}` });
        return;
      }
      const r = await api.serverMgr.fileRead(selected, p);
      if (r.error) showNotice("err", r.error);
      else setEditingFile({ path: p, content: r.content || "" });
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const saveFile = async () => {
    if (!selected || !editingFile) return;
    setSavingFile(true);
    try {
      const r = await api.serverMgr.fileWrite(selected, editingFile.path, editingFile.content);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", "File saved."); setEditingFile(null); loadFiles(selected, filePath); }
    } catch (e: any) { showNotice("err", String(e)); }
    setSavingFile(false);
  };
  const deleteEntry = async (entry: FileEntry) => {
    if (!selected) return;
    if (!await confirmDialog(`Delete "${entry.name}"?`, entry.is_dir ? "This removes the whole folder and everything inside it. This action cannot be undone." : "This file will be permanently deleted. This action cannot be undone.", { danger: true, confirmLabel: "Delete" })) return;
    try {
      const r = await api.serverMgr.fileDelete(selected, fileFullPath(entry.name));
      if (r.error) showNotice("err", r.error); else { showNotice("ok", "Deleted."); loadFiles(selected, filePath); }
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const renameEntry = async (entry: FileEntry) => {
    if (!selected) return;
    const nn = await promptDialog(`Rename "${entry.name}"`, "Enter the new name for this item:", { defaultValue: entry.name, confirmLabel: "Rename" });
    if (!nn || nn === entry.name) return;
    try {
      const r = await api.serverMgr.fileRename(selected, fileFullPath(entry.name), nn);
      if (r.error) showNotice("err", r.error); else { showNotice("ok", "Renamed."); loadFiles(selected, filePath); }
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const duplicateEntry = async (entry: FileEntry) => {
    if (!selected) return;
    try {
      const r = await api.serverMgr.fileCopy(selected, fileFullPath(entry.name));
      if (r.error) showNotice("err", r.error); else { showNotice("ok", `Duplicated as "${r.name}".`); loadFiles(selected, filePath); }
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const downloadEntry = async (entry: FileEntry) => {
    if (!selected || entry.is_dir) return;
    try {
      const r = await api.serverMgr.fileDownload(selected, fileFullPath(entry.name));
      if (r.error) showNotice("err", r.error);
      else if (!r.cancelled) showNotice("ok", "File saved to your computer.");
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const newFolder = async () => {
    if (!selected) return;
    const name = await promptDialog("New Folder", "Enter a name for the new folder:", { placeholder: "New folder name", confirmLabel: "Create" });
    if (!name) return;
    try { await api.serverMgr.fileMkdir(selected, fileFullPath(name)); loadFiles(selected, filePath); } catch (e: any) { showNotice("err", String(e)); }
  };
  const newTextFile = async () => {
    if (!selected) return;
    const name = await promptDialog("New File", "Enter a name for the new file (e.g. ops.json):", { placeholder: "File name", confirmLabel: "Create" });
    if (!name) return;
    try {
      const r = await api.serverMgr.fileWrite(selected, fileFullPath(name), "");
      if (r.error) showNotice("err", r.error); else { showNotice("ok", "File created."); loadFiles(selected, filePath); }
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const toggleSelectFile = (name: string) => setSelectedFiles((prev) => {
    const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n;
  });
  const bulkDeleteFiles = async () => {
    if (!selected || selectedFiles.size === 0) return;
    if (!await confirmDialog(`Delete ${selectedFiles.size} selected item(s)?`, "The selected items will be permanently deleted. This action cannot be undone.", { danger: true, confirmLabel: "Delete Selected" })) return;
    let ok = 0;
    for (const n of Array.from(selectedFiles)) {
      try { const r = await api.serverMgr.fileDelete(selected, fileFullPath(n)); if (!r.error) ok++; } catch {}
    }
    setSelectedFiles(new Set());
    showNotice("ok", `Deleted ${ok} item(s).`);
    loadFiles(selected, filePath);
  };
  const goUp = () => {
    if (!selected) return;
    setSelectedFiles(new Set());
    const parts = filePath.split("/").filter(Boolean);
    parts.pop();
    loadFiles(selected, parts.join("/"));
  };
  const navigateTo = (path: string) => { if (selected) { setSelectedFiles(new Set()); loadFiles(selected, path); } };
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !selected) return;
    (async () => {
      for (const file of files) {
        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = async () => {
            const b64 = String(reader.result).split(",")[1] || "";
            try {
              const r = await api.serverMgr.fileUpload(selected, filePath, file.name, b64);
              if (r.error) showNotice("err", r.error); else showNotice("ok", `Uploaded ${r.filename}`);
            } catch (err: any) { showNotice("err", String(err)); }
            resolve();
          };
          reader.readAsDataURL(file);
        });
      }
      loadFiles(selected, filePath);
    })();
    e.target.value = "";
  };

  const createBackup = async () => {
    if (!selected) return;
    setBackupBusy("create");
    try {
      const r = await api.serverMgr.backupCreate(selected, backupLabel);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", `Backup created: ${r.file}`); setBackupLabel(""); loadBackups(selected); }
    } catch (e: any) { showNotice("err", String(e)); }
    setBackupBusy(null);
  };
  const restoreBackup = async (file: string) => {
    if (!selected) return;
    if (!await confirmDialog(`Restore "${file}"?`, "Current files will be overwritten. Make sure the server is stopped before restoring. Continue?", { danger: true, confirmLabel: "Restore" })) return;
    setBackupBusy(file);
    try {
      const r = await api.serverMgr.backupRestore(selected, file);
      if (r.error) showNotice("err", r.error); else showNotice("ok", "Backup restored.");
    } catch (e: any) { showNotice("err", String(e)); }
    setBackupBusy(null);
  };
  const deleteBackup = async (file: string) => {
    if (!selected) return;
    if (!await confirmDialog(`Delete backup "${file}"?`, "This backup will be permanently deleted. This action cannot be undone.", { danger: true, confirmLabel: "Delete Backup" })) return;
    try { await api.serverMgr.backupDelete(selected, file); loadBackups(selected); } catch (e: any) { showNotice("err", String(e)); }
  };

  const deleteWorld = async (world: string) => {
    if (!selected) return;
    if (!await confirmDialog(`Delete world "${world}"?`, "This cannot be undone. All terrain, builds and entities in this world will be lost.", { danger: true, confirmLabel: "Delete World" })) return;
    try {
      const r = await api.serverMgr.deleteWorld(selected, world);
      if (r.error) showNotice("err", r.error); else { showNotice("ok", "World deleted."); loadWorlds(selected); }
    } catch (e: any) { showNotice("err", String(e)); }
  };

  const saveMeta = async () => {
    if (!selected) return;
    setSavingMeta(true);
    try {
      const port = parseInt(editPort) || 25565;
      const ram = parseInt(editRam) || 4096;
      const xms = parseInt(editXms) || Math.min(ram, 1024);
      const maxPlayers = parseInt(props["max-players"] || "") || current?.max_players || 20;
      // Keep server.properties in sync for port + MOTD.
      const nextProps = { ...props, "server-port": String(port), motd: editMotd };
      const pr = await api.serverMgr.setProperties(selected, nextProps);
      if (pr.error) { showNotice("err", pr.error); setSavingMeta(false); return; }
      const becamePublic = editVisibility === "public";
      const r = await api.serverMgr.updateMeta(selected, {
        ram_mb: ram,
        xms_mb: xms,
        motd: editMotd,
        port,
        java_path: editJava,
        jvm_args: editJvmArgs,
        aikar_flags: aikarFlags,
        auto_restart: autoRestart,
        start_on_launch: startOnLaunch,
        visibility: editVisibility,
        description: editDescription,
        tags: editTags,
        max_players: maxPlayers,
        published_at: becamePublic ? (current?.published_at || new Date().toISOString()) : "",
      });
      if (r.error) { showNotice("err", r.error); setSavingMeta(false); return; }
      setProps(nextProps);

      // Sync the website listing with the new choice.
      if (becamePublic) {
        setPublishing(true);
        const res = await pushPublic(selected, {
          type: current?.type || "paper", version: current?.version || "", port,
          motd: editMotd, ram_mb: ram, description: editDescription, tags: editTags,
          max_players: maxPlayers, running: !!current?.running,
        });
        setPublishing(false);
        if (res.ok) showNotice("ok", "Settings saved and published to the public list.");
        else showNotice("err", `Saved, but publishing failed: ${res.error}`);
      } else {
        await removePublic(selected);
        showNotice("ok", "Settings saved. Server is private (not listed).");
      }
      await refresh();
    } catch (e: any) { showNotice("err", String(e)); }
    setSavingMeta(false);
  };
  const onIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = String(reader.result).split(",")[1] || "";
      try {
        const r = await api.serverMgr.fileUpload(selected, "", "server-icon.png", b64);
        if (r.error) showNotice("err", r.error);
        else { setIconData(`data:image/png;base64,${b64}`); showNotice("ok", "Server icon updated. Shown in the multiplayer list."); }
      } catch (err: any) { showNotice("err", String(err)); }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const openFolder = async () => {
    if (!selected) return;
    try { await api.serverMgr.openFolder(selected); } catch (e: any) { showNotice("err", String(e)); }
  };
  const resetWorlds = async (world?: string) => {
    if (!selected) return;
    if (running) { showNotice("err", "Stop the server first."); return; }
    const label = world ? `world "${world}"` : "all worlds";
    if (!await confirmDialog(`Regenerate ${label}?`, "The current world data will be permanently deleted and a fresh world will be generated. This action cannot be undone.", { danger: true, confirmLabel: "Regenerate" })) return;
    try {
      const r = await api.serverMgr.resetWorld(selected, world);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", "World reset. It regenerates on the next start."); loadWorlds(selected); }
    } catch (e: any) { showNotice("err", String(e)); }
  };
  const openReinstall = async () => {
    if (!current) return;
    setReinstallVersion(current.version);
    setShowReinstall(true);
    try { const r = await api.serverMgr.listVersions(current.type); setReinstallVersions(r.versions || []); } catch {}
  };
  const doReinstall = async () => {
    if (!selected || !reinstallVersion) return;
    if (running) { showNotice("err", "Stop the server before changing its version."); return; }
    setReinstalling(true);
    try {
      const r = await api.serverMgr.reinstall(selected, reinstallVersion);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", `Server jar reinstalled for ${reinstallVersion}.`); setShowReinstall(false); await refresh(); }
    } catch (e: any) { showNotice("err", String(e)); }
    setReinstalling(false);
  };
  const eula = async (accept: boolean) => {
    if (!selected) return;
    try { await api.serverMgr.eula(selected, accept); showNotice("ok", accept ? "EULA accepted." : "EULA revoked."); } catch (e: any) { showNotice("err", String(e)); }
  };
  const doClone = async () => {
    if (!selected || !cloneName.trim()) return;
    setCloning(true);
    try {
      const r = await api.serverMgr.clone(selected, cloneName.trim(), clonePort ? parseInt(clonePort) : undefined);
      if (r.error) showNotice("err", r.error);
      else { showNotice("ok", "Server cloned."); setShowClone(false); setCloneName(""); setClonePort(""); await refresh(); }
    } catch (e: any) { showNotice("err", String(e)); }
    setCloning(false);
  };

  if (!isTauri()) {
    return (
      <div className="h-full flex items-center justify-center">
        <GlassCard className="max-w-md text-center">
          <Server size={32} className="mx-auto mb-3" style={{ color: themeColors.accent }} />
          <h1 className="tinycaps text-lg font-bold mb-1" style={{ color: themeColors.text_main }}>Local Server Manager</h1>
          <p className="text-sm" style={{ color: themeColors.text_muted }}>
            The server manager needs the Xryloth desktop app. Open this page from the installed launcher.
          </p>
        </GlassCard>
      </div>
    );
  }

  const tabBtn = ({ id, label, Icon }: (typeof TABS)[number]) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className="tinycaps text-[11px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
      style={{
        background: tab === id ? `${themeColors.accent}18` : "transparent",
        color: tab === id ? themeColors.accent : themeColors.text_muted,
        border: `1px solid ${tab === id ? `${themeColors.accent}40` : themeColors.border}`,
      }}
    >
      <Icon size={12} /> {label}
    </button>
  );

  return (
    <div className="h-full flex gap-4 max-w-6xl mx-auto w-full">
      {/* Server list */}
      <div className="w-[210px] shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Server size={18} style={{ color: themeColors.accent }} />
          <h1 className="tinycaps text-base font-bold" style={{ color: themeColors.text_main }}>Local Servers</h1>
          <button onClick={() => setShowCreate(true)} title="New server"
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ background: `${themeColors.accent}18`, border: `1px solid ${themeColors.accent}40`, color: themeColors.accent }}>
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <p className="text-xs" style={{ color: themeColors.text_muted }}>Loading…</p>
          ) : servers.length === 0 ? (
            <GlassCard>
              <p className="text-xs text-center py-4" style={{ color: themeColors.text_muted }}>
                No servers yet.<br />Click <span style={{ color: themeColors.accent }}>+</span> to create one.
              </p>
            </GlassCard>
          ) : servers.map((s) => (
            <button key={s.name} onClick={() => setSelected(s.name)}
              className="w-full text-left px-3 py-2.5 rounded-xl transition-all"
              style={{
                background: selected === s.name ? `${themeColors.accent}15` : `${themeColors.bg_card2}`,
                border: `1px solid ${selected === s.name ? `${themeColors.accent}45` : themeColors.border}`,
              }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{
                  background: s.running ? themeColors.success : themeColors.text_muted,
                  boxShadow: s.running ? `0 0 8px ${themeColors.success}` : "none",
                }} />
                <span className="text-sm font-medium truncate" style={{ color: themeColors.text_main }}>{s.name}</span>
              </div>
              <p className="text-[10px] mt-1" style={{ color: themeColors.text_muted }}>{s.type} {s.version} · :{s.port}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
        {current ? (
          <>
            <GlassCard>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="tinycaps text-xl font-bold truncate" style={{ color: themeColors.text_main }}>{current.name}</h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
                      background: running ? `${themeColors.success}20` : `${themeColors.bg_hover}77`,
                      color: running ? themeColors.success : themeColors.text_muted,
                    }}>{running ? "ONLINE" : "OFFLINE"}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: themeColors.text_sub }}>{current.type}</span>
                  </div>
                  <p className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: themeColors.text_muted }}>
                    <span>MC {current.version}</span>
                    <span>· :{current.port}</span>
                    <span>· {current.ram_mb} MB</span>
                    {running && stats.uptime_secs > 0 && <span className="flex items-center gap-1"><Clock size={11} /> {fmtUptime(stats.uptime_secs)}</span>}
                    {running && stats.memory_kb > 0 && <span className="flex items-center gap-1"><Cpu size={11} /> {fmtBytes(stats.memory_kb * 1024)}</span>}
                    {onlinePlayers && <span className="flex items-center gap-1"><Users size={11} /> {onlinePlayers.count}/{onlinePlayers.max}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {running ? (
                    <>
                      <GlowButton size="sm" variant="secondary" onClick={() => restartServer(current.name)} disabled={!!busy} className="flex items-center gap-1"><RotateCcw size={12} /> Restart</GlowButton>
                      <GlowButton size="sm" variant="secondary" onClick={() => stopServer(current.name)} disabled={!!busy} className="flex items-center gap-1"><Square size={12} /> Stop</GlowButton>
                      <GlowButton size="sm" variant="danger" onClick={() => killServer(current.name)} disabled={!!busy} className="flex items-center gap-1"><Skull size={12} /> Kill</GlowButton>
                    </>
                  ) : (
                    <GlowButton size="sm" onClick={() => startServer(current.name)} disabled={!!busy} className="flex items-center gap-1"><Play size={12} /> Start</GlowButton>
                  )}
                  <GlowButton size="sm" variant="danger" onClick={() => deleteServer(current.name)} disabled={!!busy}><Trash2 size={12} /></GlowButton>
                </div>
              </div>
            </GlassCard>

            <div className="flex items-center gap-1.5 flex-wrap">
              {TABS.map(tabBtn)}
              {notice && <span className="ml-auto text-[11px]" style={{ color: notice.type === "ok" ? themeColors.success : themeColors.danger }}>{notice.text}</span>}
            </div>

            {tab === "console" && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><GlassInput value={logFilter} onChange={setLogFilter} placeholder="Filter console…" /></div>
                  <button onClick={() => setAutoScroll((v) => !v)} title="Auto-scroll"
                    className="text-[11px] px-2 py-2 rounded-lg flex items-center gap-1"
                    style={{ background: themeColors.bg_card2, color: autoScroll ? themeColors.accent : themeColors.text_muted, border: `1px solid ${themeColors.border}` }}>
                    {autoScroll ? <ToggleRight size={14} /> : <ToggleLeft size={14} />} Auto
                  </button>
                  <button onClick={() => setLogs([])} title="Clear console"
                    className="text-[11px] px-2 py-2 rounded-lg flex items-center gap-1"
                    style={{ background: themeColors.bg_card2, color: themeColors.text_muted, border: `1px solid ${themeColors.border}` }}>
                    <Eraser size={13} />
                  </button>
                  <button onClick={() => { if (selected) api.serverMgr.clearLogs(selected); }} title="Clear server buffer"
                    className="text-[11px] px-2 py-2 rounded-lg" style={{ background: themeColors.bg_card2, color: themeColors.text_muted, border: `1px solid ${themeColors.border}` }}>
                    <RefreshCw size={13} />
                  </button>
                </div>
                <div className="flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden" style={{ background: "#050506", border: `1px solid ${themeColors.border}` }}>
                  <div className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
                    {filteredLogs.length === 0 ? (
                      <span style={{ color: "#5a5a5a" }}>{logs.length ? "No lines match the filter." : running ? "Waiting for output…" : "Server is offline. Press Start to boot it up."}</span>
                    ) : filteredLogs.map((l, i) => (
                      <div key={i} style={{
                        color: /ERROR|SEVERE|FATAL|Exception|Caused by/i.test(l) ? "#ff6b6b"
                          : /WARN/i.test(l) ? "#ffc857"
                          : /Done \(|For help, type|Starting minecraft server/i.test(l) ? themeColors.success
                          : "#b9f6ca",
                      }}>{l}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                  <div className="flex items-center gap-2 p-2" style={{ borderTop: `1px solid ${themeColors.border}` }}>
                    <span className="font-mono text-sm px-1" style={{ color: themeColors.accent }}>›</span>
                    <input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={onCommandKey}
                      disabled={!running}
                      placeholder={running ? "Type a command (↑/↓ for history)…" : "Server is offline"}
                      className="flex-1 bg-transparent outline-none font-mono text-[12px]" style={{ color: "#fff" }} />
                    <GlowButton size="sm" onClick={() => sendCommand()} disabled={!running || !command.trim()}>Send</GlowButton>
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                    {["list", "save-all", "tps", "whitelist list", "reload", "say Hello from Xryloth!"].map((c) => (
                      <button key={c} onClick={() => sendCommand(c)} disabled={!running}
                        className="text-[10px] px-2 py-0.5 rounded font-mono disabled:opacity-30"
                        style={{ background: `${themeColors.bg_hover}77`, color: "#9fc7ff", border: `1px solid ${themeColors.border}` }}>{c}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "players" && (
              <GlassCard className="flex-1 min-h-0 overflow-y-auto">
                <h3 className="tinycaps text-sm font-bold mb-3" style={{ color: themeColors.text_main }}>Player Management</h3>
                {onlinePlayers && (
                  <p className="text-xs mb-3" style={{ color: themeColors.text_sub }}>
                    Online ({onlinePlayers.count}/{onlinePlayers.max}): <span style={{ color: themeColors.accent }}>{onlinePlayers.names.join(", ") || "none"}</span>
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["op", "OP a player", true], ["deop", "Remove OP", true],
                    ["kick", "Kick player", true], ["ban", "Ban player", true],
                    ["pardon", "Pardon player", true], ["whitelist add", "Whitelist add", true],
                    ["whitelist remove", "Whitelist remove", true], ["gamemode creative", "Creative mode", true],
                    ["gamemode survival", "Survival mode", true], ["tp", "Teleport", false],
                  ].map(([cmd, label, needsName]) => (
                    <GlowButton key={label as string} size="sm" variant="secondary"
                      onClick={() => playerAction(cmd as string, needsName as boolean)}
                      disabled={!running} className="flex items-center gap-1 justify-center">
                      <Users size={12} /> {label as string}
                    </GlowButton>
                  ))}
                </div>
                <p className="text-[10px] mt-3" style={{ color: themeColors.text_muted }}>
                  These run the matching server command while the server is online.
                </p>
              </GlassCard>
            )}

            {tab === "properties" && (
              <GlassCard className="flex-1 min-h-0 overflow-y-auto">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h3 className="tinycaps text-sm font-bold" style={{ color: themeColors.text_main }}>server.properties</h3>
                  <div className="flex items-center gap-2">
                    <div className="w-44"><GlassInput value={propSearch} onChange={setPropSearch} placeholder="Search…" /></div>
                    <GlowButton size="sm" onClick={saveProps} disabled={savingProps} className="flex items-center gap-1"><Save size={12} /> {savingProps ? "Saving…" : "Save"}</GlowButton>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {visibleProps.map((key) => {
                    const val = props[key] ?? "";
                    const isBool = val === "true" || val === "false";
                    return (
                      <div key={key}>
                        <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>{key}</label>
                        {isBool ? (
                          <Select value={val} onChange={(v) => setProps((p) => ({ ...p, [key]: v }))}
                            options={[{ value: "true", label: "true" }, { value: "false", label: "false" }]} />
                        ) : (
                          <GlassInput value={val} onChange={(v) => setProps((p) => ({ ...p, [key]: v }))} />
                        )}
                      </div>
                    );
                  })}
                  {visibleProps.length === 0 && <p className="text-xs col-span-2" style={{ color: themeColors.text_muted }}>No matching properties.</p>}
                </div>
                <p className="text-[10px] mt-3" style={{ color: themeColors.text_muted }}>Changes take effect after a restart.</p>
              </GlassCard>
            )}

            {tab === "plugins" && (
              <div className="flex-1 min-h-0 flex flex-col gap-3">
                <div className="flex gap-2">
                  <GlassInput value={pluginQuery} onChange={setPluginQuery}
                    onKeyDown={(e) => { if (e.key === "Enter") searchPlugins(); }}
                    placeholder="Search Modrinth plugins (essentials, luckperms, …)" />
                  <GlowButton size="sm" onClick={searchPlugins} disabled={pluginSearching} className="flex items-center gap-1 shrink-0"><Search size={12} /> {pluginSearching ? "…" : "Search"}</GlowButton>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                  {installedPlugins.length > 0 && (
                    <GlassCard>
                      <h3 className="tinycaps text-xs font-bold mb-1" style={{ color: themeColors.text_main }}>Installed ({installedPlugins.length})</h3>
                      {installedPlugins.map((p) => (
                        <div key={p.filename} className="flex items-center justify-between gap-2 py-1.5 text-xs" style={{ borderTop: `1px solid ${themeColors.border}40` }}>
                          <span className="truncate flex-1" style={{ color: p.enabled === false ? themeColors.text_muted : themeColors.text_sub }}>
                            {p.filename} <span style={{ opacity: 0.6 }}>({fmtBytes(p.size)})</span>
                          </span>
                          <button onClick={() => togglePlugin(p)} title={p.enabled === false ? "Enable" : "Disable"}
                            style={{ color: p.enabled === false ? themeColors.text_muted : themeColors.success }}>
                            {p.enabled === false ? <ToggleLeft size={15} /> : <ToggleRight size={15} />}
                          </button>
                          <button onClick={() => deletePlugin(p.filename)} style={{ color: themeColors.danger }} title="Remove"><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </GlassCard>
                  )}
                  {pluginResults.map((mod) => (
                    <GlassCard key={mod.slug}>
                      <div className="flex items-start gap-3">
                        {mod.icon_url
                          ? <CachedImage src={mod.icon_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                          : <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.05)" }}><Puzzle size={14} style={{ color: themeColors.text_muted }} /></div>}
                        <div className="flex-1 min-w-0">
                          <h3 className="tinycaps text-sm font-semibold truncate" style={{ color: themeColors.text_main }}>{mod.title}</h3>
                          <p className="text-[11px] line-clamp-2" style={{ color: themeColors.text_sub }}>{mod.description}</p>
                          <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: themeColors.text_muted }}>
                            <span style={{ color: themeColors.accent }}>↓ {mod.downloads?.toLocaleString?.() || 0}</span>
                            {mod.versions?.slice(0, 3).join(", ")}
                          </div>
                        </div>
                        <GlowButton size="sm" onClick={() => requestInstallPlugin(mod)} disabled={installingPlugin === mod.slug} className="flex items-center gap-1 shrink-0">
                          <Download size={12} /> {installingPlugin === mod.slug ? "…" : "Install"}
                        </GlowButton>
                      </div>
                    </GlassCard>
                  ))}
                  {!pluginSearching && pluginResults.length === 0 && (
                    <p className="text-xs text-center py-6" style={{ color: themeColors.text_muted }}>Search Modrinth to add plugins to <span style={{ color: themeColors.accent }}>{current.name}</span>.</p>
                  )}
                </div>
              </div>
            )}

            {tab === "files" && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                {/* Row 1: breadcrumb + actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={goUp} disabled={!filePath} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background: "rgba(255,255,255,0.05)", color: themeColors.text_sub, border: `1px solid ${themeColors.border}` }} title="Up one level"><ArrowLeft size={13} /></button>
                  <div className="flex items-center gap-1 text-[11px] flex-1 min-w-0 font-mono" style={{ color: themeColors.text_muted }}>
                    <FolderOpen size={12} style={{ color: themeColors.accent }} />
                    <button onClick={() => navigateTo("")} style={{ color: themeColors.accent }}>{current.name}</button>
                    {filePath.split("/").filter(Boolean).map((seg, i, arr) => {
                      const path = arr.slice(0, i + 1).join("/");
                      return <span key={path} className="flex items-center gap-1 truncate"><ChevronRight size={10} /><button onClick={() => navigateTo(path)} className="truncate hover:underline">{seg}</button></span>;
                    })}
                  </div>
                  <GlowButton size="sm" variant="secondary" onClick={newTextFile} className="flex items-center gap-1"><FilePlus2 size={12} /> File</GlowButton>
                  <GlowButton size="sm" variant="secondary" onClick={newFolder} className="flex items-center gap-1"><FolderPlus size={12} /> Folder</GlowButton>
                  <GlowButton size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1"><Upload size={12} /> Upload</GlowButton>
                  {selectedFiles.size > 0 && (
                    <GlowButton size="sm" variant="danger" onClick={bulkDeleteFiles} className="flex items-center gap-1"><Trash2 size={12} /> Delete ({selectedFiles.size})</GlowButton>
                  )}
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onUpload} />
                </div>

                {/* Row 2: search + sort + view toggle */}
                <div className="flex items-center gap-2">
                  <div className="flex-1"><GlassInput value={fileSearch} onChange={setFileSearch} placeholder="Search this folder…" /></div>
                  <div className="w-32"><Select value={fileSort} onChange={(v) => setFileSort(v as "name" | "size" | "date")}
                    options={[{ value: "name", label: "Name" }, { value: "size", label: "Size" }, { value: "date", label: "Modified" }]} /></div>
                  <div className="flex items-center rounded-lg overflow-hidden shrink-0" style={{ border: `1px solid ${themeColors.border}` }}>
                    <button onClick={() => setFileView("list")} className="p-1.5" title="List view" style={{ background: fileView === "list" ? `${themeColors.accent}20` : "transparent", color: fileView === "list" ? themeColors.accent : themeColors.text_muted }}><List size={14} /></button>
                    <button onClick={() => setFileView("grid")} className="p-1.5" title="Grid view" style={{ background: fileView === "grid" ? `${themeColors.accent}20` : "transparent", color: fileView === "grid" ? themeColors.accent : themeColors.text_muted }}><Grid3x3 size={14} /></button>
                  </div>
                </div>

                <GlassCard className="flex-1 min-h-0 overflow-y-auto">
                  {fileLoading ? <p className="text-xs" style={{ color: themeColors.text_muted }}>Loading…</p> : visibleFiles.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: themeColors.text_muted }}>{fileEntries.length ? "No files match your search." : "This folder is empty."}</p>
                  ) : fileView === "list" ? (
                    <>
                      <div className="flex items-center gap-2 pb-1.5 text-[10px] tinycaps" style={{ color: themeColors.text_muted, borderBottom: `1px solid ${themeColors.border}` }}>
                        <button onClick={() => setSelectedFiles(selectedFiles.size === visibleFiles.length ? new Set() : new Set(visibleFiles.map((f) => f.name)))} title="Select all">
                          {selectedFiles.size > 0 && selectedFiles.size === visibleFiles.length ? <CheckSquare size={13} style={{ color: themeColors.accent }} /> : <Square size={13} />}
                        </button>
                        <span className="flex-1">Name</span>
                        <span className="w-16 text-right">Size</span>
                        <span className="w-40 text-right hidden md:block">Modified</span>
                        <span className="w-24 text-right">Actions</span>
                      </div>
                      {visibleFiles.map((f) => {
                        const { Icon, color } = fileVisual(f, themeColors);
                        const checked = selectedFiles.has(f.name);
                        return (
                          <div key={f.name} className="flex items-center gap-2 py-1.5 text-xs" style={{ borderTop: `1px solid ${themeColors.border}40` }}>
                            <button onClick={() => toggleSelectFile(f.name)} style={{ color: checked ? themeColors.accent : themeColors.text_muted }}>
                              {checked ? <CheckSquare size={13} /> : <Square size={13} />}
                            </button>
                            <button onClick={() => openFile(f)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                              <Icon size={14} style={{ color }} />
                              <span className="truncate" style={{ color: themeColors.text_sub }}>{f.name}</span>
                            </button>
                            <span className="w-16 text-right shrink-0 text-[10px]" style={{ color: themeColors.text_muted }}>{f.is_dir ? "" : fmtBytes(f.size)}</span>
                            <span className="w-40 text-right shrink-0 text-[10px] hidden md:block" style={{ color: themeColors.text_muted }}>{f.modified ? new Date(f.modified * 1000).toLocaleString() : ""}</span>
                            <div className="w-24 flex items-center justify-end gap-1.5 shrink-0" style={{ color: themeColors.text_muted }}>
                              <button onClick={() => renameEntry(f)} title="Rename" className="opacity-70 hover:opacity-100"><Pencil size={12} /></button>
                              <button onClick={() => duplicateEntry(f)} title="Duplicate" className="opacity-70 hover:opacity-100"><CopyPlus size={12} /></button>
                              {!f.is_dir && <button onClick={() => downloadEntry(f)} title="Download" className="opacity-70 hover:opacity-100"><Download size={12} /></button>}
                              <button onClick={() => deleteEntry(f)} title="Delete" style={{ color: themeColors.danger }}><Trash2 size={12} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 p-1">
                      {visibleFiles.map((f) => {
                        const { Icon, color } = fileVisual(f, themeColors);
                        const checked = selectedFiles.has(f.name);
                        return (
                          <div key={f.name} className="relative rounded-xl p-3 flex flex-col items-center gap-1.5 text-center" style={{ background: checked ? `${themeColors.accent}15` : `${themeColors.bg_card2}`, border: `1px solid ${checked ? `${themeColors.accent}45` : themeColors.border}` }}>
                            <button onClick={() => toggleSelectFile(f.name)} className="absolute top-1.5 left-1.5" style={{ color: checked ? themeColors.accent : themeColors.text_muted }}>
                              {checked ? <CheckSquare size={13} /> : <Square size={13} />}
                            </button>
                            <button onClick={() => openFile(f)} className="flex flex-col items-center gap-1.5 w-full min-w-0">
                              <Icon size={26} style={{ color }} />
                              <span className="text-[11px] truncate w-full" style={{ color: themeColors.text_sub }}>{f.name}</span>
                              {!f.is_dir && <span className="text-[10px]" style={{ color: themeColors.text_muted }}>{fmtBytes(f.size)}</span>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </GlassCard>
              </div>
            )}

            {tab === "backups" && (
              <div className="flex-1 min-h-0 flex flex-col gap-3">
                <div className="flex gap-2">
                  <GlassInput value={backupLabel} onChange={setBackupLabel} placeholder="Backup label (optional)" />
                  <GlowButton size="sm" onClick={createBackup} disabled={backupBusy === "create"} className="flex items-center gap-1 shrink-0"><Archive size={12} /> {backupBusy === "create" ? "Saving…" : "Create Backup"}</GlowButton>
                </div>
                <GlassCard className="flex-1 min-h-0 overflow-y-auto">
                  {backups.length === 0 ? <p className="text-xs text-center py-4" style={{ color: themeColors.text_muted }}>No backups yet.</p> : backups.map((b) => (
                    <div key={b.filename} className="flex items-center justify-between gap-2 py-2 text-xs" style={{ borderTop: `1px solid ${themeColors.border}40` }}>
                      <div className="min-w-0">
                        <p className="truncate" style={{ color: themeColors.text_sub }}>{b.filename}</p>
                        <p className="text-[10px]" style={{ color: themeColors.text_muted }}>{fmtBytes(b.size)} · {b.modified ? new Date(b.modified * 1000).toLocaleString() : ""}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <GlowButton size="sm" variant="secondary" onClick={() => restoreBackup(b.filename)} disabled={!!backupBusy || running} className="flex items-center gap-1"><RefreshCw size={11} /> Restore</GlowButton>
                        <button onClick={() => deleteBackup(b.filename)} style={{ color: themeColors.danger }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </GlassCard>
                {running && <p className="text-[10px]" style={{ color: themeColors.warn }}>Stop the server to restore a backup.</p>}
              </div>
            )}

            {tab === "worlds" && (
              <GlassCard className="flex-1 min-h-0 overflow-y-auto">
                <h3 className="tinycaps text-sm font-bold mb-2" style={{ color: themeColors.text_main }}>Worlds</h3>
                {worlds.length === 0 ? <p className="text-xs" style={{ color: themeColors.text_muted }}>No worlds found yet. Start the server once to generate one.</p> : worlds.map((w) => (
                  <div key={w} className="flex items-center justify-between py-2 text-xs" style={{ borderTop: `1px solid ${themeColors.border}40` }}>
                    <span className="flex items-center gap-2" style={{ color: themeColors.text_sub }}><Globe size={13} style={{ color: themeColors.accent }} /> {w}</span>
                    <button onClick={() => deleteWorld(w)} disabled={running} style={{ color: running ? themeColors.text_muted : themeColors.danger }} title={running ? "Stop the server first" : "Delete world"}><Trash2 size={13} /></button>
                  </div>
                ))}
              </GlassCard>
            )}

            {tab === "settings" && (
              <GlassCard className="flex-1 min-h-0 overflow-y-auto">
                <div className="flex items-center justify-between mb-4 gap-2 sticky top-0 pb-2 z-10" style={{ background: themeColors.bg_card }}>
                  <h3 className="tinycaps text-sm font-bold" style={{ color: themeColors.text_main }}>Server Settings</h3>
                  <GlowButton size="sm" onClick={saveMeta} disabled={savingMeta} className="flex items-center gap-1"><Save size={12} /> {savingMeta ? "Saving…" : "Save Settings"}</GlowButton>
                </div>

                <Section title="General">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Server Type</label>
                      <div className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", color: themeColors.text_sub, border: `1px solid ${themeColors.border}` }}>{current.type}</div>
                    </div>
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Minecraft Version</label>
                      <div className="flex gap-2">
                        <div className="flex-1 text-xs px-3 py-2 rounded-xl truncate" style={{ background: "rgba(255,255,255,0.04)", color: themeColors.text_sub, border: `1px solid ${themeColors.border}` }}>{current.version}</div>
                        <GlowButton size="sm" variant="secondary" onClick={openReinstall} className="flex items-center gap-1 shrink-0"><RefreshCw size={12} /> Change</GlowButton>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Port</label>
                      <GlassInput value={editPort} onChange={(v) => setEditPort(v.replace(/[^0-9]/g, ""))} placeholder="25565" />
                    </div>
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Server Icon</label>
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden shrink-0" style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${themeColors.border}` }}>
                          {iconData ? <CachedImage src={iconData} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={15} style={{ color: themeColors.text_muted }} />}
                        </div>
                        <GlowButton size="sm" variant="secondary" onClick={() => iconInputRef.current?.click()} className="flex items-center gap-1"><Upload size={12} /> Upload</GlowButton>
                        <input ref={iconInputRef} type="file" accept="image/png" className="hidden" onChange={onIconUpload} />
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>MOTD</label>
                      <GlassInput value={editMotd} onChange={setEditMotd} placeholder="Server MOTD" />
                    </div>
                  </div>
                </Section>

                <Section title="Publishing (Website Server List)">
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {([
                      { id: "private", label: "Private", desc: "Not listed anywhere", Icon: Lock },
                      { id: "public", label: "Public", desc: "Shown on the website", Icon: Globe },
                    ] as const).map((opt) => {
                      const active = editVisibility === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setEditVisibility(opt.id)}
                          className="text-left rounded-xl p-3 transition-all"
                          style={{
                            background: active ? `${themeColors.accent}14` : `${themeColors.bg_card2}`,
                            border: `1px solid ${active ? `${themeColors.accent}55` : themeColors.border}`,
                          }}
                        >
                          <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: active ? themeColors.accent : themeColors.text_sub }}>
                            <opt.Icon size={13} /> {opt.label}
                          </span>
                          <span className="block text-[10px] mt-0.5" style={{ color: themeColors.text_muted }}>{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  {editVisibility === "public" ? (
                    <div className="space-y-3">
                      <p className="text-[10px]" style={{ color: themeColors.text_muted }}>
                        Saving publishes this server's name, IP, port, MOTD, icon and details to the Xryloth website.
                        {current?.published_at ? ` Last published ${new Date(current.published_at).toLocaleString()}.` : ""}
                      </p>
                      <div>
                        <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Description</label>
                        <GlassInput value={editDescription} onChange={setEditDescription} placeholder="A friendly survival world for everyone" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Tags</label>
                          <GlassInput value={editTags} onChange={setEditTags} placeholder="survival,pvp,vanilla" />
                        </div>
                        <div>
                          <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Max players</label>
                          <div className="text-xs px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", color: themeColors.text_sub, border: `1px solid ${themeColors.border}` }}>
                            {props["max-players"] || current?.max_players || 20}
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px]" style={{ color: themeColors.text_muted }}>
                        Max players is edited under Gameplay. Remember to port-forward TCP {editPort} so others can join.
                      </p>
                      {publishing && <p className="text-[10px] flex items-center gap-1" style={{ color: themeColors.accent }}><RefreshCw size={11} className="animate-spin" /> Publishing…</p>}
                    </div>
                  ) : (
                    <p className="text-[10px]" style={{ color: themeColors.text_muted }}>
                      This server is private. Nothing is uploaded — it stays fully on your machine.
                    </p>
                  )}
                </Section>

                <Section title="Memory & Performance">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Max RAM (MB)</label>
                      <GlassInput value={editRam} onChange={(v) => setEditRam(v.replace(/[^0-9]/g, ""))} placeholder="4096" />
                    </div>
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Min RAM / Xms (MB)</label>
                      <GlassInput value={editXms} onChange={(v) => setEditXms(v.replace(/[^0-9]/g, ""))} placeholder="1024" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Extra JVM arguments</label>
                      <GlassInput value={editJvmArgs} onChange={setEditJvmArgs} placeholder="-XX:+UseZGC -Dexample=true" />
                    </div>
                  </div>
                  <ToggleRow label="Use Aikar's flags (G1GC tuning)" value={aikarFlags} onChange={setAikarFlags} hint="recommended for survival servers" />
                </Section>

                <Section title="Java Runtime">
                  <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Java executable</label>
                  <Select value={editJava} onChange={setEditJava} placeholder="Automatic (recommended)"
                    options={[{ value: "", label: "Automatic (recommended)" }, ...javaList.map((j) => ({ value: j.path, label: `Java ${j.major_version} — ${j.name}${j.managed ? " (managed)" : ""}` }))]} />
                  <p className="text-[10px] mt-1" style={{ color: themeColors.text_muted }}>
                    Old servers (1.7.10–1.12) need Java 8; modern servers need Java 17+. Pick the matching runtime.
                  </p>
                </Section>

                <Section title="Gameplay (server.properties)">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Gamemode</label>
                      <Select value={props["gamemode"] || "survival"} onChange={(v) => setProp("gamemode", v)} options={GAMEMODES.map((g) => ({ value: g, label: g }))} />
                    </div>
                    <div>
                      <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>Difficulty</label>
                      <Select value={props["difficulty"] || "easy"} onChange={(v) => setProp("difficulty", v)} options={DIFFICULTIES.map((d) => ({ value: d, label: d }))} />
                    </div>
                    {([
                      ["max-players", "Max players", "20"],
                      ["spawn-protection", "Spawn protection", "0"],
                      ["view-distance", "View distance", "10"],
                      ["simulation-distance", "Simulation distance", "10"],
                    ] as [string, string, string][]).map(([k, label, ph]) => (
                      <div key={k}>
                        <label className="text-[10px] mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>{label}</label>
                        <GlassInput value={props[k] ?? ""} onChange={(v) => setProp(k, v.replace(/[^0-9]/g, ""))} placeholder={ph} />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 mt-2">
                    {([
                      ["online-mode", "Online mode (verify accounts)"],
                      ["pvp", "PvP"],
                      ["allow-flight", "Allow flight"],
                      ["enable-command-block", "Command blocks"],
                      ["white-list", "Whitelist"],
                      ["enforce-whitelist", "Enforce whitelist"],
                      ["allow-nether", "Allow Nether"],
                      ["spawn-monsters", "Spawn monsters"],
                      ["spawn-animals", "Spawn animals"],
                      ["spawn-npcs", "Spawn NPCs"],
                      ["generate-structures", "Generate structures"],
                      ["hardcore", "Hardcore"],
                      ["force-gamemode", "Force gamemode"],
                    ] as [string, string][]).map(([k, label]) => (
                      <ToggleRow key={k} label={label} value={props[k] === "true"} onChange={(v) => setProp(k, String(v))} />
                    ))}
                  </div>
                </Section>

                <Section title="Lifecycle">
                  <ToggleRow label="Auto-restart if the server crashes" value={autoRestart} onChange={setAutoRestart} />
                  <ToggleRow label="Start this server when the launcher opens" value={startOnLaunch} onChange={setStartOnLaunch} />
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <GlowButton size="sm" variant="secondary" onClick={() => eula(true)} className="flex items-center gap-1"><CheckCircle2 size={12} /> Accept EULA</GlowButton>
                    <GlowButton size="sm" variant="secondary" onClick={() => eula(false)} className="flex items-center gap-1"><AlertCircle size={12} /> Revoke EULA</GlowButton>
                    <GlowButton size="sm" variant="secondary" onClick={() => setShowClone(true)} className="flex items-center gap-1"><Copy size={12} /> Clone Server</GlowButton>
                  </div>
                </Section>

                <Section title="Tools">
                  <div className="flex items-center gap-2 flex-wrap">
                    <GlowButton size="sm" variant="secondary" onClick={openFolder} className="flex items-center gap-1"><FolderOpen size={12} /> Open Folder</GlowButton>
                    <GlowButton size="sm" variant="secondary" onClick={openReinstall} className="flex items-center gap-1"><RefreshCw size={12} /> Change Version</GlowButton>
                    <GlowButton size="sm" variant="secondary" onClick={() => resetWorlds()} disabled={running} className="flex items-center gap-1"><Globe size={12} /> Regenerate Worlds</GlowButton>
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: themeColors.text_muted }}>RAM, port and JVM changes apply on the next start. Gameplay options are written to server.properties.</p>
                </Section>

                <div className="mt-2 pt-4" style={{ borderTop: `1px solid ${themeColors.border}` }}>
                  <p className="text-[10px] mb-2 tinycaps" style={{ color: themeColors.danger }}>Danger zone</p>
                  <GlowButton size="sm" variant="danger" onClick={() => deleteServer(current.name)} className="flex items-center gap-1"><Trash2 size={12} /> Delete Server</GlowButton>
                </div>
              </GlassCard>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <Server size={44} className="mx-auto mb-3" style={{ color: themeColors.text_muted, opacity: 0.4 }} />
              <p className="text-sm mb-4" style={{ color: themeColors.text_muted }}>Select a server or create a new one to unlock the full panel.</p>
              {servers.length === 0 && (
                <GlassCard className="text-left">
                  <h3 className="tinycaps text-xs font-bold mb-2 flex items-center gap-1" style={{ color: themeColors.accent }}><Database size={13} /> {FEATURES.length}+ built-in features</h3>
                  <div className="grid grid-cols-1 gap-y-0.5 max-h-52 overflow-y-auto">
                    {FEATURES.map((f) => (
                      <p key={f} className="text-[11px] flex items-center gap-1.5" style={{ color: themeColors.text_sub }}>
                        <CheckCircle2 size={11} style={{ color: themeColors.success }} /> {f}
                      </p>
                    ))}
                  </div>
                </GlassCard>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090B0E]/70 backdrop-blur-sm">
          <div className="w-[540px] max-w-[94vw] max-h-[90vh] overflow-y-auto rounded-2xl p-6" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.border_accent}50`, boxShadow: `0 20px 60px ${themeColors.accent}20` }}>
            <div className="flex items-center gap-2 mb-4">
              <Server size={18} style={{ color: themeColors.accent }} />
              <h2 className="tinycaps text-lg font-bold" style={{ color: themeColors.text_main }}>Create Local Server</h2>
              <button className="ml-auto" onClick={() => setShowCreate(false)} style={{ color: themeColors.text_muted }}><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Server Name</label>
                <GlassInput value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="My Server" />
              </div>
              <div>
                <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Server Type</label>
                <Select value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))}
                  options={(serverTypes.length ? serverTypes : [{ id: "paper", name: "Paper", desc: "" }, { id: "vanilla", name: "Vanilla", desc: "" }]).map((t) => ({ value: t.id, label: t.name }))} />
                {serverTypes.find((t) => t.id === form.type)?.desc && (
                  <p className="text-[10px] mt-1" style={{ color: themeColors.text_muted }}>{serverTypes.find((t) => t.id === form.type)?.desc}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Minecraft Version</label>
                  <Select value={form.version} onChange={(v) => setForm((f) => ({ ...f, version: v }))} placeholder="Select version…"
                    options={versions.map((v) => ({ value: v, label: v }))} />
                </div>
                <div>
                  <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>RAM (MB)</label>
                  <GlassInput value={form.ram} onChange={(v) => setForm((f) => ({ ...f, ram: v.replace(/[^0-9]/g, "") }))} placeholder="4096" />
                </div>
                <div>
                  <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Port</label>
                  <div className="flex gap-2">
                    <GlassInput value={form.port} onChange={(v) => setForm((f) => ({ ...f, port: v.replace(/[^0-9]/g, "") }))} placeholder="25565" />
                    <button onClick={async () => { const r = await api.serverMgr.nextPort(parseInt(form.port) || 25565); setForm((f) => ({ ...f, port: String(r.port) })); }}
                      className="shrink-0 px-2 rounded-xl text-[10px]" title="Find a free port"
                      style={{ background: "rgba(255,255,255,0.05)", color: themeColors.accent, border: `1px solid ${themeColors.border}` }}>Auto</button>
                  </div>
                  {portAvailable !== null && (
                    <p className="text-[10px] mt-1" style={{ color: portAvailable ? themeColors.success : themeColors.danger }}>
                      {portAvailable ? "Port is available" : "Port is in use"}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>MOTD</label>
                  <GlassInput value={form.motd} onChange={(v) => setForm((f) => ({ ...f, motd: v }))} placeholder="Default Xryloth MOTD" />
                </div>
              </div>

              {/* Public / private listing */}
              <div>
                <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Visibility</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: "private", label: "Private", desc: "Only you — nothing is shared", Icon: Lock },
                    { id: "public", label: "Public", desc: "Listed on the Xryloth website", Icon: Globe },
                  ] as const).map((opt) => {
                    const active = form.visibility === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, visibility: opt.id }))}
                        className="text-left rounded-xl p-3 transition-all"
                        style={{
                          background: active ? `${themeColors.accent}14` : `${themeColors.bg_card2}`,
                          border: `1px solid ${active ? `${themeColors.accent}55` : themeColors.border}`,
                        }}
                      >
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: active ? themeColors.accent : themeColors.text_sub }}>
                          <opt.Icon size={13} /> {opt.label}
                        </span>
                        <span className="block text-[10px] mt-0.5" style={{ color: themeColors.text_muted }}>{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.visibility === "public" && (
                <div className="space-y-3 rounded-xl p-3" style={{ background: `${themeColors.accent}0a`, border: `1px solid ${themeColors.accent}26` }}>
                  <p className="text-[10px] flex items-start gap-1.5" style={{ color: themeColors.text_muted }}>
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    Your public IP, port and details will be shown on the Xryloth website server list. Make sure the port is forwarded.
                  </p>
                  <div>
                    <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Description</label>
                    <GlassInput value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="A friendly survival world for everyone" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Tags (comma-separated)</label>
                      <GlassInput value={form.tags} onChange={(v) => setForm((f) => ({ ...f, tags: v }))} placeholder="survival,pvp,vanilla" />
                    </div>
                    <div>
                      <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Max players</label>
                      <GlassInput value={form.maxPlayers} onChange={(v) => setForm((f) => ({ ...f, maxPlayers: v.replace(/[^0-9]/g, "") }))} placeholder="20" />
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[10px] flex items-start gap-1.5" style={{ color: themeColors.text_muted }}>
                <AlertCircle size={12} className="shrink-0 mt-0.5" /> The server jar is downloaded automatically and the EULA is accepted for you.
              </p>
              {creating && download && (
                <div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${themeColors.bg_hover}aa` }}>
                    <div className="h-full rounded-full transition-all duration-200"
                      style={{ width: download.total ? `${Math.min(100, (download.downloaded / download.total) * 100)}%` : "100%", background: themeColors.accent }} />
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: themeColors.text_muted }}>
                    Downloading server jar… {fmtBytes(download.downloaded)}
                    {download.total ? ` / ${fmtBytes(download.total)}` : ""}
                  </p>
                </div>
              )}
              {createErr && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: `${themeColors.danger}15`, color: themeColors.danger }}>
                  <AlertCircle size={12} /> {createErr}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <GlowButton variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</GlowButton>
              <GlowButton size="sm" onClick={createServer} disabled={creating}>{creating ? "Creating…" : "Create Server"}</GlowButton>
            </div>
          </div>
        </div>
      )}

      {/* Clone modal */}
      {showClone && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090B0E]/70 backdrop-blur-sm">
          <div className="w-[440px] max-w-[94vw] rounded-2xl p-6" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.border_accent}50` }}>
            <div className="flex items-center gap-2 mb-4">
              <Copy size={18} style={{ color: themeColors.accent }} />
              <h2 className="tinycaps text-lg font-bold" style={{ color: themeColors.text_main }}>Clone "{current?.name}"</h2>
              <button className="ml-auto" onClick={() => setShowClone(false)} style={{ color: themeColors.text_muted }}><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>New Name</label>
                <GlassInput value={cloneName} onChange={setCloneName} placeholder="My Server Copy" />
              </div>
              <div>
                <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>New Port (optional)</label>
                <GlassInput value={clonePort} onChange={(v) => setClonePort(v.replace(/[^0-9]/g, ""))} placeholder="Leave blank to keep" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <GlowButton variant="secondary" size="sm" onClick={() => setShowClone(false)}>Cancel</GlowButton>
              <GlowButton size="sm" onClick={doClone} disabled={cloning}>{cloning ? "Cloning…" : "Clone"}</GlowButton>
            </div>
          </div>
        </div>
      )}

      {/* Change version modal */}
      {showReinstall && current && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090B0E]/70 backdrop-blur-sm">
          <div className="w-[460px] max-w-[94vw] rounded-2xl p-6" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.accent}50` }}>
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={18} style={{ color: themeColors.accent }} />
              <h2 className="tinycaps text-lg font-bold" style={{ color: themeColors.text_main }}>Change Version</h2>
              <button className="ml-auto" onClick={() => setShowReinstall(false)} style={{ color: themeColors.text_muted }}><X size={18} /></button>
            </div>
            <p className="text-xs mb-3" style={{ color: themeColors.text_sub }}>
              Re-downloads the <span style={{ color: themeColors.accent }}>{current.type}</span> server jar for the version you pick. Worlds and plugins are kept.
            </p>
            <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Minecraft Version</label>
            <Select value={reinstallVersion} onChange={setReinstallVersion} placeholder="Select version…"
              options={reinstallVersions.map((v) => ({ value: v, label: v }))} />
            {running && <p className="text-[10px] mt-2" style={{ color: themeColors.warn }}>Stop the server before changing its version.</p>}
            {reinstalling && download && download.name === selected && (
              <div className="mt-3">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${themeColors.bg_hover}aa` }}>
                  <div className="h-full rounded-full transition-all duration-200" style={{ width: download.total ? `${Math.min(100, (download.downloaded / download.total) * 100)}%` : "100%", background: themeColors.accent }} />
                </div>
                <p className="text-[10px] mt-1" style={{ color: themeColors.text_muted }}>{fmtBytes(download.downloaded)}{download.total ? ` / ${fmtBytes(download.total)}` : ""}</p>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <GlowButton variant="secondary" size="sm" onClick={() => setShowReinstall(false)}>Cancel</GlowButton>
              <GlowButton size="sm" onClick={doReinstall} disabled={reinstalling || running} className="flex items-center gap-1"><Download size={12} /> {reinstalling ? "Downloading…" : "Reinstall"}</GlowButton>
            </div>
          </div>
        </div>
      )}

      {/* Image preview modal */}
      {imagePreview && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090B0E]/80 backdrop-blur-sm" onClick={() => setImagePreview(null)}>
          <div className="rounded-2xl p-4 max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.border}` }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 w-full">
              <ImageIcon size={16} style={{ color: themeColors.accent }} />
              <h2 className="tinycaps text-sm font-bold truncate flex-1" style={{ color: themeColors.text_main }}>{imagePreview.path}</h2>
              <button onClick={() => setImagePreview(null)} style={{ color: themeColors.text_muted }}><X size={18} /></button>
            </div>
            <CachedImage src={imagePreview.url} alt="" className="max-w-full max-h-[70vh] rounded-lg object-contain" style={{ imageRendering: "pixelated", background: `${themeColors.bg_card2}` }} />
          </div>
        </div>
      )}

      {/* File editor */}
      {editingFile && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090B0E]/70 backdrop-blur-sm">
          <div className="w-[720px] max-w-[94vw] h-[70vh] flex flex-col rounded-2xl p-5" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.border_accent}50` }}>
            <div className="flex items-center gap-2 mb-3">
              <FileText size={16} style={{ color: themeColors.accent }} />
              <h2 className="tinycaps text-sm font-bold truncate" style={{ color: themeColors.text_main }}>{editingFile.path}</h2>
              <button className="ml-auto" onClick={() => setEditingFile(null)} style={{ color: themeColors.text_muted }}><X size={18} /></button>
            </div>
            <textarea value={editingFile.content} onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
              className="flex-1 w-full rounded-xl p-3 font-mono text-[12px] outline-none resize-none"
              style={{ background: "#050506", color: "#d7ffd7", border: `1px solid ${themeColors.border}` }} spellCheck={false} />
            <div className="flex justify-end gap-2 mt-3">
              <GlowButton variant="secondary" size="sm" onClick={() => setEditingFile(null)}>Cancel</GlowButton>
              <GlowButton size="sm" onClick={saveFile} disabled={savingFile} className="flex items-center gap-1"><Save size={12} /> {savingFile ? "Saving…" : "Save"}</GlowButton>
            </div>
          </div>
        </div>
      )}

      {/* Plugin compatibility warning */}
      {pluginWarn && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090B0E]/60 backdrop-blur-sm">
          <div className="w-[420px] max-w-[92vw] rounded-2xl p-6" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.danger}55` }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${themeColors.danger}20`, color: themeColors.danger }}><AlertCircle size={20} /></div>
              <div>
                <h3 className="tinycaps text-lg font-bold mb-1" style={{ color: themeColors.text_main }}>Plugin may not be compatible</h3>
                <p className="text-sm" style={{ color: themeColors.text_sub }}>
                  <span className="font-semibold" style={{ color: themeColors.text_main }}>{pluginWarn.title}</span> does not list
                  <span className="font-semibold" style={{ color: themeColors.accent }}> Minecraft {current?.version}</span> as supported. It might crash or fail to load.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <GlowButton variant="secondary" size="sm" onClick={() => setPluginWarn(null)}>Cancel</GlowButton>
              <GlowButton variant="danger" size="sm" onClick={() => { const w = pluginWarn; setPluginWarn(null); doInstallPlugin(w.slug); }}>Install Anyway</GlowButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
