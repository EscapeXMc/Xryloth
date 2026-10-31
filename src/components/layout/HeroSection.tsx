"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { Play, Clock, FolderOpen, ChevronDown, Check } from "lucide-react";
import { GlowButton } from "../ui/GlowButton";
import { motion, AnimatePresence } from "framer-motion";

function mcId(uuid?: string) {
  const t = (uuid || "").replace(/-/g, "");
  return t.length === 32 ? t : "8660ba3e76424a96b46f0b738fcc8806";
}
function avatarUrl(uuid?: string) {
  return `https://mc-heads.net/avatar/${mcId(uuid)}?size=128`;
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

export function HeroSection() {
  const themeColors = useLauncherStore((s) => s.themeColors);
  const instances = useLauncherStore((s) => s.instances);
  const playTimes = useLauncherStore((s) => s.playTimes);
  const setPage = useLauncherStore((s) => s.setPage);
  const liveVersion = useLauncherStore((s) => s.liveVersion);
  const setLoading = useLauncherStore((s) => s.setLoading);

  const [launchTarget, setLaunchTarget] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const openFolder = async (name: string) => {
    try {
      await api.instances.openFolder(name);
    } catch {}
  };

  const hour = new Date().getHours();
  const greet =
    hour < 6
      ? "burning midnight oil"
      : hour < 12
      ? "good morning"
      : hour < 17
      ? "good afternoon"
      : hour < 21
      ? "good evening"
      : "good night";

  return (
    <section className="space-y-4">
      {/* Header: Greeting + Version */}
      <div className="flex items-center justify-between">
        <div>
          <p className="tinycaps text-[10px] font-bold tracking-wider text-zinc-400">
            {greet},
          </p>
          <h1 className="text-3xl font-black text-white tracking-tight">
            {recent.length > 0 ? selected?.name || "Player" : "Player"}
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            {recent.length} profile{recent.length !== 1 ? "s" : ""} ready
            {totalH > 0 ? ` · ${totalH}h played` : ""}
          </p>
        </div>
        <div className="text-right hidden sm:block">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">v{liveVersion}</span>
        </div>
      </div>

      {/* Warning Banner */}
      {recent.length === 0 && (
        <div className="rounded-xl p-3 border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs">
          No profiles installed. Create one in the Profiles section to launch the game.
        </div>
      )}

      {/* Primary Launch Control Block */}
      <div className="relative group">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <GlowButton
            size="lg"
            disabled={!launchTarget || recent.length === 0}
            onClick={() => launchTarget && launch(launchTarget)}
            className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-black tinycaps tracking-wider px-8 py-3.5 rounded-xl shadow-[0_0_20px_rgba(255,167,38,0.3)]"
          >
            <Play size={16} /> LAUNCH GAME
          </GlowButton>

          <div className="relative">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              disabled={!recent.length}
              className="flex items-center gap-2 px-4 py-3.5 rounded-xl text-sm font-bold tinycaps transition-colors disabled:opacity-40"
              style={{
                border: `1px solid ${themeColors.border_bright || "rgba(255,255,255,0.1)"}`,
                background: themeColors.bg_card2 || "rgba(255,255,255,0.05)",
                color: themeColors.text_main || "#fff",
              }}
              title="Choose which profile to launch"
            >
              <span className="tracking-[0.12em]">
                {selected ? `${selected.name}` : "NO PROFILE"}
              </span>
              {selected?.version && (
                <span className="text-zinc-500">MC {selected.version}</span>
              )}
              <ChevronDown size={14} style={{ color: themeColors.text_main, transform: pickerOpen ? "rotate(180deg)" : undefined }} />
            </button>

            <AnimatePresence>
              {pickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="absolute left-0 mt-2 rounded-xl overflow-hidden z-50 min-w-[240px]"
                  style={{
                    background: themeColors.bg_card || "rgba(18, 20, 23, 0.95)",
                    border: `1px solid ${themeColors.border_bright || "rgba(255,255,255,0.1)"}`,
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <div className="max-h-64 overflow-y-auto py-1">
                    {recent.map((inst: any) => (
                      <button
                        key={inst.name}
                        onClick={() => { setLaunchTarget(inst.name); setPickerOpen(false); }}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors hover:bg-white/[0.07]"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold truncate text-white">{inst.name}</span>
                          <span className="text-[9px] tinycaps text-zinc-400">
                            {inst.loader} · MC {inst.version}
                          </span>
                        </span>
                        {inst.name === launchTarget && <Check size={12} className="text-amber-500" />}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setPickerOpen(false); setPage("instances"); }}
                    className="w-full text-left px-3 py-2 text-[10px] font-bold tinycaps transition-colors hover:bg-white/[0.07]"
                    style={{ color: themeColors.text_sub, borderTop: `1px solid ${themeColors.border}` }}
                  >
                    + Manage profiles
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

export function QuickProfilesBar() {
  const instances = useLauncherStore((s) => s.instances);
  const playTimes = useLauncherStore((s) => s.playTimes);
  const setPage = useLauncherStore((s) => s.setPage);
  const [launchTarget, setLaunchTarget] = useState<string | null>(null);

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

  const launch = (name: string) => {
    window.dispatchEvent(
      new CustomEvent("ec-launch-game", {
        detail: { instanceName: name },
      })
    );
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="tinycaps text-[10px] font-bold tracking-wider text-zinc-400">Quick Profiles</p>
        <button onClick={() => setPage("instances")} className="text-[10px] font-bold text-zinc-400 hover:text-white">
          All profiles
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {recent.slice(0, 4).map((inst: any) => {
          const mins = (playTimes as any)[inst.name] || 0;
          return (
            <motion.div
              key={inst.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-2 flex flex-col gap-1.5 bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-zinc-400 px-2 py-0.5 rounded bg-white/5 border border-white/10">
                  {inst.loader}
                </span>
                <span className="text-[9px] text-zinc-500">MC {inst.version}</span>
              </div>
              <p className="text-xs font-bold text-white truncate">{inst.name}</p>
              <p className="text-[9px] text-zinc-500 flex items-center gap-1">
                <Clock size={9} /> {timeAgo(inst.last_played)}{mins > 0 ? ` · ${fmtPlay(mins)}` : ""}
              </p>
              <button
                onClick={() => launch(inst.name)}
                className="w-full py-1 text-[9px] font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors"
              >
                LAUNCH
              </button>
            </motion.div>
          );
        })}
        <button
          onClick={() => setPage("instances")}
          className="rounded-xl p-2 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-white/10 text-zinc-400 hover:border-white/20 hover:text-white transition-colors min-h-[100px]"
        >
          <span className="text-[14px]">+</span>
          <span className="text-[9px] font-bold tinycaps">Add Profile</span>
        </button>
      </div>
    </section>
  );
}

export function BottomSection() {
  const setPage = useLauncherStore((s) => s.setPage);
  const themeColors = useLauncherStore((s) => s.themeColors);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Latest News */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <p className="tinycaps text-[10px] font-bold tracking-wider text-zinc-400">Latest News</p>
          <button onClick={() => setPage("announcements")} className="text-[10px] font-bold text-zinc-400 hover:text-white">
            All news
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              title: "New Cosmetics Drop",
              type: "cosmetics",
              color: "from-purple-500 to-pink-500",
            },
            {
              title: "Community Giveaway",
              type: "giveaway",
              color: "from-green-500 to-emerald-500",
            },
          ].map((item, i) => (
            <div key={i} className="rounded-xl overflow-hidden border border-white/5 group relative">
              <div className="h-32 bg-gradient-to-b from-black/40 to-black group-hover:from-black/20 group-hover:to-black/10 transition-all">
                <div className="absolute inset-0 bg-gradient-to-t from-{item.color.split(' ')[0]} via-transparent to-transparent opacity-20 group-hover:opacity-40 transition-opacity" />
                <div className="absolute bottom-2 left-2 w-2 h-2 rounded-full bg-white" />
              </div>
              <div className="p-3">
                <p className="text-xs font-bold text-white">{item.title}</p>
                <span className="text-[9px] font-bold text-zinc-400 uppercase">{item.type}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Friends / Social */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="tinycaps text-[10px] font-bold tracking-wider text-zinc-400">Friends</p>
          <button onClick={() => setPage("chat")} className="text-[10px] font-bold text-zinc-400 hover:text-white">
            Open chat
          </button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/5">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-zinc-300">No friends online</span>
          </div>
        </div>
      </div>
    </div>
  );
}
