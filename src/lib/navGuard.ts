// Navigation guard to intercept page switches when there are unsaved settings.
let guard: ((target: string) => boolean) | null = null;

export function setNavGuard(fn: (target: string) => boolean) {
  guard = fn;
}

export function clearNavGuard() {
  guard = null;
}

// Returns true if navigation is allowed to proceed, false if blocked (guard handles it).
export function checkNavGuard(target: string): boolean {
  if (guard && target !== "settings") {
    return guard(target);
  }
  return true;
}
