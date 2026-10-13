import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import {
  Award, Plus, Trash2, Pencil, Copy, Check, Globe, MessageCircle,
  Server, Users, Tag, X, Star, ShoppingBag, Activity, Wifi, WifiOff,
} from "lucide-react";
import { fetchPartners, subscribePartners, addPartner, updatePartner, removePartner, type PartnerServer, fetchStatuses } from "../../lib/partners";
import { getSession, onSessionChanged, type XrylothSession } from "../../lib/auth";
import type { ServerStatus } from "../../lib/types";

const empty: Omit<PartnerServer, "id"> = {
  name: "", ip: "25565", port: "25565", description: "", version: "",
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

/** Live server status strip: online/offline, player count, version, latency.
 * Uses real data fetched from the partner server's IP. */
function StatusStrip({ p, st, themeColors }: { p: PartnerServer; st?: ServerStatus; themeColors: any }) {
  const checking = !st;
  const online = !!st?.online;
  const playersLive = st && (st.players_online || st.players_max) ? `${st.players_online}/${st.players_max} players` : "";
  const dispVersion = st?.version || p.version || "";
  return (
    <div className="flex items-center gap-2 mt-3 flex-wrap text-[10px]">
      <span
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold"
        style={{
          background: checking ? `${themeColors.accent}15` : online ? "#22c55e1f" : "#ef44441f",
          color: checking ? themeColors.text_muted : online ? "#22c55e" : "#ef4444",
          border: `1px solid ${checking ? themeColors.border : online ? "#22c55e55" : "#ef444455"}`,
        }}
      >
        {checking
          ? <><Activity size={10} className="animate-pulse" /> Checking…</>
          : online
            ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" style={{ boxShadow: "0 0 6px #22c55e" }} /> ONLINE</>
            : <><WifiOff size={10} /> OFFLINE</>}
      </span>
      {playersLive && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: `${themeColors.accent}12`, color: themeColors.text }}><Users size={10} /> {playersLive}</span>
      )}
      {online && st!.latency > 0 && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: `${themeColors.accent}12` }}><Wifi size={10} /> {st!.latency}ms</span>
      )}
      {dispVersion && (
        <span className="px-1.5 py-0.5 rounded" style={{ background: `${themeColors.bg_card2}`, color: themeColors.text_sub }}>v{dispVersion}</span>
      )}
      {online && st!.motd && (
        <span className="px-1.5 py-0.5 rounded max-w-[260px] truncate italic" style={{ background: `${themeColors.bg_card2}`, color: themeColors.text_muted }} title={st!.motd}>“{st!.motd}”</span>
      )}
    </div>
  );
}

export function PartnersPage() {
  const { themeColors, setPage } = useLauncherStore();
  const [partners, setPartners] = useState<PartnerServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<XrylothSession | null>(() => getSession());
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => onSessionChanged(setSession), []);

  // Live realtime sync with Firebase — the list updates instantly when anyone
  // (launcher admin, website admin dashboard, curl, etc.) adds/edits/removes.
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

  // Live server status polling: real player counts, online/offline, version.
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
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [partners]);

  const isAdmin = !!session?.isAdmin;

  const save = async () => {
    setErr("");
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
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
        {isAdmin && (
          <GlowButton size="sm" onClick={() => { setForm(empty); setEditingId(null); setShowForm(!showForm); }} className="flex items-center gap-1">
            {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "Close" : "Add Partner"}
          </GlowButton>
        )}
      </div>

      {!session && (
        <GlassCard className="p-4 flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs" style={{ color: themeColors.text_muted }}>Browsing as guest. Admins sign in to manage partners.</p>
          <GlowButton size="sm" onClick={() => setPage("accounts")}>Sign In</GlowButton>
        </GlassCard>
      )}

      {isAdmin && showForm && (
        <GlassCard className="p-5 space-y-3">
          <h3 className="tinycaps text-sm font-semibold" style={{ color: themeColors.text_main }}>
            {editingId ? "Edit Partner" : "New Partner"}
          </h3>
          {err && <p className="text-xs" style={{ color: themeColors.danger }}>{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <GlassInput value={form.name} onChange={(v: any) => setForm({ ...form, name: v })} placeholder="Server name *" />
            <div className="flex gap-2">
              <div className="flex-1"><GlassInput value={form.ip} onChange={(v: any) => setForm({ ...form, ip: v })} placeholder="IP address *" /></div>
              <div className="w-24"><GlassInput value={form.port || ""} onChange={(v: any) => setForm({ ...form, port: v })} placeholder="Port" /></div>
            </div>
          </div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Full description, features, rules..." rows={3}
            className="w-full p-2 rounded-lg text-xs outline-none"
            style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}`, color: themeColors.text_main }} />
          <div className="grid grid-cols-4 gap-3">
            <GlassInput value={form.version || ""} onChange={(v: any) => setForm({ ...form, version: v })} placeholder="MC version" />
            <GlassInput value={form.players || ""} onChange={(v: any) => setForm({ ...form, players: v })} placeholder="Players (e.g. 120/500)" />
            <GlassInput value={form.website || ""} onChange={(v: any) => setForm({ ...form, website: v })} placeholder="Website URL" />
            <GlassInput value={form.discord || ""} onChange={(v: any) => setForm({ ...form, discord: v })} placeholder="Discord URL" />
          </div>
          <GlassInput value={form.webstore || ""} onChange={(v: any) => setForm({ ...form, webstore: v })} placeholder="Webstore URL (ranks, coins, crates)" />
          <GlassInput value={form.tags || ""} onChange={(v: any) => setForm({ ...form, tags: v })} placeholder="Tags (comma separated: smp, minigames, pvp)" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] mb-1" style={{ color: themeColors.text_muted }}>Logo {form.logo && <span style={{ color: themeColors.success }}>(set)</span>}</p>
              <input type="file" accept="image/*" onChange={(e) => pickFile("logo", e.target.files?.[0])} className="text-xs" style={{ color: themeColors.text_muted }} />
              <GlassInput value={form.logo?.startsWith("data:") ? "" : form.logo || ""} onChange={(v: any) => setForm({ ...form, logo: v })} placeholder="...or logo image URL" />
            </div>
            <div>
              <p className="text-[11px] mb-1" style={{ color: themeColors.text_muted }}>Banner {form.banner && <span style={{ color: themeColors.success }}>(set)</span>}</p>
              <input type="file" accept="image/*" onChange={(e) => pickFile("banner", e.target.files?.[0])} className="text-xs" style={{ color: themeColors.text_muted }} />
              <GlassInput value={form.banner?.startsWith("data:") ? "" : form.banner || ""} onChange={(v: any) => setForm({ ...form, banner: v })} placeholder="...or banner image URL" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: themeColors.text_main }}>
            <input type="checkbox" checked={!!form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
            Featured partner (pinned to top + homepage)
          </label>
          <GlowButton size="sm" onClick={save} disabled={saving} className="flex items-center gap-1">
            {saving ? "Saving..." : editingId ? "Save Changes" : "Publish Partner"}
          </GlowButton>
        </GlassCard>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => <div key={i} className="h-56 rounded-2xl animate-pulse" style={{ background: themeColors.bg_card }} />)}
        </div>
      ) : partners.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Award size={36} className="mx-auto mb-3 opacity-30" style={{ color: themeColors.text_muted }} />
          <p className="text-sm font-medium" style={{ color: themeColors.text_muted }}>No partner servers yet</p>
          <p className="text-xs mt-1" style={{ color: themeColors.text_muted, opacity: 0.6 }}>
            {isAdmin ? "Add the first partnership above." : "Check back soon."}
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {partners.map((p, i) => (
            <motion.div key={p.id || p.ip} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.06, 0.4) }}>
              <GlassCard className="overflow-hidden">
                {p.banner ? (
                  <div className="h-28 -m-0 bg-cover bg-center" style={{ backgroundImage: `url(${p.banner})`, margin: "-1rem -1rem 0" }} />
                ) : (
                  <div className="h-16 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${themeColors.accent}18, transparent)`, margin: "-1rem -1rem 0" }}>
                    <Server size={24} style={{ color: themeColors.accent, opacity: 0.5 }} />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    {p.logo ? (
                      <img src={p.logo} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" style={{ border: `1px solid ${themeColors.border}` }} />
                    ) : (
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${themeColors.accent}15`, border: `1px solid ${themeColors.accent}25` }}>
                        <Server size={20} style={{ color: themeColors.accent }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold" style={{ color: themeColors.text_main }}>{p.name}</h3>
                        {p.featured && <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${themeColors.warn}18`, color: themeColors.warn }}><Star size={9} /> FEATURED</span>}
                      </div>
                      <button onClick={() => copyIp(p)} className="text-[11px] font-mono flex items-center gap-1 mt-0.5 hover:underline" style={{ color: themeColors.accent }}>
                        {p.port && p.port !== "25565" ? `${p.ip}:${p.port}` : p.ip}
                        {copied === (p.id || p.ip) ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                  {p.description && <p className="text-xs mt-3 leading-relaxed line-clamp-3" style={{ color: themeColors.text_sub }}>{p.description}</p>}
                  <div className="flex items-center gap-2 mt-3 flex-wrap text-[10px]" style={{ color: themeColors.text_muted }}>
                    {p.version && <span className="px-1.5 py-0.5 rounded" style={{ background: `${themeColors.accent}12` }}>MC {p.version}</span>}
                    {p.players && <span className="flex items-center gap-1"><Users size={10} /> {p.players}</span>}
                    {p.tags?.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3).map((t) => (
                      <span key={t} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded" style={{ background: themeColors.bg_card2 }}><Tag size={9} />{t}</span>
                    ))}
                  </div>
                  {/* Live server status — real data from the partner server's IP */}
                  <StatusStrip p={p} st={statuses[p.id || p.ip]} themeColors={themeColors} />
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {p.website
                      ? <a href={p.website} target="_blank" rel="noreferrer" className="text-[11px] flex items-center gap-1 hover:underline" style={{ color: themeColors.accent }}><Globe size={11} /> Website</a>
                      : <span className="text-[11px] flex items-center gap-1" style={{ color: themeColors.text_muted, opacity: 0.55 }}><Globe size={11} /> Website: link not provided</span>}
                    {p.discord
                      ? <a href={p.discord} target="_blank" rel="noreferrer" className="text-[11px] flex items-center gap-1 hover:underline" style={{ color: themeColors.purple }}><MessageCircle size={11} /> Discord</a>
                      : <span className="text-[11px] flex items-center gap-1" style={{ color: themeColors.text_muted, opacity: 0.55 }}><MessageCircle size={11} /> Discord: link not provided</span>}
                    {p.webstore
                      ? <a href={p.webstore} target="_blank" rel="noreferrer" className="text-[11px] flex items-center gap-1 hover:underline" style={{ color: themeColors.warn }}><ShoppingBag size={11} /> Webstore</a>
                      : <span className="text-[11px] flex items-center gap-1" style={{ color: themeColors.text_muted, opacity: 0.55 }}><ShoppingBag size={11} /> Webstore: link not provided</span>}
                    <div className="flex-1" />
                    {isAdmin && (
                      <>
                        <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg" style={{ color: themeColors.accent }} title="Edit"><Pencil size={13} /></button>
                        <button onClick={async () => { if (p.id && confirm(`Remove "${p.name}"?`)) { await removePartner(p.id); } }} className="p-1.5 rounded-lg" style={{ color: themeColors.danger }} title="Remove"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
