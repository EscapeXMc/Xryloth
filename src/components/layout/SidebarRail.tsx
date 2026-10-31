"use client";

import React, { useEffect } from "react";
import { useLauncherStore } from "../../stores";
import {
  Gamepad2,
  Layers,
  Users,
  MessageSquare,
  Sparkles,
  Zap,
  Server,
  ShoppingBag,
  Settings,
} from "lucide-react";

const RAIL_ITEMS = [
  { id: "play", label: "PLAY", icon: Gamepad2, color: "text-fast-accent" },
  { id: "profiles", label: "PROFILES", icon: Layers, color: "text-zinc-400" },
  { id: "accounts", label: "ACCOUNTS", icon: Users, color: "text-zinc-400" },
  { id: "chat", label: "CHAT", icon: MessageSquare, color: "text-zinc-400" },
  { id: "xai", label: "AI", icon: Sparkles, color: "text-zinc-400" },
  { id: "partners", label: "PARTNERS", icon: Zap, color: "text-zinc-400" },
  { id: "servers", label: "SERVERS", icon: Server, color: "text-zinc-400" },
  { id: "mods", label: "STORE", icon: ShoppingBag, color: "text-zinc-400" },
  { id: "settings", label: "SETTINGS", icon: Settings, color: "text-zinc-400" },
];

interface SidebarRailProps {
  currentTab: string;
  setTab: (tab: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function SidebarRail({ currentTab, setTab, isOpen, onClose }: SidebarRailProps) {
  const setPage = useLauncherStore((s) => s.setPage);

  const activeId = currentTab.toLowerCase();

  useEffect(() => {
    if (!isOpen) onClose();
  }, [isOpen, onClose]);

  return (
    <aside
      className="w-20 bg-[#0A0C0E] border-r border-white/[0.08] flex flex-col items-center justify-between py-6 select-none flex-shrink-0 h-screen"
    >
      {/* Branding / Logo */}
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg cursor-pointer mb-6">
        <Gamepad2 size={18} className="text-white" />
      </div>

      {/* Navigation Items */}
      <nav className="flex flex-col items-center gap-6 flex-1">
        {RAIL_ITEMS.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setPage(item.id);
                onClose();
              }}
              className={`flex flex-col items-center gap-1.5 text-[10px] font-medium tracking-wide transition-colors cursor-pointer w-14 ${
                active
                  ? "bg-white/[0.08] text-white rounded-xl py-3 shadow-sm border border-white/[0.05]"
                  : "text-zinc-500 hover:text-white"
              }`}
              style={{ textDecoration: "none" }}
            >
              <item.icon size={20} className={`w-5 h-5 ${item.color}`} />
              <span className="uppercase">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom (reserved for future aux buttons) */}
      <div className="pb-2 w-full" />
    </aside>
  );
}
