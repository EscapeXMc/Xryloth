"use client";

import React from "react";

export function UpdateOverlay() {
  return (
    <div className="fixed inset-0 bg-[#090B0E]/50 z-50 flex items-center justify-center">
      <div className="bg-[#13161C] border border-white/10 rounded-2xl p-8 w-full max-w-sm glass-card text-center">
        <p className="text-2xl font-bold text-white">Checking for updates...</p>
        <p className="text-xryloth-400 mt-2">Xryloth will check for updates on launch.</p>
      </div>
    </div>
  );
}