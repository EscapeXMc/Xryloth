import { lazy, Suspense } from "react";
import { useLauncherStore } from "../stores";

// Lazy load all available pages
const HomePage = lazy(() => import("./pages/HomePage").then(m => ({ default: m.HomePage })));
const ProfilesPage = lazy(() => import("./pages/ProfilesPage").then(m => ({ default: m.ProfilesPage })));
const InstancesPage = lazy(() => import("./pages/InstancesPage").then(m => ({ default: m.InstancesPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const AccountsPage = lazy(() => import("./pages/AccountsPage").then(m => ({ default: m.AccountsPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then(m => ({ default: m.ChatPage })));
const XrylothAIPage = lazy(() => import("./pages/XrylothAIPage").then(m => ({ default: m.XrylothAIPage })));
const PartnersPage = lazy(() => import("./pages/PartnersPage").then(m => ({ default: m.PartnersPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then(m => ({ default: m.LogsPage })));
const ServersPage = lazy(() => import("./pages/ServersPage").then(m => ({ default: m.ServersPage })));
const ThemesPage = lazy(() => import("./pages/ThemesPage").then(m => ({ default: m.ThemesPage })));
const ModsPage = lazy(() => import("./mods/ModBrowserPage").then(m => ({ default: m.ModBrowserPage })));

function PageLoader() {
  const themeColors = useLauncherStore((s) => s.themeColors);
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="flex flex-col items-center gap-4">
        <svg className="animate-spin w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path fill="currentColor" d="M4 12a8 8 0 018-8v0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l-1.16 1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808l1.16-1.634a7.96 7.96 0 00-1.11-2.596zm8.075-2.596c.57-1.271.92-2.444.92-3.808 0-1.366-.35-2.648-.92-3.808l-1.16 1.634c.705.928 1.11 2.147 1.11 3.563 0 1.366-.35-2.648-.92-3.808l-1.16-1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808z" />
        </svg>
        <p className="text-xs" style={{ color: themeColors.text_muted }}>Loading page...</p>
      </div>
    </div>
  );
}

const pageComponents: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  home: HomePage,
  profiles: ProfilesPage,
  instances: InstancesPage,
  settings: SettingsPage,
  accounts: AccountsPage,
  chat: ChatPage,
  xai: XrylothAIPage,
  partners: PartnersPage,
  logs: LogsPage,
  servers: ServersPage,
  themes: ThemesPage,
  mods: ModsPage,
};

export function renderPage(currentPage: string) {
  const Component = pageComponents[currentPage] || HomePage;
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}
