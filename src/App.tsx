"use client";

import React, { useEffect, useRef, useMemo, useState, useCallback, ErrorInfo, Component, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "./stores";
import { MainLayoutShell } from "./components/layout/MainLayoutShell";
import { SplashScreen } from "./components/ui/SplashScreen";
import { GameBoostOverlay } from "./components/ui/GameBoostOverlay";
import { LaunchAnimation } from "./components/ui/LaunchAnimation";
import { LoadingOverlay } from "./components/ui/LoadingOverlay";
import { LaunchOverlay } from "./components/ui/LaunchOverlay";
import { WizardOverlay } from "./components/ui/WizardOverlay";
import { MusicPlayer } from "./components/ui/MusicPlayer";
import { AnnouncementHost } from "./components/ui/AnnouncementHost";
import { ToastProvider } from "./components/ui/Toast";
import { DialogHost } from "./components/ui/Dialog";
import { PartnerNotificationListener } from "./components/ui/PartnerNotificationListener";
import { api } from "./lib/api";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./lib/tauri";
import { warmImageCache } from "./lib/imageCache";
import { fetchPartners } from "./lib/partners";
import { checkNavGuard } from "./lib/navGuard";
import { attachUpdateListeners, checkForUpdates, startUpdate } from "./lib/updater";
import { watchAuthState } from "./lib/auth";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crash:", error, info);
  }
  render() {
    if (this.state.hasError) {
      const { themeColors } = useLauncherStore.getState();
      return (
        <div className="flex items-center justify-center h-full">
          <div className="glass-card text-center p-8 rounded-2xl" style={{ border: `1px solid ${themeColors.danger}40` }}>
            <p className="tinycaps text-lg font-bold mb-2" style={{ color: themeColors.danger }}>Something went wrong</p>
            <p className="text-sm mb-4" style={{ color: themeColors.text_muted }}>{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: "" })}
              className="px-4 py-2 rounded-xl text-sm font-semibold tinycaps"
              style={{ background: themeColors.accent, color: themeColors.accent_text }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const pageVariants = {
  initial: { opacity: 0, y: 12, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.99 },
};

const pageTransition = {
  type: "tween" as const,
  ease: [0.4, 0, 0.2, 1],
  duration: 0.25,
};

const potatoPageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const potatoPageTransition = {
  type: "tween" as const,
  ease: "linear" as const,
  duration: 0.08,
};

/**
 * Reactive loading overlay. Lives in its own component so App itself never
 * has to subscribe to `isLoading` — previously App destructured the WHOLE
 * store, meaning every single store write (logs, settings, playTimes,
 * install progress, server polls…) re-rendered the entire component tree.
 */
function LoadingGate() {
  const isLoading = useLauncherStore((s) => s.isLoading);
  return isLoading ? <LoadingOverlay /> : null;
}

/**
 * Pre-download the art the first screens show (client startup warm-up):
 * the mc-heads avatar used by the hero pill/profile cards plus every partner
 * logo, banner and server icon. Runs in the background once — first paint
 * then hits ~/.xryloth/image_cache on disk instead of the network, and the
 * backend keeps those copies revalidated (If-None-Match) automatically.
 */
function warmStartupImages() {
  const urls: string[] = [];
  // Exactly the URL shape HeroStage/avatarUrl requests (mcId() normalizes
  // every name to this same default hash), so the warm hit is a cache hit.
  urls.push("https://mc-heads.net/avatar/8660ba3e76424a96b46f0b738fcc8806?size=64");
  fetchPartners()
    .then((list) => {
      for (const p of list) {
        if (p.logo && /^https?:/i.test(p.logo)) urls.push(p.logo);
        if (p.banner && /^https?:/i.test(p.banner)) urls.push(p.banner);
        if (p.ip) urls.push(`https://api.mcsrvstat.us/icon/${p.ip}`);
      }
      warmImageCache(urls);
    })
    .catch(() => warmImageCache(urls));
}

function App() {
  // Narrow selectors only: these re-render App only when the selected slice
  // actually changes (theme name / stable action refs — i.e. almost never).
  const themeName = useLauncherStore((s) => s.themeName);
  const setPage = useLauncherStore((s) => s.setPage);
  const [splashDone, setSplashDone] = useState(false);
  const [launchInstance, setLaunchInstance] = useState<string | null>(null);
  const [boostInstance, setBoostInstance] = useState<string | null>(null);
  const [launchAnimInstance, setLaunchAnimInstance] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    // Actions are stable store references — read once, no subscription needed.
    const { loadSettings, loadInstances, fetchLiveVersion, loadSystemInfo } =
      useLauncherStore.getState();
    loadSettings().then(() => {
      loadInstances()
        .then(() => {
          try {
            warmStartupImages();
          } catch {
            /* warm-up is best-effort */
          }
        })
        .catch(() => {});
      api.wizard.checkFirstLaunch().then((result) => {
        if (result.first_launch) setShowWizard(true);
      }).catch(() => {});
    });
    fetchLiveVersion();
    loadSystemInfo();

    const handleLaunchEvent = (e: CustomEvent) => {
      const name = e.detail?.instanceName;
      if (name) setBoostInstance(name);
    };
    window.addEventListener("ec-launch-game", handleLaunchEvent as EventListener);
    return () => window.removeEventListener("ec-launch-game", handleLaunchEvent as EventListener);
  }, []);

  // Global handler for Xryloth AI UI actions that must survive page changes.
  // "open-create-instance" fires right after the AI navigates to the Profiles
  // page; we wait a beat for that page to mount, then open its Create wizard.
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const u = await listen<{ type: string }>("ai-action", (e) => {
        if (e.payload?.type === "open-create-instance") {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("ec-open-create-instance"));
          }, 450);
        }
      });
      if (cancelled) u(); else un = u;
    })();
    return () => { cancelled = true; if (un) un(); };
  }, []);

  useEffect(() => watchAuthState(), []);

  useEffect(() => {
    attachUpdateListeners();
    const timer = setTimeout(async () => {
      const { settings } = useLauncherStore.getState();
      if (settings.auto_check_updates === false) return;
      const info = await checkForUpdates();
      if (info?.update_available && settings.auto_update !== false) {
        setTimeout(() => { startUpdate(); }, 1800);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        if (checkNavGuard("instances")) { setPage("instances"); window.dispatchEvent(new CustomEvent("ec-open-create-instance")); }
      } else if (ctrl && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        if (checkNavGuard("mods")) setPage("mods");
      } else if (ctrl && (e.key === "," || e.key === ".")) {
        e.preventDefault();
        setPage("settings");
      } else if (ctrl && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        if (checkNavGuard("themes")) setPage("themes");
      } else if (e.key === "F5") {
        e.preventDefault();
        const ev = new CustomEvent("ec-refresh-current");
        window.dispatchEvent(ev);
      } else if (e.key === "Escape") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ec-escape-pressed"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setPage]);

  useEffect(() => {
    document.title = `Xryloth — ${themeName.charAt(0).toUpperCase() + themeName.slice(1)}`;
  }, [themeName]);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);
  const handleLaunchComplete = useCallback(() => setLaunchInstance(null), []);
  const handleBoostComplete = useCallback(() => {
    const name = boostInstance;
    setBoostInstance(null);
    if (name) {
      setLaunchAnimInstance(name);
      api.instances.launch(name).catch(console.error);
    }
  }, [boostInstance]);

  const handleLaunchAnimComplete = useCallback(() => setLaunchAnimInstance(null), []);

  if (!splashDone) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  return (
    <ToastProvider>
      <ErrorBoundary>
        <MainLayoutShell />
      </ErrorBoundary>
      <LoadingGate />
      {launchInstance && <LaunchOverlay instanceName={launchInstance} onComplete={handleLaunchComplete} />}
      <MusicPlayer />
      <AnimatePresence>
        {boostInstance && <GameBoostOverlay instanceName={boostInstance} onComplete={handleBoostComplete} />}
      </AnimatePresence>
      <AnimatePresence>
        {launchAnimInstance && <LaunchAnimation instanceName={launchAnimInstance} onComplete={handleLaunchAnimComplete} />}
      </AnimatePresence>
      <AnimatePresence>
        {showWizard && <WizardOverlay onComplete={() => setShowWizard(false)} />}
      </AnimatePresence>
      <AnnouncementHost />
      <PartnerNotificationListener />
      <DialogHost />
    </ToastProvider>
  );
}

export default App;