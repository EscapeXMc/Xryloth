"use client";

import React from "react";
import { useToast } from "./Toast";

export function AnnouncementHost() {
  const { toasts } = useToast();
  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 flex gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="glass-card p-4 rounded-xl border border-white/5 max-w-md text-left animate-in fade-in-slide-up"
        >
          <div className="flex items-center gap-3">
            <svg
              className="w-5 h-5 text-xryloth-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path
                fill="currentColor"
                d="M13 16V13h6h-3m-3 3a2 2 0 100-4 2 2 0 000 4z"
              />
            </svg>
            <div>
              <p className="font-bold text-white">{toast.title}</p>
              <p className="text-xryloth-400 text-sm">{toast.message}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}