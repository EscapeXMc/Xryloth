"use client";

import React, { useEffect } from "react";
import { useLauncherStore } from "../../stores";
import {
  Home,
  Layers,
  Users,
  Settings,
  Package,
  Zap,
  Monitor,
  ShieldAlert,
  ChevronLeft,
  Menu,
} from "lucide-react";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";

const NAV_ITEMS = [
  { id: "play", label: "Play", icon: Home, color: "xryloth-500" },
  { id: "instances", label: "Profiles", icon: Layers, color: "xryloth-400" },
  { id: "mods", label: "Mods", icon: Package, color: "purple-500" },
  { id: "partners", label: "Partners", icon: Zap, color: "green-500" },
  { id: "accounts", label: "Accounts", icon: Users, color: "blue-500" },
  { id: "settings", label: "Settings", icon: Settings, color: "gray-400" },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { currentPage, setPage, themeColors } = useLauncherStore();

  useEffect(() => {
    if (!isOpen) onClose();
  }, [isOpen, onClose]);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      style={{
        background: `linear-gradient(180deg, ${themeColors.bg_nav}, ${themeColors.bg_card})`,
        borderRight: `1px solid ${themeColors.border}`,
        boxShadow: "0 0 30px rgba(0,0,0,0.5)",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-6 bg-[#090B0E]/20 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-r from-xryloth-500 to-xryloth-900 shadow-xryloth-glow">
          <Home size={18} />
        </div>
        <span className="font-lemon font-bold text-xl text-white tracking-tight">
          XRYLOTH
        </span>
      </div>

      {/* Navigation */}
      <nav className="mt-4 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setPage(item.id);
                onClose();
              }}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all duration-200 ${
                active
                  ? "bg-xryloth-500/10 border border-xryloth-500/30 text-white shadow-[0_0_15px_rgba(255,167,38,0.1)]"
                  : "text-xryloth-400 hover:bg-white/5 hover:text-white no-underline focus:outline-none focus:ring-0"
              }`}
              style={{ textDecoration: "none" }}
            >
              <item.icon size={20} className={`text-${item.color}`} />
              <span className="text-xs font-bold tinycaps tracking-wider">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Version badge */}
      <div className="absolute bottom-6 left-6 right-6 p-4 bg-[#13161C]/50 rounded-xl border border-white/5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[#0D0F12] border border-xryloth-500/30 flex items-center justify-center">
          <Monitor size={14} className="text-xryloth-500" />
        </div>
        <div className="flex-1">
          <div className="text-xs font-bold text-white">XRYLOTH LAUNCHER</div>
          <div className="text-[10px] text-xryloth-400">v6.0.0.15</div>
        </div>
      </div>

      {/* Close button (mobile) */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10 text-xryloth-400 md:hidden"
      >
        <ChevronLeft size={20} />
      </button>
    </aside>
  );
}
