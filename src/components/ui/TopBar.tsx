import { motion } from "framer-motion";
import { useLauncherStore } from "../../stores";
import {
  Home, Layers, Puzzle, Package, Boxes, Users, Settings, FileText,
  Layout, MessageCircle, Palette, Server, X,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import { AnimatedLogo, LauncherLogo } from "./AnimatedLogo";
import { useSounds } from "./SoundEffects";
import { checkNavGuard } from "../../lib/navGuard";

type NavItem = {
  id: string;
  label: string;
  icon: any;
  shortcut?: string;
  desc?: string;
  logo?: boolean;
  featured?: boolean;
};

type NavSection = { title: string; items: NavItem[] };

const sections: NavSection[] = [
  {
    title: "Launcher",
    items: [
      { id: "home", label: "HOME", icon: Home, desc: "Your dashboard" },
      { id: "xai", label: "AI", icon: null, desc: "Xryloth AI assistant", logo: true, featured: true },
      { id: "accounts", label: "LOGIN", icon: Users, desc: "Accounts & skins" },
      { id: "settings", label: "SETTINGS", icon: Settings, shortcut: "Ctrl+,", desc: "Launcher settings" },
    ],
  },
  {
    title: "Library",
    items: [
      { id: "instances", label: "PROFILES", icon: Layers, shortcut: "Ctrl+N", desc: "Game profiles" },
      { id: "servers", label: "SERVERS", icon: Server, desc: "Self-hosted servers" },
      { id: "mods", label: "MODS", icon: Puzzle, shortcut: "Ctrl+M", desc: "Mods & plugins" },
      { id: "modpacks", label: "MODPACKS", icon: Boxes, desc: "Modpacks" },
      { id: "packs", label: "PACKS", icon: Package, desc: "Resource packs" },
    ],
  },
  {
    title: "More",
    items: [
      { id: "chat", label: "CHAT", icon: MessageCircle, desc: "Community chat" },
      { id: "templates", label: "TEMPLATES", icon: Layout, desc: "Profile templates" },
      { id: "themes", label: "THEMES", icon: Palette, shortcut: "Ctrl+T", desc: "Themes & colours" },
      { id: "logs", label: "LOGS", icon: FileText, desc: "Launcher logs" },
    ],
  },
];

export function TopBar() {
  const { currentPage, setPage, themeColors, liveVersion } = useLauncherStore();
  const { play: playSound } = useSounds();

  let idx = -1;

  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-[56px] flex items-center justify-between px-4"
      style={{
        background: `${themeColors.bg_nav}99`,
        borderBottom: `1px solid ${themeColors.border}`,
        backdropFilter: "blur(32px) saturate(1.4)",
        WebkitBackdropFilter: "blur(32px) saturate(1.4)",
      }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `linear-gradient(90deg, ${themeColors.accent}08 0%, transparent 50%, ${themeColors.purple || themeColors.blue}08 100%)`,
      }} />

      {/* Left: Brand + Primary Nav */}
      <div className="relative flex items-center gap-2" style={{ zIndex: 1 }}>
        <motion.button
          onClick={() => { setPage("home"); playSound("click"); }}
          className="relative mr-2 rounded-xl"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Xryloth home"
        >
          <AnimatedLogo size={32} animated={true} />
        </motion.button>

        <div className="w-px h-6 mr-2" style={{ background: `${themeColors.border}40` }} />

        {/* Primary navigation items */}
        <div className="flex items-center gap-1" style={{ minWidth: 0 }}>
          {sections.flatMap((section) => section.items.map((item) => {
            idx += 1;
            const itemIdx = idx;
            const isActive = currentPage === item.id;
            const Icon = item.icon;

            return (
              <Tooltip
                key={item.id}
                content={item.desc ? `${item.label} — ${item.desc}` : item.label}
                shortcut={item.shortcut || undefined}
                side="bottom"
              >
                <motion.button
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: itemIdx * 0.02, duration: 0.3 }}
                  onClick={() => {
                    if (item.id !== "settings" && !checkNavGuard(item.id)) return;
                    setPage(item.id); playSound("click");
                  }}
                  className={`relative flex flex-col items-center justify-center gap-1 rounded-xl transition-all duration-300 group ${
                    item.logo ? "py-1.5 px-3" : "py-2 px-3"
                  } min-w-[60px]`}
                  style={{
                    background: isActive
                      ? `linear-gradient(135deg, ${themeColors.accent}22, ${themeColors.accent}0d)`
                      : "transparent",
                    color: isActive ? themeColors.accent : themeColors.nav_inactive,
                    border: isActive ? `1px solid ${themeColors.accent}38` : "1px solid transparent",
                    boxShadow: item.featured && !isActive ? `0 0 0 1px ${themeColors.accent}18` : undefined,
                  }}
                  whileHover={{
                    scale: 1.05,
                    backgroundColor: isActive ? undefined : `${themeColors.bg_hover}40`,
                    borderColor: `${themeColors.accent}30`,
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  {isActive && (
                    <>
                      <motion.div
                        layoutId="topbar-indicator"
                        className="absolute bottom-[1px] left-1/2 -translate-x-1/2 w-7 h-[2px] rounded-t-full"
                        style={{ background: themeColors.accent, boxShadow: `0 0 12px ${themeColors.accent_glow}, 0 0 24px ${themeColors.accent_glow}50` }}
                        transition={{ type: "spring", stiffness: 500, damping: 35 }}
                      />
                      <div className="absolute inset-0 rounded-xl pointer-events-none" style={{
                        background: `radial-gradient(circle at 50% 50%, ${themeColors.accent}0a 0%, transparent 70%)`,
                      }} />
                    </>
                  )}

                  {item.logo ? (
                    <LauncherLogo size={24} ring className="transition-transform duration-300 group-hover:scale-110" />
                  ) : (
                    <Icon size={17} strokeWidth={isActive ? 2.3 : 1.7} />
                  )}

                  <span className="tinycaps text-[7.5px] font-bold leading-none" style={{
                    color: isActive ? themeColors.accent : themeColors.text_muted,
                    opacity: isActive ? 1 : 0.75,
                  }}>
                    {item.label}
                  </span>

                  {item.featured && !isActive && (
                    <motion.span
                      className="absolute inset-0 rounded-xl pointer-events-none"
                      style={{ background: `linear-gradient(120deg, transparent 30%, ${themeColors.accent}18 50%, transparent 70%)` }}
                      animate={{ x: ["-120%", "120%"] }}
                      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", repeatDelay: 2.5 }}
                    />
                  )}
                </motion.button>
              </Tooltip>
            );
          }))}
        </div>
      </div>

      {/* Right: Version */}
      <div className="relative flex items-center gap-2" style={{ zIndex: 1 }}>
        <div className="hidden sm:flex items-center gap-2">
        </div>
        <div className="tinycaps text-[7px] font-bold px-2 py-1 rounded-lg" style={{
          color: themeColors.text_muted,
          opacity: 0.45,
          border: `1px solid ${themeColors.border}40`,
          background: `${themeColors.bg_card}80`,
          backdropFilter: "blur(8px)",
        }}>V{liveVersion}</div>
      </div>
    </header>
  );
}