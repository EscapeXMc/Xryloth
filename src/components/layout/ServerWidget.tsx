"use client";

import { CachedImage } from "../ui/CachedImage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLauncherStore } from "../../stores";
import {
  Users,
  Copy,
  RefreshCcw,
  MessageCircle,
  ShoppingBag,
  Globe,
  Signal,
  Server,
} from "lucide-react";
import { GlowButton } from "../ui/GlowButton";
import { useToast } from "../ui/Toast";
import {
  subscribePartners,
  fetchStatuses,
  type PartnerServer,
} from "../../lib/partners";
import type { ServerStatus } from "../../lib/types";

/* Join flow: the parent shell owns navigation; we just report intent. */
export interface ServerWidgetProps {
  onJoin?: (address: string, port: number) => void;
}

/** Build the copy-able address — never double-append the port. */
function joinAddress(p: PartnerServer): { address: string; port: number } {
  const host = (p.ip || "").trim().replace(/\/+$/, "");
  const port = Number(p.port || 25565) || 25565;
  if (host.includes(":")) return { address: host, port };
  return { address: port === 25565 ? host : `${host}:${port}`, port };
}

/** Resolve a usable image/link source.
 *
 * Partner logos/banners are frequently stored as `data:image/...;base64,...`
 * data URLs (uploaded through the Partners page file picker). Those MUST be
 * passed through untouched — prefixing them with `https://` (what we used to
 * do) produces a broken URL and a blank box. Only bare hostnames get the
 * `https://` prefix.
 */
function safeUrl(u?: string): string | null {
  if (!u) return null;
  const t = u.trim();
  if (!t) return null;
  if (/^(https?:|data:|blob:)/i.test(t)) return t; // http(s), data URL, blob
  return `https://${t}`;
}

/** Public mcsrvstat.us icon endpoint — last-resort server icon. */
function pingIconUrl(address: string): string {
  return `https://api.mcsrvstat.us/icon/${encodeURIComponent(address)}`;
}

function StatusPing({ online, checking }: { online: boolean; checking?: boolean }) {
  if (checking) {
    return (
      <span className="relative flex items-center justify-center w-2 h-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      </span>
    );
  }
  return (
    <span className="relative flex items-center w-2 h-2">
      <span
        className={`absolute inline-flex w-full h-full rounded-full opacity-60 ${
          online ? "bg-emerald-400 animate-ping" : "bg-zinc-600"
        }`}
      />
      <span
        className={`relative inline-flex w-2 h-2 rounded-full ${
          online ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-zinc-600"
        }`}
      />
    </span>
  );
}

/** Server icon with a 3-step fallback chain:
 *   1. partner's custom logo (data URL or https)
 *   2. icon returned by the live status ping (mcsrvstat data URL)
 *   3. https://api.mcsrvstat.us/icon/<address>
 * If every step fails we reveal the default letter avatar rendered behind it. */
function PartnerLogo({
  p,
  pingIcon,
  address,
}: {
  p: PartnerServer;
  pingIcon?: string;
  address: string;
}) {
  const chain = React.useMemo(
    () => [safeUrl(p.logo), safeUrl(pingIcon), pingIconUrl(address)].filter(
      (x): x is string => !!x
    ),
    [p.logo, pingIcon, address]
  );
  const [step, setStep] = React.useState(0);
  const src = chain[step];

  return (
    <div className="relative w-7 h-7 rounded-lg border border-white/15 bg-black/50 overflow-hidden shrink-0">
      {/* default letter avatar sits underneath — shown if the img chain dies */}
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-amber-400">
        {(p.name || "?").charAt(0).toUpperCase()}
      </span>
      {src && (
        <CachedImage
          key={src}
          src={src}
          alt={p.name || "server"}
          className="relative w-full h-full object-cover"
          onError={() => setStep((s) => s + 1)} // advance to next fallback
        />
      )}
    </div>
  );
}

/**
 * ServerWidget — right-hub panel (Partner Servers + Discord/Store).
 *
 * NOTE: this component no longer renders its own `aside w-80` — the global
 * 3-column shell (MainLayoutShell) already owns the width; this just fills it
 * and scrolls internally.
 */
export function ServerWidget({ onJoin }: ServerWidgetProps) {
  const themeColors = useLauncherStore((s) => s.themeColors);
  const setPage = useLauncherStore((s) => s.setPage);
  const settings = useLauncherStore((s) => s.settings);
  const { toast } = useToast();

  const [partners, setPartners] = useState<PartnerServer[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---------------- live partner list (Firebase realtime via Rust) ------- */
  useEffect(() => {
    const unsub = subscribePartners((list) => {
      setPartners(Array.isArray(list) ? list : []);
    });
    return () => {
      try { unsub(); } catch { /* noop */ }
    };
  }, []);

  /* ---------------- live status polling (mcsrvstat.us via Rust) --------- */
  const refreshStatuses = useCallback(async (list: PartnerServer[]) => {
    if (!list.length) return;
    setChecking(true);
    const next: Record<string, ServerStatus> = {};
    await Promise.all(
      list.map(async (p) => {
        const key = p.id || p.name;
        try {
          next[key] = await fetchStatuses(p.ip, String(p.port || "25565"));
        } catch {
          next[key] = {
            online: false, host: p.ip, port: String(p.port || "25565"),
            version: "", players_online: 0, players_max: 0, motd: "", icon: "", latency: 0,
          };
        }
      })
    );
    setStatuses(next);
    setChecking(false);
  }, []);

  useEffect(() => {
    refreshStatuses(partners);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => refreshStatuses(partners), 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners]);

  /* --------------------------------- actions ---------------------------- */
  const copyIp = async (p: PartnerServer) => {
    const { address } = joinAddress(p);
    try {
      const { writeText } = await import("@tauri-apps/api/clipboard");
      await writeText(address);
      toast("success", "Address copied", `${address} is in your clipboard.`, 3000);
    } catch {
      try {
        await navigator.clipboard.writeText(address);
        toast("success", "Address copied", `${address} is in your clipboard.`, 3000);
      } catch {
        toast("error", "Copy failed", "Clipboard is not available right now.", 4000);
      }
    }
  };

  const join = (p: PartnerServer) => {
    const { address, port } = joinAddress(p);
    if (onJoin) onJoin(address, port);
    else setPage("partners");
  };

  const openExternal = async (url: string | null, fallbackPage: string) => {
    if (!url) {
      setPage(fallbackPage);
      return;
    }
    try {
      const { open } = await import("@tauri-apps/api/shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const discordUrl = safeUrl((settings as any)?.discord_url);
  const storeUrl = safeUrl((settings as any)?.webstore_url);

  const totalOnline = useMemo(
    () =>
      partners.reduce((m, p) => {
        const s = statuses[p.id || p.name];
        return m + (s?.online ? s.players_online || 0 : 0);
      }, 0),
    [partners, statuses]
  );

  /* --------------------------------- render ----------------------------- */
  const panel = "rounded-xl border border-white/10 bg-[#13161C]/90 overflow-hidden";

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* ================= PARTNER SERVERS ================= */}
      <div className="flex flex-col min-h-0 flex-1">
        <div className="flex items-center justify-between mb-2 px-0.5">
          <p className="tinycaps text-[10px] font-bold tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Server size={12} /> Partner Servers
          </p>
          <div className="flex items-center gap-2">
            {partners.length > 0 && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5">
                <Users size={9} /> {totalOnline}
              </span>
            )}
            <button
              onClick={() => refreshStatuses(partners)}
              disabled={checking}
              title="Refresh status"
              className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-white/5 transition disabled:opacity-50"
            >
              <RefreshCcw size={11} className={checking ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-2.5 scrollbar-hide">
          {partners.length === 0 ? (
            <div className={`${panel} px-3 py-4 text-center`}>
              <Signal size={16} className="mx-auto text-zinc-600 mb-1.5" />
              <p className="text-[11px] text-zinc-500">No partner servers yet</p>
              <button
                onClick={() => setPage("partners")}
                className="mt-1 text-[10px] font-bold text-amber-400 hover:text-amber-300"
              >
                Explore partners →
              </button>
            </div>
          ) : (
            partners.map((p) => {
              const key = p.id || p.name;
              const st = statuses[key];
              const online = !!st?.online;
              const banner = safeUrl(p.banner);

              return (
                <div key={key} className={`${panel} group`}>
                  {/* mini banner — gradient always sits behind the image so a
                      failed/missing load never leaves a black box */}
                  <div className="relative h-14 overflow-hidden">
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(120deg, #171310 0%, #221a12 50%, #101318 100%)",
                      }}
                    />
                    {/* Minecraft-style pixel grid, mirrors the Partners page */}
                    <div
                      className="absolute inset-0 opacity-[0.05]"
                      style={{
                        backgroundImage:
                          "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
                        backgroundSize: "12px 12px",
                      }}
                    />
                    {banner && (
                      <CachedImage
                        src={banner}
                        alt=""
                        className="relative w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#13161C] via-[#13161C]/35 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-amber-600/70 to-transparent" />

                    {/* logo + name over the banner */}
                    <div className="absolute left-2.5 bottom-2 flex items-center gap-2 min-w-0">
                      <PartnerLogo p={p} pingIcon={st?.icon} address={joinAddress(p).address} />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-white truncate leading-tight drop-shadow">
                          {p.name}
                        </p>
                        {p.version && (
                          <p className="text-[8px] font-mono text-zinc-400 truncate">MC {p.version}</p>
                        )}
                      </div>
                    </div>

                    {/* status ping + player badge */}
                    <div className="absolute right-2 top-2 flex items-center gap-1.5">
                      {online && (
                        <span className="text-[8px] font-black font-mono tracking-wider text-emerald-300 bg-black/65 border border-emerald-500/25 rounded-full px-1.5 py-0.5 flex items-center gap-1">
                          <Users size={8} />
                          {st?.players_online ?? 0}/{st?.players_max ?? "?"}
                        </span>
                      )}
                      <span className="bg-black/65 border border-white/10 rounded-full p-1 backdrop-blur-sm">
                        <StatusPing online={online} checking={checking && !st} />
                      </span>
                    </div>
                  </div>

                  {/* body */}
                  <div className="p-2.5 space-y-2">
                    {p.description && (
                      <p className="text-[10px] text-zinc-400 leading-snug line-clamp-2">
                        {p.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-[9px] font-mono text-zinc-500 truncate bg-black/30 border border-white/5 rounded px-1.5 py-0.5">
                          {joinAddress(p).address}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => copyIp(p)}
                          title="Copy IP"
                          className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/5 transition"
                        >
                          <Copy size={11} />
                        </button>
                        <GlowButton size="sm" onClick={() => join(p)} className="px-2.5 py-1 text-[10px]">
                          Join
                        </GlowButton>
                      </div>
                    </div>

                    {/* per-server quick links */}
                    {(p.discord || p.webstore || p.website) && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {safeUrl(p.discord) && (
                          <button
                            onClick={() => openExternal(safeUrl(p.discord)!, "chat")}
                            className="flex items-center gap-1 text-[9px] font-bold text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 rounded-md px-1.5 py-1 transition"
                          >
                            <MessageCircle size={9} /> Discord
                          </button>
                        )}
                        {safeUrl(p.webstore) && (
                          <button
                            onClick={() => openExternal(safeUrl(p.webstore)!, "mods")}
                            className="flex items-center gap-1 text-[9px] font-bold text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 rounded-md px-1.5 py-1 transition"
                          >
                            <ShoppingBag size={9} /> Store
                          </button>
                        )}
                        {safeUrl(p.website) && (
                          <button
                            onClick={() => openExternal(safeUrl(p.website)!, "partners")}
                            className="flex items-center gap-1 text-[9px] font-bold text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 rounded-md px-1.5 py-1 transition"
                          >
                            <Globe size={9} /> Site
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ================= QUICK PANELS: DISCORD / STORE ================= */}
      <div className="grid grid-cols-1 gap-2.5 shrink-0">
        {/* Discord */}
        <button
          onClick={() => openExternal(discordUrl, "chat")}
          className={`${panel} px-3 py-2.5 flex items-center gap-2.5 text-left transition-all hover:border-indigo-400/40 hover:shadow-[0_0_20px_rgba(99,102,241,0.15)] group`}
          style={{ background: "linear-gradient(120deg, rgba(88,101,242,0.12) 0%, rgba(19,22,28,0.9) 70%)" }}
        >
          <div className="w-8 h-8 rounded-lg bg-[#5865F2]/20 border border-[#5865F2]/30 flex items-center justify-center shrink-0 group-hover:bg-[#5865F2]/30 transition">
            <MessageCircle size={15} className="text-[#8b96ff]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-white">Discord</p>
            <p className="text-[9px] text-zinc-500 truncate">Chat, support & giveaways</p>
          </div>
          <span className="text-[9px] font-black text-zinc-600 group-hover:text-indigo-400 transition">→</span>
        </button>

        {/* Store */}
        <button
          onClick={() => openExternal(storeUrl, "mods")}
          className={`${panel} px-3 py-2.5 flex items-center gap-2.5 text-left transition-all hover:border-amber-400/40 hover:shadow-[0_0_20px_rgba(224,107,34,0.15)] group`}
          style={{ background: "linear-gradient(120deg, rgba(224,107,34,0.12) 0%, rgba(19,22,28,0.9) 70%)" }}
        >
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 group-hover:bg-amber-500/25 transition">
            <ShoppingBag size={15} className="text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-white">Xryloth Store</p>
            <p className="text-[9px] text-zinc-500 truncate">Mods, packs & cosmetics</p>
          </div>
          <span className="text-[9px] font-black text-zinc-600 group-hover:text-amber-400 transition">→</span>
        </button>
      </div>

      {/* tiny theme-safe note so unused themeColors doesn't break lint */}
      <span className="sr-only" style={{ color: themeColors.text_muted }}>
        server widget
      </span>
    </div>
  );
}
