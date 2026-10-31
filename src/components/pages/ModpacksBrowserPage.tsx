"use client";

import { CachedImage, useCachedImageUrl } from "../ui/CachedImage";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { ModInfo } from "../../lib/types";
import { PackageCheck, Image, Search, ExternalLink, Download, Users, Shield } from "lucide-react";
import { GlowButton } from "../ui/GlowButton";
import { GlassCard } from "../ui/GlassCard";
import { BrowserCard } from "../ui/BrowserCard";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";

interface PackCardData {
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

interface ModpacksBrowserPageProps {
  instanceName?: string;
}

export function ModpacksBrowserPage({ instanceName }: ModpacksBrowserPageProps) {
  const { selectedInstance, currentPage, setPage } = useLauncherStore();
  const [tab, setTab] = useState<"modpacks" | "resourcepacks">("modpacks");
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<PackCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedForModal, setSelectedForModal] = useState<PackCardData | null>(null);

  // Read initial tab from localStorage (set by sidebar Resource Packs button)
  useEffect(() => {
    const stored = localStorage.getItem("ec-modpacks-initial-tab");
    if (stored === "resourcepacks") {
      setTab("resourcepacks");
    }
    localStorage.removeItem("ec-modpacks-initial-tab");
  }, []);

  const fetchPacks = useCallback(async (query: string, packType: "modpacks" | "resourcepacks") => {
    setLoading(true);
    setError(null);
    try {
      const projectType = packType === "modpacks" ? "modpack" : "resourcepack";
      const results = await api.mods.search(query, projectType, undefined, undefined, 20);
      const packs: PackCardData[] = (results as any[]).map((h: any) => ({
        slug: h.slug,
        name: h.title,
        author: h.author,
        summary: h.description,
        iconUrl: h.icon_url,
        bannerUrl: h.featured_gallery || h.gallery?.[0]?.url || h.banner_url,
        version: h.latest_version || "?",
        category: projectType,
        loaders: h.loaders,
        downloads: h.downloads,
        game_versions: h.game_versions,
        description: h.description,
      }));
      setResults(packs);
    } catch (err) {
      console.error(`Pack search error (${packType}):`, err);
      setError(`Failed to load ${packType}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedFetch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPacks(query, tab), 200);
  }, [tab, fetchPacks]);

  // Load on mount and tab change
  useEffect(() => {
    setResults([]);
    fetchPacks("", tab);
  }, [fetchPacks, tab]);

  // Install pack
  const installPack = useCallback(async (pack: PackCardData) => {
    if (!instanceName) return;
    setError(null);
    setLoading(true);
    try {
      const result = await api.mods.installModpack(instanceName, pack.slug, pack.version);
      if (result.success) {
        setModalOpen(false);
      } else {
        setError(result.error || "Failed to install modpack");
      }
    } catch (err) {
      console.error("Install pack error:", err);
      setError("Installation failed");
    } finally {
      setLoading(false);
    }
  }, [instanceName]);

  const openDetails = (pack: PackCardData) => {
    setSelectedForModal(pack);
    setModalOpen(true);
  };

  const TABS = [
    { id: "modpacks", label: "Modpacks", icon: PackageCheck, desc: "Complete mod collections" },
    { id: "resourcepacks", label: "Resource Packs", icon: Image, desc: "Textures, models & sounds" },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tinycaps font-lemon">
            {tab === "modpacks" ? "Modpacks" : "Resource Packs"}
          </h1>
          <p className="text-xryloth-400 text-sm mt-1">
            {tab === "modpacks"
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

      {/* Category Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors ${
              tab === t.id
                ? "bg-xryloth-500/20 border border-xryloth-500/30 text-xryloth-500 shadow-[0_0_15px_rgba(224,107,34,0.3)]"
                : "text-zinc-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
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
              debouncedFetch(e.target.value);
            }}
            placeholder={`Search ${tab === "modpacks" ? "modpacks" : "resource packs"}…`}
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
            <p>Loading {tab === "modpacks" ? "modpacks" : "resource packs"}…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-16 rounded-2xl border-2 border-dashed border-white/10 bg-[#13161C]/50">
            <Search size={32} className="text-zinc-500 mb-3" />
            <h3 className="text-sm font-bold text-white">No {tab === "modpacks" ? "modpacks" : "resource packs"} found</h3>
            <p className="text-xs text-zinc-500 mt-1">
              {searchQuery ? `No results for "{searchQuery}"` : "Try adjusting your search."}
            </p>
          </div>
        ) : (
          results.map((pack) => (
            <PackDetailCard
              key={pack.slug}
              pack={pack}
              onView={() => openDetails(pack)}
              onInstall={() => installPack(pack)}
              installing={false}
            />
          ))
        )}
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="text-center text-xs text-red-500">{error}</div>
      )}

      {/* Pack Details Modal */}
      {modalOpen && selectedForModal && (
        <PackDetailsModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          pack={selectedForModal}
          onInstall={() => {
            installPack(selectedForModal);
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface PackDetailCardProps {
  pack: PackCardData;
  onView: () => void;
  onInstall: () => void;
  installing?: boolean;
}

function PackDetailCard({ pack, onView, onInstall, installing = false }: PackDetailCardProps) {
  const bgImage = pack.bannerUrl || pack.iconUrl;
  // Serve the pack banner background through the local disk cache too.
  const bgSrc = useCachedImageUrl(bgImage);
  const chipColor =
    pack.category === "modpack"
      ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
      : "bg-zinc-800/50 text-zinc-400 border-zinc-700";

  return (
    <div
      className="relative group overflow-hidden rounded-xl border border-white/10 bg-zinc-900/90 p-4 transition-all duration-300 hover:border-amber-500/50 hover:shadow-xl cursor-pointer min-h-[260px] flex flex-col"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onView();
      }}
    >
      {/* Banner Background */}
      {bgImage ? (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center opacity-20 blur-[2px] transition-all duration-300 group-hover:opacity-35 group-hover:scale-105"
          style={{ backgroundImage: bgSrc ? `url(${bgSrc})` : undefined }}
        />
      ) : (
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-zinc-800/40 via-zinc-900/40 to-black/60" />
      )}

      {/* Gradient Overlay */}
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#090B0E] via-[#090B0E]/85 to-[#090B0E]/40" />

      {/* Content */}
      <div className="relative z-20 flex flex-col h-full space-y-3">
        {/* Header: Icon + Title */}
        <div className="flex items-center gap-3 mb-1">
          {pack.iconUrl ? (
            <CachedImage
              src={pack.iconUrl}
              alt={pack.name}
              className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover bg-zinc-800 shadow-md"
            />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-lg border border-white/10 bg-zinc-800 flex items-center justify-center font-bold text-amber-500">
              {pack.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-white text-base leading-snug truncate">{pack.name}</h3>
            {pack.author && <span className="text-[11px] text-zinc-400">by {pack.author}</span>}
          </div>
        </div>

        {/* Summary */}
        <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed flex-1">
          {pack.summary || "No description available."}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mt-auto">
          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tighter ${chipColor}`}>
            {pack.category}
          </span>
          {pack.version && (
            <span className="px-2 py-0.5 rounded text-[9px] font-bold border border-white/10 bg-zinc-800/50 text-zinc-400">
              v{pack.version}
            </span>
          )}
          {pack.downloads && (
            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-zinc-800/50 text-zinc-400">
              {pack.downloads.toLocaleString()} DL
            </span>
          )}
        </div>

        {/* Footer: Install */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-3">
          <span className="text-[11px] font-mono text-zinc-500 truncate max-w-[55%]">{pack.slug}</span>
          <GlowButton
            onClick={(e) => {
              e.stopPropagation();
              onInstall();
            }}
            size="sm"
            disabled={installing}
            className="text-xs font-semibold"
          >
            Install
          </GlowButton>
        </div>
      </div>
    </div>
  );
}

interface PackDetailsModalProps {
  open: boolean;
  onClose: () => void;
  pack: PackCardData;
  onInstall: () => void;
}

function PackDetailsModal({ open, onClose, pack, onInstall }: PackDetailsModalProps) {
  if (!open) return null;

  const categoryColor =
    pack.category === "modpack"
      ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
      : "bg-zinc-800/50 text-zinc-400 border-zinc-700";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-[#090B0E] shadow-2xl flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#090B0E]/50 backdrop-blur-md">
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <ExternalLink size={18} />{" "}
            <span className="text-[10px]">View on Modrinth</span>
          </button>
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            <Shield size={12} /> {pack.category?.toUpperCase()}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row overflow-y-auto max-h-[75vh]">
          {/* Left: Banner + Icon */}
          <div className="md:w-2/5 h-64 md:h-auto relative overflow-hidden flex-shrink-0">
            {pack.bannerUrl ? (
              <CachedImage src={pack.bannerUrl} alt={pack.name} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full bg-zinc-900/40 flex items-center justify-center">
                <div className="w-20 h-20 rounded-xl bg-[#0D0F12] border border-white/10 flex items-center justify-center text-xs font-bold text-zinc-400 shadow-md">
                  {pack.name.charAt(0).toUpperCase()}
                </div>
              </div>
            )}
            <div className="absolute -bottom-10 left-8 md:left-10 z-10 flex items-center gap-3">
              {pack.iconUrl ? (
                <CachedImage
                  src={pack.iconUrl}
                  alt={pack.name}
                  className="w-20 h-20 rounded-2xl border-3 border-white/20 object-cover shadow-2xl bg-zinc-800"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl border-3 border-white/20 bg-zinc-800 flex items-center justify-center text-2xl font-bold text-amber-500 shadow-2xl">
                  {pack.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* Right: Details */}
          <div className="flex-1 p-6 md:p-8 overflow-y-auto min-h-[340px]">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h1 className="text-2xl font-bold text-white leading-tight">{pack.name}</h1>
                {pack.author && (
                  <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5">
                    <Users size={12} /> by {pack.author}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-semibold {categoryColor}">
                {pack.category}
              </div>
            </div>

            {/* Meta Row */}
            <div className="flex flex-wrap gap-3 mb-6 text-xs text-zinc-500">
              {pack.version && (
                <span className="flex items-center gap-1.5"><Download size={12} /> v{pack.version}</span>
              )}
              {pack.downloads && (
                <span className="flex items-center gap-1.5"><Download size={12} /> {pack.downloads.toLocaleString()} downloads</span>
              )}
              {pack.loaders?.length && <span className="flex items-center gap-1">{pack.loaders.join(" · ")}</span>}
              {pack.game_versions?.length && <span className="flex items-center gap-1">{pack.game_versions.join(" · ")}</span>}
            </div>

            {/* Description */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Description</h2>
              </div>
              <div className="rounded-lg border border-zinc-800/50 bg-[#0D0F12]/40 p-5">
                <MarkdownRenderer text={pack.summary || pack.description || "No description available."} />
              </div>
            </div>

            {/* Slug / ID */}
            <div className="mt-6 pt-6 border-t border-white/5">
              <div className="flex items-start gap-2 text-xs text-zinc-500 font-mono break-all">
                <span className="font-semibold">Slug:</span> {pack.slug}
              </div>
            </div>
          </div>
        </div>

        {/* Footer: Install */}
        <div className="px-6 py-4 border-t border-white/5 bg-[#090B0E]/30">
          <GlowButton onClick={onInstall} size="sm" className="w-full py-3 text-base font-bold">
            Install {pack.category === "modpack" ? "Modpack" : "Resource Pack"}
          </GlowButton>
        </div>
      </div>
    </div>
  );
}
