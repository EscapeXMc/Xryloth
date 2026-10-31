import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import {
  Home, Layers, Puzzle, Package, Boxes, Users, Settings, FileText,
  Layout, MessageCircle, Palette, Server, Award, ChevronsLeft, ChevronsRight, Megaphone, ShoppingBag,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import { AnimatedLogo, LauncherLogo } from "./AnimatedLogo";
import { useSounds } from "./SoundEffects";
import { checkNavGuard } from "../../lib/navGuard";
import { usePotatoMode } from "../../lib/deviceTier";

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
  /** Runs instead of navigating, for entries that leave the app. */
  action?: () => void;
};

type NavSection = { title: string; items: NavItem[] };

/*
 * The rail follows the order a player actually walks it in: play, profiles,
 * accounts, partners, store, settings - then everything that is not part of
 * that path.
 */
const sections: NavSection[] = [
  {
    title: "Play",
    items: [
      { id: "home", label: "PLAY", icon: Home, desc: "Your dashboard" },
      { id: "announcements", label: "NEWS", icon: Megaphone, desc: "Announcements & pings", featured: true },
      { id: "chat", label: "CHAT", icon: MessageCircle, desc: "Community chat" },
    ],
  },
  {
    title: "Library",
    items: [
      { id: "instances", label: "PROFILES", icon: Layers, shortcut: "Ctrl+N", desc: "Game profiles" },
      { id: "mods", label: "MODS", icon: Puzzle, shortcut: "Ctrl+M", desc: "Mods & plugins" },
      { id: "modpacks", label: "MODPACKS", icon: Boxes, desc: "Modpacks" },
      { id: "packs", label: "PACKS", icon: Package, desc: "Resource packs" },
      { id: "templates", label: "TEMPLATES", icon: Layout, desc: "Profile templates" },
      { id: "servers", label: "SERVERS", icon: Server, desc: "Self-hosted servers" },
    ],
  },
  {
    title: "Account",
    items: [
      { id: "accounts", label: "ACCOUNTS", icon: Users, desc: "Accounts & skins" },
      { id: "xai", label: "AI", icon: null, desc: "Xryloth AI assistant", logo: true, featured: true },
    ],
  },
  {
    title: "Store",
    items: [
      { id: "store", label: "STORE", icon: ShoppingBag, desc: "Ranks, cosmetics and modpacks" },
    ],
  },
  {
    title: "More",
    items: [
      { id: "themes", label: "THEMES", icon: Palette, shortcut: "Ctrl+T", desc: "Themes & colours" },
      { id: "logs", label: "LOGS", icon: FileText, desc: "Launcher logs" },
      { id: "settings", label: "SETTINGS", icon: Settings, shortcut: "Ctrl+,", desc: "Launcher settings" },
    ],
  },
];

const WIDTH_EXPANDED = 196;
const WIDTH_COLLAPSED = 76;

/**
 * The rail starts collapsed on every launch. Pinning it open is an explicit
 * user choice (the button at the bottom) and the only thing persisted here.
 */
function loadPinned(): boolean {
  try {
    return localStorage.getItem("xryl.sidebar.expanded") === "1";
  } catch {
    return false;
  }
}

export function Sidebar() {
  const { currentPage, setPage, themeColors, liveVersion, settings } = useLauncherStore();
  const { play: playSound } = useSounds();
  const potato = usePotatoMode();
  const [pinned, setPinned] = useState(loadPinned);
  const [hovered, setHovered] = useState(false);

  // Hovering the collapsed rail expands it; pinning keeps it open.
  const expanded = pinned || hovered;

  const toggle = () => {
    setPinned((p) => {
      const next = !p;
      try { localStorage.setItem("xryl.sidebar.expanded", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
    playSound("click");
  };

  // The store lives on the website when it is configured, and falls back to the
  // modpack browser until then.
  const storeAction = () => {
    const url = (settings as any)?.webstore_url;
    if (url) window.open(url, "_blank");
    else setPage("modpacks");
  };

  const width = expanded ? WIDTH_EXPANDED : WIDTH_COLLAPSED;
  const duration = potato ? "duration-150" : "duration-300";

  return (
    // The rail's footprint in the flex row never follows hover: it stays
    // WIDTH_COLLAPSED unless pinned, so hover-expansion slides *over* the page
    // rather than reflowing it. Otherwise moving the pointer away would shift
    // the content out from under whatever the user was about to click.
    <div
      className="relative shrink-0 self-stretch transition-[width] duration-300"
      style={{ width: pinned ? WIDTH_EXPANDED : WIDTH_COLLAPSED, zIndex: 30 }}
    >
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`absolute inset-y-0 left-0 flex flex-col py-3 gap-1 overflow-y-auto overflow-x-hidden transition-[width] ${duration}`}
        style={{
          width,
          // More opaque while floating over the page, so labels stay legible.
          background: `${themeColors.bg_nav}${expanded ? "f2" : "99"}`,
          borderRight: `1px solid ${themeColors.border}`,
          backdropFilter: "blur(12px) saturate(1.4)",
          WebkitBackdropFilter: "blur(12px) saturate(1.4)",
        }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `linear-gradient(180deg, ${themeColors.accent}08 0%, transparent 22%)`,
      }} />

      {/* Brand — a crisp white mark plus bold typography, no orbit/glow. */}
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
        <span
          className="relative flex items-center justify-center rounded-xl overflow-hidden shrink-0"
          style={{ width: 34, height: 34, boxShadow: `0 0 0 1px ${themeColors.accent}40` }}
        >
          <img src="/logo.png" alt="Xryloth" className="w-full h-full object-contain" />
        </span>
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
                  // The store lives on the website when it is configured, and
                  // falls back to the modpack browser until then.
                  if (item.id === "store") { storeAction(); playSound("click"); return; }
                  if (item.id !== "settings" && !checkNavGuard(item.id)) return;
                  setPage(item.id); playSound("click");
                }}
                className={
                  expanded
                    ? `relative w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 group`
                    : `relative w-[58px] flex flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-300 group ${item.logo ? "py-1.5" : "py-2"}`
                }
                style={{
                  // Active tab: a solid white pill with obsidian icons and text.
                  background: isActive ? themeColors.accent : "transparent",
                  color: isActive ? themeColors.accent_text : themeColors.nav_inactive,
                  border: "1px solid transparent",
                  boxShadow: isActive
                    ? `0 6px 20px rgba(0,0,0,0.45)`
                    : item.featured ? `0 0 0 1px ${themeColors.accent}18` : undefined,
                }}
                whileHover={{
                  scale: 1.02,
                  backgroundColor: isActive ? themeColors.accent : `${themeColors.bg_hover}40`,
                  color: isActive ? themeColors.accent_text : themeColors.text_main,
                }}
                whileTap={{ scale: 0.96 }}
              >
                {item.logo ? (
                  <LauncherLogo size={expanded ? 30 : 36} ring className="transition-transform duration-300 group-hover:scale-110 shrink-0" />
                ) : (
                  <Icon size={expanded ? 18 : 24} strokeWidth={isActive ? 2.3 : 1.7} className="shrink-0" />
                )}

                <AnimatePresence>
                  {expanded && (
                    <motion.span
                      className="tinycaps text-[11px] font-bold leading-none truncate"
                      style={{ color: isActive ? themeColors.accent_text : themeColors.text_muted, opacity: isActive ? 1 : 0.85 }}
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
                    color: isActive ? themeColors.accent_text : themeColors.text_muted,
                    opacity: isActive ? 1 : 0.75,
                  }}>
                    {item.label}
                  </span>
                )}

                {expanded && item.shortcut && (
                  <span className="ml-auto text-[9px] font-mono opacity-40 shrink-0" style={{ color: isActive ? themeColors.accent_text : themeColors.text_muted }}>
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

      {/* Pin toggle -- the rail itself expands on hover */}
      <button
        onClick={toggle}
        className="mb-1 flex items-center justify-center gap-2 rounded-xl px-1 py-1.5 transition-all duration-200 group"
        style={{ color: themeColors.text_muted }}
        title={pinned ? "Unpin — collapse to icons (hover to expand)" : "Pin sidebar open"}
      >
        <span className="p-1 rounded-lg transition-colors" style={{ background: `${themeColors.bg_hover}30` }}>
          {pinned ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
        </span>
        {expanded && (
          <span className="tinycaps text-[10px] font-bold tracking-[0.14em] opacity-60 group-hover:opacity-100">
            {pinned ? "UNPIN" : "PIN OPEN"}
          </span>
        )}
      </button>

      <div className="tinycaps text-[11px] font-bold px-1.5 py-1 rounded-lg mb-1" style={{
        color: themeColors.text_muted,
        opacity: 0.45,
        border: `1px solid ${themeColors.border}40`,
      }}>V{liveVersion}</div>
      </aside>
    </div>
  );
}