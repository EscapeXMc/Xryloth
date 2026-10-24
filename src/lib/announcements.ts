// Live announcements + admin "ping" system.
//
// Stored in Firebase Realtime Database at /announcements.
//   - Everyone can READ (realtime): ticker strip + popup + ping sound.
//   - Only the launcher ADMIN account may WRITE (enforced here and by DB rules).
//
// An announcement can drive three things at once:
//   * the scrolling ticker strip at the top of the launcher (ticker: true)
//   * a popup card with optional image / video      (popup: true)
//   * a Discord-style ping (sound + popup)          (type: "ping")
//
// A ping can target everyone (no targetUid) or a single user (targetUid).
import { db, ref, set, get, push, remove, onValue } from "./firebase";
import { getSession } from "./auth";

export type AnnouncementType = "info" | "update" | "event" | "ping";
export type MediaType = "none" | "image" | "video";

export interface Announcement {
  id?: string;
  title: string;
  body: string;
  type: AnnouncementType;
  mediaType: MediaType;
  /** https URL or data: URL (base64 upload). */
  mediaUrl?: string;
  /** Also show a popup card when this is new. */
  popup?: boolean;
  /** Show this text in the scrolling top strip. */
  ticker?: boolean;
  /** Ping a single user instead of everyone (uid). */
  targetUid?: string;
  /** Display name of the pinged user (nice for the admin list). */
  targetUsername?: string;
  /** Admin username / uid that posted it. */
  createdBy?: string;
  createdByUid?: string;
  createdAt?: number;
  priority?: "normal" | "high";
}

const PATH = "announcements";
const SEEN_KEY = "xryloth-seen-announcements";

/** Is the currently signed-in launcher account an admin? */
export function isAdmin(): boolean {
  try {
    return !!getSession()?.isAdmin;
  } catch {
    return false;
  }
}

/** Current signed-in account uid (or "" when not signed in). */
export function myUid(): string {
  try {
    return getSession()?.uid || "";
  } catch {
    return "";
  }
}

/** Does this announcement apply to me? (untargeted = everyone) */
export function appliesToMe(a: Announcement): boolean {
  if (!a.targetUid) return true;
  const uid = myUid();
  return !!uid && a.targetUid === uid;
}

/** Post a new announcement (admin only). */
export async function postAnnouncement(a: Announcement): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!isAdmin()) return { ok: false, error: "Admin access required." };
  if (!a.title?.trim() && !a.body?.trim() && !a.mediaUrl) {
    return { ok: false, error: "Add a title, message or media." };
  }
  try {
    const session = getSession();
    const node = push(ref(db, PATH));
    const payload: Announcement = {
      ...a,
      id: node.key || "",
      title: a.title?.trim() || "",
      body: a.body?.trim() || "",
      createdBy: session?.username || "Admin",
      createdByUid: session?.uid || "admin",
      createdAt: Date.now(),
      priority: a.priority || "normal",
    };
    await set(node, payload);
    return { ok: true, id: node.key || undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to post announcement." };
  }
}

export async function deleteAnnouncement(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isAdmin()) return { ok: false, error: "Admin access required." };
  try {
    await remove(ref(db, `${PATH}/${id}`));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to delete announcement." };
  }
}

/** One-shot fetch (used as a fallback / initial paint). */
export async function fetchAnnouncements(): Promise<Announcement[]> {
  try {
    const snap = await get(ref(db, PATH));
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, Announcement>;
    return sortAnnouncements(Object.entries(val).map(([id, a]) => ({ ...a, id })));
  } catch {
    return [];
  }
}

export function sortAnnouncements(list: Announcement[]): Announcement[] {
  return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Realtime subscription. Returns an unsubscribe function. */
export function subscribeAnnouncements(cb: (list: Announcement[]) => void): () => void {
  return onValue(
    ref(db, PATH),
    (snap) => {
      if (!snap.exists()) {
        cb([]);
        return;
      }
      const val = snap.val() as Record<string, Announcement>;
      cb(sortAnnouncements(Object.entries(val).map(([id, a]) => ({ ...a, id }))));
    },
    (err) => console.error("[Announcements] realtime error:", err),
  );
}

/** Ids we've already pinged/popuped for, persisted so a restart doesn't re-ping. */
function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

export function markSeen(ids: string[]) {
  try {
    const seen = loadSeen();
    ids.forEach((id) => seen.add(id));
    // Keep the list bounded.
    const arr = Array.from(seen).slice(-500);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    /* noop */
  }
}

export function hasSeen(id: string): boolean {
  return loadSeen().has(id);
}

/** Discord-style ping chime (Web Audio, no asset files). */
let pingCtx: AudioContext | null = null;
export function playPingSound() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!pingCtx) pingCtx = new Ctx();
    const ctx = pingCtx as AudioContext;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    [784, 988, 1319, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i < 2 ? "sine" : "triangle";
      osc.frequency.value = freq;
      const start = t + i * 0.05;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.2, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      osc.connect(g).connect(master);
      osc.start(start);
      osc.stop(start + 0.45);
    });
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine";
    sub.frequency.value = 130;
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    sub.connect(sg).connect(master);
    sub.start(t);
    sub.stop(t + 0.26);
  } catch {
    /* noop */
  }
}
