"use client";

import React from "react";

export function LaunchAnimation({ instanceName, onComplete }: { instanceName: string; onComplete: () => void }) {
  return (
    <div className="fixed inset-0 bg-[#090B0E]/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-[#13161C] border border-white/10 rounded-2xl p-8 w-full max-w-sm glass-card text-center">
        <svg className="h-12 w-12 text-xryloth-500 mx-auto mb-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l-1.16 1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808l1.16-1.634a7.96 7.96 0 00-1.11-2.596zm8.075-2.596c.57-1.271.92-2.444.92-3.808 0-1.366-.35-2.648-.92-3.808l-1.16 1.634c.705.928 1.11 2.147 1.11 3.563 0 1.366-.35 2.648-.92-3.808l-1.16-1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808z" />
        </svg>
        <p className="text-2xl font-bold text-white">Launching...</p>
        <p className="text-xryloth-400">Starting {instanceName}</p>
      </div>
    </div>
  );
}