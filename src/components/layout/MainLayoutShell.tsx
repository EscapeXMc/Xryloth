"use client";

import React from "react";
import { useLauncherStore } from "../../stores";
import { SidebarRail } from "./SidebarRail";
import { HeaderBar } from "./HeaderBar";
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
      className="h-screen w-screen overflow-hidden flex bg-[#090B0E] text-white select-none"
    >
      {/* ==================== COLUMN 1: LEFT NAVIGATION RAIL ==================== */}
      <SidebarRail
        currentTab={currentTab}
        setTab={(tab: string) => setPage(tab.toLowerCase())}
        isOpen={sidebarOpen}
        onClose={() => useLauncherStore.getState().toggleSidebar()}
      />

      {/* ==================== COLUMN 2: CENTER MAIN CANVAS ==================== */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0D0F12] h-full overflow-hidden">
        {/* Top Header Bar */}
        <HeaderBar currentTab={currentTab} />

        {/* Content */}
        {isFullBleed ? (
          // Full-bleed view (Chat / AI): occupies the entire main viewport.
          <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-[#0D0F12] flex flex-col">
            <div className="flex-1 min-h-0">
              {renderPageFromLazy(currentPage)}
            </div>
          </main>
        ) : (
          // Scrollable, constrained content
          <main className="flex-1 overflow-y-auto p-6 min-w-0 bg-[#0D0F12]">
            <div className="max-w-7xl mx-auto">
              {currentPage === "play" ? (
                <>
                  <HeroSection />
                  <BottomGrid />
                </>
              ) : (
                <div className="min-h-[400px] flex items-center justify-center bg-[#0D0F12]">
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
          className="w-80 flex-shrink-0 h-full border-l border-white/[0.08] bg-[#0A0C0E] p-4 flex flex-col gap-4 overflow-y-auto scrollbar-hide animate-in fade-in duration-200"
        >
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
