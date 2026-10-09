/**
 * Environment guard for Tauri.
 *
 * `@tauri-apps/api` talks to the native side through `window.__TAURI_IPC__`,
 * which is injected by the Tauri webview runtime. When the frontend is opened
 * in a plain browser (e.g. hitting the Vite dev server at
 * `http://localhost:1420` directly), that bridge is absent and every
 * `invoke()` call throws:
 *
 *   TypeError: window.__TAURI_IPC__ is not a function
 *
 * Detect the shell up-front so we can show a helpful message instead of
 * letting the raw TypeError take over the app.
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.__TAURI_IPC__ === "function" || typeof w.__TAURI__ !== "undefined";
}
