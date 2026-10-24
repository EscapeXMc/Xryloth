// Partner servers: stored in Firebase Realtime Database at /partnerServers.
// Everyone can READ. Only the admin account may WRITE (enforced in UI + calls).
import { db, ref, set, get, push, update, remove, onValue } from "./firebase";
import type { ServerStatus } from "./types";

export interface PartnerServer {
  id?: string;
  name: string;
  ip: string;
  port?: string;
  description: string;
  version?: string;
  players?: string;
  logo?: string;    // data URL or https URL
  banner?: string;  // data URL or https URL
  website?: string;
  discord?: string;
  webstore?: string;
  tags?: string;    // comma separated
  featured?: boolean;
  createdAt?: string;
}

const PATH = "partnerServers";

function sortPartners(list: PartnerServer[]): PartnerServer[] {
  return list.sort((a, b) =>
    Number(b.featured || false) - Number(a.featured || false) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}

export async function fetchPartners(): Promise<PartnerServer[]> {
  try {
    const snap = await get(ref(db, PATH));
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, Omit<PartnerServer, "id">>;
    return sortPartners(Object.entries(val).map(([id, p]) => ({ ...p, id })));
  } catch {
    return [];
  }
}


/** Fetch partners through the Rust backend (works in the Tauri desktop app,
 * bypassing WebView/CORS network limitations). Browser previews fall through. */
export async function fetchPartnersRemote(): Promise<PartnerServer[]> {
  try {
    const { api } = await import("./api");
    const list = (await api.partners.fetchRemote()) as unknown as PartnerServer[];
    return sortPartners(list);
  } catch (e: any) {
    console.error("[Partners] remote fetch error:", e?.message || e);
    return [];
  }
}

/** Whether we run inside the desktop Tauri shell (vs browser preview). */
function inTauri(): boolean {
  try {
    return typeof window !== "undefined" && !!(window as any).__TAURI_IPC__;
  } catch {
    return false;
  }
}

/** Fetch live status for a single Minecraft server via the Rust backend.
 * Browser preview falls back to the public mcsrvstat.us API directly. */
export async function fetchStatuses(host: string, port: string): Promise<ServerStatus> {
  const safePort = (port || "25565").trim();
  // Try Tauri backend first (no CORS).
  try {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_IPC__) {
      const { api } = await import("./api");
      return await api.partners.status(host, safePort);
    }
  } catch (e: any) {
    console.warn("[Partners] backend status failed (browser fallback):", e?.message);
  }
  // Browser fallback: public REST API (works in browser preview).
  try {
    const url = safePort && safePort !== "25565"
      ? `https://api.mcsrvstat.us/3/${host}:${safePort}`
      : `https://api.mcsrvstat.us/3/${host}`;
    const r = await fetch(url);
    const j = await r.json();
    return {
      online: !!j.online,
      host,
      port: safePort,
      version: j.version || "",
      players_online: j.players?.online ?? 0,
      players_max: j.players?.max ?? 0,
      motd: (j.motd?.clean && j.motd.clean[0]) || "",
      icon: j.icon || "",
      latency: j.debug?.cacheexpire ?? 0,
    };
  } catch (e: any) {
    return { online: false, host, port: safePort, version: "", players_online: 0, players_max: 0, motd: "", icon: "", latency: 0, error: e?.message };
  }
}

/** Subscribe to live realtime updates for partner servers.
 * Returns an unsubscribe function. Callback fires on every change.
 * - Desktop (Tauri): polls the Rust backend every 4s (no WebView/CORS issues).
 * - Browser preview: uses Firebase SDK realtime listener directly. */
export function subscribePartners(cb: (partners: PartnerServer[]) => void): () => void {
  // Desktop path: reliable Rust-side polling (near-realtime).
  if (inTauri()) {
    let alive = true;
    let lastJson = "";
    const tick = async () => {
      if (!alive) return;
      const list = await fetchPartnersRemote();
      const key = JSON.stringify(list);
      if (key !== lastJson) {
        lastJson = key;
        cb(list);
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }

  // Browser path: Firebase SDK realtime listener.
  const unsub = onValue(ref(db, PATH), (snap) => {
    try {
      if (!snap.exists()) { cb([]); return; }
      const val = snap.val() as Record<string, Omit<PartnerServer, "id">>;
      const list = Object.entries(val).map(([id, p]) => ({ ...p, id }));
      cb(sortPartners(list));
    } catch (e: any) {
      console.error("[Partners] realtime update error:", e);
    }
  }, (err: any) => {
    console.error("[Partners] realtime subscription error:", err);
  });
  return unsub;
}

export async function addPartner(p: Omit<PartnerServer, "id">): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!p.name?.trim() || !p.ip?.trim()) return { ok: false, error: "Name and IP are required." };
    const r = push(ref(db, PATH));
    await set(r, { ...p, createdAt: new Date().toISOString() });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to add partner." };
  }
}

export async function updatePartner(id: string, p: Partial<PartnerServer>): Promise<{ ok: boolean; error?: string }> {
  try {
    await update(ref(db, `${PATH}/${id}`), { ...p });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to update partner." };
  }
}

export async function removePartner(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await remove(ref(db, `${PATH}/${id}`));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to remove partner." };
  }
}
