// Xryloth account system: optional email/password auth (Firebase) + local admin bypass.
// Login is NEVER compulsory — the launcher works fully without an account.
import {
  auth, db,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, ref, set, get,
} from "./firebase";

export const ADMIN_EMAIL = "support@xrylothclient.com";

/**
 * The admin account.
 *
 * There is deliberately NO password here. The admin is an ordinary Firebase
 * account with this email address, and the database rules check
 * `auth.token.email == 'support@xrylothclient.com'` — a real Firebase
 * session is the only thing the rules trust.
 *
 * A local password used to short-circuit this and write an `isAdmin` session
 * straight into localStorage. That secret shipped inside the app bundle, so
 * anyone who downloaded the launcher could read it, and it never actually
 * helped: the bypass never signed in to Firebase, so `auth` stayed null and
 * every write it attempted was rejected by the rules anyway. The local
 * bypass is gone; admin status now comes from the Firebase session.
 *
 * The account has to exist in Firebase Authentication, with its email marked
 * as verified (Authentication -> the user -> "Email verified"). A real inbox
 * is not needed for that.
 */
export function isAdminEmail(email: string | undefined | null): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL;
}

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

/**
 * Keep the local session in step with Firebase.
 *
 * The session is a convenience mirror of the Firebase auth state: it holds
 * the username and the admin flag for the UI, while Firebase holds the
 * credentials the database rules actually check. If the two ever disagree —
 * someone signs out in another window, or the admin flag is stale — this
 * re-derives the session from the truth.
 */
export function watchAuthState(): () => void {
  return onAuthStateChanged(auth, (user) => {
    const current = getSession();
    if (!user) {
      if (current) saveSession(null);
      return;
    }
    if (current && current.uid === user.uid) {
      // Same account — just refresh the admin flag in case the email changed.
      const isAdmin = isAdminEmail(user.email);
      if (current.isAdmin !== isAdmin) {
        saveSession({ ...current, isAdmin, provider: isAdmin ? "admin" : "xryloth" });
      }
      return;
    }
    saveSession({
      email: user.email || "",
      username: user.displayName || (user.email || "").split("@")[0],
      uid: user.uid,
      isAdmin: isAdminEmail(user.email),
      verified: !!user.emailVerified,
      provider: isAdminEmail(user.email) ? "admin" : "xryloth",
      createdAt: new Date().toISOString(),
    });
  });
}

export async function signup(email: string, password: string, username: string): Promise<{ ok: boolean; error?: string; needsVerification?: boolean }> {
  email = email.trim();
  username = username.trim();
  if (!email || !password || !username) return { ok: false, error: "Email, password and username are required." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const isAdmin = isAdminEmail(email);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try { await updateProfile(cred.user, { displayName: username }); } catch {}
    try {
      const { sendEmailVerification } = await import("firebase/auth");
      await sendEmailVerification(cred.user);
    } catch {}
    try { await set(ref(db, `users/${cred.user.uid}`), { email, username, createdAt: new Date().toISOString() }); } catch {}
    if (isAdmin) {
      // The admin is signed in straight away: the rules trust the Firebase
      // session, so an admin that is not signed in cannot write anything.
      // Email verification is a console action, not an inbox one.
      saveSession({
        email, username, uid: cred.user.uid, isAdmin: true, verified: true,
        provider: "admin", createdAt: new Date().toISOString(),
      });
      return { ok: true };
    }
    await signOut(auth);
    return { ok: true, needsVerification: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e?.code || e?.message) };
  }
}

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string; needsVerification?: boolean }> {
  email = email.trim();
  if (!email || !password) return { ok: false, error: "Email and password are required." };
  const isAdmin = isAdminEmail(email);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await cred.user.reload();
    if (!cred.user.emailVerified && !isAdmin) {
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
      email, username, uid: cred.user.uid, isAdmin, verified: true,
      provider: isAdmin ? "admin" : "xryloth", createdAt: new Date().toISOString(),
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
