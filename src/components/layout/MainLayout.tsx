"use client";

import React from "react";
import { useLauncherStore } from "../../stores";
import { SidebarRail } from "./SidebarRail";
import { HeaderBar } from "./HeaderBar";
import { HeroSection, BottomGrid } from "./HeroStage";
import { ServerWidget } from "./ServerWidget";
import { renderPage as renderPageFromLazy } from "../LazyPages";

export function MainLayout() {
  const { currentPage, setPage, sidebarOpen, themeColors } =
    useLauncherStore();

  return (
    <div
      className="h-screen w-screen overflow-hidden flex bg-[#0d0f12]"
      style={{
        background: themeColors.bg_main,
        color: themeColors.text_main,
      }}
    >
      {/* LEFT: Sidebar Rail */}
      <SidebarRail
        currentTab={currentPage}
        setTab={setPage}
        isOpen={sidebarOpen}
        onClose={() => useLauncherStore.getState().toggleSidebar()}
      />

      {/* CENTER: Main Canvas */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto min-w-0 bg-[#0d0f12]">
        {/* Header Bar */}
        <HeaderBar currentTab={currentPage} />

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-4 relative min-w-0">
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
      </div>

      {/* RIGHT: Server Widget Hub */}
      <ServerWidget
        onJoin={(address, port) => {
          setPage("partners");
        }}
      />
    </div>
  );
}
