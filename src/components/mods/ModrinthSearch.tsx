"use client";

import React, { useCallback, useState } from "react";
import { useLauncherStore } from "../../stores";

export interface ModrinthSearchProps {
  instanceName?: string;
  initialQuery?: string;
  tab?: "mods" | "packs";
  onSearchChange: (query: string) => void;
}

export function ModrinthSearch({
  instanceName,
  initialQuery = "",
  tab = "mods",
  onSearchChange,
}: ModrinthSearchProps) {
  const [query, setQuery] = useState(initialQuery);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      onSearchChange(value);
    },
    [onSearchChange]
  );

  return (
    <div className="space-y-4">
      {/* Search Bar — live on every keystroke, no min length */}
      <div className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder={tab === "packs" ? "Search packs…" : "Search mods…"}
          className="w-full rounded-xl px-4 py-2 bg-[#13161C]/50 backdrop-blur-md border border-white/5 text-white placeholder-gray-400 focus:outline-none focus:border-xryloth-500 transition-colors"
        />
      </div>

      <div className="text-[10px] text-xryloth-400/60">
        Type to search instantly — results update on every keystroke.
      </div>
    </div>
  );
}
