"use client";

import React from "react";
import { GlowButton } from "./GlowButton";

export function GameBoostOverlay({ instanceName, onComplete }: { instanceName: string; onComplete: () => void }) {
  return (
    <div className="fixed inset-0 bg-[#090B0E]/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-[#13161C] border border-white/10 rounded-2xl p-8 w-full max-w-sm glass-card text-center">
        <div className="flex items-center justify-center gap-4">
          <svg className="h-12 w-12 text-xryloth-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M12 15L3 6l10-4 10 4-10 4z" />
          </svg>
          <div>
            <p className="text-2xl font-bold text-white">Game Boost</p>
            <p className="text-xryloth-400">Launching boost for {instanceName}</p>
          </div>
        </div>
        <GlowButton size="sm" onClick={onComplete}>OK</GlowButton>
      </div>
    </div>
  );
}