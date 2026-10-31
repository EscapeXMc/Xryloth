import { useState, useEffect, useRef, useCallback } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import { FabricLogo } from "../ui/FabricLogo";
import { ForgeLogo } from "../ui/ForgeLogo";
import { OptifineLogo } from "../ui/OptifineLogo";
import { QuiltLogo } from "../ui/QuiltLogo";
import {
  Users, Plus, Trash2, Monitor, Check, ExternalLink, AlertCircle, Shield,
  Mail, Lock, LogOut, BadgeCheck, UserPlus, ShoppingBag,
} from "lucide-react";
import {
  signup, login, logout, resendVerification, getSession, onSessionChanged,
  type XrylothSession,
} from "../../lib/auth";

interface Account {
  type: "microsoft" | "elyby" | "offline";
  username: string;
  uuid: string;
  client_token?: string;
  access_token?: string;
  refresh_token?: string;
  token_exp?: number;
}

export function AccountsPage() {
  const { settings, saveSettings, themeColors } = useLauncherStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeUuid, setActiveUuid] = useState("");
  const [msStep, setMsStep] = useState<"idle" | "polling" | "done" | "error">("idle");
  const [msUserCode, setMsUserCode] = useState("");
  const [msUri, setMsUri] = useState("");
  const [msError, setMsError] = useState("");
  const msPollRef = useRef<NodeJS.Timeout | null>(null);
  const [elyStep, setElyStep] = useState<"idle" | "polling" | "done" | "error">("idle");
  const [elyAuthUrl, setElyAuthUrl] = useState("");
  const [elyError, setElyError] = useState("");
  const [offlineUsername, setOfflineUsername] = useState("");
  const [skinFile, setSkinFile] = useState<string | null>(null);
  const [skinInfo, setSkinInfo] = useState<{ custom_skin_path: string; has_skin: boolean } | null>(null);
  // Xryloth account (optional email auth)
  const [xSession, setXSession] = useState<XrylothSession | null>(() => getSession());
  const [xMode, setXMode] = useState<"login" | "signup">("login");
  const [xEmail, setXEmail] = useState("");
  const [xPass, setXPass] = useState("");
  const [xName, setXName] = useState("");
  const [xBusy, setXBusy] = useState(false);
  const [xMsg, setXMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  // Supported Minecraft loaders (brand logos)
  const loaders = [
    { id: "fabric", name: "Fabric", desc: "Lightweight & fast", icon: <FabricLogo size={20} /> },
    { id: "forge", name: "Forge", desc: "Classic modding API", icon: <ForgeLogo size={20} /> },
    { id: "optifine", name: "OptiFine", desc: "Performance & shaders", icon: <OptifineLogo size={20} /> },
    { id: "quilt", name: "Quilt", desc: "Modern fabric fork", icon: <QuiltLogo size={20} /> },
  ];

  useEffect(() => onSessionChanged(setXSession), []);

  const submitXryloth = async () => {
    setXBusy(true);
    setXMsg(null);
    const res = xMode === "signup"
      ? await signup(xEmail, xPass, xName)
      : await login(xEmail, xPass);
    setXBusy(false);
    if (res.ok && res.needsVerification) {
      setXMsg({ kind: "info", text: "Account created! Check your inbox and verify your email, then log in." });
      setXMode("login");
    } else if (res.ok) {
      setXMsg({ kind: "ok", text: xSession?.isAdmin ? "Welcome, Admin." : "Signed in!" });
      setXEmail(""); setXPass(""); setXName("");
    } else if (res.needsVerification) {
      setXMsg({ kind: "info", text: res.error || "Please verify your email first." });
    } else {
      setXMsg({ kind: "err", text: res.error || "Failed." });
    }
  };

  useEffect(() => {
    const savedAccounts = (settings as any).accounts || [];
    const savedActive = (settings as any).active_account_uuid || "";
    setAccounts(savedAccounts);
    setActiveUuid(savedActive);
  }, [settings]);

  const saveAccounts = async (newAccounts: Account[], newActive?: string) => {
    setAccounts(newAccounts);
    const toSave: Record<string, any> = { accounts: newAccounts };
    if (newActive !== undefined) toSave.active_account_uuid = newActive;
    await saveSettings(toSave);
  };

  const startMicrosoftAuth = useCallback(async () => {
    setMsStep("polling");
    setMsError("");
    if (msPollRef.current) clearInterval(msPollRef.current);

    try {
      const result = await api.auth.microsoftStart();
      if (result.error) throw new Error(result.error);
      setMsUserCode(result.user_code || "");
      setMsUri(result.verification_uri || "");

      let finished = false;
      msPollRef.current = setInterval(async () => {
        if (finished) return;
        try {
          const status = await api.auth.microsoftPollStatus();
          if (status.status === "done" && status.result) {
            finished = true;
            if (msPollRef.current) clearInterval(msPollRef.current);
            const res = status.result;
            if (res.error) {
              throw new Error(res.error);
            }
            if (res.access_token) {
              // Complete the XBL/XSTS/Minecraft exchange
              const pollResult = await api.auth.microsoftComplete(res.access_token, res.refresh_token || "");
              if (pollResult.error) throw new Error(pollResult.error);
              const newAccount: Account = {
                type: "microsoft",
                username: pollResult.username,
                uuid: pollResult.uuid || pollResult.username,
                access_token: pollResult.mc_token,
                refresh_token: pollResult.refresh_token || res.refresh_token || "",
                token_exp: pollResult.token_exp,
              };
              const newAccounts = [...accounts.filter((a) => a.uuid !== newAccount.uuid), newAccount];
              await saveAccounts(newAccounts, newAccount.uuid);
              setMsStep("done");
            } else if (res.error) {
              throw new Error(res.error);
            }
          }
        } catch (err: any) {
          finished = true;
          if (msPollRef.current) clearInterval(msPollRef.current);
          console.error("Microsoft auth failed:", err);
          setMsError(err?.toString() || "Authentication failed");
          setMsStep("error");
        }
      }, 3000);

      // Safety timeout: stop polling after 6 minutes
      setTimeout(() => {
        if (!finished) {
          finished = true;
          if (msPollRef.current) clearInterval(msPollRef.current);
          setMsError("Authentication timed out. Please try again.");
          setMsStep("error");
        }
      }, 360000);
    } catch (err: any) {
      if (msPollRef.current) clearInterval(msPollRef.current);
      console.error("Microsoft auth failed:", err);
      setMsError(err?.toString() || "Authentication failed");
      setMsStep("error");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (msPollRef.current) clearInterval(msPollRef.current);
    };
  }, []);

  const startElybyAuth = async () => {
    setElyStep("polling");
    setElyError("");
    try {
      const result = await api.auth.elybyStart();
      setElyAuthUrl(result.auth_url);
      const pollResult = await api.auth.elybyPoll();
      if (pollResult.error) throw new Error(pollResult.error);
      const newAccount: Account = {
        type: "elyby",
        username: pollResult.username,
        uuid: pollResult.uuid,
        access_token: pollResult.mc_token || pollResult.access_token || "",
        refresh_token: pollResult.refresh_token || "",
      };
      const newAccounts = [...accounts.filter((a) => a.uuid !== newAccount.uuid), newAccount];
      await saveAccounts(newAccounts, newAccount.uuid);
      setElyStep("done");
    } catch (err: any) {
      console.error("Ely.by auth failed:", err);
      setElyError(err?.toString() || "Authentication failed");
      setElyStep("error");
    }
  };

  const addOfflineAccount = async () => {
    if (!offlineUsername.trim()) return;
    try {
      const result = await api.auth.createOffline(offlineUsername.trim());
      const newAccount: Account = {
        type: "offline",
        username: result.username,
        uuid: result.uuid,
      };
      const newAccounts = [...accounts.filter((a) => a.uuid !== result.uuid), newAccount];
      await saveAccounts(newAccounts, newAccounts.length === 1 ? result.uuid : activeUuid);
      setOfflineUsername("");
    } catch (err) {
      console.error("Failed to create offline account:", err);
    }
  };

  const removeAccount = async (uuid: string) => {
    const newAccounts = accounts.filter((a) => a.uuid !== uuid);
    const newActive = activeUuid === uuid ? (newAccounts[0]?.uuid || "") : activeUuid;
    await saveAccounts(newAccounts, newActive);
  };

  const setActive = async (uuid: string) => {
    setActiveUuid(uuid);
    await api.settings.saveOne("active_account_uuid", uuid);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#0D0F12] h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto w-full space-y-6">
      {/* Page header + active-account summary */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${themeColors.accent}18`, color: themeColors.accent, border: `1px solid ${themeColors.accent}30` }}>
            <Users size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight" style={{ color: themeColors.text_main }}>Accounts</h1>
            <p className="text-xs mt-0.5" style={{ color: themeColors.text_muted }}>
              {accounts.length === 0
                ? "No accounts yet — add one below to start playing"
                : `${accounts.length} account${accounts.length === 1 ? "" : "s"} · active: ${accounts.find((a) => a.uuid === activeUuid)?.username ?? "none"}`}
            </p>
          </div>
        </div>
        {accounts.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: `${themeColors.accent}12`, border: `1px solid ${themeColors.accent}30`, color: themeColors.accent }}>
            <BadgeCheck size={14} />
            {accounts.find((a) => a.uuid === activeUuid)?.username ?? "No active account"}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto w-full">
        <GlassCard className="h-full">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield size={16} style={{ color: themeColors.accent }} />
              <h3 className="text-sm font-bold" style={{ color: themeColors.text_main }}>Microsoft</h3>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"
              style={{ background: `${themeColors.accent}15`, color: themeColors.accent }}>Official</span>
          </div>
          <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>Sign in for online play on official servers</p>
          {msStep === "polling" && msUserCode ? (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: themeColors.text_main }}>Go to <a href={msUri} target="_blank" rel="noreferrer" style={{ color: themeColors.accent }}>{msUri}</a></p>
              <p className="text-xs" style={{ color: themeColors.text_sub }}>Enter code: <span className="font-mono font-bold" style={{ color: themeColors.accent }}>{msUserCode}</span></p>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: themeColors.accent, borderTopColor: "transparent" }} />
                <span className="text-xs" style={{ color: themeColors.text_muted }}>Waiting for authentication...</span>
              </div>
              <button onClick={() => { if (msPollRef.current) clearInterval(msPollRef.current); setMsStep("idle"); }}
                className="text-xs underline" style={{ color: themeColors.danger }}>
                Cancel
              </button>
            </div>
          ) : msStep === "done" ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: themeColors.success }}>
              <Check size={14} /> Successfully signed in!
            </div>
          ) : (
            <>
              {msError && (
                <div className="flex items-center gap-1 text-xs mb-2" style={{ color: themeColors.danger }}>
                  <AlertCircle size={12} /> {msError}
                </div>
              )}
              <GlowButton size="sm" onClick={startMicrosoftAuth} className="w-full flex items-center justify-center gap-1">
                <Shield size={14} /> Sign In with Microsoft
              </GlowButton>
            </>
          )}
        </GlassCard>

        <GlassCard className="h-full">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Monitor size={16} style={{ color: themeColors.purple }} />
              <h3 className="text-sm font-bold" style={{ color: themeColors.text_main }}>Ely.by</h3>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"
              style={{ background: `${themeColors.purple}15`, color: themeColors.purple }}>Capes</span>
          </div>
          <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>Custom capes, skins &amp; cosmetics</p>
          {elyStep === "polling" && elyAuthUrl ? (
            <div className="space-y-2">
              <a href={elyAuthUrl} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1" style={{ color: themeColors.accent }}>
                <ExternalLink size={12} /> Open Ely.by login
              </a>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: themeColors.purple, borderTopColor: "transparent" }} />
                <span className="text-xs" style={{ color: themeColors.text_muted }}>Waiting for authentication...</span>
              </div>
            </div>
          ) : elyStep === "done" ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: themeColors.success }}>
              <Check size={14} /> Successfully signed in!
            </div>
          ) : (
            <>
              {elyError && (
                <div className="flex items-center gap-1 text-xs mb-2" style={{ color: themeColors.danger }}>
                  <AlertCircle size={12} /> {elyError}
                </div>
              )}
              <GlowButton size="sm" onClick={startElybyAuth} className="w-full flex items-center justify-center gap-1" style={{ background: themeColors.purple }}>
                <Monitor size={14} /> Sign In with Ely.by
              </GlowButton>
            </>
          )}
        </GlassCard>
      </div>

      {/* Offline input + signed-in/active accounts stacked vertically */}
      <div className="mt-6 max-w-5xl space-y-6">
        <GlassCard>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Users size={16} style={{ color: themeColors.warn }} />
              <h3 className="text-sm font-bold" style={{ color: themeColors.text_main }}>Offline</h3>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"
              style={{ background: `${themeColors.warn}15`, color: themeColors.warn }}>No auth</span>
          </div>
          <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>Play without authentication (local servers only)</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <GlassInput value={offlineUsername} onChange={setOfflineUsername}
                placeholder="Username" onKeyDown={(e) => e.key === "Enter" && addOfflineAccount()} />
            </div>
            <GlowButton size="sm" onClick={addOfflineAccount}
              disabled={!offlineUsername.trim()} style={{ background: themeColors.warn }}>
              <Plus size={14} /> Add
            </GlowButton>
          </div>
        </GlassCard>

        <GlassCard className="h-full">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={16} style={{ color: themeColors.success }} />
          <h3 className="tinycaps text-sm font-semibold" style={{ color: themeColors.text_main }}>Xryloth Account</h3>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${themeColors.success}15`, color: themeColors.success }}>OPTIONAL</span>
          {xSession?.isAdmin && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: `${themeColors.warn}18`, color: themeColors.warn }}><BadgeCheck size={9} /> ADMIN</span>
          )}
        </div>
        <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>
          Sign up with email + password (verification required). Never compulsory — the launcher works fully without it.
        </p>
        {xSession ? (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: `${themeColors.success}08`, border: `1px solid ${themeColors.success}25` }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: `${themeColors.success}20`, color: themeColors.success }}>
              {xSession.username[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium" style={{ color: themeColors.text_main }}>{xSession.username}</div>
              <div className="text-[10px]" style={{ color: themeColors.text_muted }}>{xSession.email}{xSession.isAdmin ? " · full admin access" : ""}</div>
            </div>
            <button onClick={() => logout()} className="p-1.5 rounded-lg flex items-center gap-1 text-xs" style={{ color: themeColors.danger }}>
              <LogOut size={13} /> Sign Out
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: themeColors.bg_card2 }}>
              {(["login", "signup"] as const).map((m) => (
                <button key={m} onClick={() => { setXMode(m); setXMsg(null); }}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold tinycaps"
                  style={{ background: xMode === m ? `${themeColors.accent}20` : "transparent", color: xMode === m ? themeColors.accent : themeColors.text_muted }}>
                  {m === "login" ? "Log In" : "Sign Up"}
                </button>
              ))}
            </div>
            {xMode === "signup" && (
              <GlassInput value={xName} onChange={setXName} placeholder="Username" onKeyDown={(e) => e.key === "Enter" && submitXryloth()} />
            )}
            <GlassInput value={xEmail} onChange={setXEmail} placeholder="Email address" onKeyDown={(e) => e.key === "Enter" && submitXryloth()} />
            <GlassInput value={xPass} onChange={setXPass} placeholder="Password (min 6 chars)" type="password" onKeyDown={(e) => e.key === "Enter" && submitXryloth()} />
            {xMsg && (
              <p className="text-xs" style={{ color: xMsg.kind === "err" ? themeColors.danger : xMsg.kind === "ok" ? themeColors.success : themeColors.warn }}>{xMsg.text}</p>
            )}
            <GlowButton size="sm" onClick={submitXryloth} disabled={xBusy} className="w-full flex items-center justify-center gap-1" style={{ background: themeColors.success }}>
              {xMode === "signup" ? <UserPlus size={14} /> : <Lock size={14} />} {xBusy ? "Please wait..." : xMode === "signup" ? "Create Account" : "Log In"}
            </GlowButton>
            {xMode === "login" && (
              <button onClick={async () => { const r = await resendVerification(xEmail, xPass); setXMsg(r.ok ? { kind: "ok", text: "Verification email re-sent." } : { kind: "err", text: r.error || "Failed." }); }}
                className="text-[11px] underline w-full text-center" style={{ color: themeColors.text_muted }}>
                Didn't get the verification email? Re-send it
              </button>
            )}
          </div>
        )}
      </GlassCard>

      <GlassCard className="h-full">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold" style={{ color: themeColors.text_main }}>Your Accounts</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: themeColors.bg_card2, color: themeColors.text_muted }}>{accounts.length}</span>
        </div>
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 rounded-xl border border-dashed"
            style={{ borderColor: themeColors.border }}>
            <Users size={28} style={{ color: themeColors.text_muted, opacity: 0.5 }} />
            <p className="text-sm font-semibold mt-2" style={{ color: themeColors.text_main }}>No accounts yet</p>
            <p className="text-xs mt-0.5 text-center" style={{ color: themeColors.text_muted }}>Use the options above to add one.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => {
              const isActive = acc.uuid === activeUuid;
              const typeColor = acc.type === "microsoft" ? themeColors.accent : acc.type === "elyby" ? themeColors.purple : themeColors.warn;
              return (
                <div key={acc.uuid} className="group flex items-center justify-between px-3 py-2.5 rounded-xl transition-all"
                  style={{
                    border: `1px solid ${isActive ? typeColor : themeColors.border}`,
                    background: isActive ? `${typeColor}10` : "transparent",
                  }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={{ background: `${typeColor}20`, color: typeColor }}>
                      {acc.username[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold flex items-center gap-1.5" style={{ color: themeColors.text_main }}>
                        <span className="truncate">{acc.username}</span>
                        {isActive && <BadgeCheck size={13} style={{ color: themeColors.accent, flexShrink: 0 }} />}
                      </div>
                      <div className="text-[10px] flex items-center gap-1.5 flex-wrap" style={{ color: themeColors.text_muted }}>
                        <span className="px-1.5 py-0.5 rounded font-bold uppercase tracking-wide" style={{ background: `${typeColor}15`, color: typeColor }}>{acc.type}</span>
                        {/* A Microsoft account without a Minecraft profile cannot launch
                            the game - say so before the user finds out the hard way. */}
                        {acc.type === "microsoft" && !acc.uuid && (
                          <span
                            className="px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: `${themeColors.danger}22`, color: themeColors.danger }}
                            title="This Microsoft account has no Minecraft: Java Edition profile"
                          >
                            Not linked
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!isActive && (
                      <GlowButton size="sm" onClick={() => setActive(acc.uuid)} className="text-xs">Use</GlowButton>
                    )}
                    <button onClick={() => removeAccount(acc.uuid)}
                      className="p-1.5 rounded-lg transition-all opacity-40 group-hover:opacity-100"
                      style={{ color: themeColors.danger }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Supported game loaders */}
      <GlassCard className="h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold" style={{ color: themeColors.text_main }}>Supported Loaders</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: themeColors.bg_card2, color: themeColors.text_muted }}>
            {loaders.length} loaders
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loaders.map((loader) => (
            <GlassCard
              key={loader.id}
              className="flex flex-col items-center gap-2 p-3 rounded-lg hover:border-white/20 transition-all cursor-pointer"
              style={{ border: `1px solid ${themeColors.border}` }}
            >
              <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${themeColors.border}` }}>
                {loader.icon}
              </div>
              <div className="text-xs font-semibold leading-tight text-center" style={{ color: themeColors.text_main }}>{loader.name}</div>
              <div className="text-[10px] leading-none text-center" style={{ color: themeColors.text_muted }}>{loader.desc}</div>
            </GlassCard>
          ))}
        </div>
      </GlassCard>

      {/* Monetisation off-ramp: the launcher works without an account, but
          official servers need one. */}
      <GlassCard className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${themeColors.accent}18`, color: themeColors.accent }}>
            <ShoppingBag size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: themeColors.text_main }}>
              Don&apos;t own Minecraft yet?
            </p>
            <p className="text-[11px]" style={{ color: themeColors.text_muted }}>
              An official copy is needed for online play. Offline and local accounts
              work without one.
            </p>
          </div>
        </div>
        <a
          href="https://www.minecraft.net/en-us/get-minecraft"
          target="_blank"
          rel="noreferrer"
          className="outline-btn px-4 py-2 text-xs font-semibold"
        >
          Buy Minecraft
        </a>
      </GlassCard>
      </div>
      </div>
    </div>
  );
}
