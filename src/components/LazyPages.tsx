import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useLauncherStore } from "../stores";

// Lazy load all pages for better performance
const HomePage = lazy(() => import("../pages/HomePage").then(m => ({ default: m.HomePage })));
const InstancesPage = lazy(() => import("../pages/InstancesPage").then(m => ({ default: m.InstancesPage })));
const ModsPage = lazy(() => import("../pages/ModsPage").then(m => ({ default: m.ModsPage })));
const SettingsPage = lazy(() => import("../pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const AccountsPage = lazy(() => import("../pages/AccountsPage").then(m => ({ default: m.AccountsPage })));
const XrylothAIPage = lazy(() => import("../pages/XrylothAIPage").then(m => ({ default: m.XrylothAIPage })));
const PacksPage = lazy(() => import("../pages/PacksPage").then(m => ({ default: m.PacksPage })));
const ModpacksPage = lazy(() => import("../pages/ModpacksPage").then(m => ({ default: m.ModpacksPage })));
const LogsPage = lazy(() => import("../pages/LogsPage").then(m => ({ default: m.LogsPage })));
const ServersPage = lazy(() => import("../pages/ServersPage").then(m => ({ default: m.ServersPage })));
const TemplatesPage = lazy(() => import("../pages/TemplateBrowser").then(m => ({ default: m.TemplatesPage })));
const ConfigEditorPage = lazy(() => import("../pages/ConfigEditorPage").then(m => ({ default: m.ConfigEditorPage })));
const ChatPage = lazy(() => import("../pages/ChatPage").then(m => ({ default: m.ChatPage })));
const ThemesPage = lazy(() => import("../pages/ThemesPage").then(m => ({ default: m.ThemesPage })));

function PageLoader() {
  const { themeColors } = useLauncherStore();
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="flex flex-col items-center gap-4">
        <Loader2 size={32} className="animate-spin" style={{ color: themeColors.accent }} />
        <p className="text-sm" style={{ color: themeColors.text_muted }}>Loading page...</p>
      </div>
    </div>
  );
}

const pageComponents: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  home: HomePage,
  instances: InstancesPage,
  mods: ModsPage,
  settings: SettingsPage,
  accounts: AccountsPage,
  xai: XrylothAIPage,
  packs: PacksPage,
  modpacks: ModpacksPage,
  logs: LogsPage,
  servers: ServersPage,
  templates: TemplatesPage,
  configeditor: ConfigEditorPage,
  chat: ChatPage,
  themes: ThemesPage,
};

export function renderPage(currentPage: string) {
  const Component = pageComponents[currentPage] || HomePage;
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}