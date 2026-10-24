import { useEffect, useState } from "react";
import { useLauncherStore } from "../stores";

/**
 * "Potato mode" — the automatic low-end tier.
 *
 * Xryloth's decorative layers (background video/image, animated orbs, floating
 * particles, rain/snow/fire/matrix effects, click sparkles) cost GPU time on
 * every frame, and the video also costs a network fetch at startup. On a weak
 * machine that is the difference between a usable launcher and a slideshow, so
 * the tier is detected and cached, which lets the very first frame (splash
 * screen included) already skip the expensive layers on later launches.
 *
 * Gate: total physical RAM. Firmware reserves a slice of it, so a machine sold
 * as "8 GB" reports roughly 7.6-7.9 GiB of MemTotal. Gating at a literal 8 GiB
 * would therefore flag every 8 GB machine, so the gate sits at 7 GiB: 4 GB
 * (~3.7 GiB) and 6 GB (~5.7 GiB) machines trip it, real 8 GB machines do not.
 */
export const LOW_RAM_GATE_BYTES = 7 * 1024 ** 3;

const CACHE_KEY = "xryl.perf.lowend";

function readCache(): boolean | null {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

function writeCache(v: boolean) {
  try { localStorage.setItem(CACHE_KEY, v ? "1" : "0"); } catch { /* noop */ }
}

/**
 * `navigator.deviceMemory` reports GB rounded down to a power of two and capped
 * at 8, and only exists on Chromium. It is synchronous, so it can answer before
 * the backend's `get_system_info` round-trip completes.
 */
function deviceMemoryHint(): boolean | null {
  const gb = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof gb === "number" && gb > 0 ? gb < 8 : null;
}

/** True when this machine should run without the decorative layers. */
export function usePotatoMode(): boolean {
  const ramTotal = useLauncherStore((s) => s.systemInfo.ram_total);
  const [lowEnd, setLowEnd] = useState<boolean>(() => readCache() ?? deviceMemoryHint() ?? false);

  useEffect(() => {
    // ram_total is 0 until the backend answers. It is fixed hardware info, so
    // once it arrives it is authoritative and never flaps.
    if (ramTotal <= 0) return;
    const next = ramTotal < LOW_RAM_GATE_BYTES;
    writeCache(next);
    setLowEnd(next);
  }, [ramTotal]);

  return lowEnd;
}
