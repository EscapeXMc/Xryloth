import { useEffect, useRef, useMemo, useState, useCallback, ErrorInfo, Component, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "./stores";
import { Sidebar } from "./components/ui/Sidebar";
import { TitleBar } from "./components/ui/TitleBar";
import { LoadingOverlay } from "./components/ui/LoadingOverlay";
import { SplashScreen } from "./components/ui/SplashScreen";
import { LaunchOverlay } from "./components/ui/LaunchOverlay";
import { WizardOverlay } from "./components/ui/WizardOverlay";
import { AnimatedBackground, useAnimatedBg } from "./components/ui/AnimatedBackgrounds";
import { LaunchAnimation } from "./components/ui/LaunchAnimation";
import { MinecraftParticles } from "./components/ui/MinecraftParticles";
import { ThemeSync } from "./components/ui/ThemeSync";
import { MusicPlayer } from "./components/ui/MusicPlayer";
import { HomePage } from "./components/pages/HomePage";
import { InstancesPage } from "./components/pages/InstancesPage";
import { ModsPage } from "./components/pages/ModsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { AccountsPage } from "./components/pages/AccountsPage";
import { XrylothAIPage } from "./components/pages/XrylothAIPage";
import { PacksPage } from "./components/pages/PacksPage";
import { ModpacksPage } from "./components/pages/ModpacksPage";
import { LogsPage } from "./components/pages/LogsPage";
import { ServersPage } from "./components/pages/ServersPage";
import { PartnersPage } from "./components/pages/PartnersPage";
import { TemplatesPage } from "./components/pages/TemplateBrowser";
import { ConfigEditorPage } from "./components/pages/ConfigEditorPage";
import { ChatPage } from "./components/pages/ChatPage";
import { ThemesPage } from "./components/pages/ThemesPage";
import { AnnouncementsPage } from "./components/pages/AnnouncementsPage";
import { AnnouncementTicker } from "./components/ui/AnnouncementTicker";
import { AnnouncementHost } from "./components/ui/AnnouncementPopup";
import { ToastProvider } from "./components/ui/Toast";
import { Breadcrumb } from "./components/ui/Breadcrumb";
import { GameBoostOverlay } from "./components/ui/GameBoostOverlay";
import { UpdateOverlay } from "./components/ui/UpdateOverlay";
import { api } from "./lib/api";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { checkNavGuard } from "./lib/navGuard";
import { attachUpdateListeners, checkForUpdates, startUpdate } from "./lib/updater";
import { usePotatoMode } from "./lib/deviceTier";
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

/** The cheapest backdrop: two static radial gradients. No animation, no network. */
function StaticBackdrop({ themeColors }: { themeColors: any }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <div className="absolute inset-0" style={{
        background: `radial-gradient(circle at 20% 20%, ${themeColors.accent}08 0%, transparent 50%), radial-gradient(circle at 80% 80%, ${themeColors.purple || themeColors.blue}06 0%, transparent 50%)`,
      }} />
    </div>
  );
}

function AnimatedOrbs({ themeColors }: { themeColors: any }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <div className="absolute" style={{
        top: "10%", left: "15%", width: "400px", height: "400px",
        background: `radial-gradient(circle, ${themeColors.accent}12 0%, transparent 70%)`,
        borderRadius: "50%", filter: "blur(80px)",
        animation: "orbFloat1 20s ease-in-out infinite",
      }} />
      <div className="absolute" style={{
        bottom: "15%", right: "10%", width: "350px", height: "350px",
        background: `radial-gradient(circle, ${themeColors.purple || themeColors.blue}10 0%, transparent 70%)`,
        borderRadius: "50%", filter: "blur(80px)",
        animation: "orbFloat2 25s ease-in-out infinite",
      }} />
      <div className="absolute" style={{
        top: "50%", left: "50%", width: "300px", height: "300px",
        background: `radial-gradient(circle, ${themeColors.accent}08 0%, transparent 70%)`,
        borderRadius: "50%", filter: "blur(60px)",
        animation: "orbFloat3 18s ease-in-out infinite",
      }} />
    </div>
  );
}

function FloatingParticles({ themeColors }: { themeColors: any }) {
  const particles = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: Math.random() * 3 + 1,
      duration: Math.random() * 20 + 15,
      delay: Math.random() * 15,
      opacity: Math.random() * 0.4 + 0.1,
    })), []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {particles.map((p) => (
        <div key={p.id} className="absolute rounded-full" style={{
          left: `${p.left}%`,
          bottom: "-10px",
          width: `${p.size}px`,
          height: `${p.size}px`,
          background: themeColors.accent,
          opacity: p.opacity,
          animation: `particleDrift ${p.duration}s linear ${p.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

function BackgroundLayer() {
  const { settings, themeColors } = useLauncherStore();
  const potato = usePotatoMode();
  const isLinux = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent || (navigator as any).platform || "");
  const bgType = settings.launcher_bg_type || (isLinux ? "none" : "video");
  const bgImage = settings.launcher_bg_image || "";
  const bgVideo = settings.launcher_bg_video || "https://cdn.pixabay.com/video/2023/06/24/168653-839542456_large.mp4";
  const bgOpacity = settings.launcher_bg_opacity ?? 65;
  const bgBlur = settings.launcher_bg_blur ?? 4;
  const bgFit = settings.launcher_bg_fit || "cover";
  const bgBrightness = settings.launcher_bg_brightness ?? 36;
  const bgDimming = settings.launcher_bg_dimming ?? 3;
  const videoRef = useRef<HTMLVideoElement>(null);
  const fitVal = bgFit === "stretch" ? "fill" : bgFit;
  const [resolvedBgImage, setResolvedBgImage] = useState("");
  const [resolvedBgVideo, setResolvedBgVideo] = useState("");

  useEffect(() => {
    // Low-end tier never paints a custom image, so skip the lookup as well.
    if (potato) { setResolvedBgImage(""); return; }
    if (bgType === "image" && bgImage) {
      if (bgImage === "file") {
        api.background.getFilePath().then((path) => {
          if (path) setResolvedBgImage(convertFileSrc(path));
        }).catch(() => {});
      } else if (bgImage.startsWith("http")) {
        setResolvedBgImage(bgImage);
      } else if (bgImage.startsWith("data:")) {
        setResolvedBgImage(bgImage);
      } else {
        setResolvedBgImage(convertFileSrc(bgImage));
      }
    } else {
      setResolvedBgImage("");
    }
  }, [bgType, bgImage, potato]);

  useEffect(() => {
    // Low-end tier never paints the background video, so never fetch its source.
    if (potato) { setResolvedBgVideo(""); return; }
    if (bgType === "video" && bgVideo) {
      if (bgVideo === "file") {
        api.background.getVideoPath().then((path) => {
          if (path) setResolvedBgVideo(convertFileSrc(path));
        }).catch(() => {});
      } else if (bgVideo.startsWith("http")) {
        setResolvedBgVideo(bgVideo);
      } else {
        setResolvedBgVideo(convertFileSrc(bgVideo));
      }
    } else {
      setResolvedBgVideo("");
    }
  }, [bgType, bgVideo, potato]);

  const showCustom = (bgType === "image" && resolvedBgImage) || (bgType === "video" && resolvedBgVideo);

  // Low-end tier: no video, no custom image, no animated layers -- a single
  // static gradient, with nothing that repaints per frame.
  if (potato) return <StaticBackdrop themeColors={themeColors} />;

  if (!showCustom) {
    if (settings.enable_particles === false) return <StaticBackdrop themeColors={themeColors} />;
    return (
      <>
        <AnimatedOrbs themeColors={themeColors} />
        <FloatingParticles themeColors={themeColors} />
      </>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {bgType === "image" && resolvedBgImage && (
        <img src={resolvedBgImage} alt="" className="absolute inset-0 w-full h-full"
          style={{
            objectFit: fitVal,
            opacity: bgOpacity / 100,
            filter: [
              bgBlur > 0 ? `blur(${bgBlur}px)` : "",
              bgBrightness !== 100 ? `brightness(${bgBrightness}%)` : "",
            ].filter(Boolean).join(" ") || undefined,
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      )}
      {bgType === "video" && resolvedBgVideo && (
        <video ref={videoRef} src={resolvedBgVideo} autoPlay loop muted playsInline
          className="absolute inset-0 w-full h-full"
          style={{
            objectFit: fitVal,
            opacity: bgOpacity / 100,
            filter: [
              bgBlur > 0 ? `blur(${bgBlur}px)` : "",
              bgBrightness !== 100 ? `brightness(${bgBrightness}%)` : "",
            ].filter(Boolean).join(" ") || undefined,
          }}
          onError={(e) => { (e.target as HTMLVideoElement).style.display = "none"; }} />
      )}
      {/* Dark dimming overlay */}
      {bgDimming > 0 && (
        <div className="absolute inset-0" style={{
          background: `rgba(0,0,0,${bgDimming / 100})`,
        }} />
      )}
      <div className="absolute inset-0" style={{
        background: `linear-gradient(180deg, ${themeColors.bg_main}44 0%, ${themeColors.bg_main}18 40%, ${themeColors.bg_main}18 60%, ${themeColors.bg_main}44 100%)`,
      }} />
      <FloatingParticles themeColors={themeColors} />
    </div>
  );
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

// Low-end tier: a short opacity fade instead of move + scale. The transform is
// what makes the compositor re-render the whole page on every navigation.
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

function App() {
  const { currentPage, setPage, themeColors, themeName, loadSettings, loadInstances, fetchLiveVersion, loadSystemInfo } = useLauncherStore();
  const [splashDone, setSplashDone] = useState(false);
  const [launchInstance, setLaunchInstance] = useState<string | null>(null);
  const [boostInstance, setBoostInstance] = useState<string | null>(null);
  const [launchAnimInstance, setLaunchAnimInstance] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const { bgType } = useAnimatedBg();
  const potato = usePotatoMode();

  useEffect(() => {
    loadSettings().then(() => {
      loadInstances();
      api.wizard.checkFirstLaunch().then((result) => {
        if (result.first_launch) setShowWizard(true);
      }).catch(() => {});
    });
    fetchLiveVersion();
    // Fetched here (not just from HomePage) so the low-end tier is known while
    // the splash screen is still up, i.e. before the first heavy frame paints.
    loadSystemInfo();

    // Listen for launch events from InstancesPage
    const handleLaunchEvent = (e: CustomEvent) => {
      const name = e.detail?.instanceName;
      if (name) setBoostInstance(name);
    };
    window.addEventListener("ec-launch-game", handleLaunchEvent as EventListener);
    return () => window.removeEventListener("ec-launch-game", handleLaunchEvent as EventListener);
  }, []);

  // Keep the local account session in step with Firebase. The session is only
  // a mirror for the UI — the database rules check the Firebase token — so it
  // has to follow the real auth state rather than trust what was stored.
  useEffect(() => watchAuthState(), []);

  // Auto-updater: attach realtime listeners, then check GitHub on startup.
  useEffect(() => {
    attachUpdateListeners();
    const timer = setTimeout(async () => {
      const { settings } = useLauncherStore.getState();
      if (settings.auto_check_updates === false) return;
      const info = await checkForUpdates();
      if (info?.update_available && settings.auto_update !== false) {
        // Automatic mode: show the overlay, then install without a prompt.
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

  // Keep the window title in sync with the active theme. The icon is left
  // alone on purpose: the shipped /favicon.svg is the real white brand mark,
  // and generating a coloured tile here used to replace it with a letter.
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

  const renderPage = () => {
    switch (currentPage) {
      case "home": return <HomePage />;
      case "instances": return <InstancesPage />;
      case "mods": return <ModsPage />;
      case "packs": return <PacksPage />;
      case "modpacks": return <ModpacksPage />;
      case "accounts": return <AccountsPage />;
      case "xai": return <XrylothAIPage />;
      case "servers": return <ServersPage />;
      case "partners": return <PartnersPage />;
      case "templates": return <TemplatesPage />;
      case "configeditor": return <ConfigEditorPage />;
      case "chat": return <ChatPage />;
      case "themes": return <ThemesPage />;
      case "announcements": return <AnnouncementsPage />;
      case "settings": return <SettingsPage />;
      case "logs": return <LogsPage />;
      default: return <HomePage />;
    }
  };

  if (!splashDone) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  return (
    <ToastProvider>
      <ThemeSync />
      <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: themeColors.bg_main, color: themeColors.text_main }}>
        <TitleBar />
        <AnnouncementTicker />
        <div className="flex flex-1 overflow-hidden relative">
          <BackgroundLayer />
          {!potato && <AnimatedBackground type={bgType} />}
          {!potato && <MinecraftParticles />}
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden relative" style={{ zIndex: 1 }}>
            <Breadcrumb />
            <main className="flex-1 overflow-hidden relative">
              <ErrorBoundary>
                <AnimatePresence mode="wait">
                  <motion.div key={currentPage} variants={potato ? potatoPageVariants : pageVariants} initial="initial" animate="animate" exit="exit" transition={potato ? potatoPageTransition : pageTransition}
                    className="absolute inset-0 overflow-y-auto overflow-x-hidden p-5" style={{ scrollbarWidth: "thin", scrollBehavior: "smooth" }}>
                    {renderPage()}
                  </motion.div>
                </AnimatePresence>
              </ErrorBoundary>
            </main>
          </div>
        </div>
        {useLauncherStore.getState().isLoading && <LoadingOverlay />}
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
        <UpdateOverlay />
        <AnnouncementHost />
      </div>
    </ToastProvider>
  );
}

export default App;
