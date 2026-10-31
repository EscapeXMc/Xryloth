"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { ModInfo } from "../../lib/types";
import { PackageCheck, Image, Search, Package, Layers, ExternalLink } from "lucide-react";
import { GlowButton } from "../ui/GlowButton";
import { GlassCard } from "../ui/GlassCard";
import { BrowserCard } from "../ui/BrowserCard";
import { ModDetailsModal } from "../ui/ModDetailsModal";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";

interface ModBrowserPageProps {
  instanceName?: string;
}

interface CardData {
  slug: string;
  name: string;
  author?: string;
  summary?: string;
  iconUrl?: string;
  bannerUrl?: string;
  version?: string;
  category?: string;
  loaders?: string[];
  downloads?: number;
  game_versions?: string[];
  description?: string;
}

const TABS: { id: "mods" | "modpacks" | "resourcepacks"; label: string; icon: any; projectType: string }[] = [
  { id: "mods", label: "Mods", icon: Package, projectType: "mod" },
  { id: "modpacks", label: "Packs", icon: PackageCheck, projectType: "modpack" },
  { id: "resourcepacks", label: "Resource Packs", icon: Image, projectType: "resourcepack" },
];

export function ModBrowserPage({ instanceName }: ModBrowserPageProps) {
  const { selectedInstance, currentPage, setPage } = useLauncherStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMod, setSelectedMod] = useState<ModInfo | null>(null);
  const [activeTab, setActiveTab] = useState<"mods" | "modpacks" | "resourcepacks">("mods");
  const [results, setResults] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedForModal, setSelectedForModal] = useState<CardData | null>(null);

  // Deep-link support: other pages (Profiles cards, sidebar) can request a
  // specific tab by writing this key before navigating to the Mods page.
  useEffect(() => {
    const stored = localStorage.getItem("ec-modbrowser-initial-tab");
    if (stored === "modpacks" || stored === "resourcepacks" || stored === "mods") {
      setActiveTab(stored);
    }
    localStorage.removeItem("ec-modbrowser-initial-tab");
  }, []);

  const getProjectTypeFacet = (tab: "mods" | "modpacks" | "resourcepacks") => {
    switch (tab) {
      case "modpacks":
        return "modpack";
      case "resourcepacks":
        return "resourcepack";
      case "mods":
      default:
        return "mod";
    }
  };

  // Fetch mods/packs/resourcepacks — supports empty queries (top downloaded) and live search
  const fetchProjects = useCallback(async (query: string, tab: "mods" | "modpacks" | "resourcepacks") => {
    setLoading(true);
    setError(null);
    try {
      const typeFacet = getProjectTypeFacet(tab);
      const mcVersion = tab === "mods" ? "1.21.11" : undefined;
      const results = await api.mods.search(query, typeFacet, undefined, mcVersion, 20);
      const items: CardData[] = (results as any[]).map((h: any) => ({
        slug: h.slug,
        name: h.title,
        author: h.author,
        summary: h.description,
        iconUrl: h.icon_url,
        bannerUrl: h.featured_gallery || h.gallery?.[0]?.url || h.banner_url,
        version: h.latest_version || "?",
        category: tab === "modpacks" ? "modpack" : tab === "resourcepacks" ? "resourcepack" : "mod",
        loaders: h.loaders,
        downloads: h.downloads,
        game_versions: h.game_versions,
        description: h.description,
      }));
      // For mods, filter to Fabric 1.21.11 compatible
      const filtered = tab === "mods"
        ? items.filter((m) => (!m.game_versions || m.game_versions.includes("1.21.11")) || (!m.loaders || m.loaders.includes("fabric")))
        : items;
      setResults(filtered);
    } catch (err) {
      console.error("Search error:", err);
      setError("Failed to search Modrinth");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced wrapper for live search on every keystroke
  const debouncedFetchProjects = useCallback((query: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => fetchProjects(query, activeTab), 200);
  }, [activeTab, fetchProjects]);

  // Load on mount and tab change
  useEffect(() => {
    setResults([]);
    setSearchQuery("");
    fetchProjects("", activeTab);
  }, [fetchProjects, activeTab]);

  // Install mod/pack
  const installItem = useCallback(
    async (item: CardData, versionId?: string, versionNumber?: string) => {
      if (!instanceName) return;
      setError(null);
      setLoading(true);
      try {
        const verId = versionId || item.version;
        if (item.category === "modpack") {
          const result = await api.mods.installModpack(instanceName, item.slug, verId);
          if (result.success) {
            setModalOpen(false);
          } else {
            setError(result.error || "Failed to install modpack");
          }
        } else if (item.category === "resourcepack") {
          const result = await api.mods.installResourcepack(instanceName, item.slug, verId);
          if (result.success) {
            setModalOpen(false);
          } else {
            setError(result.error || "Failed to install resource pack");
          }
        } else {
          const result = await api.mods.install(instanceName, item.slug, verId);
          if (result.success) {
            setModalOpen(false);
          } else {
            setError(result.error || "Failed to install mod");
          }
        }
      } catch (err) {
        console.error("Install error:", err);
        setError("Installation failed");
      } finally {
        setLoading(false);
      }
    },
    [instanceName]
  );

  const openDetails = (item: CardData) => {
    setSelectedForModal(item);
    setModalOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tinycaps font-lemon">
            {activeTab === "mods" ? "Mod Browser" : activeTab === "modpacks" ? "Modpacks" : "Resource Packs"}
          </h1>
          <p className="text-xryloth-400 text-sm mt-1">
            {activeTab === "mods"
              ? "Browse and install mods from Modrinth (Fabric 1.21.11 only)"
              : activeTab === "modpacks"
              ? "Browse and install complete modpack collections from Modrinth"
              : "Browse and install resource packs for your Minecraft instance"}
          </p>
        </div>
        <GlowButton
          size="sm"
          variant="ghost"
          onClick={() => setPage("instances")}
          className="hidden sm:inline-flex"
        >
          Back to Instances
        </GlowButton>
      </header>

      {/* Tab Bar */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2 mb-4">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                active
                  ? "bg-amber-600/30 text-amber-400 border border-amber-500/40 shadow-[0_0_15px_rgba(224,107,34,0.3)]"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search — live on every keystroke */}
      <div className="glass-card p-4 rounded-xl border border-white/5">
        <div className="flex gap-3">
          <Search size={16} className="mt-0.5 text-zinc-500 flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              debouncedFetchProjects(e.target.value);
            }}
            placeholder={`Search ${activeTab === "mods" ? "mods" : activeTab === "modpacks" ? "modpacks" : "resource packs"}…`}
            className="w-full rounded-xl px-4 py-2 bg-[#13161C]/50 backdrop-blur-md border border-white/5 text-white placeholder-gray-400 focus:outline-none focus:border-xryloth-500 transition-colors"
          />
        </div>
        <div className="text-[10px] text-xryloth-400/60 mt-1">
          Type to search instantly — results update on every keystroke.
        </div>
      </div>

      {/* Results Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {loading ? (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-xryloth-400 animate-pulse">
            <Search size={24} className="mb-3 text-zinc-500" />
            <p>Loading {activeTab === "mods" ? "mods" : activeTab === "modpacks" ? "modpacks" : "resource packs"}…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-16 rounded-2xl border-2 border-dashed border-white/10 bg-[#13161C]/50">
            <Search size={32} className="text-zinc-500 mb-3" />
            <h3 className="text-sm font-bold text-white">No results found</h3>
            <p className="text-xs text-zinc-500 mt-1">
              {searchQuery ? `No results for "{searchQuery}"` : "Try adjusting your search."}
            </p>
          </div>
        ) : (
          results.map((item) => (
            <BrowserCard
              key={item.slug}
              title={item.name}
              author={item.author}
              slug={item.slug}
              summary={item.summary}
              iconUrl={item.iconUrl}
              bannerUrl={item.bannerUrl}
              version={item.version}
              category={item.category}
              loaders={item.loaders}
              downloads={item.downloads}
              onInstall={() => installItem(item)}
              onView={() => openDetails(item)}
            />
          ))
        )}
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="text-center text-xs text-red-500">{error}</div>
      )}

      {/* Item Details Modal */}
      {modalOpen && selectedForModal && (
        <ModDetailsModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          slug={selectedForModal.slug}
          category={selectedForModal.category as "mod" | "modpack" | "resourcepack"}
          instanceName={instanceName}
        />
      )}
    </div>
  );
}
