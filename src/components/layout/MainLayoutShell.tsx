"use client";

import React from "react";
import { useLauncherStore } from "../../stores";
import { SidebarRail } from "./SidebarRail";
import { HeaderBar, WindowControls } from "./HeaderBar";
import { HeroSection } from "./HeroStage";
import { BottomGrid } from "./HeroStage";
import { ServerWidget } from "./ServerWidget";
import { renderPage as renderPageFromLazy } from "../LazyPages";

/**
 * MainLayoutShell — Persistent global shell wrapped around ALL sub-views.
 *
 * Layout architecture (fixed 3-column):
 *   Col 1: SidebarRail (w-20, always visible)
 *   Col 2: Center canvas (flex-1, dynamic content per route)
 *   Col 3: ServerWidget / RightSidebarHub (w-80, ONLY on Play/Home page)
 *
 * Sub-pages (Profiles, Mods, Partners, Accounts, Settings, etc.) get the
 * full center-canvas width because the right hub is conditionally omitted.
 *
 * Two shell-wide decisions:
 *   1. The window controls (minimize/maximize/close) are pinned to the
 *      window's TRUE top-right corner here, not inside the header. The
 *      header only spans the center column, so keeping the buttons there
 *      parked a minimize button in the middle of the title area — right
 *      where drags and stray clicks land (the "clicking the screen
 *      minimizes it" bug). They now sit where every other app puts them,
 *      outside the drag region's click path.
 *   2. The columns paint over one shared ambient layer (slow ember fields,
 *      static radial gradients — no blur cost) with translucent fills, so
 *      the frosted-glass surfaces behind them have something to refract.
 */
export function MainLayoutShell() {
  // Narrow selectors — the shell only re-renders when the route or sidebar
  // visibility actually changes, not on every store write (logs, polls, …),
  // which used to re-render every page under it.
  const currentPage = useLauncherStore((s) => s.currentPage);
  const setPage = useLauncherStore((s) => s.setPage);
  const sidebarOpen = useLauncherStore((s) => s.sidebarOpen);

  // Map currentPage to tab labels used by the shell.
  const currentTab = currentPage === "play" ? "PLAY" : currentPage.charAt(0).toUpperCase() + currentPage.slice(1);

  const showRightHub = currentPage === "play";

  // Pages that own the entire center viewport (no max-width / padding wrapper).
  const isFullBleed = currentPage === "chat" || currentPage === "xai" || currentPage === "servers";

  return (
    <div
      className="relative h-screen w-screen overflow-hidden flex bg-[#090B0E] text-white select-none"
    >
      {/* ==================== AMBIENT EMBER FIELD ====================
          Static radial gradients only (GPU-cheap — no filter, no blur).
          Sits under every column; the translucent column fills and the
          frosted panels pick it up as depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(900px 520px at 16% -12%, rgba(224,107,34,0.10), transparent 62%)," +
            "radial-gradient(760px 500px at 86% 112%, rgba(200,81,8,0.09), transparent 66%)," +
            "radial-gradient(640px 420px at 78% -16%, rgba(255,255,255,0.04), transparent 60%)",
        }}
      />

      {/* ==================== WINDOW CONTROLS (TRUE CORNER) ====================
          Absolute to the shell root = the window's own top-right corner on
          every page. z-30 keeps it under dialogs/overlays (z-50+). */}
      <div className="absolute top-0 right-0 z-30">
        <WindowControls />
      </div>

      {/* ==================== COLUMN 1: LEFT NAVIGATION RAIL ==================== */}
      <SidebarRail
        currentTab={currentTab}
        setTab={(tab: string) => setPage(tab.toLowerCase())}
        isOpen={sidebarOpen}
        onClose={() => useLauncherStore.getState().toggleSidebar()}
      />

      {/* ==================== COLUMN 2: CENTER MAIN CANVAS ==================== */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0D0F12]/70 h-full overflow-hidden">
        {/* Top Header Bar */}
        <HeaderBar currentTab={currentTab} />

        {/* Content */}
        {isFullBleed ? (
          // Full-bleed view (Chat / AI): occupies the entire main viewport.
          <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0">
              {renderPageFromLazy(currentPage)}
            </div>
          </main>
        ) : (
          // Scrollable, constrained content
          <main className="flex-1 overflow-y-auto p-6 min-w-0">
            <div className="max-w-7xl mx-auto">
              {currentPage === "play" ? (
                <>
                  <HeroSection />
                  <BottomGrid />
                </>
              ) : (
                <div className="min-h-[400px] flex items-center justify-center">
                  {renderPageFromLazy(currentPage)}
                </div>
              )}
            </div>
          </main>
        )}
      </div>

      {/* ==================== COLUMN 3: RIGHT SIDEBAR HUB (PLAY ONLY) ==================== */}
      {showRightHub && (
        <aside
          className="relative w-80 flex-shrink-0 h-full border-l border-white/[0.08] bg-[#0A0C0E]/65 pt-14 px-4 pb-4 flex flex-col gap-4 overflow-y-auto scrollbar-hide animate-in fade-in duration-200"
        >
          {/* Top band — visually continues the header line across the hub
              and keeps its first row clear of the corner window controls.
              Draggable, like the header it extends. */}
          <div
            data-tauri-drag-region
            className="absolute top-0 left-0 right-0 h-14 border-b border-white/[0.07] bg-[#090B0E]/50 backdrop-blur-md pointer-events-auto"
          />
          <ServerWidget
            onJoin={() => {
              setPage("partners");
            }}
          />
        </aside>
      )}
    </div>
  );
}
