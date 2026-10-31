import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api } from "../lib/api";
import type { Settings, Instance, ThemeColors, ModInfo, ServerStatus } from "../lib/types";
import { THEME_VARIANTS, type ThemeVariant } from "../lib/themes";
import { THEMES } from "../lib/types";

function resolveThemeColors(themeName: string, mode: ThemeVariant): ThemeColors {
  const custom = loadCustomThemeColors(themeName, mode);
  if (custom) return custom;
  if (THEMES[themeName]) return THEMES[themeName].colors;
  return THEME_VARIANTS[mode].colors;
}

const CUSTOM_THEMES_KEY = "ec-custom-themes";

function getStoredThemeMode(): ThemeVariant {
  try {
    const stored = localStorage.getItem("ec-theme-mode");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return "dark";
}

function loadCustomThemeColors(themeName: string, mode: ThemeVariant): ThemeColors | null {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return null;
    const custom: Record<string, { colors: ThemeColors }> = JSON.parse(raw);
    if (custom[themeName]) return custom[themeName].colors;
  } catch {}
  return null;
}

const DEFAULT_THEME = "orange";
const LEGACY_DEFAULT_THEMES = ["black"];

function pickTheme(stored: string | undefined): string {
  if (!stored || LEGACY_DEFAULT_THEMES.includes(stored)) return DEFAULT_THEME;
  return stored;
}

const initialThemeMode = getStoredThemeMode();

export interface LauncherStore {
  settings: Settings;
  instances: Instance[];
  currentPage: string;
  selectedInstance: Instance | null;
  isLoading: boolean;
  loadingMessage: string;
  themeName: string;
  themeColors: ThemeColors;
  themeMode: ThemeVariant;
  logs: string[];
  playTimes: Record<string, number>;
  systemInfo: {
    cpu: number;
    ram_pct: number;
    ram_used: number;
    ram_total: number;
    disk_pct: number;
    disk_used: number;
    disk_total: number;
  };
  liveVersion: string;
  releaseNotes: string;
  sidebarOpen: boolean;

  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: (s: Record<string, any>) => Promise<void>;
  setSetting: (key: string, value: any) => Promise<void>;
  loadInstances: () => Promise<void>;
  setPage: (page: string) => void;
  setSelectedInstance: (instance: Instance | null) => void;
  addInstance: (instance: Omit<Instance, "id">) => void;
  updateInstance: (id: string, updates: Partial<Instance>) => void;
  deleteInstance: (id: string) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setTheme: (name: string) => void;
  setThemeMode: (mode: ThemeVariant) => void;
  toggleSidebar: () => void;
  loadLogs: () => Promise<void>;
  log: (msg: string) => void;
  loadPlayTimes: () => Promise<void>;
  loadSystemInfo: () => Promise<void>;
  fetchLiveVersion: () => Promise<void>;

  // Mod operations
  installMod: (slug: string, version?: string) => Promise<void>;
  uninstallMod: (slug: string) => Promise<void>;
  toggleMod: (slug: string) => Promise<void>;

  // Server status
  servers: ServerStatus[];
  serverLoading: boolean;
  refreshServers: () => Promise<void>;
}

export const useLauncherStore = create<LauncherStore>()(
  persist(
    (set, get) => ({
      settings: {},
      instances: [],
      currentPage: "play",
      selectedInstance: null,
      isLoading: false,
      loadingMessage: "",
      themeName: DEFAULT_THEME,
      themeColors: resolveThemeColors(DEFAULT_THEME, initialThemeMode),
      themeMode: initialThemeMode,
      logs: [],
      playTimes: {},
      systemInfo: {
        cpu: 0,
        ram_pct: 0,
        ram_used: 0,
        ram_total: 0,
        disk_pct: 0,
        disk_used: 0,
        disk_total: 0,
      },
      liveVersion: "5.9",
      releaseNotes: "",
      sidebarOpen: true,
      servers: [],
      serverLoading: false,

      loadSettings: async () => {
        try {
          const settings = await api.settings.get();
          const themeName = pickTheme(settings.theme);
          const mode = getStoredThemeMode();
          set({
            settings,
            themeName,
            themeColors: resolveThemeColors(themeName, mode),
            themeMode: mode,
          });
        } catch (err) {
          console.error("Failed to load settings:", err);
        }
      },

      saveSettings: async (s: Record<string, any>) => {
        try {
          await api.settings.save(s);
          const settings = { ...get().settings, ...s };
          const themeName = pickTheme(settings.theme);
          const mode = getStoredThemeMode();
          set({
            settings,
            themeName,
            themeColors: resolveThemeColors(themeName, mode),
            themeMode: mode,
          });
        } catch (err) {
          console.error("Failed to save settings:", err);
        }
      },

      setSetting: async (key: string, value: any) => {
        await api.settings.saveOne(key, value);
        const settings = { ...get().settings, [key]: value };
        if (key === "theme") {
          const mode = getStoredThemeMode();
          set({
            settings,
            themeName: value,
            themeColors: resolveThemeColors(value, mode),
            themeMode: mode,
          });
        } else {
          set({ settings });
        }
      },

      loadInstances: async () => {
        try {
          const instances = await api.instances.get();
          set({ instances });
        } catch (err) {
          console.error("Failed to load instances:", err);
        }
      },

      setPage: (page) => set({ currentPage: page }),

      setSelectedInstance: (instance) =>
        set({ selectedInstance: instance }),

      addInstance: (instance) =>
        set((state) => ({
          instances: [
            ...state.instances,
            { ...instance, id: crypto.randomUUID() },
          ],
        })),
      updateInstance: (id, updates) =>
        set((state) => ({
          instances: state.instances.map((i) =>
            i.id === id ? { ...i, ...updates } : i
          ),
        })),
      deleteInstance: (id) =>
        set((state) => ({
          instances: state.instances.filter((i) => i.id !== id),
          selectedInstance:
            state.selectedInstance?.id === id ? null : state.selectedInstance,
        })),

      setLoading: (loading, message = "") =>
        set({ isLoading: loading, loadingMessage: message }),

      setTheme: (name: string) => {
        const mode = getStoredThemeMode();
        set({
          settings: { ...get().settings, theme: name },
          themeName: name,
          themeColors: resolveThemeColors(name, mode),
        });
        api.settings.saveOne("theme", name).catch(console.error);
      },

      setThemeMode: (mode: ThemeVariant) => {
        const currentTheme = get().themeName;
        set({ themeMode: mode, themeColors: resolveThemeColors(currentTheme, mode) });
        try {
          localStorage.setItem("ec-theme-mode", mode);
        } catch {}
      },

      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      loadLogs: async () => {
        try {
          const logs = await api.logs.get();
          set({ logs });
        } catch {}
      },

      log: (msg: string) => {
        const now = new Date().toLocaleTimeString();
        set((s) => ({ logs: [...s.logs, `[${now}] ${msg}`] }));
      },

      loadPlayTimes: async () => {
        try {
          const playTimes = await api.playTimes.get();
          set({
            playTimes:
              playTimes && typeof playTimes === "object" ? playTimes : {},
          });
        } catch {}
      },

      loadSystemInfo: async () => {
        try {
          const systemInfo = await api.system.getInfo();
          set({ systemInfo });
        } catch {}
      },

      fetchLiveVersion: async () => {
        try {
          const v = await api.version.getLatest();
          set({ liveVersion: v.tag || "5.9", releaseNotes: v.notes || "" });
        } catch {
          set({ liveVersion: "5.9" });
        }
      },

      // Mod operations
      installMod: async (slug, versionId) => {
        if (!get().selectedInstance) {
          throw new Error("No instance selected");
        }
        set((s) => ({ isLoading: true, loadingMessage: `Installing ${slug}...` }));
        try {
          const result = await api.mods.install(
            get().selectedInstance!.name,
            slug,
            versionId || ""
          );
          if (result.success) {
            // Reload instance to get updated mod list
            const updated = await api.instances.getMods(get().selectedInstance!.name);
            set((s) => ({
              instances: s.instances.map((i) =>
                i.name === get().selectedInstance!.name
                  ? { ...i, mods: updated }
                  : i
              ),
            }));
          }
        } finally {
          set({ isLoading: false, loadingMessage: "" });
        }
      },

      uninstallMod: async (slug) => {
        if (!get().selectedInstance) return;
        set((s) => ({ isLoading: true, loadingMessage: `Removing ${slug}...` }));
        try {
          await api.instances.deleteMod(get().selectedInstance!.name, slug);
          const updated = await api.instances.getMods(get().selectedInstance!.name);
          set((s) => ({
            instances: s.instances.map((i) =>
              i.name === get().selectedInstance!.name
                ? { ...i, mods: updated }
                : i
            ),
          }));
        } finally {
          set({ isLoading: false, loadingMessage: "" });
        }
      },

      toggleMod: async (slug) => {
        if (!get().selectedInstance) return;
        try {
          const inst = get().selectedInstance!;
          const mod = inst.mods?.find((m) => m.slug === slug);
          const targetEnabled = !(mod?.enabled);
          await api.instances.toggleMod(inst.name, slug);
          set((s) => ({
            instances: s.instances.map((i) =>
              i.name === inst.name
                ? {
                    ...i,
                    mods: (i.mods || []).map((m) =>
                      m.slug === slug ? { ...m, enabled: targetEnabled } : m
                    ),
                  }
                : i
            ),
          }));
        } catch (err) {
          console.error("Failed to toggle mod:", err);
        }
      },

      // Server status
      refreshServers: async () => {
        set({ serverLoading: true });
        try {
          const servers = await api.servers.get();
          const results = await Promise.all(
            servers.map(async (s) => {
              try {
                const status = await api.servers.ping(s.address, s.port);
                return {
                  name: s.name,
                  address: s.address,
                  port: s.port,
                  online: status.online,
                  players_online: status.players?.online ?? 0,
                  players_max: status.players?.max ?? 0,
                  version: status.version || "Unknown",
                  motd: status.motd || "No MOTD",
                  };
              } catch {
                return {
                  name: s.name,
                  address: s.address,
                  port: s.port,
                  online: false,
                  players_online: 0,
                  players_max: 0,
                  version: "Unknown",
                  motd: "Offline",
                  latency: 0,
                };
              }
            })
          );
          set({ servers: results.map((s: any) => ({
  online: false,
  host: s.address,
  port: s.port,
  version: "",
  players_online: 0,
  players_max: 0,
  motd: "",
  icon: "",
  latency: 0,
  error: undefined,
}))});
        } catch (err) {
          console.error("Failed to refresh servers:", err);
        } finally {
          set({ serverLoading: false });
        }
      },
    }),
    {
      name: "xryloth-launcher-storage",
      partialize: (s) => ({
        themeName: s.themeName,
        themeMode: s.themeMode,
        sidebarOpen: s.sidebarOpen,
        settings: s.settings,
        instances: s.instances,
        playTimes: s.playTimes,
      }),
    }
  )
);