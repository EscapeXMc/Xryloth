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
 * Browser preview falls back to the public mcsrvstat.us API directly.
 * Handles IPs that already include a port (e.g. "host:25572") without double-appending. */
export async function fetchStatuses(host: string, port: string): Promise<ServerStatus> {
  const safeHost = (host || "").trim().replace(/\/+$/, "");
  let safePort = (port || "25565").trim();

  // If the host already contains a port (e.g. "power-1.mantranodes.fun:25572"),
  // extract it and don't double-append.
  const hostHasPort = safeHost.includes(":");
  let effectiveHost = safeHost;
  let effectivePort = safePort;
  if (hostHasPort) {
    // Host already has ":port" — split it out so we have clean values.
    const lastColon = safeHost.lastIndexOf(":");
    const maybePort = safeHost.slice(lastColon + 1);
    if (/^\d+$/.test(maybePort)) {
      effectiveHost = safeHost.slice(0, lastColon);
      effectivePort = maybePort;
    }
  }

  // Try Tauri backend first (no CORS). Pass the ORIGINAL safeHost so the
  // Rust side can decide how to build the URL (it also has double-port logic).
  try {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_IPC__) {
      const { api } = await import("./api");
      return await api.partners.status(safeHost, safePort);
    }
  } catch (e: any) {
    console.warn("[Partners] backend status failed (browser fallback):", e?.message);
  }

  // Browser fallback: public REST API.
  // Build candidate URLs — first bare host (SRV / default), then host:port if custom.
  const candidates: string[] = [];
  if (hostHasPort) {
    candidates.push(`https://api.mcsrvstat.us/3/${safeHost}`);
  } else {
    candidates.push(`https://api.mcsrvstat.us/3/${safeHost}`);
    if (effectivePort && effectivePort !== "25565") {
      candidates.push(`https://api.mcsrvstat.us/3/${safeHost}:${effectivePort}`);
    }
  }

  for (const url of candidates) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j.online) {
        return {
          online: true,
          host: safeHost,
          port: effectivePort,
          version: j.version || "",
          players_online: j.players?.online ?? 0,
          players_max: j.players?.max ?? 0,
          motd: (j.motd?.clean && j.motd.clean[0]) || "",
          icon: j.icon || "",
          latency: j.debug?.cacheexpire ?? 0,
        };
      }
      // Offline on this candidate — return offline immediately.
      return { online: false, host: safeHost, port: effectivePort, version: "", players_online: 0, players_max: 0, motd: "", icon: "", latency: 0 };
    } catch {
      // Try next candidate
    }
  }
  return { online: false, host: safeHost, port: effectivePort, version: "", players_online: 0, players_max: 0, motd: "", icon: "", latency: 0, error: "All connection attempts failed" };
}

/* ---------- shared desktop poll: ONE interval for every subscriber ----------
 * Previously each component's subscribePartners() started its own 4s timer,
 * so 4 subscribers hammered fetch_partners_remote ~1x/sec (7300+ backend
 * fetches in one session). Now every subscriber shares a single poll and
 * partner data (which changes rarely) is fetched once per 20s. */
interface SharedPartnersPoll {
  subs: Set<(partners: PartnerServer[]) => void>;
  timer: ReturnType<typeof setInterval> | null;
  lastJson: string;
  lastList: PartnerServer[] | null;
  ticking: boolean;
}
let sharedPoll: SharedPartnersPoll | null = null;

async function sharedPollTick(): Promise<void> {
  const p = sharedPoll;
  if (!p || p.ticking) return;
  p.ticking = true;
  try {
    const list = await fetchPartnersRemote();
    const key = JSON.stringify(list);
    if (key !== p.lastJson) {
      p.lastJson = key;
      p.lastList = list;
      p.subs.forEach((cb) => {
        try { cb(list); } catch { /* one bad subscriber must not stop the rest */ }
      });
    }
  } finally {
    if (sharedPoll) sharedPoll.ticking = false;
  }
}

function ensureSharedPoll(): SharedPartnersPoll {
  if (!sharedPoll) {
    sharedPoll = { subs: new Set(), timer: null, lastJson: "", lastList: null, ticking: false };
  }
  if (!sharedPoll.timer) {
    sharedPollTick();
    // Partner list rarely changes — 20s keeps it near-realtime and the
    // backend quiet (was 4s per subscriber).
    sharedPoll.timer = setInterval(sharedPollTick, 20_000);
  }
  return sharedPoll;
}

/** Subscribe to live realtime updates for partner servers.
 * Returns an unsubscribe function. Callback fires on every change.
 * - Desktop (Tauri): shared Rust-side poll (one fetch per 20s total).
 * - Browser preview: uses Firebase SDK realtime listener directly. */
export function subscribePartners(cb: (partners: PartnerServer[]) => void): () => void {
  // Desktop path: reliable Rust-side polling (near-realtime).
  if (inTauri()) {
    const p = ensureSharedPoll();
    p.subs.add(cb);
    if (p.lastList) {
      try { cb(p.lastList); } catch { /* noop */ }
    }
    return () => {
      p.subs.delete(cb);
      // No subscribers left → stop the poll entirely (restarts on demand).
      if (p.subs.size === 0 && p.timer) {
        clearInterval(p.timer);
        p.timer = null;
      }
    };
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

export async function submitPartnerApplication(app: {
  serverName: string; serverIp: string; serverPort?: string; description: string;
  discord?: string; website?: string; mcVersion?: string; reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!app.serverName?.trim() || !app.serverIp?.trim()) return { ok: false, error: "Server name and IP are required." };
    const r = push(ref(db, "partnerApplications"));
    await set(r, { ...app, status: "pending", submittedAt: new Date().toISOString() });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to submit application." };
  }
}
