"use client";

import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import {
  Layers as Grass,
  Play,
  Layers,
  Image,
  Check,
  Plus,
  ArrowRight,
} from "lucide-react";
import { GlowButton } from "../ui/GlowButton";
import { ProfileCardOptions, type InstallTarget } from "../ui/ProfileCardOptions";
import { ProfileSettingsModal } from "../ui/ProfileSettingsModal";
import { InstallOverlay } from "../ui/InstallOverlay";

interface ProfileCard {
  id: string;
  name: string;
  version: string;
  loader: string;
  active: boolean;
  lastPlayed?: string;
  playTime?: number;
}

const MOCK_PROFILES: ProfileCard[] = [
  { id: "1", name: "Survival World", version: "1.21.11", loader: "Fabric", active: true, lastPlayed: "2h ago", playTime: 45 },
  { id: "2", name: "Creative Build", version: "1.21.1", loader: "Fabric", active: false, lastPlayed: "1d ago", playTime: 120 },
  { id: "3", name: "Tech Server", version: "1.20.1", loader: "NeoForge", active: false, lastPlayed: "3d ago", playTime: 300 },
];

export function ProfilesPage() {
  const { instances, setPage, loadInstances } = useLauncherStore();
  const [searchQuery, setSearchQuery] = useState("");

  // Edit modal (profile settings / JVM & memory)
  const [editing, setEditing] = useState<any>(null);
  const [settingsTab, setSettingsTab] = useState<"profile" | "java">("profile");
  // Version / loader changed → show the install overlay
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);

  const filtered = instances.filter((i: any) =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Always edit the freshest copy from the store (names can change on save).
  const editingProfile =
    (editing && instances.find((i: any) => i.name === editing.name)) || editing;

  const openSettings = (profile: any, tab: "profile" | "java") => {
    setEditing(profile);
    setSettingsTab(tab);
  };

  const openBrowserTab = (tab: "mods" | "modpacks" | "resourcepacks") => {
    localStorage.setItem("ec-modbrowser-initial-tab", tab);
    setPage("mods");
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Your Profiles</h1>
          <p className="text-xs text-zinc-500 mt-1">Manage your Minecraft game profiles</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0 w-64">
            <input
              type="text"
              placeholder="Search profiles..."
              className="w-full bg-[#13161C]/80 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-fast-accent/50 focus:outline-none transition-colors"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <GlowButton
            size="sm"
            variant="ghost"
            onClick={() => setPage("instances")}
            className="px-4 py-2.5 text-xs font-bold"
          >
            <Plus size={14} className="mr-1" /> New Profile
          </GlowButton>
        </div>
      </div>

      {/* Profile Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filtered.length > 0 ? (
          filtered.map((inst: any) => (
            <div
              key={inst.id || inst.name}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/90 shadow-xl transition-all duration-300 hover:border-amber-500/50 hover:shadow-2xl"
            >
              {/* Minecraft Grass/Dirt Theme Header Banner */}
              <div className="relative h-32 w-full overflow-hidden">
                {/* Gradient: grass top → dirt bottom */}
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/90 via-emerald-950/70 to-zinc-950" />
                {/* Subtle pixel grid texture overlay */}
                <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px] opacity-30 pointer-events-none" />
                <div className="absolute inset-0 bg-black/20" />

                {/* Grass Block Icon */}
                <div className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-800/80 border border-emerald-500/30 text-emerald-300 shadow-inner shadow-lg">
                  <Grass size={20} className="drop-shadow-md" />
                </div>

                {/* Loader badge */}
                <span className="absolute right-4 top-4 z-10 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-bold text-emerald-400 border border-emerald-500/20 backdrop-blur-md uppercase tracking-wider">
                  {inst.loader}
                </span>

                {/* Active indicator */}
                {inst.active && (
                  <div className="absolute right-4 bottom-4 z-10 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/60 border border-white/20 backdrop-blur-md">
                    <Check size={12} className="text-fast-accent" />
                    <span className="text-[10px] font-bold text-white">Active</span>
                  </div>
                )}

                {/* Profile name overlay */}
                <div className="absolute bottom-4 left-4 right-4 z-10">
                  <h3 className="text-lg font-bold text-white truncate drop-shadow-md">{inst.name}</h3>
                </div>
              </div>

              {/* Card Body */}
              <div className="flex flex-1 flex-col justify-between p-4 space-y-4 bg-zinc-950/60">
                {/* Metadata */}
                <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
                  <span className="flex items-center gap-1">
                    <span className="text-zinc-500">MC</span> {inst.version}
                  </span>
                  <span>{inst.lastPlayed || "Never played"}</span>
                </div>

                {/* Fixed Action Button Bar */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
                  <button
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("ec-launch-game", {
                          detail: { instanceName: inst.name },
                        })
                      );
                    }}
                    className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-black font-bold text-xs shadow-lg shadow-amber-500/30 hover:from-amber-400 hover:to-amber-600 transition-all shrink-0"
                  >
                    <Play size={12} /> Play
                  </button>
                  <button
                    onClick={() => openBrowserTab("mods")}
                    className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-white/5 text-zinc-300 text-xs font-medium border border-white/10 hover:bg-white/10 hover:text-white transition-colors shrink-0"
                  >
                    <Layers size={12} /> Mods
                  </button>
                  <button
                    onClick={() => openBrowserTab("resourcepacks")}
                    className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-white/5 text-zinc-300 text-xs font-medium border border-white/10 hover:bg-white/10 hover:text-white transition-colors shrink-0"
                  >
                    <Image size={12} /> Packs
                  </button>
                </div>

                {/* More Options — full context menu (folders, edit, JVM, export, delete) */}
                <ProfileCardOptions
                  profile={inst}
                  onOpenSettings={(tab) => openSettings(inst, tab)}
                  onChanged={() => loadInstances()}
                  onInstall={(target) => setInstallTarget(target)}
                />
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center py-16 rounded-2xl border-2 border-dashed border-white/10 bg-[#13161C]/50">
            <Plus size={32} className="text-zinc-500 mb-4" />
            <h3 className="text-sm font-bold text-white">No profiles found</h3>
            <p className="text-xs text-zinc-500 mt-1">
              {searchQuery ? `No results for "{searchQuery}"` : "Create your first profile to get started."}
            </p>
          </div>
        )}

        {/* Create Profile Card */}
        <button
          onClick={() => setPage("instances")}
          className="rounded-xl overflow-hidden border-2 border-dashed border-white/10 bg-zinc-900/50 hover:bg-white/5 hover:border-amber-500/30 transition-all flex flex-col items-center justify-center py-12 group"
        >
          <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center mb-4 group-hover:bg-white/10 transition-colors">
            <Plus size={24} className="text-zinc-400 group-hover:text-white transition-colors" />
          </div>
          <span className="text-xs font-bold text-zinc-300 group-hover:text-white">Create Profile</span>
          <span className="text-[9px] text-zinc-500 mt-1">Start from scratch</span>
        </button>
      </div>

      {/* Profile settings (name / icon / version / loader, JVM & RAM) */}
      <ProfileSettingsModal
        open={!!editingProfile}
        profile={editingProfile}
        initialTab={settingsTab}
        onClose={() => setEditing(null)}
        onSaved={() => loadInstances()}
        onInstall={(target) => setInstallTarget(target)}
      />

      {/* Version / loader change → install progress */}
      <AnimatePresence>
        {installTarget && (
          <InstallOverlay
            instanceName={installTarget.instanceName}
            version={installTarget.version}
            loader={installTarget.loader}
            loaderVersion={installTarget.loaderVersion}
            onClose={() => {
              setInstallTarget(null);
              loadInstances();
            }}
            onPlay={() => {
              window.dispatchEvent(
                new CustomEvent("ec-launch-game", {
                  detail: { instanceName: installTarget.instanceName },
                })
              );
              setInstallTarget(null);
              loadInstances();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
