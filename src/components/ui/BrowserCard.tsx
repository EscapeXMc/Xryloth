"use client";

import { CachedImage, useCachedImageUrl } from "./CachedImage";
import React from "react";

interface BrowserCardProps {
  title: string;
  author?: string;
  slug?: string;
  summary?: string;
  iconUrl?: string;
  bannerUrl?: string;
  version?: string;
  category?: string;
  loaders?: string[];
  downloads?: number;
  onInstall: () => void;
  onView?: () => void;
  installing?: boolean;
  installed?: boolean;
}

export function BrowserCard({
  title,
  author,
  slug,
  summary,
  iconUrl,
  bannerUrl,
  version,
  category,
  loaders,
  downloads,
  onInstall,
  onView,
  installing = false,
  installed = false,
}: BrowserCardProps) {
  const bgImage = bannerUrl || iconUrl;
  // Serve the banner/icon background through the local disk cache too.
  const bgSrc = useCachedImageUrl(bgImage);

  const chipColor = (() => {
    if (category === "modpack") return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    if (loaders?.includes("fabric")) return "bg-xryloth-500/20 text-xryloth-500 border-xryloth-500/30";
    return "bg-zinc-800/50 text-zinc-400 border-zinc-700";
  })();

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't open view if clicking the Install button
    if ((e.target as HTMLElement).closest("button")) return;
    onView?.();
  };

  return (
    <div
      className="relative group overflow-hidden rounded-xl border border-white/10 bg-zinc-900/90 p-4 transition-all duration-200 hover:border-amber-500/50 hover:shadow-xl min-h-[120px] flex flex-col justify-between cursor-pointer"
      onClick={handleCardClick}
    >
      {/* BACKGROUND BANNER IMAGE */}
      {bgImage ? (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center opacity-20 blur-[2px] transition-all duration-300 group-hover:opacity-35 group-hover:scale-105"
          style={{ backgroundImage: bgSrc ? `url(${bgSrc})` : undefined }}
        />
      ) : (
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-zinc-800/40 via-zinc-900/40 to-black/60" />
      )}

      {/* DARK GRADIENT OVERLAY (FOR READABILITY) */}
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-zinc-950/40" />

      {/* FOREGROUND CONTENT */}
      <div className="relative z-20 flex flex-col justify-between h-full space-y-3">
        {/* HEADER ROW: ICON LEFT + TITLE RIGHT */}
        <div className="flex items-center gap-3">
          {iconUrl ? (
            <CachedImage
              src={iconUrl}
              alt={title}
              className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover bg-zinc-800 shadow-md"
            />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-lg border border-white/10 bg-zinc-800 flex items-center justify-center font-bold text-amber-500">
              {title.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-white text-base leading-snug truncate">{title}</h3>
            {author && <span className="text-[11px] text-zinc-400">by {author}</span>}
          </div>
        </div>

        {/* SUMMARY DESCRIPTION */}
        <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
          {summary || "No description provided."}
        </p>

        {/* Badges & Tags row */}
        <div className="flex flex-wrap gap-1.5">
          {category && <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tighter ${chipColor}`}>{category}</span>}
          {version && <span className="px-2 py-0.5 rounded text-[9px] font-bold border border-white/10 bg-zinc-800/50 text-zinc-400">{version}</span>}
          {loaders?.length && <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-zinc-800/50 text-zinc-400">{loaders.join(" · ")}</span>}
        </div>

        {/* FOOTER ROW: SLUG + INSTALL BUTTON */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-auto">
          {slug && <span className="text-[11px] font-mono text-zinc-500 truncate max-w-[60%]">{slug}</span>}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInstall();
            }}
            disabled={installing || installed}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500 hover:text-black transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {installed ? "Installed" : installing ? "Installing..." : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
