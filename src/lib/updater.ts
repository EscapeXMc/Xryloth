import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type { UpdateInfo } from "./types";

export type UpdateStage = "idle" | "available" | "downloading" | "applying" | "error";

export interface UpdateState {
  stage: UpdateStage;
  info: UpdateInfo | null;
  percent: number;
  downloaded: number;
  total: number;
  speed: number;
  logs: string[];
  error?: string;
}

let state: UpdateState = {
  stage: "idle",
  info: null,
  percent: 0,
  downloaded: 0,
  total: 0,
  speed: 0,
  logs: [],
};

type Listener = (s: UpdateState) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l(state);
}

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  notify();
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeUpdate(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

function stamp(): string {
  return new Date().toLocaleTimeString();
}

export function appendUpdateLog(msg: string) {
  const logs = [...state.logs, `[${stamp()}] ${msg}`];
  set({ logs: logs.slice(-400) });
}

let attached = false;
export async function attachUpdateListeners() {
  if (attached) return;
  attached = true;
  try {
    await listen<{ downloaded: number; total: number; percent: number; speed: number }>(
      "update-progress",
      (e) => {
        const p = e.payload || ({} as any);
        set({
          percent: p.percent ?? 0,
          downloaded: p.downloaded ?? 0,
          total: p.total ?? 0,
          speed: p.speed ?? 0,
        });
      }
    );
    await listen<string>("update-log", (e) => {
      appendUpdateLog(String(e.payload));
    });
  } catch (err) {
    console.error("Failed to attach update listeners:", err);
  }
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    appendUpdateLog("Checking GitHub for the latest release...");
    const info = await api.updates.check();
    if (info && info.update_available) {
      set({ stage: "available", info, error: undefined });
      appendUpdateLog(`Update available: v${info.latest_version} (you have v${info.current_version})`);
    } else {
      appendUpdateLog(`You are up to date (v${info?.current_version ?? "?"}).`);
    }
    return info;
  } catch (err: any) {
    appendUpdateLog(`Update check failed: ${err?.message || err}`);
    return null;
  }
}

export async function startUpdate() {
  // Only start from the "available" screen (so a dismissed auto-update is a no-op).
  if (state.stage !== "available") return;
  const info = state.info;
  if (!info || !info.download_url) {
    appendUpdateLog("No download URL for this update.");
    set({ stage: "error", error: "No download URL" });
    return;
  }
  set({
    stage: "downloading",
    percent: 0,
    downloaded: 0,
    total: info.download_size || 0,
    speed: 0,
    error: undefined,
    logs: [`[${stamp()}] Starting update to v${info.latest_version}...`],
  });
  try {
    const res = await api.updates.download(info.download_url, info.download_name || "");
    if (!res.success) throw new Error(res.error || "Download failed");
    appendUpdateLog("Download complete. Launching installer...");
    set({ stage: "applying", percent: 100 });
    // Give the UI a moment to show completion before the launcher closes.
    await new Promise((r) => setTimeout(r, 800));
    const applied = await api.updates.install(res.path);
    if (applied && applied.error) {
      throw new Error(applied.error);
    }
    // If apply succeeded on Windows/Linux the process exits here.
    appendUpdateLog("Installer started. Xryloth will close and restart automatically.");
  } catch (err: any) {
    const msg = err?.message || String(err);
    appendUpdateLog(`Update failed: ${msg}`);
    set({ stage: "error", error: msg });
  }
}

export function dismissUpdate() {
  set({ stage: "idle" });
}
