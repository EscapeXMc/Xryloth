// Public server registry.
//
// When a player creates a Minecraft server with the Xryloth launcher and marks
// it PUBLIC, its details are mirrored to Firebase Realtime Database at
// /publicServers/<key>. The Xryloth website reads that node and renders the
// community server list. PRIVATE servers are never written anywhere.
import { db, ref, set, get, remove, update, onValue } from "./firebase";
import { getSession } from "./auth";

export interface PublicServer {
  id?: string;
  /** Display name (what the launcher shows). */
  name: string;
  /** MOTD shown in the multiplayer list / website card. */
  motd: string;
  /** Server software: paper | purpur | fabric | vanilla. */
  type: string;
  /** Minecraft version, e.g. "1.21.1". */
  version: string;
  /** Join port (default 25565). */
  port: number;
  /** Public IP of the host machine (best-effort). */
  host: string;
  /** Ready-to-paste "host:port" address. */
  address: string;
  /** Optional description for the website card. */
  description?: string;
  /** Comma-separated tags, e.g. "survival,pvp,vanilla". */
  tags?: string;
  /** Allocated RAM in MB. */
  ramMb?: number;
  /** Max players (from server.properties). */
  maxPlayers?: number;
  /** Owner display name + uid. */
  owner?: string;
  ownerUid?: string;
  /** Base64 / https server icon (may be empty). */
  icon?: string;
  /** Whether the server currently accepts connections. */
  online?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

const PATH = "publicServers";

/** Stable key so re-publishing updates the same node instead of duplicating. */
export function serverKey(name: string): string {
  const uid = getSession()?.uid || "guest";
  const clean = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `${uid}_${clean || "server"}`;
}

export async function publishServer(s: PublicServer): Promise<{ ok: boolean; error?: string; key?: string }> {
  if (!s.name?.trim()) return { ok: false, error: "Server name is required." };
  try {
    const session = getSession();
    const key = serverKey(s.name);
    const node = ref(db, `${PATH}/${key}`);
    const existing = await get(node);
    const payload: PublicServer = {
      ...s,
      id: key,
      owner: session?.username || "Anonymous",
      ownerUid: session?.uid || "guest",
      address: s.host ? `${s.host}:${s.port}` : `:${s.port}`,
      online: s.online ?? false,
      createdAt: existing.exists() ? (existing.val()?.createdAt ?? Date.now()) : Date.now(),
      updatedAt: Date.now(),
    };
    await set(node, payload);
    return { ok: true, key };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to publish server." };
  }
}

export async function unpublishServer(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await remove(ref(db, `${PATH}/${serverKey(name)}`));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to unpublish server." };
  }
}

/** Update a few live fields (e.g. online state) without touching the rest. */
export async function patchServer(name: string, patch: Partial<PublicServer>): Promise<void> {
  try {
    await update(ref(db, `${PATH}/${serverKey(name)}`), { ...patch, updatedAt: Date.now() });
  } catch {
    /* best-effort */
  }
}

export async function fetchPublicServers(): Promise<PublicServer[]> {
  try {
    const snap = await get(ref(db, PATH));
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, PublicServer>;
    return Object.entries(val)
      .map(([id, s]) => ({ ...s, id }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

export function subscribePublicServers(cb: (list: PublicServer[]) => void): () => void {
  return onValue(
    ref(db, PATH),
    (snap) => {
      if (!snap.exists()) {
        cb([]);
        return;
      }
      const val = snap.val() as Record<string, PublicServer>;
      cb(
        Object.entries(val)
          .map(([id, s]) => ({ ...s, id }))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      );
    },
    (err) => console.error("[PublicServers] realtime error:", err),
  );
}
