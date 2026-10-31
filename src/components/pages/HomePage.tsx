import { CachedImage } from "../ui/CachedImage";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import {
  Plus, ChevronRight, ChevronDown, Clock, Play, Cpu, Zap, History,
  MessageCircle, Wrench, FolderOpen, Award,
  Newspaper, Palette, FileCog, Gauge, Image as ImageIcon, Copy, Check, Users, ShoppingBag,
} from "lucide-react";
import { subscribePartners, fetchStatuses, type PartnerServer } from "../../lib/partners";
import { subscribeToOnlineUsers, type ChatUser } from "../../lib/chatService";
import { getSession, onSessionChanged, type XrylothSession } from "../../lib/auth";
import type { NewsItem, ServerStatus } from "../../lib/types";

const RELEASES_URL = "https://github.com/EscapeXMc/Xryloth/releases/latest";

function mcId(uuid?: string) {
  const t = (uuid || "").replace(/-/g, "");
  return t.length === 32 ? t : "8660ba3e76424a96b46f0b738fcc8806";
}
function avatarUrl(uuid?: string) {
  return `https://mc-heads.net/avatar/${mcId(uuid)}?size=128`;
}
/** Full-body skin render — the "3D preview" the hero stands on. */
function skinUrl(uuid?: string) {
  return `https://mc-heads.net/body/${mcId(uuid)}/right`;
}
function timeAgo(iso?: string) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (isNaN(s) || s < 0) return "just now";
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
function shortDate(raw?: string) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw.slice(0, 16);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtPlay(min: number) {
  if (!min || min <= 0) return "0h";
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}
function fmtGB(bytes: number) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// Loader chips are monochrome too: the label carries the meaning, not a hue.
const LOADER_LABEL: Record<string, string> = {
  fabric: "Fabric", forge: "Forge", quilt: "Quilt", neoforge: "NeoForge", vanilla: "Vanilla",
};
function loaderLabel(loader?: string) {
  const k = (loader || "vanilla").toLowerCase();
  return LOADER_LABEL[k] || LOADER_LABEL.vanilla;
}

/** Small live indicator: a glowing green dot, per the design system. */
function LiveDot({ on = true, size = 6 }: { on?: boolean; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: on ? "#22c55e" : "#52525b",
        boxShadow: on ? "0 0 8px rgba(34,197,94,0.85)" : undefined,
      }}
    />
  );
}

function CpuSparkline({ data, color }: { data: number[]; color: string }) {
  const w = 220, h = 56;
  const pts = useMemo(() => {
    if (data.length < 2) return "";
    return data.map((v, i) => `${(i / (data.length - 1)) * w},${h - Math.min(100, Math.max(0, v)) / 100 * (h - 6) - 3}`).join(" ");
  }, [data]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function HomePage() {
  const {
    themeColors: e, instances: t, playTimes: n, systemInfo: s, settings: r,
    setPage: a, setSelectedInstance: o, setLoading: l, liveVersion, loadPlayTimes: c, loadSystemInfo: u,
  } = useLauncherStore();

  const [news, setNews] = useState<NewsItem[]>([]);
  const [partners, setPartners] = useState<PartnerServer[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [onlineUsers, setOnlineUsers] = useState<ChatUser[]>([]);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [session, setSession] = useState<XrylothSession | null>(() => getSession());
  const [devOpen, setDevOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [skinOk, setSkinOk] = useState(true);
  const [launchTarget, setLaunchTarget] = useState("");

  useEffect(() => onSessionChanged(setSession), []);
  useEffect(() => { c(); u(); }, []);

  // Live telemetry polling for the system card.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        await u();
        const v = useLauncherStore.getState().systemInfo.cpu;
        if (alive) setCpuHist((h) => [...h.slice(-29), Math.round(v)]);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Live news — the enhanced feed carries artwork for the promo cards.
  useEffect(() => {
    let alive = true;
    api.news.getEnhanced()
      .then((list) => { if (alive && list?.length) setNews(list); })
      .catch(() => api.news.get().then((list) => { if (alive) setNews(list); }).catch(() => {}));
    return () => { alive = false; };
  }, []);

  // Live partner servers (realtime) + a live ping for their status dots.
  useEffect(() => {
    const unsub = subscribePartners(setPartners);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!partners.length) return;
    let alive = true;
    const poll = async () => {
      const entries = await Promise.all(
        partners.slice(0, 6).map(async (p) => {
          try { return [p.id || p.ip, await fetchStatuses(p.ip, p.port || "25565")] as const; }
          catch { return null; }
        })
      );
      if (!alive) return;
      const next: Record<string, ServerStatus> = {};
      for (const en of entries) if (en) next[en[0]] = en[1];
      setStatuses(next);
    };
    poll();
    const id = setInterval(poll, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [partners]);

  // Live presence from the community chat.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try { unsub = subscribeToOnlineUsers((list) => setOnlineUsers(list || [])); } catch { /* chat unavailable */ }
    return () => { try { unsub?.(); } catch {} };
  }, []);

  const installed = useMemo(() => t.filter((x: any) => x.installed), [t]);
  const recent = useMemo(() => [...installed].sort((x: any, y: any) =>
    (y.last_played ? new Date(y.last_played).getTime() : 0) - (x.last_played ? new Date(x.last_played).getTime() : 0)
  ), [installed]);
  const totalH = useMemo(() => Math.floor(Object.values(n).reduce((m: number, v: any) => m + (v || 0), 0) / 60), [n]);

  // Default the launch picker to the most recently played profile.
  useEffect(() => {
    if (!launchTarget && recent.length) setLaunchTarget(recent[0].name);
  }, [recent, launchTarget]);

  const selected = recent.find((x: any) => x.name === launchTarget) || recent[0];

  const hour = new Date().getHours();
  const greet = hour < 6 ? "burning midnight oil" : hour < 12 ? "good morning" : hour < 17 ? "good afternoon" : hour < 21 ? "good evening" : "good night";
  const username = r.username || r.cracked_username || r.ely_by_username || session?.username || "player";
  const uuid = r.mc_uuid || r.ely_uuid || "";
  const accountsLinked = [r.username, r.cracked_username, r.ely_by_username].filter(Boolean).length;

  const launch = (name: string) => {
    const inst = installed.find((x: any) => x.name === name);
    window.dispatchEvent(new CustomEvent("ec-launch-game", { detail: { instanceName: name, version: inst?.version || "", loader: inst?.loader || "" } }));
  };
  const openFolder = async (name: string) => { try { await api.instances.openFolder(name); } catch {} };
  const copyIp = async (p: PartnerServer) => {
    try { await navigator.clipboard.writeText(p.port && p.port !== "25565" ? `${p.ip}:${p.port}` : p.ip); } catch {}
    setCopiedIp(p.id || p.ip);
    setTimeout(() => setCopiedIp(null), 1500);
  };

  const storageAdvice = s.disk_pct > 90 ? "Critical — free up space" : s.disk_pct > 80 ? "Getting full — clean old instances" : s.disk_pct > 60 ? "Healthy buffer remaining" : "Plenty of headroom";
  const onlineCount = onlineUsers.filter((x) => x.status === "online").length;
  const friends = onlineUsers.filter((x) => x.status === "online" && x.username);

  const socials = [
    {
      icon: MessageCircle,
      title: "DISCORD",
      desc: "Join the community chat with live player presence.",
      action: "JOIN",
      go: () => { const url = (r as any).discord_url; if (url) window.open(url, "_blank"); else a("chat"); },
    },
    {
      icon: ShoppingBag,
      title: "STORE",
      desc: (r as any).webstore_url
        ? "Ranks, cosmetics and modpacks from the Xryloth store."
        : "Ranks, cosmetics and modpacks. The store is being set up.",
      action: (r as any).webstore_url ? "VISIT" : "SOON",
      go: () => { const url = (r as any).webstore_url; if (url) window.open(url, "_blank"); else a("modpacks"); },
    },
  ];

  const devTools = [
    { icon: Palette, name: "Shader Studio", desc: "Shaders & visual packs", page: "packs" },
    { icon: FileCog, name: "Launch Scripts", desc: "JVM args & configs", page: "configeditor" },
    { icon: ImageIcon, name: "Resource Pack Editor", desc: "Browse & manage packs", page: "packs" },
    { icon: Gauge, name: "Performance Profiler", desc: "Logs & diagnostics", page: "logs" },
  ];

  return (
    <div className="max-w-8xl mx-auto space-y-5">
      {/* ==================== HERO / MAIN ACTION ==================== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="relative rounded-3xl overflow-hidden"
        style={{
          border: `1px solid ${e.border}`,
          background: "linear-gradient(150deg, #0c0c0f 0%, #060607 55%, #030303 100%)",
        }}
      >
        {/* Environment: monochrome cave atmosphere behind the figure. */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `radial-gradient(58% 78% at 78% 118%, ${e.accent}22 0%, transparent 62%), radial-gradient(42% 62% at 12% -10%, ${e.accent}12 0%, transparent 70%)`,
        }} />
        <div className="absolute left-0 right-0 bottom-0 h-28 pointer-events-none" style={{
          background: `linear-gradient(180deg, transparent 0%, ${e.accent}0d 100%)`,
        }} />
        <div className="absolute inset-0 pointer-events-none opacity-[0.05]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "radial-gradient(70% 60% at 50% 110%, #090B0E 0%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 110%, #090B0E 0%, transparent 75%)",
        }} />

        <div className="relative flex items-stretch gap-6 p-7 flex-wrap">
          <div className="flex-1 min-w-[260px] flex flex-col justify-center gap-4">
            <div>
              <p className="tinycaps text-[11px]" style={{ color: e.text_muted }}>{greet},</p>
              <h1 className="text-[34px] leading-none font-black tinycaps" style={{ color: e.text_main }}>{username}</h1>
              <p className="text-[11px] tinycaps mt-2" style={{ color: e.text_sub }}>
                {installed.length} profile{installed.length !== 1 ? "s" : ""} ready{totalH > 0 ? ` · ${totalH}h played` : ""}
                {accountsLinked > 0 ? ` · ${accountsLinked} account${accountsLinked !== 1 ? "s" : ""} linked` : ""}
              </p>
            </div>

            {/* Primary CTA: pure white with obsidian text, plus the version picker. */}
            <div className="flex items-center gap-2 flex-wrap">
              <GlowButton
                size="lg"
                disabled={!launchTarget}
                onClick={() => launchTarget && launch(launchTarget)}
                className="flex items-center gap-2 !px-9"
                style={{ letterSpacing: "0.14em" }}
              >
                <Play size={16} /> LAUNCH GAME
              </GlowButton>

              <div className="relative">
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  disabled={!recent.length}
                  className="flex items-center gap-2 px-3.5 py-3.5 rounded-2xl text-[11px] font-bold tinycaps transition-colors disabled:opacity-40"
                  style={{
                    border: `1px solid ${e.border_bright}`,
                    background: `${e.bg_card2}`,
                    color: e.text_main,
                  }}
                  title="Choose which profile to launch"
                >
                  <span className="tracking-[0.12em]">{selected ? `${selected.name}` : "NO PROFILE"}</span>
                  {selected?.version && <span style={{ color: e.text_muted }}>MC {selected.version}</span>}
                  <ChevronDown size={13} style={{ color: e.text_main, transform: pickerOpen ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
                </button>

                <AnimatePresence>
                  {pickerOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                      className="absolute left-0 mt-2 rounded-2xl overflow-hidden z-50 min-w-[240px]"
                      style={{ background: `${e.bg_card}f5`, border: `1px solid ${e.border_bright}`, backdropFilter: "blur(12px)" }}
                    >
                      <div className="max-h-64 overflow-y-auto py-1">
                        {recent.map((inst: any) => (
                          <button
                            key={inst.name}
                            onClick={() => { setLaunchTarget(inst.name); setPickerOpen(false); }}
                            className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors hover:bg-white/[0.07]"
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block text-[11px] font-bold truncate" style={{ color: e.text_main }}>{inst.name}</span>
                              <span className="block text-[9px] tinycaps" style={{ color: e.text_muted }}>{loaderLabel(inst.loader)} · MC {inst.version}</span>
                            </span>
                            {inst.name === launchTarget && <Check size={12} style={{ color: e.text_main }} />}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => { setPickerOpen(false); a("instances"); }}
                        className="w-full text-left px-3 py-2 text-[10px] font-bold tinycaps transition-colors hover:bg-white/[0.07]"
                        style={{ color: e.text_sub, borderTop: `1px solid ${e.border}` }}
                      >
                        + Manage profiles
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* 3D player skin preview */}
          <div className="relative hidden md:flex items-end justify-center shrink-0" style={{ width: 158 }}>
            <div className="absolute bottom-1 rounded-full" style={{
              width: 104, height: 12,
              background: `radial-gradient(ellipse, ${e.accent}38 0%, transparent 70%)`,
              filter: "blur(5px)",
            }} />
            {skinOk ? (
              <CachedImage
                src={skinUrl(uuid)}
                alt=""
                className="relative h-[212px] object-contain"
                style={{ imageRendering: "pixelated", filter: "drop-shadow(0 14px 34px rgba(0,0,0,0.72))" }}
                onError={() => setSkinOk(false)}
              />
            ) : (
              <CachedImage
                src={avatarUrl(uuid)}
                alt=""
                className="relative w-[120px] rounded-2xl mb-6"
                style={{ imageRendering: "pixelated", border: `1px solid ${e.border_bright}` }}
              />
            )}
          </div>
        </div>
      </motion.section>

      {/* ==================== QUICK PROFILE SLOTS ==================== */}
      <section>
        <div className="flex items-center justify-between px-1 mb-2">
          <p className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_muted }}>Quick Profiles</p>
          <button onClick={() => a("instances")} className="ghost-btn px-1.5 py-0.5 text-[11px] font-bold tinycaps">
            all profiles <ChevronRight size={12} />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {recent.slice(0, 3).map((inst: any, k: number) => {
            const mins = (n as any)[inst.name] || 0;
            return (
              <motion.div
                key={inst.name}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.06 }}
                className="rounded-2xl p-3.5 flex flex-col gap-1.5 transition-transform hover:-translate-y-0.5"
                style={{
                  background: `${e.bg_card}88`,
                  border: `1px solid ${e.border}`,
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold tinycaps px-1.5 py-0.5 rounded-md" style={{ background: `${e.bg_hover}aa`, color: e.text_sub, border: `1px solid ${e.border}` }}>
                    {loaderLabel(inst.loader)}
                  </span>
                  <span className="text-[9px] tinycaps" style={{ color: e.text_muted }}>MC {inst.version}</span>
                  <span className="flex-1" />
                  <LiveDot on size={5} />
                </div>
                <p className="text-[12px] font-bold truncate" style={{ color: e.text_main }}>{inst.name}</p>
                <p className="text-[10px] tinycaps flex items-center gap-1" style={{ color: e.text_muted }}>
                  <Clock size={10} /> {timeAgo(inst.last_played)}{mins > 0 ? ` · ${fmtPlay(mins)}` : ""}
                </p>
                <div className="flex gap-1.5 mt-1.5">
                  <button onClick={() => launch(inst.name)} className="outline-btn flex-1 py-1.5 text-[10px] tinycaps font-bold">
                    <Play size={11} /> PLAY
                  </button>
                  <button onClick={() => openFolder(inst.name)} className="outline-btn px-2.5 py-1.5" title="Open folder">
                    <FolderOpen size={12} />
                  </button>
                </div>
              </motion.div>
            );
          })}

          <button
            onClick={() => a("instances")}
            className="rounded-2xl p-3.5 flex flex-col items-center justify-center gap-1.5 min-h-[132px] transition-colors hover:bg-white/[0.05]"
            style={{ border: `1px dashed ${e.border_bright}`, color: e.text_sub }}
          >
            <Plus size={20} />
            <span className="text-[10px] font-bold tinycaps tracking-[0.12em]">Add a Profile</span>
          </button>
        </div>
      </section>

      {/* ==================== NEWS (LEFT) + UTILITY RAIL ==================== */}
      <div className="flex gap-5 items-start flex-wrap lg:flex-nowrap">
        {/* News feed with promotional artwork */}
        <div className="flex-1 min-w-[320px] space-y-4" style={{ flex: "1 1 62%" }}>
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Newspaper size={14} style={{ color: e.text_main }} />
              <span className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_main }}>News & Patch Notes</span>
              <span className="flex items-center gap-1 text-[9px] tinycaps" style={{ color: e.text_muted }}>
                <LiveDot /> live
              </span>
              <span className="flex-1" />
              <button onClick={() => a("announcements")} className="ghost-btn px-1.5 py-0.5 text-[10px] font-bold tinycaps">
                all news <ChevronRight size={11} />
              </button>
            </div>

            {news.length === 0 ? (
              <p className="text-[11px] py-6 text-center" style={{ color: e.text_muted }}>No news right now.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {news.slice(0, 4).map((it, i) => (
                  <a
                    key={`${it.url}-${i}`}
                    href={it.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block rounded-xl overflow-hidden transition-transform hover:-translate-y-0.5"
                    style={{ border: `1px solid ${e.border}`, background: e.bg_card, boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }}
                  >
                    <div className="h-28 overflow-hidden" style={{ background: "linear-gradient(135deg, #1a1a1e, #0b0b0d)" }}>
                      {it.image && (
                        <CachedImage
                          src={it.image}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="text-[11px] font-semibold line-clamp-2" style={{ color: e.text_main }}>{it.title}</p>
                      <p className="text-[9px] tinycaps mt-1 flex items-center gap-1.5" style={{ color: e.text_sub }}>
                        <span className="px-1.5 py-0.5 rounded-md" style={{ background: `${e.bg_hover}88`, border: `1px solid ${e.border}` }}>{it.type || "news"}</span>
                        {shortDate(it.date)}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </GlassCard>

          {/* Friends - who is around right now. */}
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={14} style={{ color: e.accent }} />
              <span className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_main }}>Friends</span>
              <span className="flex items-center gap-1 text-[9px] tinycaps" style={{ color: e.text_muted }}>
                <LiveDot /> {onlineCount} online
              </span>
              <span className="flex-1" />
              <button onClick={() => a("chat")} className="ghost-btn px-1.5 py-0.5 text-[10px] font-bold tinycaps">
                open chat <ChevronRight size={11} />
              </button>
            </div>
            {friends.length === 0 ? (
              <p className="text-[11px] py-3 text-center" style={{ color: e.text_muted }}>
                No friends online right now.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {friends.slice(0, 8).map((f: any) => (
                  <div key={f.uuid || f.username} className="flex items-center gap-2 px-2 py-1.5 rounded-xl"
                    style={{ background: e.bg_card2, border: `1px solid ${e.border}` }}>
                    <span className="w-5 h-5 rounded-full overflow-hidden shrink-0" style={{ background: `${e.accent}20` }}>
                      <CachedImage src={avatarUrl(f.uuid)} alt="" className="w-full h-full object-contain" style={{ imageRendering: "pixelated" }} />
                    </span>
                    <span className="text-[10px] font-semibold" style={{ color: e.text_main }}>{f.username}</span>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#22c55e" }} />
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* Footer */}
          <div className="flex items-center gap-3 flex-wrap px-1 text-[10px] tinycaps" style={{ color: `${e.text_muted}` }}>
            <span>Xryloth Client v{liveVersion}</span>
            <span className="w-1 h-1 rounded-full inline-block" style={{ background: `${e.border_bright}` }} />
            <button onClick={() => a("announcements")} className="ghost-btn px-1.5 py-0.5">what's new</button>
            <button onClick={() => a("settings")} className="ghost-btn px-1.5 py-0.5">settings</button>
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="ghost-btn px-1.5 py-0.5">github</a>
            <span className="flex-1" />
            <span>Proprietary — All Rights Reserved</span>
          </div>
        </div>

        {/* Right utility & partner rail */}
        <div className="space-y-4 w-full lg:w-auto" style={{ flex: "1 1 30%", minWidth: 260 }}>
          {/* Social cards */}
          <div className="grid grid-cols-2 gap-3">
            {socials.map((sc) => (
              <div key={sc.title} className="panel-dark p-3.5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <sc.icon size={14} style={{ color: e.text_main }} />
                  <span className="text-[10px] font-bold tinycaps tracking-[0.16em]" style={{ color: e.text_main }}>{sc.title}</span>
                </div>
                <p className="text-[10px] leading-snug" style={{ color: e.text_sub }}>{sc.desc}</p>
                <button onClick={sc.go} className="outline-btn mt-auto py-1.5 text-[10px] tinycaps font-bold tracking-[0.12em]">
                  {sc.action}
                </button>
              </div>
            ))}
          </div>

          {/* Partnered servers — live status dots */}
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Award size={14} style={{ color: e.text_main }} />
              <span className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_main }}>Partnered Servers</span>
              <span className="flex items-center gap-1 text-[9px] tinycaps" style={{ color: e.text_muted }}>
                <LiveDot /> live
              </span>
              <span className="flex-1" />
              <button onClick={() => a("partners")} className="ghost-btn px-1.5 py-0.5 text-[10px] font-bold tinycaps">
                all <ChevronRight size={11} />
              </button>
            </div>
            <div className="space-y-1.5">
              {partners.length === 0 && (
                <p className="text-[11px] py-3 text-center" style={{ color: e.text_muted }}>No partnerships yet — check back soon.</p>
              )}
              {partners.slice(0, 5).map((p) => {
                const st = statuses[p.id || p.ip];
                const key = p.id || p.ip;
                return (
                  <div key={key} className="flex items-center gap-2.5 p-2 rounded-xl" style={{ background: `${e.bg_card}66`, border: `1px solid ${e.border}` }}>
                    {p.logo
                      ? <CachedImage src={p.logo} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" style={{ border: `1px solid ${e.border}` }} />
                      : <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${e.bg_hover}77`, border: `1px solid ${e.border}` }}><Award size={13} style={{ color: e.text_sub }} /></div>}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold truncate" style={{ color: e.text_main }}>{p.name}</p>
                      <p className="text-[9px] line-clamp-1" style={{ color: e.text_sub }}>{p.description || p.ip}</p>
                    </div>
                    <span className="flex items-center gap-1 text-[9px] tinycaps shrink-0" style={{ color: st?.online ? "#22c55e" : e.text_muted }}>
                      <LiveDot on={!!st?.online} size={5} />
                      {st?.online ? `${st.players_online}/${st.players_max}` : st ? "offline" : "…"}
                    </span>
                    <button onClick={() => copyIp(p)} title="Copy IP" className="outline-btn px-2 py-1.5 shrink-0">
                      {copiedIp === key ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </GlassCard>

          {/* Players online — live presence from community chat */}
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users size={14} style={{ color: e.text_main }} />
              <span className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_main }}>Players Online</span>
              <span className="text-[10px] font-bold" style={{ color: e.text_main }}>{onlineCount}</span>
              <span className="flex-1" />
              <button onClick={() => a("chat")} className="ghost-btn px-1.5 py-0.5 text-[10px] font-bold tinycaps">
                open chat <ChevronRight size={11} />
              </button>
            </div>
            {onlineCount === 0 ? (
              <p className="text-[11px] py-2" style={{ color: `${e.text_muted}` }}>Nobody is online right now.</p>
            ) : (
              <div className="space-y-1">
                {onlineUsers.filter((x) => x.status === "online").slice(0, 5).map((usr) => (
                  <div key={usr.uid} className="flex items-center gap-2 text-[11px]" style={{ color: e.text_sub }}>
                    <LiveDot size={5} />
                    <span className="truncate" style={{ color: e.text_main }}>{usr.displayName || usr.username}</span>
                    {usr.mcUsername && <span className="text-[9px] tinycaps truncate" style={{ color: e.text_sub }}>· {usr.mcUsername}</span>}
                  </div>
                ))}
                {onlineCount > 5 && <p className="text-[9px] tinycaps pt-0.5" style={{ color: `${e.text_muted}` }}>+{onlineCount - 5} more in chat</p>}
              </div>
            )}
          </GlassCard>

          {/* Live system resources */}
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={14} style={{ color: e.text_main }} />
              <span className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_main }}>System</span>
              <span className="flex items-center gap-1 text-[9px] tinycaps" style={{ color: e.text_muted }}>
                <LiveDot /> live
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] tinycaps mb-0.5">
              <span style={{ color: e.text_muted }}>CPU · {Math.round(s.cpu)}%</span>
              <Zap size={11} style={{ color: e.text_muted }} />
              <span style={{ color: e.text_muted }}>RAM · {Math.round(s.ram_pct)}%</span>
            </div>
            <CpuSparkline data={cpuHist.length ? cpuHist : [s.cpu]} color={e.accent} />
            <div className="space-y-2 mt-1">
              <div>
                <div className="flex items-center justify-between text-[9px] tinycaps mb-1" style={{ color: e.text_muted }}>
                  <span>Memory · {fmtGB(s.ram_used)} / {fmtGB(s.ram_total)}</span>
                  <span>{Math.round(s.ram_pct)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${e.border}aa` }}>
                  <motion.div className="h-full rounded-full" style={{ background: e.text_main }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, s.ram_pct)}%` }} transition={{ duration: 1 }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[9px] tinycaps mb-1" style={{ color: e.text_muted }}>
                  <span className="flex items-center gap-1"><History size={10} /> Storage · {fmtGB(s.disk_used)} used</span>
                  <span>{Math.round(s.disk_pct)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${e.border}aa` }}>
                  <motion.div className="h-full rounded-full" style={{ background: "rgba(255,255,255,0.55)" }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, s.disk_pct)}%` }} transition={{ duration: 1 }} />
                </div>
                <p className="text-[9px] tinycaps mt-1" style={{ color: e.text_muted }}>{storageAdvice.toLowerCase()}</p>
              </div>
            </div>
          </GlassCard>

          {/* Developer tools */}
          <GlassCard className="p-4">
            <button onClick={() => setDevOpen(!devOpen)} className="w-full flex items-center gap-2">
              <Wrench size={14} style={{ color: e.text_main }} />
              <span className="tinycaps text-[10px] font-bold tracking-[0.14em] flex-1 text-left" style={{ color: e.text_main }}>Developer Tools</span>
              <ChevronRight size={13} style={{ color: e.text_muted, transform: devOpen ? "rotate(90deg)" : undefined, transition: "transform .2s" }} />
            </button>
            <AnimatePresence>
              {devOpen && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {devTools.map((dt) => (
                      <button key={dt.name} onClick={() => { o(null); a(dt.page); l(false); }}
                        className="p-2.5 rounded-xl text-left transition-colors hover:bg-white/[0.06]"
                        style={{ background: `${e.bg_card}66`, border: `1px solid ${e.border}` }}>
                        <dt.icon size={15} style={{ color: e.text_main }} />
                        <p className="text-[11px] font-bold mt-1" style={{ color: e.text_main }}>{dt.name}</p>
                        <p className="text-[9px] line-clamp-1" style={{ color: e.text_sub }}>{dt.desc}</p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
