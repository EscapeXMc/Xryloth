"use client";

import React, { useState } from "react";
import { useLauncherStore } from "../../stores";
import { Package, PackageCheck, Image } from "lucide-react";

const TABS: { id: string; label: string; icon: any }[] = [
  { id: "mods", label: "Mods", icon: Package },
  { id: "modpacks", label: "Packs", icon: PackageCheck },
  { id: "resourcepacks", label: "Resource Packs", icon: Image },
];

export function ModsBrowserPage() {
  const { setPage } = useLauncherStore();

  // All tabs (Mods, Packs, Resource Packs) live in ModBrowserPage — navigate there
  const handleTabChange = () => setPage("mods");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tinycaps font-lemon">Mod Browser</h1>
          <p className="text-xryloth-400 text-sm mt-1">
            Browse and install mods, modpacks, and resource packs from Modrinth
          </p>
        </div>
      </header>

      {/* Tab Bar — all tabs route to ModBrowserPage which handles each type */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={handleTabChange}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all text-zinc-400 hover:text-white hover:bg-white/5"
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#13161C]/40 p-8 text-center">
        <Package size={48} className="mx-auto mb-4 text-zinc-600" />
        <h3 className="text-sm font-bold text-white">Mod Browser</h3>
        <p className="text-xs text-zinc-500 mt-1">
          Use the tabs above to browse Mods, Packs, or Resource Packs. All browsing
          happens in the Mod Browser with live search, banner cards, and detail modals.
        </p>
      </div>
    </div>
  );
}
