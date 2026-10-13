import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import {
  Home, Layers, Puzzle, Package, Boxes, Users, Settings, FileText,
  Layout, MessageCircle, Palette, Server, Award, ChevronsLeft, ChevronsRight,
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
  /** Render the launcher logo instead of the lucide icon. */
  logo?: boolean;
  /** Highlight this entry as a featured section. */
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
      { id: "partners", label: "PARTNERS", icon: Award, desc: "Partnered servers", featured: true },
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

function loadExpanded(): boolean {
  try {
    const v = localStorage.getItem("xryl.sidebar.expanded");
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function Sidebar() {
  const { currentPage, setPage, themeColors, liveVersion } = useLauncherStore();
  const { play: playSound } = useSounds();
  const [expanded, setExpanded] = useState(loadExpanded);

  const toggle = () => {
    setExpanded((e) => {
      const next = !e;
      try { localStorage.setItem("xryl.sidebar.expanded", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
    playSound("click");
  };

  const widthClass = expanded ? "w-[196px]" : "w-[76px]";

  return (
    <aside className={`${widthClass} shrink-0 flex flex-col py-3 gap-1 overflow-y-auto overflow-x-hidden relative transition-[width] duration-300`}
      style={{
        background: `${themeColors.bg_nav}99`,
        borderRight: `1px solid ${themeColors.border}`,
        backdropFilter: "blur(32px) saturate(1.4)",
        WebkitBackdropFilter: "blur(32px) saturate(1.4)",
      }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `linear-gradient(180deg, ${themeColors.accent}08 0%, transparent 22%)`,
      }} />

      {/* Brand */}
      <motion.button
        onClick={() => { setPage("home"); playSound("click"); }}
        className="relative mb-1.5 mt-0.5 rounded-xl flex items-center"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Xryloth home"
      >
        <AnimatedLogo size={44} animated={true} />
        <AnimatePresence>
          {expanded && (
            <motion.div
              className="leading-none ml-1 text-left"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.2 }}
            >
              <span className="block tinycaps text-[14px] font-black tracking-[0.16em]" style={{ color: themeColors.text_main }}>
                XRYLOTH
              </span>
              <span className="block text-[9px] tracking-[0.3em] mt-0.5" style={{ color: themeColors.text_muted }}>
                CLIENT
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      <div className="w-7 h-px mb-2" style={{ background: `${themeColors.border}60` }} />

      {sections.map((section, si) => (
        <div key={section.title} className="w-full flex flex-col items-center">
          {si > 0 && expanded && (
            <div className="w-full px-3 mb-1 mt-1">
              <div className="w-full h-px" style={{ background: `${themeColors.border}30` }} />
            </div>
          )}
          {si > 0 && !expanded && (
            <div className="w-6 h-px my-1.5" style={{ background: `${themeColors.border}40` }} />
          )}

          {expanded ? (
            <div className="w-full px-2.5 mb-1">
              <p className="tinycaps text-[9px] font-bold tracking-[0.22em] uppercase" style={{ color: themeColors.text_muted, opacity: 0.45 }}>
                {section.title}
              </p>
            </div>
          ) : (
            <p className="tinycaps text-[10px] font-bold mb-1 tracking-[0.14em] shrink-0" style={{
              color: themeColors.text_muted,
              opacity: 0.5,
            }}>
              {section.title.slice(0, 4).toUpperCase()}
            </p>
          )}

          {section.items.map((item) => {
            const isActive = currentPage === item.id;
            const Icon = item.icon;

            const inner = (
              <motion.button
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                onClick={() => {
                  if (item.id !== "settings" && !checkNavGuard(item.id)) return;
                  setPage(item.id); playSound("click");
                }}
                className={
                  expanded
                    ? `relative w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 group`
                    : `relative w-[58px] flex flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-300 group ${item.logo ? "py-1.5" : "py-2"}`
                }
                style={{
                  background: isActive
                    ? `linear-gradient(135deg, ${themeColors.accent}22, ${themeColors.accent}0d)`
                    : "transparent",
                  color: isActive ? themeColors.accent : themeColors.nav_inactive,
                  border: isActive ? `1px solid ${themeColors.accent}38` : "1px solid transparent",
                  boxShadow: item.featured && !isActive ? `0 0 0 1px ${themeColors.accent}18` : undefined,
                }}
                whileHover={{
                  scale: 1.02,
                  backgroundColor: isActive ? undefined : `${themeColors.bg_hover}40`,
                  borderColor: `${themeColors.accent}30`,
                }}
                whileTap={{ scale: 0.96 }}
              >
                {isActive && (
                  <>
                    <motion.div
                      layoutId="sidebar-indicator"
                      className={expanded ? "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full" : "absolute -left-[1px] top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full"}
                      style={{ background: themeColors.accent, boxShadow: `0 0 12px ${themeColors.accent_glow}, 0 0 24px ${themeColors.accent_glow}50` }}
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                    <div className="absolute inset-0 rounded-xl pointer-events-none" style={{
                      background: `radial-gradient(circle at 50% 50%, ${themeColors.accent}0a 0%, transparent 70%)`,
                    }} />
                  </>
                )}

                {item.logo ? (
                  <LauncherLogo size={expanded ? 30 : 36} ring className="transition-transform duration-300 group-hover:scale-110 shrink-0" />
                ) : (
                  <Icon size={expanded ? 18 : 24} strokeWidth={isActive ? 2.3 : 1.7} className="shrink-0" />
                )}

                <AnimatePresence>
                  {expanded && (
                    <motion.span
                      className="tinycaps text-[11px] font-bold leading-none truncate"
                      style={{ color: isActive ? themeColors.accent : themeColors.text_muted, opacity: isActive ? 1 : 0.85 }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>

                {!expanded && (
                  <span className="tinycaps text-[12px] font-bold leading-none" style={{
                    color: isActive ? themeColors.accent : themeColors.text_muted,
                    opacity: isActive ? 1 : 0.75,
                  }}>
                    {item.label}
                  </span>
                )}

                {expanded && item.shortcut && (
                  <span className="ml-auto text-[9px] font-mono opacity-40 shrink-0" style={{ color: themeColors.text_muted }}>
                    {item.shortcut}
                  </span>
                )}

                {item.featured && !isActive && (
                  <motion.span
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ background: `linear-gradient(120deg, transparent 30%, ${themeColors.accent}18 50%, transparent 70%)` }}
                    animate={{ x: ["-120%", "120%"] }}
                    transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", repeatDelay: 2.5 }}
                  />
                )}
              </motion.button>
            );

            if (expanded) return <div key={item.id} className="w-full px-2">{inner}</div>;
            return (
              <Tooltip
                key={item.id}
                content={item.desc ? `${item.label} — ${item.desc}` : item.label}
                shortcut={item.shortcut || undefined}
                side="right"
              >
                {inner}
              </Tooltip>
            );
          })}
        </div>
      ))}

      <div className="flex-1" />

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        className="mb-1 flex items-center justify-center gap-2 rounded-xl px-1 py-1.5 transition-all duration-200 group"
        style={{ color: themeColors.text_muted }}
        title={expanded ? "Collapse sidebar" : "Expand sidebar"}
      >
        <span className="p-1 rounded-lg transition-colors" style={{ background: `${themeColors.bg_hover}30` }}>
          {expanded ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
        </span>
        {expanded && (
          <span className="tinycaps text-[10px] font-bold tracking-[0.14em] opacity-60 group-hover:opacity-100">
            COLLAPSE
          </span>
        )}
      </button>

      <div className="tinycaps text-[11px] font-bold px-1.5 py-1 rounded-lg mb-1" style={{
        color: themeColors.text_muted,
        opacity: 0.45,
        border: `1px solid ${themeColors.border}40`,
      }}>V{liveVersion}</div>
    </aside>
  );
}