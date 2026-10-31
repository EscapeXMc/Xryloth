"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  MoreHorizontal,
  FolderOpen,
  Puzzle,
  Camera,
  FolderCog,
  FileJson,
  Copy,
  Pin,
  PinOff,
  Eraser,
  Trash2,
  SlidersHorizontal,
  Cpu,
  Loader2,
} from "lucide-react";
import { save as saveFileDialog } from "@tauri-apps/api/dialog";
import { api } from "../../lib/api";
import type { Instance } from "../../lib/types";
import { useToast } from "./Toast";
import { confirmDialog, promptDialog, alertDialog } from "./Dialog";

const PIN_KEY = "ec-pinned-instances"; // same key InstancesPage reads

export interface InstallTarget {
  instanceName: string;
  version: string;
  loader: string;
  loaderVersion: string;
}

interface ProfileCardOptionsProps {
  profile: Instance;
  /** Opens the edit modal on the given tab (profile settings / JVM & RAM). */
  onOpenSettings?: (tab: "profile" | "java") => void;
  /** Called after any action that changes profile metadata (rename, clone, delete...). */
  onChanged?: () => void;
  /** Called when the Minecraft version / loader changed and files must be reinstalled. */
  onInstall?: (target: InstallTarget) => void;
}

type BusyKey =
  | null
  | "folder"
  | "mods"
  | "screenshots"
  | "saves"
  | "config"
  | "edit"
  | "jvm"
  | "clone"
  | "exportMrpack"
  | "exportConfig"
  | "cache"
  | "delete"
  | "pin";

/**
 * The "••• More options" button on a profile card.
 *
 * Opens a glassmorphic, portal-rendered context menu (portal = it can never be
 * clipped by the card's `overflow-hidden`). Every row performs a real action.
 */
export function ProfileCardOptions({
  profile,
  onOpenSettings,
  onChanged,
  onInstall,
}: ProfileCardOptionsProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<BusyKey>(null);
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(PIN_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(arr) && arr.includes(profile.name);
    } catch {
      return false;
    }
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  /* ---------------------------------------------------------- positioning */
  useLayoutEffect(() => {
    if (!open) return; // keep the last position so the exit animation stays put
    const trig = triggerRef.current;
    const menu = menuRef.current;
    if (!trig || !menu) return;

    const r = trig.getBoundingClientRect();
    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    const gap = 8;
    const edge = 8;

    // Prefer opening downward; flip above the trigger when it would overflow.
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - edge) top = Math.max(edge, r.top - h - gap);

    // Keep the menu inside the viewport horizontally.
    let left = r.left + r.width / 2 - w / 2;
    left = Math.min(Math.max(edge, left), window.innerWidth - w - edge);

    setPos({ left, top });
  }, [open]);

  /* ------------------------------------------------------- outside / esc */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  /* ------------------------------------------------------------- helpers */
  const fail = useCallback(
    (title: string, err: any) => {
      const msg =
        typeof err === "string"
          ? err
          : err?.error || err?.message || (err ? String(err) : "Something went wrong");
      toast("error", title, msg, 6000);
    },
    [toast]
  );

  const openFolder = useCallback(
    async (key: Exclude<BusyKey, null>, sub?: string) => {
      setBusy(key);
      try {
        const res = sub
          ? await api.instances.openPath(profile.name, sub)
          : await api.instances.openFolder(profile.name);
        if (res && (res as any).error) fail("Cannot open folder", (res as any).error);
      } catch (e) {
        fail("Cannot open folder", e);
      }
      setBusy(null);
    },
    [profile.name, fail]
  );

  const duplicateProfile = useCallback(async () => {
    const suggested = `${profile.name} Copy`;
    const name = await promptDialog(
      "Duplicate Profile",
      `Choose a name for the copy of "${profile.name}". Mods, saves and config are copied too.`,
      { defaultValue: suggested, placeholder: "New profile name", confirmLabel: "Duplicate" }
    );
    if (!name || !name.trim()) return;
    if (name.trim() === profile.name) {
      alertDialog("Name Taken", "The copy needs a different name than the original profile.");
      return;
    }
    setBusy("clone");
    try {
      const res = await api.clone.instance(profile.name, name.trim());
      if (res?.success) {
        toast("success", "Profile duplicated", `"${name.trim()}" was created from "${profile.name}".`);
        onChanged?.();
      } else {
        fail("Duplicate failed", res?.error);
      }
    } catch (e) {
      fail("Duplicate failed", e);
    }
    setBusy(null);
  }, [profile.name, toast, onChanged, fail]);

  const pickPath = useCallback(async (title: string, defaultName: string, ext: string) => {
    try {
      return await saveFileDialog({
        defaultPath: defaultName,
        filters: [{ name: title, extensions: [ext] }],
      });
    } catch {
      return null;
    }
  }, []);

  const exportMrpack = useCallback(async () => {
    setBusy("exportMrpack");
    try {
      const target = await pickPath("Modrinth Pack", `${profile.name}.mrpack`, "mrpack");
      if (!target) { setBusy(null); return; } // cancelled
      const res = await api.export.mrpack(profile.name, profile.name, profile.version || "", target);
      if ((res as any)?.error) {
        fail("Export failed", (res as any).error);
      } else {
        toast("success", "Profile exported", `${profile.name}.mrpack saved — share it with anyone.`);
      }
    } catch (e) {
      fail("Export failed", e);
    }
    setBusy(null);
  }, [profile.name, profile.version, pickPath, toast, fail]);

  const exportConfig = useCallback(async () => {
    setBusy("exportConfig");
    try {
      const target = await pickPath("Instance Config", `${profile.name}.json`, "json");
      if (!target) { setBusy(null); return; }
      const res = await api.exportConfig.instance(profile.name, target);
      if (res?.success) {
        toast("success", "Config exported", res.path || "Profile config saved.");
      } else {
        fail("Export failed", res?.error);
      }
    } catch (e) {
      fail("Export failed", e);
    }
    setBusy(null);
  }, [profile.name, pickPath, toast, fail]);

  const clearCache = useCallback(async () => {
    const ok = await confirmDialog(
      "Clear profile cache?",
      `Temporary files of "${profile.name}" (logs, crash reports, caches) will be deleted.\nMods, worlds and settings are kept.`,
      { confirmLabel: "Clear Cache", danger: true }
    );
    if (!ok) return;
    setBusy("cache");
    try {
      const res = await api.instances.clearCache(profile.name);
      if (res?.success) {
        const items = res.removed?.length || 0;
        const kb = Math.round((res.freed_bytes || 0) / 1024);
        toast("success", "Cache cleared", `${items} item(s) removed — ${kb} KB freed.`);
      } else {
        fail("Clear cache failed", res?.error);
      }
    } catch (e) {
      fail("Clear cache failed", e);
    }
    setBusy(null);
  }, [profile.name, toast, fail]);

  const deleteProfile = useCallback(async () => {
    const ok = await confirmDialog(
      "Delete this profile?",
      `Are you sure you want to delete this profile?\n"${profile.name}" and its entire folder (mods, saves, worlds) will be permanently removed.\nThis action cannot be undone.`,
      { confirmLabel: "Delete Profile", danger: true }
    );
    if (!ok) return;
    setBusy("delete");
    try {
      const res: any = await api.instances.delete(profile.name);
      if (res?.error) {
        fail("Delete failed", res.error);
      } else {
        toast("success", "Profile deleted", `"${profile.name}" was removed.`);
        onChanged?.();
      }
    } catch (e) {
      fail("Delete failed", e);
    }
    setBusy(null);
  }, [profile.name, toast, onChanged, fail]);

  const togglePin = useCallback(() => {
    setBusy("pin");
    try {
      const raw = localStorage.getItem(PIN_KEY);
      const arr: string[] = raw ? JSON.parse(raw) : [];
      const next = arr.includes(profile.name)
        ? arr.filter((n) => n !== profile.name)
        : [...arr, profile.name];
      localStorage.setItem(PIN_KEY, JSON.stringify(next));
      const nowPinned = next.includes(profile.name);
      setPinned(nowPinned);
      toast("success", nowPinned ? "Pinned to top" : "Unpinned", `"${profile.name}" ${nowPinned ? "will sort first on the Instances page." : "is back to normal sorting."}`);
      onChanged?.();
    } catch {
      toast("error", "Could not update pin");
    }
    setBusy(null);
  }, [profile.name, toast, onChanged]);

  /* -------------------------------------------------------------- rows */
  const row = (
    key: BusyKey,
    label: string,
    Icon: React.ComponentType<{ size?: number | string; className?: string }>,
    onClick: () => void,
    opts?: { danger?: boolean; right?: React.ReactNode }
  ) => {
    const spinning = busy === key;
    const disabled = busy !== null && !spinning;
    return (
      <button
        type="button"
        key={label}
        disabled={disabled}
        onClick={() => {
          if (disabled || spinning) return;
          onClick();
        }}
        className={`group/row w-full flex items-center justify-between gap-3 px-3 py-[7px] text-left text-[11px] font-medium transition-colors disabled:opacity-40 ${
          opts?.danger
            ? "text-red-400 hover:bg-red-500/15 hover:text-red-300"
            : "text-zinc-300 hover:bg-white/[0.07] hover:text-white"
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {spinning ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-amber-400" />
          ) : (
            <Icon size={13} className="shrink-0 opacity-70 group-hover/row:opacity-100" />
          )}
          <span className="truncate">{label}</span>
        </span>
        {opts?.right}
      </button>
    );
  };

  const section = (label: string) => (
    <div className="px-3 pt-2 pb-1 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.14em]">
      {label}
    </div>
  );

  const divider = <div className="my-1.5 h-px bg-white/[0.07]" />;

  // The menu is portalled into document.body so the card's `overflow-hidden`
  // can never clip it. AnimatePresence lives *inside* the portal, otherwise
  // React portals aren't recognized as valid AnimatePresence children and the
  // exit animation would be skipped.
  const menu = createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          key="profile-options-menu"
          initial={{ opacity: 0, scale: 0.94, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 4 }}
          transition={{ duration: 0.13, ease: "easeOut" }}
          style={{
            position: "fixed",
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            width: 232,
            transformOrigin: "bottom center",
          }}
          className="z-[9999] rounded-2xl overflow-hidden py-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
            {/* glass panel */}
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                background: "linear-gradient(180deg, rgba(22,25,34,0.97) 0%, rgba(13,15,18,0.98) 100%)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            />
            <div className="relative">
              {/* header */}
              <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: "#e06b22", boxShadow: "0 0 8px #e06b22" }}
                />
                <span className="text-[11px] font-bold text-white truncate">{profile.name}</span>
                <span className="ml-auto text-[9px] font-mono text-zinc-500">
                  {profile.version}
                </span>
              </div>
              {divider}

              {section("File access")}
              {row("folder", "Open Instance Folder", FolderOpen, () => openFolder("folder"))}
              {row("mods", "Open Mods Folder", Puzzle, () => openFolder("mods", "mods"))}
              {row("screenshots", "View Screenshots", Camera, () => openFolder("screenshots", "screenshots"))}
              {row("config", "Open Config Folder", FolderCog, () => openFolder("config", "config"))}

              {divider}
              {section("Customization")}
              {row(
                "edit",
                "Edit Profile",
                SlidersHorizontal,
                () => { setOpen(false); onOpenSettings?.("profile"); }
              )}
              {row(
                "jvm",
                "JVM & RAM Settings",
                Cpu,
                () => { setOpen(false); onOpenSettings?.("java"); }
              )}
              {row(
                "exportMrpack",
                "Export Profile (.mrpack)",
                FileJson,
                exportMrpack
              )}
              {row(
                "exportConfig",
                "Export Config (JSON)",
                FileJson,
                exportConfig
              )}
              {row("clone", "Duplicate Profile", Copy, duplicateProfile)}
              {row(
                "pin",
                pinned ? "Unpin from top" : "Pin to top",
                pinned ? PinOff : Pin,
                togglePin
              )}

              {divider}
              {section("Danger zone")}
              {row("cache", "Clear Cache / Logs", Eraser, clearCache)}
              {row("delete", "Delete Profile", Trash2, deleteProfile, { danger: true })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full mt-2 text-[10px] font-bold flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors ${
          open
            ? "text-amber-400 bg-amber-500/10"
            : "text-zinc-500 hover:text-white hover:bg-white/5"
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={14} className="mr-0.5" />
        More options
      </button>
      {menu}
    </div>
  );
}

/**
 * Install target helper so ProfilesPage can reuse the same shape as InstancesPage.
 */
export function toInstallTarget(inst: Instance | null | undefined): InstallTarget | null {
  if (!inst) return null;
  return {
    instanceName: inst.name,
    version: inst.version,
    loader: inst.loader,
    loaderVersion: inst.loader_version || "",
  };
}
