"use client";

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, User, Cpu, Upload, Loader2, RotateCcw, Check, Info } from "lucide-react";
import { api } from "../../lib/api";
import { useLauncherStore } from "../../stores";
import type { Instance } from "../../lib/types";
import { GlassInput } from "./FormControls";
import { GlassToggle } from "./FormControls";
import { Select } from "./Select";
import { GlowButton } from "./GlowButton";
import { useToast } from "./Toast";
import { alertDialog } from "./Dialog";
import type { InstallTarget } from "./ProfileCardOptions";

type Tab = "profile" | "java";

interface ProfileSettingsModalProps {
  open: boolean;
  profile: Instance | null;
  initialTab?: Tab;
  onClose: () => void;
  /** Reload the instance list after metadata changed. */
  onSaved?: () => void;
  /** Version / loader changed → caller should show the install overlay. */
  onInstall?: (target: InstallTarget) => void;
}

const NAME_INVALID = /[\/\\]/;

export function ProfileSettingsModal({
  open,
  profile,
  initialTab = "profile",
  onClose,
  onSaved,
  onInstall,
}: ProfileSettingsModalProps) {
  const { themeColors, settings } = useLauncherStore();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // Profile tab
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState("vanilla");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [versions, setVersions] = useState<string[]>([]);
  const [loaders, setLoaders] = useState<string[]>(["vanilla", "fabric", "forge", "quilt", "neoforge"]);
  const [icon, setIcon] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const fileRef = useRefSafe();

  // Java tab
  const [ramOverride, setRamOverride] = useState(false);
  const [ramMb, setRamMb] = useState(4096);
  const [jvmArgs, setJvmArgs] = useState("");
  const [javaPath, setJavaPath] = useState("");
  const [javas, setJavas] = useState<any[]>([]);
  const [globalRam, setGlobalRam] = useState<number>(settings.ram_mb || settings.max_memory || 2048);

  const profileName = profile?.name ?? "";

  /* ------------------------------------------------------------- loading */
  useEffect(() => {
    if (!open || !profile) return;
    setTab(initialTab);
    setName(profile.name);
    setVersion(profile.version || "");
    setLoader((profile.loader || "vanilla").toLowerCase());
    setLoaderVersion(profile.loader_version || "");
    setJvmArgs("");
    setJavaPath("");
    setRamOverride(false);
    setRamMb(settings.ram_mb || settings.max_memory || 4096);
    setIcon(null);

    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [mc, st, installed, iconRes] = await Promise.all([
          api.versions.getMinecraft().catch(() => null),
          api.instanceSettings.get(profile.name).catch(() => null),
          api.java.getInstallations().catch(() => []),
          api.instances.getIcon(profile.name).catch(() => ({ success: false, icon: null })),
        ]);
        if (!alive) return;
        if (mc) {
          const list = (mc.release_versions?.length ? mc.release_versions : mc.all_versions) || [];
          const uniq = Array.from(new Set([...list, ...(profile.version ? [profile.version] : [])]));
          setVersions(uniq);
        }
        if (st) {
          const ram = Number(st.ram_mb || 0);
          setRamOverride(ram >= 512);
          if (ram >= 512) setRamMb(ram);
          setJvmArgs(st.jvm_args || "");
          setJavaPath(st.java_path || "");
        }
        setJavas(Array.isArray(installed) ? installed : []);
        if (iconRes?.success && iconRes.icon) setIcon(iconRes.icon);

        // Supported loaders for the current MC version
        if (profile.version) {
          const sup = await api.versions.getSupportedLoaders(profile.version).catch(() => null);
          if (alive && sup && sup.length) {
            setLoaders((prev) =>
              Array.from(new Set([...sup, ...(profile.loader ? [profile.loader.toLowerCase()] : []), ...(prev.includes("vanilla") ? [] : [])]))
            );
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profileName, initialTab]);

  // Reload loaders when the MC version changes
  useEffect(() => {
    if (!open || !version) return;
    let alive = true;
    api.versions.getSupportedLoaders(version).then((sup) => {
      if (!alive || !sup || !sup.length) return;
      setLoaders((prev) => Array.from(new Set([...sup, ...(prev.includes(loader) ? [] : [])])));
      if (!sup.includes(loader)) setLoader(sup[0]);
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, open]);

  /* --------------------------------------------------------------- icon */
  const onPickIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !profile) return;
    if (!file.type.startsWith("image/")) {
      await alertDialog("Unsupported File", "Please choose an image file (PNG or JPG).");
      return;
    }
    setIconBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      const res: any = await api.instances.setIcon(profile.name, dataUrl.split(",")[1]);
      if (res?.error) {
        toast("error", "Icon not saved", res.error, 6000);
      } else {
        setIcon(dataUrl);
        toast("success", "Profile icon updated");
        onSaved?.();
      }
    } catch (err: any) {
      toast("error", "Icon not saved", err?.message || String(err), 6000);
    }
    setIconBusy(false);
  };

  /* --------------------------------------------------------------- save */
  const saveProfile = async () => {
    if (!profile) return;
    const trimmed = name.trim();
    if (!trimmed) {
      await alertDialog("Name Required", "Profile name cannot be empty.");
      return;
    }
    if (NAME_INVALID.test(trimmed) || trimmed.includes("..")) {
      await alertDialog("Invalid Name", "Profile name cannot contain / \\ or .. characters.");
      return;
    }
    if (!version) {
      await alertDialog("Version Required", "Select a Minecraft version for this profile.");
      return;
    }

    const nameChanged = trimmed !== profile.name;
    const versionChanged = version !== (profile.version || "");
    const loaderChanged =
      loader !== (profile.loader || "").toLowerCase() ||
      loaderVersion.trim() !== (profile.loader_version || "");

    if (!nameChanged && !versionChanged && !loaderChanged) {
      toast("info", "No changes", "Nothing to save on the Profile tab.");
      onClose();
      return;
    }

    setSaving(true);
    try {
      let targetName = profile.name;
      if (nameChanged || versionChanged || loaderChanged) {
        const res = await api.instances.edit(
          profile.name,
          trimmed,
          version,
          loader,
          loaderVersion.trim()
        );
        if (res?.error) {
          toast("error", "Could not save profile", res.error, 6000);
          setSaving(false);
          return;
        }
        targetName = res.name || trimmed;
      }

      toast(
        "success",
        "Profile updated",
        nameChanged ? `Renamed to "${targetName}".` : "Profile settings saved."
      );
      onSaved?.();

      const needsInstall = versionChanged || loaderChanged;
      if (needsInstall && profile.installed !== false) {
        onInstall?.({
          instanceName: targetName,
          version,
          loader,
          loaderVersion: loaderVersion.trim(),
        });
      }
      setSaving(false);
      onClose();
      return;
    } catch (err: any) {
      toast("error", "Could not save profile", err?.message || String(err), 6000);
    }
    setSaving(false);
  };

  const saveJava = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await api.instanceSettings.save(
        profile.name,
        ramOverride ? ramMb : 0,
        jvmArgs.trim(),
        javaPath
      );
      if (res?.error) {
        toast("error", "Could not save JVM settings", res.error, 6000);
      } else {
        toast(
          "success",
          "JVM settings saved",
          ramOverride
            ? `This profile will launch with ${ramMb} MB RAM.`
            : "This profile now follows the global launcher settings."
        );
        onSaved?.();
        onClose();
      }
    } catch (err: any) {
      toast("error", "Could not save JVM settings", err?.message || String(err), 6000);
    }
    setSaving(false);
  };

  const resetJava = async () => {
    setRamOverride(false);
    setRamMb(settings.ram_mb || settings.max_memory || 4096);
    setJvmArgs("");
    setJavaPath("");
    setSaving(true);
    try {
      await api.instanceSettings.save(profile?.name || "", 0, "", "");
      toast("success", "Reset to global defaults", "This profile now uses the launcher-wide Java & RAM settings.");
      onSaved?.();
      onClose();
    } catch (err: any) {
      toast("error", "Reset failed", err?.message || String(err));
    }
    setSaving(false);
  };

  /* ------------------------------------------------------------ helpers */
  const field = (label: string, hint?: string) => (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
    </div>
  );

  const tabBtn = (id: Tab, label: string, Icon: React.ComponentType<{ size?: number | string; className?: string }>) => {
    const active = tab === id;
    return (
      <button
        type="button"
        onClick={() => setTab(id)}
        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
          active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
        }`}
        style={{
          background: active ? `${themeColors.accent}20` : "transparent",
          border: `1px solid ${active ? `${themeColors.accent}60` : "transparent"}`,
        }}
      >
        <Icon size={12} /> {label}
      </button>
    );
  };

  return (
    <AnimatePresence>
      {open && profile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => !saving && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            className="relative w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[86vh]"
            style={{
              background: "linear-gradient(180deg, #161922 0%, #13161C 100%)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
            }}
          >
            {/* header */}
            <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-white/[0.07]">
              <div
                className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shrink-0 text-white"
                style={{ background: `${themeColors.accent}20`, border: `1px solid ${themeColors.accent}40` }}
              >
                {icon ? (
                  <img src={icon} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User size={18} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-black text-white truncate">Profile Settings</h2>
                <p className="text-[11px] text-zinc-500 truncate">{profile.name}</p>
              </div>
              <button
                onClick={() => !saving && onClose()}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* tabs */}
            <div className="flex gap-2 px-5 pt-4">
              {tabBtn("profile", "Profile", User)}
              {tabBtn("java", "JVM & Memory", Cpu)}
            </div>

            {/* body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {loading && (
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 py-4 justify-center">
                  <Loader2 size={13} className="animate-spin" /> Loading profile data…
                </div>
              )}

              {tab === "profile" && !loading && (
                <>
                  <div>
                    {field("Profile name")}
                    <GlassInput value={name} onChange={setName} placeholder="Profile name" />
                  </div>

                  <div>
                    {field("Profile icon", "PNG / JPG")}
                    <div className="flex items-center gap-3">
                      <div
                        className="w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
                        style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}` }}
                      >
                        {icon ? (
                          <img src={icon} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User size={20} className="text-zinc-600" />
                        )}
                      </div>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={onPickIcon}
                      />
                      <GlowButton
                        size="sm"
                        variant="secondary"
                        loading={iconBusy}
                        onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-1"
                      >
                        <Upload size={12} /> {icon ? "Change icon" : "Upload icon"}
                      </GlowButton>
                    </div>
                  </div>

                  <div>
                    {field("Minecraft version")}
                    <Select
                      value={version}
                      onChange={setVersion}
                      placeholder="Select a version"
                      options={versions.map((v) => ({ value: v, label: v }))}
                    />
                  </div>

                  <div>
                    {field("Mod loader")}
                    <div className="flex flex-wrap gap-2">
                      {loaders.map((l) => {
                        const active = loader === l;
                        const label = l === "vanilla" ? "Vanilla" : l.charAt(0).toUpperCase() + l.slice(1);
                        return (
                          <button
                            key={l}
                            type="button"
                            onClick={() => setLoader(l)}
                            className="px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
                            style={{
                              background: active ? `${themeColors.accent}20` : themeColors.bg_card2,
                              border: `1px solid ${active ? `${themeColors.accent}70` : themeColors.border}`,
                              color: active ? themeColors.accent : themeColors.text_muted,
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {loader !== "vanilla" && (
                    <div>
                      {field("Loader version", "optional — auto picks the latest")}
                      <GlassInput
                        value={loaderVersion}
                        onChange={setLoaderVersion}
                        placeholder="Auto (latest)"
                      />
                    </div>
                  )}

                  <div
                    className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
                    style={{ background: `${themeColors.accent}10`, border: `1px solid ${themeColors.accent}25`, color: themeColors.text_muted }}
                  >
                    <Info size={13} className="shrink-0 mt-0.5" style={{ color: themeColors.accent }} />
                    <span>
                      Changing the Minecraft version or loader re-downloads the game files for this
                      profile. Mods are kept — check compatibility before switching.
                    </span>
                  </div>
                </>
              )}

              {tab === "java" && !loading && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-white">Override global RAM</p>
                      <p className="text-[11px] text-zinc-500">
                        Off = follow the launcher-wide setting ({globalRam} MB)
                      </p>
                    </div>
                    <GlassToggle checked={ramOverride} onChange={setRamOverride} />
                  </div>

                  {ramOverride && (
                    <div
                      className="rounded-xl p-4 space-y-3"
                      style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}` }}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                          Max memory
                        </span>
                        <span className="text-lg font-black" style={{ color: themeColors.accent }}>
                          {(ramMb / 1024).toFixed(ramMb % 1024 === 0 ? 0 : 1)} GB
                          <span className="text-[11px] font-bold text-zinc-500 ml-1">{ramMb} MB</span>
                        </span>
                      </div>
                      <input
                        type="range"
                        min={512}
                        max={32768}
                        step={512}
                        value={ramMb}
                        onChange={(e) => setRamMb(Number(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
                        <span>512 MB</span>
                        <span>8 GB</span>
                        <span>16 GB</span>
                        <span>32 GB</span>
                      </div>
                      <div className="flex gap-2">
                        {[2048, 4096, 6144, 8192, 16384].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setRamMb(n)}
                            className="flex-1 py-1 rounded-lg text-[10px] font-bold transition-all"
                            style={{
                              background: ramMb === n ? `${themeColors.accent}25` : "rgba(255,255,255,0.04)",
                              border: `1px solid ${ramMb === n ? `${themeColors.accent}60` : "rgba(255,255,255,0.08)"}`,
                              color: ramMb === n ? themeColors.accent : themeColors.text_muted,
                            }}
                          >
                            {n >= 1024 ? `${n / 1024}G` : n}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    {field("Extra JVM flags", "appended after the global flags")}
                    <textarea
                      value={jvmArgs}
                      onChange={(e) => setJvmArgs(e.target.value)}
                      rows={3}
                      spellCheck={false}
                      placeholder="-XX:+UseZGC -XX:+ZGenerational"
                      className="w-full px-3 py-2.5 rounded-xl text-[11px] font-mono outline-none resize-y transition-all"
                      style={{
                        background: themeColors.bg_card2,
                        border: `1px solid ${themeColors.border}`,
                        color: themeColors.text_main,
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = `${themeColors.accent}60`)}
                      onBlur={(e) => (e.currentTarget.style.borderColor = themeColors.border)}
                    />
                  </div>

                  <div>
                    {field("Java runtime", "for this profile only")}
                    <Select
                      value={javaPath}
                      onChange={setJavaPath}
                      placeholder="Auto (launcher default)"
                      options={[
                        { value: "", label: "Auto (launcher default)" },
                        ...javas.map((j) => ({
                          value: j.path,
                          label: `Java ${j.major_version ?? "?"} — ${j.name || j.path.split("/").pop() || j.path}`,
                        })),
                      ]}
                    />
                  </div>

                  <div
                    className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
                    style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)", color: themeColors.text_muted }}
                  >
                    <Info size={13} className="shrink-0 mt-0.5 text-blue-400" />
                    <span>These settings apply the next time this profile is launched. They never affect other profiles.</span>
                  </div>
                </>
              )}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.07]">
              {tab === "java" ? (
                <button
                  type="button"
                  onClick={resetJava}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-500 hover:text-white transition-colors disabled:opacity-40"
                >
                  <RotateCcw size={12} /> Reset to defaults
                </button>
              ) : (
                <span className="text-[10px] text-zinc-600 truncate">{profile.version} · {profile.loader}</span>
              )}
              <div className="flex items-center gap-2">
                <GlowButton size="sm" variant="ghost" onClick={() => !saving && onClose()} disabled={saving}>
                  Cancel
                </GlowButton>
                <GlowButton
                  size="sm"
                  loading={saving}
                  onClick={tab === "profile" ? saveProfile : saveJava}
                  className="flex items-center gap-1"
                >
                  <Check size={12} />
                  {tab === "profile" ? "Save Profile" : "Save JVM Settings"}
                </GlowButton>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Tiny ref helper kept local so the component stays self-contained. */
function useRefSafe() {
  return React.useRef<HTMLInputElement>(null);
}
