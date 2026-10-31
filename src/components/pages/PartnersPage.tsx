import { CachedImage } from "../ui/CachedImage";
import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import {
  Award, Plus, Trash2, Pencil, Copy, Check, Globe, MessageCircle,
  Server, Users, Tag, X, Star, ShoppingBag, Activity, Wifi, WifiOff, ChevronDown,
} from "lucide-react";
import { subscribePartners, addPartner, updatePartner, removePartner, type PartnerServer, fetchStatuses } from "../../lib/partners";
import { getSession, onSessionChanged, type XrylothSession } from "../../lib/auth";
import { confirmDialog } from "../ui/Dialog";
import type { ServerStatus } from "../../lib/types";

const empty: Omit<PartnerServer, "id"> = {
  name: "", ip: "", port: "25565", description: "", version: "",
  players: "", logo: "", banner: "", website: "", discord: "", webstore: "", tags: "", featured: false,
};

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

/** Live server status: online/offline badge, player count bar, latency, version.
 * All data fetched live from the partner server via mcsrvstat.us / backend ping. */
function StatusStrip({ p, st, themeColors }: { p: PartnerServer; st?: ServerStatus; themeColors: any }) {
  const checking = !st;
  const online = !!st?.online;
  const cur = st?.players_online ?? 0;
  const max = st?.players_max ?? 0;
  const pct = max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : 0;
  const dispVersion = st?.version || p.version || "";
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-3 space-y-2">
      {/* Row 1: Status badge + Version + Latency */}
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <span
          className="flex items-center gap-1.5 px-2 py-1 rounded-full font-bold text-[10px] tracking-wide"
          style={{
            background: checking ? "rgba(255,255,255,0.05)" : online ? "#22c55e18" : "#ef444418",
            color: checking ? "#71717a" : online ? "#22c55e" : "#ef4444",
            border: `1px solid ${checking ? "rgba(255,255,255,0.08)" : online ? "#22c55e40" : "#ef444440"}`,
          }}
        >
          {checking
            ? <><Activity size={10} className="animate-pulse" /> PINGING…</>
            : online
              ? <><span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse inline-block" style={{ boxShadow: "0 0 6px #22c55e" }} /> ONLINE</>
              : <><WifiOff size={10} /> OFFLINE</>}
        </span>
        {online && dispVersion && (
          <span className="px-1.5 py-0.5 rounded bg-white/5 text-zinc-400 font-mono">v{dispVersion}</span>
        )}
        {online && st!.latency > 0 && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-zinc-400"><Wifi size={9} /> {st!.latency}ms</span>
        )}
      </div>

      {/* Row 2: Live player count bar */}
      {online && max > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 text-zinc-300 font-semibold"><Users size={10} className="text-amber-400" /> {cur} / {max} players</span>
            <span className="text-zinc-500 font-mono">{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background: pct > 80 ? "linear-gradient(90deg, #ef4444, #f97316)" : pct > 50 ? "linear-gradient(90deg, #eab308, #f59e0b)" : "linear-gradient(90deg, #22c55e, #4ade80)",
                boxShadow: pct > 80 ? "0 0 8px #ef444650" : "0 0 8px #22c55e40",
              }}
            />
          </div>
        </div>
      )}

      {/* Row 2 fallback: server offline or no max data */}
      {(!online || max === 0) && (
        <div className="text-[10px] text-zinc-600">
          {online ? "Player count unavailable" : "Server is currently offline"}
        </div>
      )}

      {/* Row 3: MOTD */}
      {online && st!.motd && (
        <div className="text-[10px] text-zinc-500 italic truncate" title={st!.motd}>"{st!.motd}"</div>
      )}
    </div>
  );
}

export function PartnersPage() {
  const { themeColors, setPage } = useLauncherStore();
  const [partners, setPartners] = useState<PartnerServer[]>([]);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recommended" | "online" | "name">("recommended");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<XrylothSession | null>(() => getSession());
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  useEffect(() => onSessionChanged(setSession), []);

  // Live realtime sync with Firebase
  const [liveError, setLiveError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const unsub = subscribePartners((list) => {
      setPartners(list);
      setLoading(false);
      setLiveError(null);
    });
    return () => { unsub(); };
  }, []);

  // Live server status polling
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  useEffect(() => {
    const refresh = async () => {
      const st: Record<string, ServerStatus> = {};
      await Promise.all(partners.map(async (p) => {
        try {
          st[p.id || p.ip] = await fetchStatuses(p.ip, p.port || "25565");
        } catch {
          st[p.id || p.ip] = { online: false, host: p.ip, port: p.port || "25565", version: "", players_online: 0, players_max: 0, motd: "", icon: "", latency: 0, error: "fetch failed" };
        }
      }));
      setStatuses(st);
    };
    if (partners.length) refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [partners]);

  const isAdmin = !!session?.isAdmin;

  const save = async () => {
    setErr("");
    if (!form.name.trim() || !form.ip.trim()) { setErr("Server name and IP are required."); return; }
    setSaving(true);
    const res = editingId
      ? await updatePartner(editingId, form)
      : await addPartner(form);
    setSaving(false);
    if (!res.ok) { setErr(res.error || "Failed."); return; }
    setForm(empty); setEditingId(null); setShowForm(false);
  };

  const startEdit = (p: PartnerServer) => {
    setForm({
      name: p.name || "", ip: p.ip || "", port: p.port || "25565",
      description: p.description || "", version: p.version || "", players: p.players || "",
      logo: p.logo || "", banner: p.banner || "", website: p.website || "",
      discord: p.discord || "", webstore: (p as any).webstore || "", tags: p.tags || "", featured: !!p.featured,
    });
    setEditingId(p.id || null);
    setShowForm(true);
  };

  const copyIp = async (p: PartnerServer) => {
    const addr = p.port && p.port !== "25565" ? `${p.ip}:${p.port}` : p.ip;
    try { await navigator.clipboard.writeText(addr); } catch {}
    setCopied(p.id || p.ip);
    setTimeout(() => setCopied(null), 1500);
  };

  const pickFile = async (key: "logo" | "banner", f: File | undefined) => {
    if (!f) return;
    const url = await fileToDataUrl(f);
    setForm((s) => ({ ...s, [key]: url }));
  };

  // Search + sort
  const visiblePartners = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? partners.filter((p) =>
          [p.name, p.description, p.version, p.tags].join(" ").toLowerCase().includes(needle))
      : partners;
    const sorted = [...filtered];
    const up = (p: any) => {
      const st = statuses[p.id || p.ip];
      return st?.online ? 1 : 0;
    };
    const players = (p: any) => statuses[p.id || p.ip]?.players_online || 0;
    if (sortBy === "name") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sortBy === "online") {
      sorted.sort((a, b) => players(b) - players(a));
    } else {
      sorted.sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || up(b) - up(a));
    }
    return sorted;
  }, [partners, statuses, query, sortBy]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Award size={20} style={{ color: themeColors.accent }} />
          <div>
            <h1 className="tinycaps text-xl font-bold gradient-text" style={{ "--accent": themeColors.accent, "--accent2": themeColors.purple || themeColors.blue } as any}>Partner Servers</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs" style={{ color: themeColors.text_muted }}>Official Xryloth partnered Minecraft servers</p>
              <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full tinycaps" style={{ background: `${themeColors.success}15`, color: themeColors.success }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ background: themeColors.success }} /> LIVE SYNC
              </span>
            </div>
            {liveError && <p className="text-xs mt-1" style={{ color: themeColors.danger }}>{liveError}</p>}
          </div>
        </div>
        {/* Admin-only: Add Partner button */}
        {isAdmin && (
          <GlowButton size="sm" onClick={() => { setForm(empty); setEditingId(null); setShowForm(!showForm); }} className="flex items-center gap-1">
            {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "Close" : "Add Partner"}
          </GlowButton>
        )}
      </div>

      {/* Guest prompt — Sign In works */}
      {!session && (
        <GlassCard className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Server size={16} style={{ color: themeColors.text_muted }} />
            <p className="text-xs" style={{ color: themeColors.text_muted }}>
              Browsing as guest. Sign in with an admin account to manage partners.
            </p>
          </div>
          <GlowButton size="sm" onClick={() => setPage("accounts")}>Sign In</GlowButton>
        </GlassCard>
      )}

      {/* Signed in but NOT admin — just a subtle note, no buttons */}
      {session && !isAdmin && (
        <GlassCard className="p-4 flex items-center gap-2">
          <Users size={14} style={{ color: themeColors.text_muted }} />
          <p className="text-xs" style={{ color: themeColors.text_muted }}>
            Signed in as <span style={{ color: themeColors.text_main }}>{session.username}</span>. Only admins can manage partners.
          </p>
        </GlassCard>
      )}

      {/* Admin form — full-featured inline panel */}
      {isAdmin && showForm && (
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="tinycaps text-sm font-bold" style={{ color: themeColors.text_main }}>
              {editingId ? "Edit Partner" : "Add New Partner"}
            </h3>
            <button onClick={() => { setShowForm(false); setErr(""); }} className="p-1 rounded-lg" style={{ color: themeColors.text_muted }}>
              <X size={16} />
            </button>
          </div>
          {err && <p className="text-xs px-3 py-2 rounded-lg" style={{ color: themeColors.danger, background: `${themeColors.danger}15` }}>{err}</p>}

          {/* Row 1: Name + IP + Port */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Server Name *</label>
              <GlassInput value={form.name} onChange={(v: any) => setForm({ ...form, name: v })} placeholder="MyAwesomeSMP" />
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>IP Address *</label>
              <GlassInput value={form.ip} onChange={(v: any) => setForm({ ...form, ip: v })} placeholder="play.example.com" />
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Port</label>
              <GlassInput value={form.port || ""} onChange={(v: any) => setForm({ ...form, port: v })} placeholder="25565" />
            </div>
          </div>

          {/* Row 2: Description */}
          <div>
            <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Full description, features, rules, game modes..." rows={3}
              className="w-full p-2.5 rounded-lg text-xs outline-none resize-none"
              style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}`, color: themeColors.text_main }} />
          </div>

          {/* Row 3: MC Version + Players + Tags */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>MC Version</label>
              <GlassInput value={form.version || ""} onChange={(v: any) => setForm({ ...form, version: v })} placeholder="1.21.4" />
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Players</label>
              <GlassInput value={form.players || ""} onChange={(v: any) => setForm({ ...form, players: v })} placeholder="e.g. 120/500" />
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Tags</label>
              <GlassInput value={form.tags || ""} onChange={(v: any) => setForm({ ...form, tags: v })} placeholder="smp, minigames, pvp" />
            </div>
          </div>

          {/* Row 4: Links */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Website URL</label>
              <GlassInput value={form.website || ""} onChange={(v: any) => setForm({ ...form, website: v })} placeholder="https://..." />
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Discord URL</label>
              <GlassInput value={form.discord || ""} onChange={(v: any) => setForm({ ...form, discord: v })} placeholder="discord.gg/..." />
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: themeColors.text_muted }}>Webstore URL</label>
              <GlassInput value={form.webstore || ""} onChange={(v: any) => setForm({ ...form, webstore: v })} placeholder="https://store..." />
            </div>
          </div>

          {/* Row 5: Logo + Banner */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-medium mb-1" style={{ color: themeColors.text_muted }}>
                Logo {form.logo && <span style={{ color: themeColors.success }}>(set)</span>}
              </p>
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" onChange={(e) => pickFile("logo", e.target.files?.[0])} className="text-xs" style={{ color: themeColors.text_muted }} />
                <GlassInput value={form.logo?.startsWith("data:") ? "" : form.logo || ""} onChange={(v: any) => setForm({ ...form, logo: v })} placeholder="...or image URL" className="flex-1" />
              </div>
              {form.logo && (
                <CachedImage src={form.logo} alt="" className="mt-2 h-12 rounded-lg object-cover" style={{ border: `1px solid ${themeColors.border}` }} />
              )}
            </div>
            <div>
              <p className="text-[11px] font-medium mb-1" style={{ color: themeColors.text_muted }}>
                Banner {form.banner && <span style={{ color: themeColors.success }}>(set)</span>}
              </p>
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" onChange={(e) => pickFile("banner", e.target.files?.[0])} className="text-xs" style={{ color: themeColors.text_muted }} />
                <GlassInput value={form.banner?.startsWith("data:") ? "" : form.banner || ""} onChange={(v: any) => setForm({ ...form, banner: v })} placeholder="...or image URL" className="flex-1" />
              </div>
              {form.banner && (
                <CachedImage src={form.banner} alt="" className="mt-2 h-12 rounded-lg object-cover" style={{ border: `1px solid ${themeColors.border}` }} />
              )}
            </div>
          </div>

          {/* Featured toggle + Save */}
          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: themeColors.text_main }}>
              <input type="checkbox" checked={!!form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
              <Star size={12} style={{ color: themeColors.warn }} /> Featured (pinned to top + homepage)
            </label>
            <GlowButton size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save Changes" : "Publish Partner"}
            </GlowButton>
          </div>
        </GlassCard>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => <div key={i} className="h-56 rounded-2xl animate-pulse" style={{ background: themeColors.bg_card }} />)}
        </div>
      ) : partners.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Award size={36} className="mx-auto mb-3 opacity-30" style={{ color: themeColors.text_muted }} />
          <p className="text-sm font-medium" style={{ color: themeColors.text_muted }}>No partner servers yet</p>
          <p className="text-xs mt-1" style={{ color: themeColors.text_muted, opacity: 0.6 }}>
            {isAdmin ? "Click \"Add Partner\" above to create the first partnership." : "Check back soon."}
          </p>
        </GlassCard>
      ) : (
        <>
          {/* Filter bar — no Become a Partner button */}
          <GlassCard className="p-3 flex items-center gap-2 flex-wrap">
            <GlassInput
              value={query}
              onChange={(v: any) => setQuery(v)}
              placeholder="Search partner servers"
              className="flex-1 min-w-[220px]"
            />
            {/* Custom Sort Dropdown */}
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-zinc-900/90 border border-white/10 text-xs font-semibold text-white hover:border-amber-500/40 transition-all min-w-[160px] outline-none"
              >
                <span>{sortBy === "recommended" ? "Recommended" : sortBy === "online" ? "Most players" : "Name (A-Z)"}</span>
                <ChevronDown size={14} className={`text-zinc-400 transition-transform duration-200 ${sortOpen ? "rotate-180" : ""}`} />
              </button>
              {sortOpen && (
                <div className="absolute right-0 mt-2 w-full min-w-[160px] rounded-xl bg-zinc-950/95 backdrop-blur-md border border-white/10 shadow-2xl overflow-hidden z-50 py-1">
                  {([
                    { value: "recommended", label: "Recommended" },
                    { value: "online", label: "Most players" },
                    { value: "name", label: "Name (A-Z)" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setSortBy(opt.value); setSortOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs transition-colors outline-none ${
                        sortBy === opt.value
                          ? "bg-amber-500/20 text-amber-400 font-semibold"
                          : "text-zinc-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </GlassCard>

          {/* Partner cards */}
          <div className="grid grid-cols-2 gap-4">
          {visiblePartners.map((p, i) => (
            <motion.div key={p.id || p.ip} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.06, 0.4) }}>
              <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/90 shadow-xl transition-all duration-300 hover:border-amber-500/50">

                {/* Server Banner Image / Fallback Header */}
                <div className="relative h-36 w-full overflow-hidden bg-zinc-950">
                  {p.banner ? (
                    <CachedImage
                      src={p.banner}
                      alt={p.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-r from-amber-950/40 via-zinc-900 to-zinc-950 flex items-center justify-center">
                      {/* Minecraft-style pixel grid pattern */}
                      <div className="absolute inset-0 opacity-[0.04]" style={{
                        backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                        backgroundSize: "16px 16px",
                      }} />
                      <div className="relative flex flex-col items-center gap-2">
                        <Server size={28} className="text-amber-500/30" />
                        <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-white/15 uppercase">Xryloth Partner</span>
                      </div>
                    </div>
                  )}
                  {/* Dark gradient overlay for smooth content transition */}
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-black/40" />
                  {/* Featured badge */}
                  {p.featured && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/20 backdrop-blur-md border border-amber-500/30">
                      <Star size={10} className="text-amber-400" />
                      <span className="text-[9px] font-bold text-amber-400">FEATURED</span>
                    </div>
                  )}
                </div>

                {/* Card Content */}
                <div className="flex flex-1 flex-col justify-between p-5 space-y-4 -mt-8 relative z-10">
                  {/* Logo + Name */}
                  <div className="flex items-start gap-4">
                    {p.logo ? (
                      <CachedImage src={p.logo} alt="" className="h-14 w-14 rounded-xl border-2 border-zinc-900 bg-zinc-950 object-cover shadow-lg shrink-0" />
                    ) : (
                      <div className="h-14 w-14 rounded-xl border-2 border-zinc-900 bg-zinc-950 flex items-center justify-center shadow-lg shrink-0">
                        <Server size={22} style={{ color: themeColors.accent }} />
                      </div>
                    )}
                    <div className="pt-2 min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-white truncate">{p.name}</h3>
                      <button onClick={() => copyIp(p)} className="text-[11px] font-mono flex items-center gap-1 mt-0.5 text-amber-400 hover:underline">
                        {p.port && p.port !== "25565" ? `${p.ip}:${p.port}` : p.ip}
                        {copied === (p.id || p.ip) ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">
                    {p.description || "No description provided."}
                  </p>

                  {/* Tags & Metadata */}
                  <div className="flex items-center gap-2 flex-wrap text-[10px] text-zinc-500">
                    {p.version && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">MC {p.version}</span>}
                    {p.tags?.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4).map((t) => (
                      <span key={t} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/5"><Tag size={9} />{t}</span>
                    ))}
                  </div>

                  {/* Live Status Strip */}
                  <StatusStrip p={p} st={statuses[p.id || p.ip]} themeColors={themeColors} />

                  {/* Footer: Links + Actions */}
                  <div className="flex items-center gap-3 pt-3 border-t border-white/5 flex-wrap text-[11px]">
                    {p.website
                      ? <a href={p.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-zinc-400 hover:text-amber-400 transition-colors"><Globe size={11} /> Website</a>
                      : <span className="flex items-center gap-1 text-zinc-600"><Globe size={11} /> No website</span>}
                    {p.discord
                      ? <a href={p.discord} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-zinc-400 hover:text-purple-400 transition-colors"><MessageCircle size={11} /> Discord</a>
                      : <span className="flex items-center gap-1 text-zinc-600"><MessageCircle size={11} /> No Discord</span>}
                    {p.webstore
                      ? <a href={p.webstore} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-zinc-400 hover:text-orange-400 transition-colors"><ShoppingBag size={11} /> Store</a>
                      : null}
                    <div className="flex-1" />
                    {/* Admin-only: Edit + Delete */}
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg text-zinc-500 hover:text-amber-400 hover:bg-white/5 transition-colors" title="Edit"><Pencil size={13} /></button>
                        <button onClick={async () => { if (p.id && await confirmDialog(`Remove "${p.name}"?`, "This will permanently remove this partner server from the list. This action cannot be undone.", { danger: true, confirmLabel: "Remove" })) { await removePartner(p.id); } }} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors" title="Remove"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
