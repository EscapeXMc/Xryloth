import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import {
  Plus, ChevronRight, Clock, Play, Cpu, Zap, History, Settings as SettingsIcon,
  Headphones, MessageCircle, Crown, User, Wrench, FolderOpen, Award,
  Newspaper, Flame, Palette, FileCog, Gauge, Image as ImageIcon, Copy, Check,
} from "lucide-react";
import { subscribePartners, type PartnerServer } from "../../lib/partners";
import { getSession, onSessionChanged, type XrylothSession } from "../../lib/auth";
import type { NewsItem } from "../../lib/types";

const FALLBACK_AVATAR = "https://mc-heads.net/avatar/8660ba3e76424a96b46f0b738fcc8806?size=128";
function avatarUrl(uuid?: string) {
  const t = (uuid || "").replace(/-/g, "");
  return t.length === 32 ? `https://mc-heads.net/avatar/${t}?size=128` : FALLBACK_AVATAR;
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
function fmtPlay(min: number) {
  if (!min || min <= 0) return "0h";
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}
function fmtGB(bytes: number) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const LOADER_STYLE: Record<string, { bg: string; label: string }> = {
  fabric: { bg: "#60a5fa", label: "Fabric" },
  forge: { bg: "#f59e0b", label: "Forge" },
  quilt: { bg: "#a855f7", label: "Quilt" },
  neoforge: { bg: "#f59e0b", label: "NeoForge" },
  vanilla: { bg: "#a1a1aa", label: "Vanilla" },
};
function loaderOf(loader?: string) {
  const k = (loader || "vanilla").toLowerCase();
  return LOADER_STYLE[k] || LOADER_STYLE.vanilla;
}

function CpuSparkline({ data, color }: { data: number[]; color: string }) {
  const w = 220, h = 56;
  const pts = useMemo(() => {
    if (data.length < 2) return "";
    return data.map((v, i) => `${(i / (data.length - 1)) * w},${h - Math.min(100, Math.max(0, v)) / 100 * (h - 6) - 3}`).join(" ");
  }, [data]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SegBar({ pct, color, segments = 24 }: { pct: number; color: string; segments?: number }) {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * segments);
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: segments }).map((_, i) => (
        <div key={i} className="flex-1 h-3 rounded-[3px]" style={{ background: i < filled ? color : `${color}18`, opacity: i < filled ? 0.9 : 1 }} />
      ))}
    </div>
  );
}

export function HomePage() {
  const {
    themeColors: e, instances: t, playTimes: n, systemInfo: s, settings: r,
    setPage: a, setSelectedInstance: o, setLoading: l, loadPlayTimes: c, loadSystemInfo: u,
  } = useLauncherStore();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [partners, setPartners] = useState<PartnerServer[]>([]);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [session, setSession] = useState<XrylothSession | null>(() => getSession());
  const [devOpen, setDevOpen] = useState(false);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  useEffect(() => onSessionChanged(setSession), []);
  useEffect(() => { c(); u(); }, []);

  // Live telemetry polling for the sparkline
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

  useEffect(() => {
    api.news.get().then(setNews).catch(() => {});
    const unsub = subscribePartners(setPartners);
    return () => unsub();
  }, []);

  const installed = useMemo(() => t.filter((x: any) => x.installed), [t]);
  const recent = useMemo(() => [...installed].sort((x: any, y: any) =>
    (y.last_played ? new Date(y.last_played).getTime() : 0) - (x.last_played ? new Date(x.last_played).getTime() : 0)
  ).slice(0, 4), [installed]);
  const totalH = useMemo(() => Math.floor(Object.values(n).reduce((m: number, v: any) => m + (v || 0), 0) / 60), [n]);

  const hour = new Date().getHours();
  const greet = hour < 6 ? "burning midnight oil" : hour < 12 ? "good morning" : hour < 17 ? "good afternoon" : hour < 21 ? "good evening" : "good night";
  const username = r.username || r.cracked_username || r.ely_by_username || session?.username || "player";
  const uuid = r.mc_uuid || r.ely_uuid || "";
  const isLinked = !!r.username && !!uuid;

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

  const devTools = [
    { icon: Palette, name: "Shader Studio", desc: "Shaders & visual packs", page: "packs" },
    { icon: FileCog, name: "Launch Scripts", desc: "JVM args & configs", page: "configeditor" },
    { icon: ImageIcon, name: "Resource Pack Editor", desc: "Browse & manage packs", page: "packs" },
    { icon: Gauge, name: "Performance Profiler", desc: "Logs & diagnostics", page: "logs" },
  ];

  return (
    <div className="flex gap-5 max-w-8xl mx-auto items-start">
      {/* ============ LEFT: workspace (70%) ============ */}
      <div className="flex-1 min-w-0 space-y-6" style={{ flex: "0 1 70%" }}>
        {/* Greeting banner */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl overflow-hidden p-7 flex items-center gap-5 flex-wrap"
          style={{ background: `linear-gradient(145deg, ${e.bg_card}, ${e.bg_card2})`, border: `1px solid ${e.border}50` }}>
          <img src={avatarUrl(uuid)} alt="" className="w-16 h-16 rounded-2xl shrink-0" style={{ imageRendering: "pixelated", border: `1px solid ${e.border}` }}
            onError={(ev) => { (ev.target as HTMLImageElement).src = FALLBACK_AVATAR; }} />
          <div className="flex-1 min-w-[220px]">
            <p className="text-xs tinycaps" style={{ color: e.text_muted }}>{greet},</p>
            <h1 className="text-3xl font-extrabold tinycaps leading-tight">
              <span style={{ color: e.text_main }}>welcome back, </span>
              <span style={{ color: e.accent }}>{username}</span>
            </h1>
            <p className="text-xs tinycaps mt-1" style={{ color: e.text_muted }}>
              {installed.length} profile{installed.length !== 1 ? "s" : ""} ready{totalH > 0 ? ` · ${totalH}h played` : ""}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <GlowButton size="sm" onClick={() => a("instances")} className="flex items-center gap-1.5"><Plus size={14} /> New Instance</GlowButton>
              <GlowButton size="sm" variant="secondary" onClick={() => a("partners")} className="flex items-center gap-1.5"><Award size={14} /> Partners</GlowButton>
            </div>
          </div>
        </motion.div>

        {/* Telemetry */}
        <div>
          <p className="tinycaps text-[10px] font-bold tracking-[0.14em] mb-2 px-1" style={{ color: e.text_muted }}>Global Resources</p>
          <div className="grid grid-cols-3 gap-4">
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Cpu size={14} style={{ color: e.accent }} />
                <span className="tinycaps text-[10px] font-bold" style={{ color: e.text_main }}>CPU · {Math.round(s.cpu)}%</span>
              </div>
              <CpuSparkline data={cpuHist.length ? cpuHist : [s.cpu]} color={e.accent} />
              <p className="text-[10px] tinycaps" style={{ color: e.text_muted }}>live · last 75s</p>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={14} style={{ color: e.purple }} />
                <span className="tinycaps text-[10px] font-bold" style={{ color: e.text_main }}>Memory · {fmtGB(s.ram_used)}</span>
              </div>
              <SegBar pct={s.ram_pct} color={e.purple} />
              <p className="text-[10px] tinycaps mt-2" style={{ color: e.text_muted }}>{Math.round(s.ram_pct)}% of {fmtGB(s.ram_total)} utilized</p>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <History size={14} style={{ color: e.blue }} />
                <span className="tinycaps text-[10px] font-bold" style={{ color: e.text_main }}>Storage Advisor</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: `${e.blue}18` }}>
                <motion.div className="h-full rounded-full" style={{ background: e.blue }}
                  initial={{ width: 0 }} animate={{ width: `${Math.min(100, s.disk_pct)}%` }} transition={{ duration: 1 }} />
              </div>
              <p className="text-[10px] tinycaps mt-2" style={{ color: e.text_muted }}>{fmtGB(s.disk_used)} used · {storageAdvice.toLowerCase()}</p>
            </GlassCard>
          </div>
        </div>

        {/* Instances */}
        <div>
          <div className="flex items-center justify-between px-1 mb-2">
            <p className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_muted }}>Instances & Projects</p>
            <button onClick={() => a("instances")} className="flex items-center gap-1 text-[11px] font-bold tinycaps" style={{ color: e.accent }}>
              all instances <ChevronRight size={12} />
            </button>
          </div>
          {recent.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <p className="text-sm" style={{ color: e.text_muted }}>No instances yet</p>
              <GlowButton size="sm" onClick={() => a("instances")} className="mt-3 inline-flex items-center gap-1"><Plus size={14} /> Create Instance</GlowButton>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {recent.map((inst: any, k: number) => {
                const ld = loaderOf(inst.loader);
                const mins = (n as any)[inst.name] || 0;
                return (
                  <motion.div key={inst.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.06 }}>
                    <GlassCard className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md" style={{ background: `${ld.bg}20`, color: ld.bg, border: `1px solid ${ld.bg}40` }}>{ld.label}</span>
                        <span className="flex items-center gap-1 text-[9px] tinycaps" style={{ color: e.text_muted }}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: e.success }} /> ready
                        </span>
                        <div className="flex-1" />
                        <span className="text-[10px] tinycaps" style={{ color: e.text_muted }}>MC {inst.version}</span>
                      </div>
                      <h3 className="text-sm font-bold mt-2 truncate" style={{ color: e.text_main }}>{inst.name}</h3>
                      <p className="text-[10px] tinycaps flex items-center gap-1 mt-0.5" style={{ color: e.text_muted }}>
                        <Clock size={10} /> last played {timeAgo(inst.last_played)}{mins > 0 ? ` · ${fmtPlay(mins)}` : ""}
                      </p>
                      <div className="flex gap-2 mt-3">
                        <GlowButton size="sm" onClick={() => launch(inst.name)} className="flex-1 flex items-center justify-center gap-1"><Play size={12} /> Play</GlowButton>
                        <button onClick={() => openFolder(inst.name)} title="Open folder"
                          className="px-2.5 rounded-lg" style={{ border: `1px solid ${e.border}`, color: e.text_muted }}>
                          <FolderOpen size={13} />
                        </button>
                      </div>
                    </GlassCard>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Partner servers strip */}
        <div>
          <div className="flex items-center justify-between px-1 mb-2">
            <p className="tinycaps text-[10px] font-bold tracking-[0.14em]" style={{ color: e.text_muted }}>Partner Servers</p>
            <button onClick={() => a("partners")} className="flex items-center gap-1 text-[11px] font-bold tinycaps" style={{ color: e.accent }}>
              view all <ChevronRight size={12} />
            </button>
          </div>
          {partners.length === 0 ? (
            <GlassCard className="p-5 text-center">
              <p className="text-xs" style={{ color: e.text_muted }}>No partnerships yet — check back soon.</p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {partners.filter((p) => p.featured).concat(partners.filter((p) => !p.featured)).slice(0, 2).map((p) => (
                <GlassCard key={p.id || p.ip} className="p-4 flex items-center gap-3">
                  {p.logo
                    ? <img src={p.logo} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0" style={{ border: `1px solid ${e.border}` }} />
                    : <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${e.accent}15` }}><Award size={18} style={{ color: e.accent }} /></div>}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: e.text_main }}>{p.name}</p>
                    <p className="text-[10px] line-clamp-1" style={{ color: e.text_muted }}>{p.description || p.ip}</p>
                  </div>
                  <button onClick={() => copyIp(p)} title="Copy IP" className="p-2 rounded-lg shrink-0" style={{ border: `1px solid ${e.border}`, color: e.accent }}>
                    {copiedIp === (p.id || p.ip) ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ RIGHT: sidebar stack (30%) ============ */}
      <div className="space-y-4" style={{ flex: "0 1 30%", minWidth: 240 }}>
        {/* Account card */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <img src={avatarUrl(uuid)} alt="" className="w-12 h-12 rounded-xl" style={{ imageRendering: "pixelated", border: `1px solid ${e.border}` }}
              onError={(ev) => { (ev.target as HTMLImageElement).src = FALLBACK_AVATAR; }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: e.text_main }}>{username}</p>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {isLinked && <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${e.success}15`, color: e.success }}>MICROSOFT VERIFIED</span>}
                {r.ely_by_username && <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${e.purple}15`, color: e.purple }}>ELY.BY LINKED</span>}
                {session && <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${e.blue}15`, color: e.blue }}>{session.isAdmin ? "ADMIN" : "XRYLOTH ID"}</span>}
                {!isLinked && !session && <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${e.warn}15`, color: e.warn }}>OFFLINE</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: `1px solid ${e.border}` }}>
            <p className="tinycaps text-[9px] font-bold" style={{ color: e.text_muted }}>Recent activity</p>
            {[
              { icon: Clock, text: `${fmtPlay(Object.values(n).reduce((m: number, v: any) => m + (v || 0), 0))} total playtime` },
              { icon: User, text: `Signed in as ${username}` },
              { icon: Crown, text: session?.isAdmin ? "Admin access active" : "Standard access" },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: e.text_sub }}>
                <row.icon size={12} style={{ color: e.text_muted }} /> {row.text}
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Developer tools drawer */}
        <GlassCard className="p-4">
          <button onClick={() => setDevOpen(!devOpen)} className="w-full flex items-center gap-2">
            <Wrench size={14} style={{ color: e.accent }} />
            <span className="tinycaps text-[10px] font-bold flex-1 text-left" style={{ color: e.text_main }}>Developer Tools</span>
            <ChevronRight size={13} style={{ color: e.text_muted, transform: devOpen ? "rotate(90deg)" : undefined, transition: "transform .2s" }} />
          </button>
          <AnimatePresence>
            {devOpen && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {devTools.map((t) => (
                    <button key={t.name} onClick={() => { o(""); a(t.page); l(false); }}
                      className="p-2.5 rounded-xl text-left transition-all hover:scale-[1.02]"
                      style={{ background: `${e.accent}08`, border: `1px solid ${e.border}` }}>
                      <t.icon size={15} style={{ color: e.accent }} />
                      <p className="text-[11px] font-bold mt-1" style={{ color: e.text_main }}>{t.name}</p>
                      <p className="text-[9px] line-clamp-1" style={{ color: e.text_muted }}>{t.desc}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>

        {/* News & patch notes */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Newspaper size={14} style={{ color: e.accent }} />
            <span className="tinycaps text-[10px] font-bold" style={{ color: e.text_main }}>News & Patch Notes</span>
          </div>
          <div className="space-y-2">
            {(news.length ? news.slice(0, 4) : []).map((it, i) => (
              <a key={i} href={it.url} target="_blank" rel="noreferrer" className="block p-2 rounded-lg transition-all hover:scale-[1.01]" style={{ background: `${e.accent}06`, border: `1px solid ${e.border}` }}>
                <p className="text-[11px] font-semibold line-clamp-2" style={{ color: e.text_main }}>{it.title}</p>
                <p className="text-[9px] tinycaps mt-0.5" style={{ color: e.text_muted }}>{it.type} · {it.date}</p>
              </a>
            ))}
            {news.length === 0 && <p className="text-[11px]" style={{ color: e.text_muted }}>No news right now.</p>}
          </div>
        </GlassCard>

        {/* Community */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Flame size={14} style={{ color: e.warn }} />
            <span className="tinycaps text-[10px] font-bold" style={{ color: e.text_main }}>Community</span>
          </div>
          <div className="space-y-2">
            <button onClick={() => a("modpacks")} className="w-full text-left p-2 rounded-lg" style={{ background: `${e.warn}08`, border: `1px solid ${e.border}` }}>
              <p className="text-[11px] font-bold" style={{ color: e.text_main }}>Trending modpacks</p>
              <p className="text-[9px]" style={{ color: e.text_muted }}>Browse curated packs</p>
            </button>
            <button onClick={() => a("chat")} className="w-full text-left p-2 rounded-lg flex items-center gap-2" style={{ background: `${e.purple}08`, border: `1px solid ${e.border}` }}>
              <MessageCircle size={13} style={{ color: e.purple }} />
              <span className="text-[11px] font-bold" style={{ color: e.text_main }}>Community chat</span>
            </button>
            <button onClick={() => a("partners")} className="w-full text-left p-2 rounded-lg flex items-center gap-2" style={{ background: `${e.success}08`, border: `1px solid ${e.border}` }}>
              <Award size={13} style={{ color: e.success }} />
              <span className="text-[11px] font-bold" style={{ color: e.text_main }}>Partner servers</span>
            </button>
            <div className="flex items-center gap-2 text-[10px] pt-1" style={{ color: e.text_muted }}>
              <Headphones size={11} /> Music & ambience in Settings
              <button onClick={() => a("settings")} className="ml-auto" style={{ color: e.accent }}><SettingsIcon size={11} /></button>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
