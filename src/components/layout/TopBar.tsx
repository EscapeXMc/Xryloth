"use client";

import React, { useState } from "react";
import { useLauncherStore } from "../../stores";
import {
  Menu,
  Zap,
  Palette,
  RefreshCcw,
  Bell,
} from "lucide-react";
import { GlowButton } from "../ui/GlowButton";
import { GlassCard } from "../ui/GlassCard";

interface TopBarProps {
  onMenuToggle: () => void;
}

export function TopBar({ onMenuToggle }: TopBarProps) {
  const { themeMode, setThemeMode, setPage, themeColors } = useLauncherStore();
  const [notifications, setNotifications] = useState(0);

  return (
    <header className="h-[56px] border-b border-white/5 bg-[#090B0E]/80 backdrop-blur-md sticky top-0 z-40 px-6 flex items-center justify-between select-none">
      {/* Left: Menu toggle + Brand */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="p-2 rounded-lg hover:bg-white/10 text-xryloth-400 transition-colors"
          aria-label="Toggle navigation"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-gradient-to-r from-xryloth-500 to-xryloth-900 shadow-xryloth-glow">
            <Zap size={14} />
          </div>
          <span className="font-lemon font-bold text-lg text-white tracking-tight">
            XRYLOTH
          </span>
        </div>
      </div>

      {/* Center: Quick Tools */}
      <div className="flex items-center gap-2 hidden md:flex">
        <QuickTool
          icon={Zap}
          label="Game Boost"
          onClick={() => setPage("instances")}
        />
        <QuickTool
          icon={Palette}
          label="Theme"
          onClick={() => setPage("settings")}
        />
        <QuickTool
          icon={Bell}
          label="Notifications"
          badge={3}
        />
        <QuickTool
          icon={RefreshCcw}
          label="Refresh"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("ec-refresh-current"));
          }}
        />
      </div>

      {/* Right: Notifications + Theme */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
          className="p-2 rounded-lg hover:bg-white/10 text-xryloth-400 transition-colors"
          title="Toggle Theme"
        >
          <Palette size={20} />
        </button>
        <button
          onClick={() => setNotifications(0)}
          className={`relative p-2 rounded-lg hover:bg-white/10 text-xryloth-400 transition-colors`}
          title="Notifications"
        >
          <Bell size={20} />
          {notifications > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-xryloth-500 rounded-full animate-pulse"></span>
          )}
        </button>
      </div>
    </header>
  );
}

function QuickTool({ icon: Icon, label, onClick, badge }: any) {
  return (
    <button
      onClick={onClick}
      className="p-2 rounded-lg hover:bg-white/10 text-xryloth-400 hover:text-white transition-colors group relative"
      title={label}
    >
      <Icon size={18} />
      {badge && (
        <span className="absolute top-1 right-1 w-2 h-2 bg-xryloth-500 rounded-full animate-pulse"></span>
      )}
    </button>
  );
}