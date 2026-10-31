"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown, User, Lock, Zap } from "lucide-react";
import { appWindow } from "@tauri-apps/api/window";
import { useLauncherStore } from "../../stores";
import { GlowButton } from "../ui/GlowButton";
import { getSession, onSessionChanged, type XrylothSession } from "../../lib/auth";

function WindowControls() {
  return (
    <div className="flex gap-1">
      <GlowButton
        size="sm"
        variant="ghost"
        onClick={() => appWindow.minimize().catch(() => {})}
        className="w-8 h-8 p-0 text-zinc-400 hover:bg-white/5 hover:text-white"
        title="Minimize"
      >
        <span className="text-[10px] font-bold">—</span>
      </GlowButton>
      <GlowButton
        size="sm"
        variant="ghost"
        onClick={async () => {
          const max = await appWindow.isMaximized().catch(() => false);
          if (max) { appWindow.unmaximize().catch(() => {}); }
          else { appWindow.maximize().catch(() => {}); }
        }}
        className="w-8 h-8 p-0 text-zinc-400 hover:bg-white/5 hover:text-white"
        title="Maximize"
      >
        <span className="text-[10px] font-bold">□</span>
      </GlowButton>
      <GlowButton
        size="sm"
        variant="fast-danger"
        onClick={() => appWindow.close().catch(() => {})}
        className="w-8 h-8 p-0 text-white hover:bg-fast-danger/20"
        title="Close"
      >
        <span className="text-[10px] font-bold">✕</span>
      </GlowButton>
    </div>
  );
}

function AuthPill() {
  const setPage = useLauncherStore((s) => s.setPage);
  const [session, setSession] = useState<XrylothSession | null>(() => getSession());

  useEffect(() => onSessionChanged(setSession), []);

  // Signed in — show identity, click goes to Accounts page
  if (session) {
    return (
      <button
        onClick={() => setPage("accounts")}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 hover:border-emerald-500/40 transition-all"
        title={`${session.email} — click to manage account`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
        <span className="truncate max-w-[120px]">{session.username}</span>
        {session.isAdmin && (
          <span className="px-1 py-0.5 rounded text-[8px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30">ADMIN</span>
        )}
      </button>
    );
  }

  // Not signed in — Sign In button navigates to Accounts page
  return (
    <button
      onClick={() => setPage("accounts")}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-fast-card/50 border border-white/10 text-zinc-300 text-xs font-bold hover:bg-white/10 hover:border-white/20 hover:text-white transition-all"
      title="Sign in to your Xryloth account"
    >
      <Lock size={12} className="text-fast-accent" />
      <span>Sign In</span>
    </button>
  );
}

function AccountSelector() {
  const settings = useLauncherStore((s) => s.settings);
  const [session] = useState<XrylothSession | null>(() => getSession());

  // Prefer the Xryloth session username, then Minecraft usernames
  const username =
    session?.username ||
    settings.username ||
    settings.cracked_username ||
    settings.ely_by_username ||
    "No Account";

  return (
    <div className="flex items-center gap-2 pl-1">
      <div className="w-8 h-8 rounded-full border border-white/10 overflow-hidden bg-[#13161C] flex items-center justify-center flex-shrink-0">
        {session ? (
          <span className="text-xs font-black text-fast-accent">{username.charAt(0).toUpperCase()}</span>
        ) : (
          <User size={14} className="text-zinc-400" />
        )}
      </div>
      <div className="flex flex-col items-end truncate min-w-0">
        <span className="text-xs font-bold text-white truncate">{username}</span>
        <ChevronDown size={12} className="text-zinc-500 flex-shrink-0" />
      </div>
    </div>
  );
}

interface HeaderBarProps {
  currentTab: string;
}

export function HeaderBar({ currentTab }: HeaderBarProps) {
  const sidebarOpen = useLauncherStore((s) => s.sidebarOpen);
  const toggleSidebar = useLauncherStore((s) => s.toggleSidebar);

  return (
    <header
      data-tauri-drag-region
      className="h-14 border-b border-white/5 flex items-center justify-between px-5 bg-[#090B0E]/90 backdrop-blur-md z-20 flex-shrink-0"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-4 min-w-0">
        {/* Branding */}
        <button
          onClick={toggleSidebar}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/5 text-zinc-400 flex-shrink-0"
          title="Toggle Sidebar"
        >
          <Zap size={18} className="text-fast-accent" />
        </button>
        <div className="flex flex-col items-start min-w-0">
          <span className="text-xs font-black text-white tracking-tight truncate">XRYLOTH</span>
          <span className="text-[9px] text-zinc-500 uppercase tracking-wider truncate">{currentTab}</span>
        </div>

        {/* Auth + Account */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <AuthPill />
          <AccountSelector />
        </div>
      </div>

      <WindowControls />
    </header>
  );
}
