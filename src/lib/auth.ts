// Xryloth account system: optional email/password auth (Firebase) + local admin bypass.
// Login is NEVER compulsory — the launcher works fully without an account.
import {
  auth, db,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  updateProfile, ref, set, get,
} from "./firebase";

export const ADMIN_EMAIL = "support@xrylothclient.com";
export const ADMIN_PASS = "EscapeX298@";

export interface XrylothSession {
  email: string;
  username: string;
  uid: string;
  isAdmin: boolean;
  verified: boolean;
  provider: "xryloth" | "admin";
  createdAt: string;
}

const SESSION_KEY = "xryloth-account-session";

export function getSession(): XrylothSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as XrylothSession) : null;
  } catch { return null; }
}

function saveSession(s: XrylothSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent("xryloth-account-changed", { detail: s }));
}

export function onSessionChanged(cb: (s: XrylothSession | null) => void) {
  const h = (e: Event) => cb((e as CustomEvent).detail ?? null);
  window.addEventListener("xryloth-account-changed", h);
  return () => window.removeEventListener("xryloth-account-changed", h);
}

function isAdminCreds(email: string, password: string) {
  return email.trim().toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASS;
}

function adminSession(): XrylothSession {
  return {
    email: ADMIN_EMAIL, username: "XrylothAdmin", uid: "admin-local-bypass",
    isAdmin: true, verified: true, provider: "admin",
    createdAt: new Date().toISOString(),
  };
}

export async function signup(email: string, password: string, username: string): Promise<{ ok: boolean; error?: string; needsVerification?: boolean }> {
  email = email.trim();
  username = username.trim();
  if (!email || !password || !username) return { ok: false, error: "Email, password and username are required." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  // Admin bypass: no real .com domain exists, so this account is local-only.
  if (isAdminCreds(email, password)) {
    saveSession(adminSession());
    return { ok: true };
  }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try { await updateProfile(cred.user, { displayName: username }); } catch {}
    try {
      const { sendEmailVerification } = await import("firebase/auth");
      await sendEmailVerification(cred.user);
    } catch {}
    try { await set(ref(db, `users/${cred.user.uid}`), { email, username, createdAt: new Date().toISOString() }); } catch {}
    await signOut(auth);
    return { ok: true, needsVerification: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e?.code || e?.message) };
  }
}

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string; needsVerification?: boolean }> {
  email = email.trim();
  if (!email || !password) return { ok: false, error: "Email and password are required." };
  if (isAdminCreds(email, password)) {
    saveSession(adminSession());
    return { ok: true };
  }
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await cred.user.reload();
    if (!cred.user.emailVerified) {
      try {
        const { sendEmailVerification } = await import("firebase/auth");
        await sendEmailVerification(cred.user);
      } catch {}
      await signOut(auth);
      return { ok: false, needsVerification: true, error: "Please verify your email first — we just re-sent the link." };
    }
    let username = cred.user.displayName || email.split("@")[0];
    try {
      const snap = await get(ref(db, `users/${cred.user.uid}`));
      if (snap.exists() && snap.val()?.username) username = snap.val().username;
    } catch {}
    saveSession({
      email, username, uid: cred.user.uid, isAdmin: false, verified: true,
      provider: "xryloth", createdAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e?.code || e?.message) };
  }
}

export async function resendVerification(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    const { sendEmailVerification } = await import("firebase/auth");
    await sendEmailVerification(cred.user);
    await signOut(auth);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e?.code || e?.message) };
  }
}

export async function logout() {
  try { await signOut(auth); } catch {}
  saveSession(null);
}

function friendlyAuthError(code: string): string {
  const c = String(code || "");
  if (c.includes("email-already-in-use")) return "That email is already registered — try logging in.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("invalid-email")) return "That email address looks invalid.";
  if (c.includes("weak-password")) return "Password must be at least 6 characters.";
  if (c.includes("too-many-requests")) return "Too many attempts — wait a minute and retry.";
  if (c.includes("network-request-failed")) return "Network error — check your connection.";
  return "Authentication failed. Please try again.";
}
