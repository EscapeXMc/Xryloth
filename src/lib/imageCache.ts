import { invoke as tauriInvoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./tauri";

/**
 * Image cache client.
 *
 * Every remote image (mod icons, banners, partner logos, avatars, news art)
 * is resolved through the Rust-side disk cache (~/.xryloth/image_cache)
 * instead of being fetched by the webview on every visit:
 *
 *   getCachedImage(url)  -> asset:// URL served from local disk (session-memoized)
 *   warmImageCache(urls) -> fire-and-forget pre-download at client startup
 *   subscribeImageCache  -> live swap when the backend revalidates a stale
 *                           copy and the remote image actually changed
 *
 * Non-remote sources (data:, blob:, local, relative paths) pass through
 * untouched, so callers can hand us any src blindly.
 */

export function isRemoteImage(src?: string | null): src is string {
  return !!src && /^https?:\/\//i.test(src);
}

function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(new Error(`Tauri backend unavailable (command "${cmd}").`));
  }
  return tauriInvoke<T>(cmd, args);
}

/** remote url -> displayable local asset url (per session) */
const resolved = new Map<string, string>();
/** remote url -> in-flight resolve (dedupes concurrent callers) */
const inflight = new Map<string, Promise<string>>();
/** url -> subscribers notified on a live cache update */
const subs = new Set<(url: string, display: string) => void>();

let listenerStarted = false;

function ensureUpdateListener() {
  if (listenerStarted || !isTauri()) return;
  listenerStarted = true;
  listen<{ url?: string; path?: string }>("image-cache-updated", (e) => {
    const url = e.payload?.url;
    const path = e.payload?.path;
    if (!url || !path) return;
    try {
      const display = convertFileSrc(path);
      resolved.set(url, display);
      subs.forEach((cb) => {
        try {
          cb(url, display);
        } catch {
          /* subscriber errors must not break the fan-out */
        }
      });
    } catch {
      /* convertFileSrc unavailable — keep the old mapping */
    }
  }).catch(() => {
    listenerStarted = false;
  });
}

/**
 * Resolve a remote image URL to a locally cached asset URL.
 * Cache hit: resolves in ~1ms (one IPC + disk path, no network).
 * Cache miss: downloads via Rust (single download — the webview never
 * fetches it separately). Falls back to the original remote URL on error.
 */
export function getCachedImage(src: string): Promise<string> {
  if (!isRemoteImage(src)) return Promise.resolve(src);
  const hit = resolved.get(src);
  if (hit) return Promise.resolve(hit);

  let p = inflight.get(src);
  if (!p) {
    ensureUpdateListener();
    p = invoke<{ success?: boolean; path?: string; error?: string }>("image_cache_get", { url: src })
      .then((r) => {
        if (r?.success && r.path) {
          const display = convertFileSrc(r.path);
          resolved.set(src, display);
          return display;
        }
        return src; // backend refused (offline, non-image…) → try remote directly
      })
      .catch(() => src)
      .finally(() => {
        inflight.delete(src);
      });
    inflight.set(src, p);
  }
  return p;
}

/** Pre-download a batch of remote images in the background (startup warm-up). */
export function warmImageCache(urls: string[]) {
  const remote: string[] = [];
  for (const u of urls) {
    if (isRemoteImage(u) && !remote.includes(u)) remote.push(u);
  }
  if (!remote.length) return;
  invoke("image_cache_warm", { urls: remote.slice(0, 64) }).catch(() => {});
}

/** Listen for live swaps (backend found a newer copy of a cached image). */
export function subscribeImageCache(cb: (url: string, display: string) => void): () => void {
  ensureUpdateListener();
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
