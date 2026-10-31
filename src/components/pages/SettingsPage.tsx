import { useState, useEffect, useRef, useCallback } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { checkForUpdates, startUpdate } from "../../lib/updater";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import { Select } from "../ui/Select";
import { THEMES } from "../../lib/types";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { setNavGuard, clearNavGuard } from "../../lib/navGuard";
import { confirmDialog } from "../ui/Dialog";
import {
  Settings as SettingsIcon, Download, Globe, FolderOpen, Bell, Palette,
  Info, RefreshCcw, ExternalLink, Check, X, Save, Image, Film,
  Monitor, Layout, Type, Gamepad2, Sliders, Eye, Paintbrush,
  HardDrive, AlertTriangle, Sun, Moon, Link, Trash2, Wrench, FileText, Pencil
} from "lucide-react";

const TABS = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "background", label: "Background", icon: Image },
  { id: "java", label: "Java & Game", icon: Monitor },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "integrations", label: "Integrations", icon: Globe },
  { id: "directories", label: "Directories", icon: FolderOpen },
  { id: "updates", label: "Updates", icon: RefreshCcw },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "recovery", label: "Recovery", icon: AlertTriangle },
  { id: "about", label: "About", icon: Info },
];

export function SettingsPage() {
  const { settings, saveSettings, setPage, themeColors, setTheme, themeName, liveVersion, releaseNotes } = useLauncherStore();
  const [tab, setTab] = useState("general");
  const [cleared, setCleared] = useState(false);
  const [local, setLocal] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [showLeavePrompt, setShowLeavePrompt] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localRef = useRef<Record<string, any>>({});
  const dirtyRef = useRef(false);
  const [updateInfo, setUpdateInfo] = useState<{ update_available: boolean; latest_version?: string; download_url?: string } | null>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const bgVideoInputRef = useRef<HTMLInputElement>(null);
  const [bgPreview, setBgPreview] = useState("");
  const [bgVideoPreview, setBgVideoPreview] = useState("");
  const [bgUrlInput, setBgUrlInput] = useState("");
  const [javaInstallations, setJavaInstallations] = useState<any[]>([]);
  const [downloadingJava, setDownloadingJava] = useState<number | null>(null);
  const [javaDownloadResult, setJavaDownloadResult] = useState<string>("");
  const [showUninstall, setShowUninstall] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallError, setUninstallError] = useState<string>("");

  useEffect(() => {
    const next = { auto_update: true, auto_check_updates: true, ...settings };
    localRef.current = next;
    setLocal(next);
  }, [settings]);
  useEffect(() => {
    api.java.getInstallations().then(setJavaInstallations).catch(() => {});
  }, []);

  useEffect(() => {
    if (local.launcher_bg_type === "image" && local.launcher_bg_image === "file") {
      api.background.getFilePath().then((p) => { if (p) setBgPreview(convertFileSrc(p)); }).catch(() => {});
    } else if (local.launcher_bg_image && local.launcher_bg_image.startsWith("http")) {
      setBgPreview(local.launcher_bg_image);
    } else if (local.launcher_bg_image && local.launcher_bg_image.startsWith("data:")) {
      setBgPreview(local.launcher_bg_image);
    } else {
      setBgPreview("");
    }
  }, [local.launcher_bg_type, local.launcher_bg_image]);

  useEffect(() => {
    if (local.launcher_bg_type === "video" && local.launcher_bg_video === "file") {
      api.background.getVideoPath().then((p) => { if (p) setBgVideoPreview(convertFileSrc(p)); }).catch(() => {});
    } else if (local.launcher_bg_video && local.launcher_bg_video.startsWith("http")) {
      setBgVideoPreview(local.launcher_bg_video);
    } else {
      setBgVideoPreview("");
    }
  }, [local.launcher_bg_type, local.launcher_bg_video]);

  const doSave = useCallback(async (thenNavigate?: string) => {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    await saveSettings(localRef.current);
    setDirty(false);
    dirtyRef.current = false;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (thenNavigate) {
      clearNavGuard();
      setPage(thenNavigate as any);
    }
  }, [saveSettings, setPage]);

  const set = (key: string, value: any) => {
    setLocal((p) => {
      const next = { ...p, [key]: value };
      localRef.current = next;
      return next;
    });
    setDirty(true);
    dirtyRef.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { doSave(); }, 700);
  };

  useEffect(() => {
    setNavGuard((target: string) => {
      // Nothing actually changed -> let navigation through without prompting.
      if (!dirtyRef.current) return true;
      setLeaveTarget(target);
      setShowLeavePrompt(true);
      return false;
    });
    return () => clearNavGuard();
  }, []);

  // Cancel any pending auto-save when the page unmounts.
  useEffect(() => () => {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
  }, []);

  const checkUpdates = async () => {
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
    } catch {}
  };

  const doUninstall = async () => {
    setUninstalling(true);
    setUninstallError("");
    try {
      const r = await api.uninstall.launcher(deleteData);
      if (r && (r as any).error) { setUninstallError((r as any).error); setUninstalling(false); }
      // On success the Rust side deletes Xryloth and exits the app.
    } catch (e: any) {
      setUninstallError(e?.message || String(e));
      setUninstalling(false);
    }
  };

  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const result = await api.background.saveFile(dataUrl);
        if (result.success) {
          set("launcher_bg_type", "image");
          set("launcher_bg_image", "file");
        }
      } catch (err) {
        console.error("Failed to save bg file:", err);
        set("launcher_bg_type", "image");
        set("launcher_bg_image", dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleBgVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const result = await api.background.saveVideo(dataUrl);
        if (result.success) {
          set("launcher_bg_type", "video");
          set("launcher_bg_video", "file");
        }
      } catch (err) {
        console.error("Failed to save video file:", err);
        set("launcher_bg_type", "video");
        set("launcher_bg_video", dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const toggle = (key: string) => set(key, !local[key]);
  const Toggle = ({ label, k }: { label: string; k: string }) => (
    <label className="flex items-center justify-between py-1">
      <span className="text-sm" style={{ color: themeColors.text_sub }}>{label}</span>
      <div className="w-10 h-5 rounded-full relative cursor-pointer transition-colors"
        style={{ background: local[k] ? themeColors.accent : themeColors.bg_card2 }}
        onClick={() => toggle(k)}>
        <div className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
          style={{ background: "#fff", left: local[k] ? "22px" : "2px" }} />
      </div>
    </label>
  );

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SettingsIcon size={20} style={{ color: themeColors.accent }} />
          <div>
            <h1 className="tinycaps text-xl font-bold gradient-text" style={{ "--accent": themeColors.accent, "--accent2": themeColors.purple || themeColors.blue } as any}>Settings</h1>
            <p className="text-xs mt-0.5" style={{ color: themeColors.text_muted }}>Configure your launcher</p>
          </div>
        </div>
        <GlowButton onClick={() => doSave()} size="sm" className="flex items-center gap-1">
          {saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? "Saved!" : "Save"}
        </GlowButton>
      </div>

      <div className="flex gap-3">
        <div className="w-40 space-y-1 shrink-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-all"
              style={{
                background: tab === id ? `${themeColors.accent}15` : "transparent",
                color: tab === id ? themeColors.accent : themeColors.text_sub,
                border: tab === id ? `1px solid ${themeColors.accent}30` : "1px solid transparent",
              }}>
              <Icon size={14} /> <span className="tinycaps">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 min-w-0">
          {tab === "general" && (
            <div className="space-y-4">
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Launcher Behavior</h3>
                <div className="space-y-1">
                  <Toggle label="Close launcher when game starts" k="close_on_start" />
                  <Toggle label="Keep launcher open after game closes" k="keep_open" />
                  <Toggle label="Show development builds" k="show_dev_builds" />
                  <Toggle label="Animations enabled" k="animations_enabled" />
                  <Toggle label="Compact mode" k="compact_mode" />
                  <Toggle label="Auto-check for updates" k="auto_check_updates" />
                  <Toggle label="Force update on next launch" k="force_update" />
                  <Toggle label="Auto-check for mod updates on launch" k="auto_mod_updates" />
                  <Toggle label="Auto-enable resource packs after install" k="auto_enable_rps" />
                </div>
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Default Page</h3>
                <Select value={local.default_page || "home"} onChange={(v) => set("default_page", v)}
                  options={["home", "instances", "mods", "packs", "modpacks", "servers", "accounts"].map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))} />
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Pre/Post Launch Commands</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Pre-launch command (runs before game)</label>
                    <GlassInput value={local.pre_launch_cmd || ""} onChange={(v) => set("pre_launch_cmd", v)} placeholder="Optional command..." />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Post-launch command (runs after game closes)</label>
                    <GlassInput value={local.post_launch_cmd || ""} onChange={(v) => set("post_launch_cmd", v)} placeholder="Optional command..." />
                  </div>
                </div>
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Mod Management</h3>
                <div className="space-y-1">
                  <Toggle label="Auto-check for mod updates on launch" k="auto_mod_updates" />
                  <Toggle label="Auto-enable resource packs after install" k="auto_enable_rps" />
                  <Toggle label="Auto-resolve mod dependencies" k="auto_resolve_deps" />
                </div>
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.danger }}>Danger Zone</h3>
                <p className="text-xs mb-3" style={{ color: themeColors.text_sub }}>
                  Remove the Xryloth launcher and its desktop shortcuts from this computer.
                </p>
                <GlowButton size="sm" variant="danger" onClick={() => setShowUninstall(true)}>
                  <Trash2 size={14} /> Uninstall Xryloth
                </GlowButton>
              </GlassCard>
            </div>
          )}

          {tab === "appearance" && (
            <div className="space-y-4">
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Theme</h3>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(THEMES).map(([name, theme]) => (
                    <button key={name} onClick={() => setTheme(name)}
                      className="p-3 rounded-lg text-left transition-all relative"
                      style={{
                        background: theme.colors.bg_card,
                        border: `2px solid ${themeName === name ? theme.colors.accent : theme.colors.border}`,
                        boxShadow: themeName === name ? `0 0 12px ${theme.colors.accent}30` : "none",
                      }}>
                      <div className="flex gap-1 mb-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: theme.colors.accent }} />
                        <div className="w-3 h-3 rounded-full" style={{ background: theme.colors.purple }} />
                        <div className="w-3 h-3 rounded-full" style={{ background: theme.colors.blue }} />
                      </div>
                      <span className="text-xs font-medium" style={{ color: theme.colors.text_main }}>{theme.display_name}</span>
                      {themeName === name && (
                        <div className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: theme.colors.accent }}>
                          <Check size={10} color={theme.colors.accent_text} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Display Options</h3>
                <div className="space-y-1">
                  <Toggle label="Show play time on home page" k="show_playtime" />
                  <Toggle label="Show system stats on home page" k="show_system_stats" />
                  <Toggle label="Show news on home page" k="show_news_home" />
                </div>
              </GlassCard>
            </div>
          )}

          {tab === "background" && (
            <div className="space-y-4">
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Background Type</h3>
                <div className="flex gap-2">
                  {([
                    { value: "default", label: "Theme Default", icon: Paintbrush },
                    { value: "image", label: "Custom Image", icon: Image },
                    { value: "video", label: "Custom Video", icon: Film },
                    { value: "none", label: "None (Fastest)", icon: X },
                  ] as const).map(({ value, label, icon: Icon }) => (
                    <button key={value} onClick={() => set("launcher_bg_type", value)}
                      className="flex-1 p-3 rounded-lg text-center transition-all"
                      style={{
                        background: (local.launcher_bg_type || "default") === value ? `${themeColors.accent}15` : themeColors.bg_card2,
                        border: `2px solid ${(local.launcher_bg_type || "default") === value ? themeColors.accent : themeColors.border}`,
                      }}>
                      <Icon size={20} className="mx-auto mb-1" style={{ color: (local.launcher_bg_type || "default") === value ? themeColors.accent : themeColors.text_muted }} />
                      <div className="text-xs font-medium" style={{ color: (local.launcher_bg_type || "default") === value ? themeColors.text_main : themeColors.text_muted }}>{label}</div>
                    </button>
                  ))}
                </div>
              </GlassCard>

              {/* URL Input for images/videos */}
              {(local.launcher_bg_type === "image" || local.launcher_bg_type === "video") && (
                <GlassCard>
                  <h3 className="tinycaps text-sm font-semibold mb-2" style={{ color: themeColors.text_main }}>
                    {local.launcher_bg_type === "image" ? "Image URL" : "Video URL"}
                  </h3>
                  <p className="text-[10px] mb-2" style={{ color: themeColors.text_muted }}>
                    Paste a direct link to an image or video (JPG, PNG, GIF, WebP, MP4, WebM)
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={bgUrlInput}
                      onChange={(e) => setBgUrlInput(e.target.value)}
                      placeholder="https://example.com/image.jpg"
                      className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
                      style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}`, color: themeColors.text_main }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && bgUrlInput.trim()) {
                          const url = bgUrlInput.trim();
                          if (local.launcher_bg_type === "image") {
                            api.background.deleteFile();
                            set("launcher_bg_image", url);
                          } else {
                            api.background.deleteVideo();
                            set("launcher_bg_video", url);
                          }
                          setBgUrlInput("");
                        }
                        e.stopPropagation();
                      }}
                    />
                    <GlowButton size="sm" onClick={() => {
                      if (bgUrlInput.trim()) {
                        const url = bgUrlInput.trim();
                        if (local.launcher_bg_type === "image") {
                          api.background.deleteFile();
                          set("launcher_bg_image", url);
                        } else {
                          api.background.deleteVideo();
                          set("launcher_bg_video", url);
                        }
                        setBgUrlInput("");
                      }
                    }} className="flex items-center gap-1">
                      <Link size={12} /> Load
                    </GlowButton>
                  </div>
                </GlassCard>
              )}

              {(local.launcher_bg_type === "image") && (
                <GlassCard>
                  <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Background Image</h3>
                  <div className="space-y-3">
                    {bgPreview && (
                      <div className="relative rounded-lg overflow-hidden h-40" style={{ border: `1px solid ${themeColors.border}` }}>
                        <img src={bgPreview} alt="" className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <button onClick={() => { api.background.deleteFile(); set("launcher_bg_image", ""); set("launcher_bg_type", "default"); }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg flex items-center gap-1 text-xs text-white"
                          style={{ background: `${themeColors.danger}cc` }}>
                          <Trash2 size={12} /> Remove
                        </button>
                      </div>
                    )}
                    <GlowButton size="sm" variant="secondary" onClick={() => bgImageInputRef.current?.click()} className="flex items-center gap-1">
                      <Image size={12} /> {bgPreview ? "Change Image" : "Upload from File"}
                    </GlowButton>
                    <input ref={bgImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgImageUpload} />
                  </div>
                </GlassCard>
              )}

              {(local.launcher_bg_type === "video") && (
                <GlassCard>
                  <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Background Video (loops automatically)</h3>
                  <div className="space-y-3">
                    {bgVideoPreview && (
                      <div className="relative rounded-lg overflow-hidden h-40" style={{ border: `1px solid ${themeColors.border}` }}>
                        <video src={bgVideoPreview} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                        <button onClick={() => { api.background.deleteVideo(); set("launcher_bg_video", ""); set("launcher_bg_type", "default"); }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg flex items-center gap-1 text-xs text-white"
                          style={{ background: `${themeColors.danger}cc` }}>
                          <Trash2 size={12} /> Remove
                        </button>
                      </div>
                    )}
                    <GlowButton size="sm" variant="secondary" onClick={() => bgVideoInputRef.current?.click()} className="flex items-center gap-1">
                      <Film size={12} /> {bgVideoPreview ? "Change Video" : "Upload from File"}
                    </GlowButton>
                    <p className="text-[10px]" style={{ color: themeColors.text_muted }}>MP4, WebM. Video will loop continuously.</p>
                    <input ref={bgVideoInputRef} type="file" accept="video/*" className="hidden" onChange={handleBgVideoUpload} />
                  </div>
                </GlassCard>
              )}

              {(local.launcher_bg_type === "image" || local.launcher_bg_type === "video") && (
                <GlassCard>
                  <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Adjustments</h3>
                  <div className="space-y-4">
                    {/* Opacity */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-1" style={{ color: themeColors.text_muted }}>
                          <Eye size={12} /> Opacity
                        </span>
                        <span style={{ color: themeColors.accent }}>{local.launcher_bg_opacity ?? 100}%</span>
                      </div>
                      <input type="range" min={5} max={100} value={local.launcher_bg_opacity ?? 100}
                        onChange={(e) => set("launcher_bg_opacity", parseInt(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, ${themeColors.accent} ${((local.launcher_bg_opacity ?? 100) - 5) / 95 * 100}%, rgba(255,255,255,0.1) ${((local.launcher_bg_opacity ?? 100) - 5) / 95 * 100}%)`, accentColor: themeColors.accent }} />
                    </div>

                    {/* Brightness */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-1" style={{ color: themeColors.text_muted }}>
                          <Sun size={12} /> Brightness
                        </span>
                        <span style={{ color: themeColors.accent }}>{local.launcher_bg_brightness ?? 100}%</span>
                      </div>
                      <input type="range" min={10} max={200} value={local.launcher_bg_brightness ?? 100}
                        onChange={(e) => set("launcher_bg_brightness", parseInt(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, ${themeColors.accent} ${((local.launcher_bg_brightness ?? 100) - 10) / 190 * 100}%, rgba(255,255,255,0.1) ${((local.launcher_bg_brightness ?? 100) - 10) / 190 * 100}%)`, accentColor: themeColors.accent }} />
                    </div>

                    {/* Blur */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-1" style={{ color: themeColors.text_muted }}>
                          <Sliders size={12} /> Blur
                        </span>
                        <span style={{ color: themeColors.accent }}>{local.launcher_bg_blur ?? 0}px</span>
                      </div>
                      <input type="range" min={0} max={30} value={local.launcher_bg_blur ?? 0}
                        onChange={(e) => set("launcher_bg_blur", parseInt(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, ${themeColors.accent} ${(local.launcher_bg_blur ?? 0) / 30 * 100}%, rgba(255,255,255,0.1) ${(local.launcher_bg_blur ?? 0) / 30 * 100}%)`, accentColor: themeColors.accent }} />
                    </div>

                    {/* Dark Dimming Overlay */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-1" style={{ color: themeColors.text_muted }}>
                          <Moon size={12} /> Dark Overlay (Dimming)
                        </span>
                        <span style={{ color: themeColors.accent }}>{local.launcher_bg_dimming ?? 0}%</span>
                      </div>
                      <input type="range" min={0} max={80} value={local.launcher_bg_dimming ?? 0}
                        onChange={(e) => set("launcher_bg_dimming", parseInt(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, ${themeColors.accent} ${(local.launcher_bg_dimming ?? 0) / 80 * 100}%, rgba(255,255,255,0.1) ${(local.launcher_bg_dimming ?? 0) / 80 * 100}%)`, accentColor: themeColors.accent }} />
                      <p className="text-[10px] mt-1" style={{ color: themeColors.text_muted }}>
                        Adds a dark overlay on top — useful for light/bright images
                      </p>
                    </div>

                    {/* Fit Mode */}
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: themeColors.text_muted }}>Fit Mode</label>
                      <div className="grid grid-cols-4 gap-1">
                        {(["cover", "contain", "fill", "stretch"] as const).map((mode) => (
                          <button key={mode} onClick={() => set("launcher_bg_fit", mode)}
                            className="px-2 py-1.5 rounded-lg text-[11px] capitalize transition-all"
                            style={{
                              background: (local.launcher_bg_fit || "cover") === mode ? `${themeColors.accent}20` : themeColors.bg_card2,
                              color: (local.launcher_bg_fit || "cover") === mode ? themeColors.accent : themeColors.text_muted,
                              border: `1px solid ${(local.launcher_bg_fit || "cover") === mode ? themeColors.accent : themeColors.border}40`,
                            }}>
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Reset button */}
                    <GlowButton size="sm" variant="secondary" onClick={() => {
                      set("launcher_bg_opacity", 100);
                      set("launcher_bg_brightness", 100);
                      set("launcher_bg_blur", 0);
                      set("launcher_bg_dimming", 0);
                      set("launcher_bg_fit", "cover");
                    }} className="flex items-center gap-1">
                      <RefreshCcw size={12} /> Reset All Adjustments
                    </GlowButton>
                  </div>
                </GlassCard>
              )}

              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Quick Presets</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Minecraft Landscape", type: "image", url: "https://cdn.pixabay.com/photo/2016/08/24/21/34/minecraft-1618089_1280.jpg" },
                    { label: "Dark Caves", type: "image", url: "https://cdn.pixabay.com/photo/2021/08/12/06/46/minecraft-6539860_1280.jpg" },
                    { label: "Night Sky", type: "image", url: "https://cdn.pixabay.com/photo/2017/08/30/01/05/milky-way-2695569_1280.jpg" },
                    { label: "Ocean Waves", type: "image", url: "https://cdn.pixabay.com/photo/2016/11/14/04/45/sea-1822458_1280.jpg" },
                    { label: "Forest Path", type: "image", url: "https://cdn.pixabay.com/photo/2016/02/18/22/18/path-1205630_1280.jpg" },
                    { label: "Galaxy", type: "image", url: "https://cdn.pixabay.com/photo/2019/04/06/06/42/galaxy-4106300_1280.jpg" },
                    { label: "Anime Sunset", type: "image", url: "https://cdn.pixabay.com/photo/2017/02/01/09/17/background-2029999_1280.jpg" },
                    { label: "Default Dark", type: "default", url: "" },
                  ].map((preset) => (
                    <button key={preset.label} onClick={() => {
                      api.background.deleteFile();
                      api.background.deleteVideo();
                      if (preset.type === "default") {
                        set("launcher_bg_type", "default");
                        set("launcher_bg_image", "");
                        set("launcher_bg_video", "");
                      } else {
                        set("launcher_bg_type", "image");
                        set("launcher_bg_image", preset.url);
                      }
                    }}
                      className="p-3 rounded-lg text-left text-xs transition-all"
                      style={{ background: themeColors.bg_card2, border: `1px solid ${(local.launcher_bg_type || "default") === preset.type && (preset.type === "default" || local.launcher_bg_image === preset.url) ? themeColors.accent : themeColors.border}` }}>
                      <span style={{ color: themeColors.text_main }}>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </GlassCard>
            </div>
          )}

          {tab === "java" && (
            <div className="space-y-4">
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Java Settings</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Java Path (empty for auto-detect)</label>
                    <GlassInput value={local.java_path || ""} onChange={(v) => set("java_path", v)} placeholder="Auto-detect" />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>JVM Arguments</label>
                    <GlassInput value={local.jvm_args || ""} onChange={(v) => set("jvm_args", v)} placeholder="-Xmx2G -Xms1G" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Min Memory (MB)</label>
                      <GlassInput value={String(local.min_memory || 2048)} onChange={(v) => set("min_memory", parseInt(v) || 2048)} />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Max Memory (MB)</label>
                      <GlassInput value={String(local.max_memory || 4096)} onChange={(v) => set("max_memory", parseInt(v) || 4096)} />
                    </div>
                  </div>
                  {/* Recommended values, so nobody has to guess. */}
                  <p className="text-[10px] leading-snug" style={{ color: themeColors.text_muted }}>
                    3–6 GB is ideal for most players. More is not always faster — the
                    launcher also manages its own JVM flags.
                  </p>
                </div>
              </GlassCard>

              <GlassCard>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <HardDrive size={16} style={{ color: themeColors.accent }} />
                    <h3 className="tinycaps text-sm font-semibold" style={{ color: themeColors.text_main }}>Java Installations</h3>
                  </div>
                  <GlowButton size="sm" variant="secondary" onClick={() => api.java.getInstallations().then(setJavaInstallations).catch(() => {})} className="flex items-center gap-1">
                    <RefreshCcw size={12} /> Refresh
                  </GlowButton>
                </div>
                {javaInstallations.length === 0 ? (
                  <div className="px-3 py-2 rounded-lg text-xs" style={{ background: `${themeColors.warn}10`, color: themeColors.warn, border: `1px solid ${themeColors.warn}20` }}>
                    No Java installations detected. Install Java or click Download below.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {javaInstallations.map((j, idx) => (
                      <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                        style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}` }}>
                        <HardDrive size={14} style={{ color: j.managed ? themeColors.success : themeColors.blue }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate" style={{ color: themeColors.text_main }}>{j.name}</div>
                          <div className="text-[10px] truncate" style={{ color: themeColors.text_muted }}>{j.path}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded" style={{
                            background: j.managed ? `${themeColors.success}20` : `${themeColors.blue}20`,
                            color: j.managed ? themeColors.success : themeColors.blue,
                          }}>
                            Java {j.major_version}
                          </span>
                          {j.managed && <span className="text-[10px]" style={{ color: themeColors.text_muted }}>Managed</span>}
                          {String(local.java_path || "") === j.path && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${themeColors.accent}20`, color: themeColors.accent }}>Active</span>
                          )}
                          <button onClick={() => { set("java_path", j.path); }}
                            className="text-[10px] px-2 py-0.5 rounded transition-all"
                            style={{ background: `${themeColors.accent}15`, color: themeColors.accent, border: `1px solid ${themeColors.accent}30` }}>
                            Use
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>

              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Auto-Download Java</h3>
                <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>
                  Download the correct Java version for your Minecraft version. The launcher will also auto-download when launching.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { version: 8, desc: "MC 1.8 – 1.16.x" },
                    { version: 16, desc: "MC 1.17.x" },
                    { version: 17, desc: "MC 1.18 – 1.20.x" },
                    { version: 21, desc: "MC 1.21+" },
                  ].map(({ version, desc }) => (
                    <button key={version}
                      onClick={async () => {
                        setDownloadingJava(version);
                        setJavaDownloadResult("");
                        try {
                          const result = await api.java.download(version);
                          if (result.success) {
                            setJavaDownloadResult(`Java ${version} downloaded successfully!`);
                            const updated = await api.java.getInstallations();
                            setJavaInstallations(updated);
                          } else {
                            setJavaDownloadResult(`Failed: ${result.error}`);
                          }
                        } catch (e: any) {
                          setJavaDownloadResult(`Error: ${e.message}`);
                        }
                        setDownloadingJava(null);
                      }}
                      disabled={downloadingJava !== null}
                      className="p-3 rounded-lg text-left transition-all flex items-center gap-3"
                      style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}` }}>
                      {downloadingJava === version ? (
                        <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: `${themeColors.accent} transparent`, borderTopColor: themeColors.accent }} />
                      ) : (
                        <Download size={16} style={{ color: themeColors.accent }} />
                      )}
                      <div>
                        <div className="text-xs font-medium" style={{ color: themeColors.text_main }}>Java {version}</div>
                        <div className="text-[10px]" style={{ color: themeColors.text_muted }}>{desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {javaDownloadResult && (
                  <div className="mt-3 px-3 py-2 rounded-lg text-xs" style={{
                    background: javaDownloadResult.includes("Failed") || javaDownloadResult.includes("Error") ? `${themeColors.danger}10` : `${themeColors.success}10`,
                    color: javaDownloadResult.includes("Failed") || javaDownloadResult.includes("Error") ? themeColors.danger : themeColors.success,
                    border: `1px solid ${javaDownloadResult.includes("Failed") || javaDownloadResult.includes("Error") ? themeColors.danger : themeColors.success}20`,
                  }}>
                    {javaDownloadResult}
                  </div>
                )}
              </GlassCard>

              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Game Window</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Resolution Width</label>
                      <GlassInput value={String(local.game_resolution_width || 854)} onChange={(v) => set("game_resolution_width", parseInt(v) || 854)} />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Resolution Height</label>
                      <GlassInput value={String(local.game_resolution_height || 480)} onChange={(v) => set("game_resolution_height", parseInt(v) || 480)} />
                    </div>
                  </div>
                  <Toggle label="Start in fullscreen" k="game_fullscreen" />
                </div>
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Performance Defaults</h3>
                <div className="space-y-1">
                  <Toggle label="Auto-configure game settings for FPS" k="perf_game_config" />
                  <Toggle label="Aggressive JVM optimization" k="perf_jvm_aggressive" />
                  <Toggle label="Auto-install FPS performance mods on new modded instances" k="perf_auto_mods" />
                  <Toggle label="RAM optimization" k="perf_ram_opt" />
                </div>
                {local.perf_auto_mods !== false && (
                  <div className="mt-3 px-3 py-2 rounded-lg text-[10px]" style={{ background: `${themeColors.success}10`, color: themeColors.success, border: `1px solid ${themeColors.success}20` }}>
                    Every new Fabric, Quilt, Forge or NeoForge instance gets a curated FPS pack — Fabric API, Sodium, Lithium, Dynamic FPS, Mod Menu and more. Mods with no matching build for the version are skipped automatically.
                  </div>
                )}
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Game Boost</h3>
                <div className="space-y-1">
                  <Toggle label="Kill unnecessary background processes" k="boost_kill_processes" />
                  <Toggle label="Clear temp folders" k="boost_clear_temp" />
                  <Toggle label="Empty recycle bin" k="boost_empty_recycle" />
                  <Toggle label="Flush DNS cache" k="boost_flush_dns" />
                  <Toggle label="Clear thumbnail cache" k="boost_clear_thumbs" />
                  <Toggle label="Optimize system memory" k="boost_optimize_memory" />
                </div>
                <div className="mt-3 px-3 py-2 rounded-lg text-[10px]" style={{ background: `${themeColors.accent}10`, color: themeColors.text_sub, border: `1px solid ${themeColors.accent}20` }}>
                  Each boost step is off by default. Enable only what you want Game Boost to do when launching.
                </div>
              </GlassCard>
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>In-Game Defaults</h3>
                <div className="space-y-1">
                  <Toggle label="Disable VSync" k="def_vsync_off" />
                  <Toggle label="Disable music" k="def_no_music" />
                  <Toggle label="Enable gamma/brightness" k="def_gamma" />
                  <Toggle label="Full bright mode" k="def_full_bright" />
                </div>
              </GlassCard>
            </div>
          )}

          {tab === "downloads" && (
            <GlassCard>
              <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Download Settings</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Concurrent Downloads</label>
                  <GlassInput value={String(local.concurrent_downloads || 8)} onChange={(v) => set("concurrent_downloads", parseInt(v) || 8)} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>Download Speed Limit (KB/s, 0 = unlimited)</label>
                  <GlassInput value={String(local.download_speed_limit || 0)} onChange={(v) => set("download_speed_limit", parseInt(v) || 0)} />
                </div>
                <Toggle label="Skip already downloaded files" k="skip_existing" />
              </div>
            </GlassCard>
          )}

          {tab === "integrations" && (
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Integrations</h3>
                <div className="space-y-1">
                  <Toggle label="Use authlib-injector for Ely.by skins" k="use_authlib" />
                  <Toggle label="Show Ely.by accounts in account switcher" k="show_elyby" />
                  <Toggle label="Discord Rich Presence" k="discord_rpc" />
                </div>
                {local.discord_rpc && (
                  <div className="mt-3 px-3 py-2 rounded-lg text-[10px]" style={{ background: `${themeColors.blue}10`, color: themeColors.blue, border: `1px solid ${themeColors.blue}20` }}>
                    Shows your launcher activity and currently playing Minecraft instance on your Discord profile.
                  </div>
                )}
              </GlassCard>
          )}

          {tab === "directories" && (
            <GlassCard>
              <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Directories</h3>
              <div className="space-y-3">
                {[
                  { key: "game_directory", label: "Minecraft Directory" },
                  { key: "java_directory", label: "Java Directory" },
                  { key: "mods_directory", label: "Mods Directory" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs mb-1 block" style={{ color: themeColors.text_sub }}>{label}</label>
                    {/* A path chip with Open / Change, so the folder can be reached
                        without hunting through the file system. */}
                    <div className="flex items-center gap-2">
                      <div
                        className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl font-mono text-[11px]"
                        style={{
                          background: themeColors.bg_card2,
                          border: `1px solid ${themeColors.border}`,
                          color: themeColors.text_sub,
                        }}
                        title={local[key] || ""}
                      >
                        {local[key] || "Not set"}
                      </div>
                      <GlowButton
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const path = local[key];
                          if (!path) return;
                          api.systemCmd.runCommand(`xdg-open ${JSON.stringify(path)}`).catch(console.error);
                        }}
                        className="flex items-center gap-1"
                      >
                        <FolderOpen size={12} /> Open
                      </GlowButton>
                      <GlowButton size="sm" variant="secondary" onClick={() => set(key, "")} className="flex items-center gap-1">
                        <Pencil size={12} /> Change
                      </GlowButton>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {tab === "updates" && (
            <GlassCard>
              <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Updates</h3>
              <div className="space-y-3">
                <Toggle label="Auto-check for updates on startup" k="auto_check_updates" />
                <Toggle label="Install updates automatically" k="auto_update" />
                <GlowButton size="sm" onClick={checkUpdates} className="flex items-center gap-1">
                  <RefreshCcw size={14} /> Check for Updates
                </GlowButton>
                {updateInfo && (
                  <div className="px-3 py-2 rounded-lg text-sm"
                    style={{ background: updateInfo.update_available ? `${themeColors.warn}15` : `${themeColors.success}15`, color: updateInfo.update_available ? themeColors.warn : themeColors.success }}>
                    {updateInfo.update_available ? `Update available: ${updateInfo.latest_version}` : "You are up to date!"}
                  </div>
                )}
                {updateInfo?.update_available && updateInfo.download_url && (
                  <GlowButton size="sm" onClick={() => startUpdate()} className="flex items-center gap-1">
                    <Download size={14} /> Update Now
                  </GlowButton>
                )}
              </div>
            </GlassCard>
          )}

          {tab === "tools" && (
            <div className="space-y-4">
              <GlassCard>
                <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>Troubleshooting</h3>
                <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>
                  Run a check and send the result with a bug report.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <GlowButton
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setTab("logs");
                    }}
                    className="flex items-center gap-1"
                  >
                    <FileText size={13} /> Open logs
                  </GlowButton>
                  <GlowButton
                    size="sm"
                    variant="secondary"
                    onClick={() => api.java.getInstallations().then(setJavaInstallations).catch(() => { })}
                    className="flex items-center gap-1"
                  >
                    <Monitor size={13} /> Test Java environment
                  </GlowButton>
                  <GlowButton size="sm" variant="secondary" onClick={() => setPage("logs")} className="flex items-center gap-1">
                    <FileText size={13} /> Report a problem
                  </GlowButton>
                </div>
              </GlassCard>
            </div>
          )}

          {tab === "recovery" && (
            <div className="space-y-4">
              <GlassCard style={{ border: `1px solid ${themeColors.danger}40` }}>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} style={{ color: themeColors.danger }} />
                  <h3 className="tinycaps text-sm font-semibold" style={{ color: themeColors.danger }}>Destructive actions</h3>
                </div>
                <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>
                  Clearing the launcher data resets your settings, logs and cached
                  downloads. Your Minecraft profiles and worlds are not touched.
                </p>
                <GlowButton
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (!await confirmDialog("Clear launcher data?", "This will reset settings, logs and cached downloads. This action cannot be undone.", { danger: true, confirmLabel: "Clear Data" })) return;
                    setCleared(true);
                  }}
                  className="flex items-center gap-1"
                >
                  <Trash2 size={13} /> Clear data
                </GlowButton>
                {cleared && (
                  <p className="text-[10px] mt-2" style={{ color: themeColors.success }}>
                    Data cleared. Restart the launcher to start fresh.
                  </p>
                )}
              </GlassCard>
            </div>
          )}

          {tab === "about" && (
            <GlassCard>
              <h3 className="tinycaps text-sm font-semibold mb-3" style={{ color: themeColors.text_main }}>About Xryloth</h3>
              <div className="space-y-2 text-sm" style={{ color: themeColors.text_sub }}>
                <p>Version: {liveVersion || "5.9"} (Tauri Rewrite)</p>
                <p>Author: EscapeXOG</p>
                <p>License: Proprietary — All Rights Reserved</p>
                <div className="pt-2 flex gap-2">
                  <a href="https://xrylothclient.vercel.app" target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg"
                    style={{ color: themeColors.accent, border: `1px solid ${themeColors.border}` }}>
                    <ExternalLink size={12} /> Website
                  </a>
                </div>
                <p className="text-[10px] pt-2" style={{ color: themeColors.text_muted }}>
                  © {new Date().getFullYear()} Xryloth. This software is proprietary and may not be copied,
                  modified, or redistributed without written permission.
                </p>
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Unsaved changes leave prompt */}
      {showLeavePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090B0E]/60 backdrop-blur-sm">
          <div className="w-[380px] rounded-2xl p-6 text-center" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.border_accent}50`, boxShadow: `0 20px 60px ${themeColors.accent}20` }}>
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `${themeColors.warn}20`, color: themeColors.warn }}>
              <AlertTriangle size={24} />
            </div>
            <h3 className="tinycaps text-lg font-bold mb-1" style={{ color: themeColors.text_main }}>Unsaved Settings</h3>
            <p className="text-sm mb-5" style={{ color: themeColors.text_muted }}>
              You have unsaved setting changes. Save them before leaving?
            </p>
            <div className="flex gap-2 justify-center">
              <GlowButton size="sm" variant="secondary" onClick={() => { if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; } setShowLeavePrompt(false); setDirty(false); dirtyRef.current = false; clearNavGuard(); setPage(leaveTarget as any); }}>
                Don't Save
              </GlowButton>
              <GlowButton size="sm" onClick={() => { setShowLeavePrompt(false); doSave(leaveTarget || undefined); }}>
                <Save size={14} /> Save & Continue
              </GlowButton>
            </div>
          </div>
        </div>
      )}

      {/* Uninstall confirmation */}
      {showUninstall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090B0E]/60 backdrop-blur-sm">
          <div className="w-[440px] rounded-2xl p-6" style={{ background: themeColors.bg_card, border: `1px solid ${themeColors.danger}50`, boxShadow: `0 20px 60px ${themeColors.danger}20` }}>
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `${themeColors.danger}20`, color: themeColors.danger }}>
              <AlertTriangle size={24} />
            </div>
            <h3 className="tinycaps text-lg font-bold mb-1 text-center" style={{ color: themeColors.text_main }}>Uninstall Xryloth</h3>
            <p className="text-sm mb-4 text-center" style={{ color: themeColors.text_muted }}>
              This removes the Xryloth launcher and its desktop shortcuts. The Xryloth Installer is not removed.
            </p>
            <label className="flex items-start gap-2 mb-5 cursor-pointer select-none">
              <input type="checkbox" checked={deleteData} disabled={uninstalling}
                onChange={(e) => setDeleteData(e.target.checked)} className="mt-0.5" />
              <span className="text-xs" style={{ color: themeColors.text_sub }}>
                Also delete my instances, servers, mods and settings (cannot be undone)
              </span>
            </label>
            {uninstalling && (
              <p className="text-xs mb-4 text-center" style={{ color: themeColors.warn }}>
                Uninstalling Xryloth… the launcher will close.
              </p>
            )}
            {uninstallError && (
              <p className="text-xs mb-4 text-center" style={{ color: themeColors.danger }}>{uninstallError}</p>
            )}
            <div className="flex gap-2 justify-center">
              <GlowButton size="sm" variant="secondary" disabled={uninstalling} onClick={() => { setShowUninstall(false); setDeleteData(false); setUninstallError(""); }}>
                Cancel
              </GlowButton>
              <GlowButton size="sm" variant="danger" disabled={uninstalling} onClick={doUninstall}>
                <Trash2 size={14} /> {uninstalling ? "Uninstalling…" : "Uninstall"}
              </GlowButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
