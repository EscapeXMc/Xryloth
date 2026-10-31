"use client";

import React, { useState, useEffect } from "react";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { Instance, ModInfo } from "../../lib/types";
import { GlowButton } from "../ui/GlowButton";
import { GlassCard } from "../ui/GlassCard";
import { ServerWidget } from "../layout/ServerWidget";

export function InstancesPage() {
  const { instances, selectedInstance, setSelectedInstance, setPage, setTheme, themeName, themeColors } =
    useLauncherStore();
  const [name, setName] = useState("");
  const [mcVersion, setMcVersion] = useState("1.21.11");
  const [loader, setLoader] = useState("fabric");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [newInstance, setNewInstance] = useState<{ name: string; mcVersion: string; loader: string; loaderVersion: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string } | null>(null);
  const [importModalsOpen, setImportModalsOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  // Load instances
  useEffect(() => {
    const load = async () => {
      try {
        const result = await api.instances.get();
        await useLauncherStore.getState().loadInstances();
      } catch (err) {
        console.error("Failed to load instances:", err);
      }
    };
    load();
  }, []);

  // Select instance
  const handleSelect = (inst: Instance) => {
    setSelectedInstance(inst);
    setPage("play");
  };

  // Create instance
  const handleCreate = async () => {
    if (!name.trim() || !mcVersion.trim()) return;
    setNewInstance({ name: name.trim(), mcVersion: mcVersion.trim(), loader: loader.trim(), loaderVersion: loaderVersion.trim() });
    try {
      await api.instances.create(name.trim(), mcVersion.trim(), loader.trim(), loaderVersion.trim() || "latest");
      await useLauncherStore.getState().loadInstances();
      setName("");
      setMcVersion("1.21.11");
      setLoader("fabric");
      setLoaderVersion("");
    } catch (err) {
      console.error("Failed to create instance:", err);
    }
  };

  // Delete instance
  const handleDelete = async (id: string) => {
    try {
      await api.instances.delete(id);
      await useLauncherStore.getState().loadInstances();
    } catch (err) {
      console.error("Failed to delete instance:", err);
    }
    setDeleteConfirm(null);
  };

  // Import modpack
  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImportResult(null);
    try {
      const result = await api.instances.createFromModpack(
        selectedInstance?.name || "",
        mcVersion,
        loader,
        loaderVersion,
        importUrl.trim()
      );
      setImportResult(result.success ? "Modpack imported successfully!" : (result.error || "Failed to import"));
      setImportUrl("");
      setImportModalsOpen(false);
      await useLauncherStore.getState().loadInstances();
    } catch (err) {
      console.error("Failed to import modpack:", err);
      setImportResult("Import failed");
    }
  };

  return (
    <div className="space-y-6">
      {/* Add Instance Card */}
      <GlassCard className="p-6">
        <h2 className="text-xl font-bold text-white tracking-tinycaps font-lemon mb-4">New Instance</h2>
        <div className="grid grid-cols-2 gap-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Instance name"
            className={`w-full rounded-xl px-3 py-2 bg-[#13161C]/50 backdrop-blur-md border border-white/5 text-white placeholder-gray-400 focus:outline-none focus:border-xryloth-500 transition-colors`}
          />
          <select
            value={loader}
            onChange={(e) => setLoader(e.target.value)}
            className={`w-full rounded-xl px-3 py-2 bg-[#13161C]/50 backdrop-blur-md border border-white/5 text-white placeholder-gray-400 focus:outline-none focus:border-xryloth-500 transition-colors`}
          >
            <option value="fabric">Fabric</option>
            <option value="forge">Forge</option>
            <option value="quilt">Quilt</option>
            <option value="vanilla">Vanilla</option>
          </select>
          <input
            value={mcVersion}
            onChange={(e) => setMcVersion(e.target.value)}
            placeholder="MC version"
            className={`w-full rounded-xl px-3 py-2 bg-[#13161C]/50 backdrop-blur-md border border-white/5 text-white placeholder-gray-400 focus:outline-none focus:border-xryloth-500 transition-colors`}
          />
          <input
            value={loaderVersion}
            onChange={(e) => setLoaderVersion(e.target.value)}
            placeholder="Loader version"
            className={`w-full rounded-xl px-3 py-2 bg-[#13161C]/50 backdrop-blur-md border border-white/5 text-white placeholder-gray-400 focus:outline-none focus:border-xryloth-500 transition-colors`}
          />
        </div>
        <GlowButton onClick={handleCreate} className="w-full">
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create Instance
        </GlowButton>
      </GlassCard>

      {/* Instances List */}
      <div>
        {instances.length === 0 ? (
          <div className="text-center py-12 text-xryloth-400">
            <svg className="mx-auto mb-3 h-12 w-12 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l-1.16 1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808l1.16-1.634a7.96 7.96 0 00-1.11-2.596zm8.075-2.596c.57-1.271.92-2.444.92-3.808 0-1.366-.35-2.648-.92-3.808l-1.16 1.634c.705.928 1.11 2.147 1.11 3.563 0 1.366-.35-2.648-.92-3.808z" />
            </svg>
            No instances yet. Create your first instance above.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {instances.map((inst) => (
              <GlassCard
                key={inst.id}
                className="p-4 rounded-xl border border-white/5 cursor-pointer hover:border-xryloth-500/30 transition-colors"
                onClick={() => handleSelect(inst)}
              >
                <div className="flex items-start gap-3">
                  {/* Instance icon/loader indicator */}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-r from-xryloth-500 to-xryloth-900 text-xryloth-950 text-sm font-bold">
                    {inst.loader.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-white line-clamp-1">{inst.name}</div>
                        <div className="text-[10px] text-xryloth-400/70 line-clamp-1">
                          {inst.version || "—"} • {inst.loader || "—"}
                        </div>
                      </div>
                      <GlowButton
                        size="sm"
                        variant="ghost"
                        onClick={() => setPage("play")}
                        className="hidden"
                        title="Select instance"
                      >
                        Select
                      </GlowButton>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <GlowButton size="sm" variant="ghost">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5v14a2 2 0 002 2h4a2 2 0 002-2v-1"/><path d="M13 2H6a2 2 0 00-2 2v7"/><path d="M3 10h18"/><path d="M7 15l-3 3L7 15"/><path d="Z"/></svg>
                        Modpack
                      </GlowButton>
                      <GlowButton size="sm" variant="ghost">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.79 1.73l3.29-3.01a1 1 0 01.99 1.73l3.29-3.01a1 1 0 01.99.81l3.22 1.84a1 1 0 01.99.82l3.29-3.82a1 1 0 01.08-1.29l-3.35-3.93a1 1 0 01-.61-1.05l-3.44 3.93a1 1 0 01-.61-1.05L7 21"/><path d="M18 20l-7-6a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h4a2 2 0 002-2V7a2 2 0 002-2h9a2 2 0 002-2v6"/></svg>
                        Mods
                      </GlowButton>
                      <GlowButton size="sm" variant="ghost">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v7"/><path d="M13 2H6a2 2 0 00-2 2v7"/><path d="M13 10h/a2 2 0 012 2h4a2 2 0 012-2h/a2 2 0 01-2-2h-/a2 2 0 01-2-2h-/a2 2 0 01-2-2h-/a2 2 0 01-2-2h-/w"/><path d="M2 9l10 5 10-5"/><path d="M2 15l10 5 10-5"/></svg>
                        Packs
                      </GlowButton>
                    </div>
                    <div className="flex items-center gap-2 text-xs mt-1">
                      {inst.installed && <span className="text-xryloth-500">✓ Installed</span>}
                      {!inst.installed && <span className="text-xryloth-400">○ Not installed</span>}
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-[#090B0E]/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#13161C] border border-white/10 rounded-2xl p-8 w-full max-w-sm glass-card">
            <h3 className="text-xl font-bold text-white mb-3">Delete Instance</h3>
            <p className="text-xryloth-400 mb-6">Are you sure you want to delete instance ID "{deleteConfirm.id}"? This cannot be undone.</p>
            <div className="flex gap-3">
              <GlowButton variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</GlowButton>
              <GlowButton variant="primary" onClick={() => { handleDelete(deleteConfirm.id); setDeleteConfirm(null); }}>Delete</GlowButton>
            </div>
          </div>
        </div>
      )}

      {/* Import Modpack Modal */}
      {importResult && (
        <div className="fixed inset-0 bg-[#090B0E]/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#13161C] border border-white/10 rounded-2xl p-8 w-full max-w-sm glass-card text-center">
            <p className="text-xl font-bold text-white mb-2">{importResult}</p>
            <GlowButton variant="ghost" onClick={() => setImportModalsOpen(false)}>OK</GlowButton>
          </div>
        </div>
      )}

      {importModalsOpen && (
        <div className="fixed inset-0 bg-[#090B0E]/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#13161C] border border-white/10 rounded-2xl p-8 w-full max-w-md glass-card">
            <h3 className="text-xl font-bold text-white mb-4">Import Modpack</h3>
            <p className="text-xryloth-400 mb-4">Enter the URL of a .mrpack modpack to import:</p>
            <input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://example.com/modpack.mrpack"
              className={`w-full rounded-xl px-3 py-2 bg-[#13161C]/50 backdrop-blur-md border border-white/5 text-white placeholder-gray-400 focus:outline-none focus:border-xryloth-500 transition-colors mb-4`}
            />
            <GlowButton onClick={handleImport} className="w-full">
              Import
            </GlowButton>
            <GlowButton variant="ghost" onClick={() => setImportModalsOpen(false)}>Cancel</GlowButton>
          </div>
        </div>
      )}
    </div>
  );
}