"use client";

import { CachedImage } from "../ui/CachedImage";
import React, { useState, useMemo, useEffect } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { Play, ChevronDown, Check, Newspaper, Users, ExternalLink, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SteveModel } from "../ui/SteveModel";
import { subscribeToOnlineUsers, type ChatUser } from "../../lib/chatService";
import type { NewsItem } from "../../lib/types";

/* ------------------------------------------------------------------ utils */
function mcId(uuid?: string) {
  const t = (uuid || "").replace(/-/g, "");
  return t.length === 32 ? t : "8660ba3e76424a96b46f0b738fcc8806";
}
function avatarUrl(uuid?: string) {
  return `https://mc-heads.net/avatar/${mcId(uuid)}?size=64`;
}
function timeAgo(iso?: string) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (isNaN(s) || s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
function fmtPlay(min: number) {
  if (!min) return "0m";
  if (min < 60) return `${Math.floor(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
function prettyLoader(l?: string) {
  if (!l) return "Vanilla";
  const t = l.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* =========================================================== HERO SECTION */
export function HeroSection() {
  const instances = useLauncherStore((s) => s.instances);
  const playTimes = useLauncherStore((s) => s.playTimes);
  const setPage = useLauncherStore((s) => s.setPage);

  const [launchTarget, setLaunchTarget] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Left graphic chain: vector Steve SVG (primary, local bundle) → PNG
  // render → live 3D SteveModel, so the hero never ends up empty.
  const [steveSrc, setSteveSrc] = useState<string>("/assets/steve-vector.svg");
  const [steveRenderFailed, setSteveRenderFailed] = useState(false);

  const installed = useMemo(
    () => instances.filter((x: any) => x.installed),
    [instances]
  );
  const recent = useMemo(
    () =>
      [...installed].sort(
        (x: any, y: any) =>
          (y.last_played ? new Date(y.last_played).getTime() : 0) -
          (x.last_played ? new Date(x.last_played).getTime() : 0)
      ),
    [installed]
  );
  const totalH = useMemo(
    () =>
      Math.floor(
        Object.values(playTimes).reduce((m: number, v: any) => m + (v || 0), 0) / 60
      ),
    [playTimes]
  );

  const selected = recent.find((x: any) => x.name === launchTarget) || recent[0];

  const launch = (name: string) => {
    const inst = installed.find((x: any) => x.name === name);
    window.dispatchEvent(
      new CustomEvent("ec-launch-game", {
        detail: { instanceName: name, version: inst?.version || "", loader: inst?.loader || "" },
      })
    );
  };

  const hour = new Date().getHours();
  const greet =
    hour < 6
      ? "burning the midnight oil"
      : hour < 12
      ? "good morning"
      : hour < 17
      ? "good afternoon"
      : hour < 21
      ? "good evening"
      : "good night";

  const username =
    (useLauncherStore.getState().settings as any)?.username ||
    (useLauncherStore.getState().settings as any)?.cracked_username ||
    (useLauncherStore.getState().settings as any)?.ely_by_username ||
    "Player";

  const versionLabel = selected
    ? `${selected.version}-${prettyLoader(selected.loader)}`
    : null;

  return (
    <section className="space-y-4">
      {/* ==================== HERO STAGE ==================== */}
      <div className="relative w-full min-h-[480px] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-zinc-950 via-zinc-900/80 to-zinc-950 px-8 py-10 md:px-12 shadow-[0_0_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl hover:border-amber-500/40 transition-all duration-500 grid grid-cols-1 lg:grid-cols-12 items-center gap-8">
        {/* Bottom vignette so text/buttons stay readable over the model */}
        <div className="absolute inset-x-0 bottom-0 z-0 h-56 bg-gradient-to-t from-black via-black/70 to-transparent pointer-events-none" />
        {/* Top subtle fade for the pill */}
        <div className="absolute inset-x-0 top-0 z-0 h-24 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />

        {/* Inner amber border glow — subtle lit-from-within edge */}
        <div className="absolute inset-0 z-0 rounded-3xl pointer-events-none ring-1 ring-inset ring-amber-500/10" />

        {/* Ambient floating orbs — cheap radial gradients (no CSS blur filter,
            GPU-friendly per the blur budget) for immersive depth */}
        <div
          className="absolute -left-10 top-1/2 -translate-y-1/2 z-0 w-96 h-96 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(224,107,34,0.18) 0%, rgba(224,107,34,0.06) 45%, transparent 70%)",
          }}
        />
        <div
          className="absolute right-10 bottom-0 z-0 w-80 h-80 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(234,88,12,0.14) 0%, rgba(234,88,12,0.05) 45%, transparent 70%)",
          }}
        />

        {/* Steve render — dedicated left grid column (lg:col-span-4).
            Natural flow positioning (no absolute / negative-margin hacks),
            so the figure never clips the card border. Chain:
            /assets/steve-vector.svg → PNG render → live 3D SteveModel. */}
        <div className="hidden lg:flex lg:col-span-4 relative h-full items-end justify-center pointer-events-none">
          {/* Soft amber glow behind the model (radial gradient = GPU cheap) */}
          <div
            className="absolute inset-x-6 inset-y-2 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(224,107,34,0.16) 0%, rgba(224,107,34,0.05) 45%, transparent 70%)",
            }}
          />
          {steveRenderFailed ? (
            <div className="relative z-20 w-48 h-[340px] opacity-95 filter drop-shadow-[0_20px_30px_rgba(0,0,0,0.9)]">
              <SteveModel className="absolute inset-0" />
            </div>
          ) : (
            <img
              src={steveSrc}
              alt="Steve"
              className="relative z-20 h-[340px] w-auto object-contain opacity-95 select-none pointer-events-auto filter drop-shadow-[0_20px_30px_rgba(0,0,0,0.9)] hover:scale-105 transition-transform duration-500"
              onError={() => {
                // SVG → PNG render → 3D model (never both fails silently)
                if (steveSrc.endsWith(".svg")) setSteveSrc("/assets/steve-render.png");
                else setSteveRenderFailed(true);
              }}
            />
          )}
        </div>

        {/* Right: launch content column (lg:col-span-8) — profile badge,
            greeting, LAUNCH button and instance cards */}
        <div className="relative z-10 lg:col-span-8 flex flex-col items-center lg:items-start justify-center gap-5 w-full max-w-lg mx-auto lg:mx-0 text-center lg:text-left">
        {/* User badge — glass pill with pulsing presence dot */}
        <div className="flex items-center justify-center lg:justify-start w-full">
          <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-zinc-900/90 border border-white/10 text-xs text-zinc-300 shadow-inner backdrop-blur-md">
            <CachedImage
              src={avatarUrl(username)}
              alt=""
              className="w-6 h-6 rounded-full border border-white/15 bg-[#161922]"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
            <span className="font-mono text-[11px] text-white tracking-wider">
              {username}
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
          </div>
        </div>

        {/* Greeting block — crisp hierarchy: mono uppercase greeting, bold
            gradient username (kept modest), clean status line */}
        <div className="flex flex-col items-center lg:items-start gap-1 text-center lg:text-left w-full max-w-md">
          <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-amber-400">
            {greet.charAt(0).toUpperCase() + greet.slice(1)},
          </p>
          <h1 className="text-xl font-black tracking-wide bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)]">
            {username}
          </h1>
          <p className="text-xs text-zinc-500 font-mono drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">
            {recent.length} profile{recent.length !== 1 ? "s" : ""} ready to launch
            {totalH > 0 ? ` · ${totalH}h played` : ""}
          </p>
        </div>

        {/* Launch cluster — status chip, split LAUNCH button, cards */}
        <div className="relative w-full max-w-md flex flex-col items-center lg:items-start gap-3">
          {/* Status chip */}
          <div className="bg-black/55 border border-white/10 rounded-full px-4 py-1 text-[11px] text-zinc-300 flex items-center justify-center gap-2 backdrop-blur-sm">
            {recent.length === 0 ? (
              <>
                <span className="text-[10px]">⚠</span>
                No profiles installed — create one in Profiles
              </>
            ) : (
              <>
                <span className="text-[10px]">💾</span>
                {selected?.name ? `${selected.name} — ` : ""}
                {totalH > 0 ? `${totalH}h played · ready` : "ready to launch"}
              </>
            )}
          </div>

          {/* Split LAUNCH GAME button — glow shadow that intensifies on hover */}
          <div className="relative w-full">
            <div className="rounded-xl overflow-hidden shadow-[0_12px_34px_rgba(234,88,12,0.38),0_4px_10px_rgba(224,107,34,0.28)] hover:shadow-[0_16px_44px_rgba(234,88,12,0.5),0_6px_16px_rgba(224,107,34,0.38)] flex border border-amber-400/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300">
              {/* Main action */}
              <button
                onClick={() => selected && launch(selected.name)}
                disabled={!selected}
                className="flex-1 py-4 px-6 flex flex-col items-center justify-center cursor-pointer transition
                  bg-gradient-to-r from-amber-700 via-amber-600 to-orange-600
                  hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play size={20} className="mb-1 text-amber-50 drop-shadow" />
                <span className="text-base font-black text-white uppercase tracking-[0.16em] drop-shadow">
                  LAUNCH GAME
                </span>
                <span className="mt-1 text-[10px] font-bold font-mono tracking-wider text-amber-100/95 bg-black/25 rounded-lg px-2.5 py-1">
                  {versionLabel || "No profile"}
                </span>
              </button>

              {/* Profile dropdown toggle */}
              <button
                onClick={() => setPickerOpen((v) => !v)}
                disabled={!recent.length}
                className="w-14 border-l border-amber-400/30 flex items-center justify-center cursor-pointer
                  bg-gradient-to-b from-orange-600 to-amber-700 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronDown
                  size={16}
                  className={`text-amber-50 shrink-0 transition-transform ${pickerOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {/* Profile dropdown */}
            <AnimatePresence>
              {pickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="absolute left-0 mt-2 w-full rounded-xl overflow-hidden z-50 border border-white/10 bg-[#0a0c0e]/95 backdrop-blur-xl shadow-2xl"
                >
                  <div className="max-h-60 overflow-y-auto py-1">
                    {recent.map((inst: any) => (
                      <button
                        key={inst.name}
                        onClick={() => { setLaunchTarget(inst.name); setPickerOpen(false); }}
                        className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-white/[0.06]"
                      >
                        <CachedImage
                          src={avatarUrl(inst.name)}
                          alt=""
                          className="w-6 h-6 rounded bg-[#161922] border border-white/10"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                          }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold truncate text-white">{inst.name}</span>
                          <span className="text-[9px] tinycaps text-zinc-500 truncate">
                            {prettyLoader(inst.loader)} · MC {inst.version}
                          </span>
                        </span>
                        {inst.name === selected?.name && <Check size={12} className="text-amber-500 shrink-0" />}
                      </button>
                    ))}
                    <button
                      onClick={() => { setPickerOpen(false); setPage("profiles"); }}
                      className="w-full text-left px-3 py-2 text-[10px] font-bold tinycaps text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white border-t border-white/10"
                    >
                      + Manage Profiles
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Quick profile selector cards */}
          <div className="w-full">
            <div className="flex items-stretch gap-2 w-full overflow-x-auto pb-1 scrollbar-hide">
              {recent.slice(0, 4).map((inst: any) => {
                const mins = (playTimes as any)[inst.name] || 0;
                const active = inst.name === selected?.name;
                return (
                  <button
                    key={inst.name}
                    onClick={() => setLaunchTarget(inst.name)}
                    className={`flex-1 min-w-[132px] rounded-xl p-2.5 text-left transition-all duration-300 border shadow-sm
                      ${active
                        ? "bg-amber-500/10 border-amber-500/50 shadow-[0_0_18px_rgba(224,107,34,0.18)]"
                        : "bg-black/45 border-white/15 hover:bg-white/[0.07] hover:border-amber-400/40 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <CachedImage
                        src={avatarUrl(inst.name)}
                        alt=""
                        className={`w-8 h-8 rounded-lg border ${active ? "border-amber-400/50" : "border-white/10"} bg-[#161922]`}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className={`text-[11px] font-bold truncate ${active ? "text-amber-300" : "text-white"}`}>
                          {inst.name}
                        </div>
                        <div className="mt-0.5 inline-block max-w-full truncate text-[9px] font-mono text-zinc-400 bg-black/40 border border-white/10 rounded px-1.5 py-0.5">
                          {inst.version}-{prettyLoader(inst.loader)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[9px] text-zinc-500">
                      <span className="flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        {fmtPlay(mins)}
                      </span>
                      {active && (
                        <span className="text-[8px] font-black tracking-widest text-amber-400">SELECTED</span>
                      )}
                    </div>
                  </button>
                );
              })}
              {/* Add-profile card */}
              <button
                onClick={() => setPage("profiles")}
                className="min-w-[120px] rounded-xl p-2.5 flex flex-col items-center justify-center gap-1
                  bg-white/[0.03] border-2 border-dashed border-white/15 hover:bg-white/[0.07] hover:border-amber-500/40 hover:-translate-y-0.5 transition-all duration-300"
              >
                <span className="text-lg font-bold text-zinc-500 leading-none group-hover:text-amber-400">+</span>
                <span className="text-[10px] font-bold text-zinc-400">Add Profile</span>
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ BOTTOM GRID */
const NEWS_FALLBACK: NewsItem[] = [
  {
    title: "Xryloth Client Update",
    url: "https://github.com/EscapeXMc/Xryloth/releases/latest",
    date: new Date().toISOString(),
    type: "RELEASE",
  },
  {
    title: "Join our community",
    url: "https://discord.gg/",
    date: new Date().toISOString(),
    type: "COMMUNITY",
  },
];

export function BottomGrid() {
  const setPage = useLauncherStore((s) => s.setPage);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [friends, setFriends] = useState<ChatUser[]>([]);

  /* Real Minecraft news — enhanced feed first, plain feed as fallback. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const items = await api.news.getEnhanced().catch(() => api.news.get());
        if (!alive) return;
        const list = Array.isArray(items) ? items.filter((n) => n?.title) : [];
        setNews(list.slice(0, 4));
      } catch {
        if (alive) setNews(NEWS_FALLBACK);
      }
    })();
    return () => { alive = false; };
  }, []);

  /* Live friends presence. */
  useEffect(() => {
    const unsub = subscribeToOnlineUsers((users) => setFriends(users || []));
    return () => { try { unsub(); } catch { /* noop */ } };
  }, []);

  const onlineFriends = friends.filter((f) => f.status === "online");
  const shownNews = news.length ? news : NEWS_FALLBACK;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* ---------- Latest News (banner cards, glowing borders) ---------- */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <p className="tinycaps text-[10px] font-bold tracking-wider text-zinc-400 truncate flex items-center gap-1.5">
            <Newspaper size={12} /> Latest News
          </p>
          <button
            onClick={() => setPage("announcements")}
            className="text-[10px] font-bold text-zinc-400 hover:text-amber-400 transition-colors flex items-center gap-1"
          >
            All News <ExternalLink size={10} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {shownNews.map((item, i) => {
            // Rust enhanced feed uses `image`; be forgiving about alternates.
            const art =
              (item as any).image || (item as any).imageUrl || (item as any).banner || "";
            const category = (item as any).type || (item as any).category || "NEWS";
            return (
              <a
                key={`${item.url}-${i}`}
                href={item.url || "#"}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!item.url) e.preventDefault();
                }}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/90 shadow-lg hover:border-amber-500/40 transition-all duration-300 hover:shadow-[0_0_26px_rgba(224,107,34,0.22)]"
              >
                {/* ---------- Thumbnail container (h-40) ---------- */}
                <div className="relative h-40 w-full overflow-hidden bg-zinc-950">
                  {/* Ambient Minecraft-themed gradient + pixel grid — ALWAYS
                      rendered underneath so a missing/broken image never
                      leaves a black box. */}
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-950/40 via-zinc-900 to-zinc-950 flex items-center justify-center">
                    <div
                      className="absolute inset-0 opacity-[0.05]"
                      style={{
                        backgroundImage:
                          "linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)",
                        backgroundSize: "16px 16px",
                      }}
                    />
                    <span className="relative text-xs font-mono text-amber-500/60 uppercase tracking-widest">
                      {category}
                    </span>
                  </div>

                  {/* News artwork on top; hides itself if it fails to load,
                      revealing the ambient gradient below. */}
                  {art && (
                    <CachedImage
                      src={art}
                      alt={item.title}
                      className="relative h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}

                  {/* legibility overlay + accent streak */}
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-black/40 pointer-events-none" />
                  <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-amber-600/80 via-orange-500/60 to-transparent pointer-events-none" />

                  {/* Category pill */}
                  <div className="absolute top-3 left-3 z-10">
                    <span className="rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-amber-400 border border-amber-500/30 backdrop-blur-md uppercase tracking-wider">
                      {category}
                    </span>
                  </div>
                  {item.date && (
                    <span className="absolute top-3 right-3 z-10 text-[9px] font-mono text-zinc-300 bg-black/60 rounded-full px-2 py-1 backdrop-blur-md">
                      {timeAgo(item.date)}
                    </span>
                  )}
                </div>

                {/* ---------- Content body ---------- */}
                <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
                  <h3 className="text-sm font-bold text-white leading-snug line-clamp-2 group-hover:text-amber-400 transition-colors">
                    {item.title}
                  </h3>
                  <div className="flex items-center justify-between text-xs text-zinc-400 pt-2 border-t border-white/5">
                    <span>{item.date ? timeAgo(item.date) : "Recent"}</span>
                    <span className="text-amber-400 group-hover:underline">
                      Read more ↗
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* ---------------------- Friends (live presence) ------------------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="tinycaps text-[10px] font-bold tracking-wider text-zinc-400 truncate flex items-center gap-1.5">
            <Users size={12} /> Friends
          </p>
          <button
            onClick={() => setPage("chat")}
            className="text-[10px] font-bold text-zinc-400 hover:text-amber-400 transition-colors"
          >
            Open Chat
          </button>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#13161C]/90 p-2 space-y-1 max-h-[220px] overflow-y-auto">
          {onlineFriends.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-3 text-zinc-500">
              <span className="w-2 h-2 rounded-full bg-zinc-600" />
              <span className="text-[11px] truncate">No friends online</span>
            </div>
          ) : (
            onlineFriends.slice(0, 8).map((f) => (
              <div
                key={f.uid || f.username}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
              >
                {f.photoURL ? (
                  <CachedImage src={f.photoURL} alt="" className="w-6 h-6 rounded-full border border-white/10" />
                ) : (
                  <CachedImage src={avatarUrl(f.mcUsername || f.username)} alt="" className="w-6 h-6 rounded-full border border-white/10" />
                )}
                <span className="flex-1 min-w-0 text-[11px] font-medium text-zinc-200 truncate">
                  {f.displayName || f.username}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              </div>
            ))
          )}
        </div>

        {/* Discord / Store teaser moved to right hub — this stays a compact hint */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 text-[10px] text-zinc-400">
          <Sparkles size={12} className="text-amber-400 shrink-0" />
          <span className="truncate">Partner servers & quick links live in the side panel →</span>
        </div>
      </div>
    </div>
  );
}
