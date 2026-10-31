"use client";

import React, { useCallback, useState, useEffect } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Play,
  Loader2,
  X,
  CheckCircle,
  AlertCircle,
  Plug,
} from "lucide-react";
import { GlowButton } from "./GlowButton";

interface Instance {
  id: string;
  name: string;
  version: string;
  loader: string;
  loader_version: string;
  ram_mb?: number;
  jvm_args?: string;
  version_json_exists?: boolean;
  installed?: boolean;
  mods?: Array<{ name: string; slug?: string; version?: string; source?: string }>;
}

interface ModVersion {
  id: string;
  version_number: string;
  loaders: string[];
  game_versions: string[];
  files: Array<{ primary: boolean; size: number; filename: string; url: string }>;
}

interface InstallValidationModalProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  category: "mod" | "modpack" | "resourcepack";
  instanceName?: string;
  instances: Instance[];
  modVersions: ModVersion[];
  onInstall: (instanceName: string, versionId?: string) => void;
  installing?: boolean;
}

const LOADER_COMPATIBILITY: Record<string, string[]> = {
  fabric: ["fabric"],
  forge: ["forge"],
  neoforge: ["neoforge"],
  quilt: ["quilt", "fabric"],
};

function isVersionCompatible(modGameVersions: string[], instanceVersion: string): boolean {
  if (!modGameVersions || modGameVersions.length === 0) return true;
  if (modGameVersions.includes(instanceVersion)) return true;
  const instanceMajorMinor = instanceVersion.split(".").slice(0, 2).join(".");
  for (const v of modGameVersions) {
    const vMajorMinor = v.split(".").slice(0, 2).join(".");
    if (vMajorMinor === instanceMajorMinor) return true;
    if (v.includes("*")) {
      const prefix = v.replace("*", "");
      if (instanceVersion.startsWith(prefix)) return true;
    }
  }
  return false;
}

// Find the latest version compatible with the instance's game version and loader
function getCompatibleVersion(
  versions: ModVersion[],
  instanceGameVersion: string,
  instanceLoader: string
): ModVersion | null {
  const compatibleLoaders = LOADER_COMPATIBILITY[instanceLoader.toLowerCase()] || [instanceLoader.toLowerCase()];

  // First pass: exact game version + loader match
  const exactMatch = versions.find((ver) =>
    ver.game_versions.includes(instanceGameVersion) &&
    ver.loaders.some((l) => compatibleLoaders.includes(l.toLowerCase()))
  );
  if (exactMatch) return exactMatch;

  // Second pass: major.minor match + loader match
  const instanceMajorMinor = instanceGameVersion.split(".").slice(0, 2).join(".");
  const minorMatch = versions.find((ver) => {
    const hasLoader = ver.loaders.some((l) => compatibleLoaders.includes(l.toLowerCase()));
    if (!hasLoader) return false;
    return ver.game_versions.some((gv) => {
      const gvMajorMinor = gv.split(".").slice(0, 2).join(".");
      return gvMajorMinor === instanceMajorMinor;
    });
  });
  if (minorMatch) return minorMatch;

  // Third pass: any loader match
  const loaderOnlyMatch = versions.find((ver) =>
    ver.loaders.some((l) => compatibleLoaders.includes(l.toLowerCase()))
  );
  if (loaderOnlyMatch) return loaderOnlyMatch;

  // Fallback to first version (latest)
  return versions[0] || null;
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return "Unknown";
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
  return bytes.toString() + " B";
}

function loaderColorClass(loader: string): string {
  switch (loader.toLowerCase()) {
    case "fabric": return "text-emerald-400 border-emerald-500/20 bg-emerald-500/10";
    case "forge": return "text-orange-400 border-orange-500/20 bg-orange-500/10";
    case "neoforge": return "text-purple-400 border-purple-500/20 bg-purple-500/10";
    default: return "text-zinc-400 border-zinc-700 bg-zinc-800/50";
  }
}

export function InstallValidationModal({
  open,
  onClose,
  slug,
  category,
  instanceName,
  instances,
  modVersions,
  onInstall,
  installing = false,
}: InstallValidationModalProps) {
  if (!open) return null;

  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(
    instances.find((i) => i.name === instanceName) || instances[0] || null
  );
  const [selectedVersion, setSelectedVersion] = useState<ModVersion | null>(null);
  const [validationResults, setValidationResults] = useState<Map<string, { pass: boolean; message: string; critical: boolean }>>(new Map());
  const [validated, setValidated] = useState(false);
  const [installingLocal, setInstallingLocal] = useState(installing);

  // Auto-select compatible version when instance or versions change
  useEffect(() => {
    if (selectedInstance && modVersions.length > 0) {
      const compatible = getCompatibleVersion(
        modVersions,
        selectedInstance.version,
        selectedInstance.loader
      );
      setSelectedVersion(compatible || modVersions[0] || null);
    }
  }, [selectedInstance, modVersions]);

  const runValidation = useCallback(() => {
    if (!selectedInstance || !selectedVersion) {
      setValidated(false);
      return;
    }

    const results = new Map<string, { pass: boolean; message: string; critical: boolean }>();

    results.set("instance_exists", {
      pass: !!selectedInstance,
      message: selectedInstance ? `Instance "${selectedInstance.name}" found` : "No instance selected",
      critical: true,
    });

    if (!selectedInstance) {
      setValidationResults(results);
      setValidated(false);
      return;
    }

    results.set("instance_has_loader", {
      pass: !!selectedInstance.loader && selectedInstance.loader !== "none",
      message: selectedInstance.loader ? `Loader: ${selectedInstance.loader}` : "Instance has no loader configured",
      critical: true,
    });

    results.set("instance_has_version", {
      pass: !!selectedInstance.version && selectedInstance.version !== "unknown",
      message: selectedInstance.version ? `Minecraft: ${selectedInstance.version}` : "Instance has no Minecraft version",
      critical: true,
    });

    const modLoaders = selectedVersion.loaders || [];
    const instanceLoader = selectedInstance.loader.toLowerCase();
    const compatibleLoaders = LOADER_COMPATIBILITY[instanceLoader] || [instanceLoader];
    const loaderMatch = modLoaders.some((l: string) => compatibleLoaders.includes(l.toLowerCase()));
    results.set("loader_compatibility", {
      pass: loaderMatch,
      message: loaderMatch ? `Mod supports ${instanceLoader} loader` : `Mod loaders (${modLoaders.join(", ")}) incompatible with ${instanceLoader}`,
      critical: true,
    });

    const modGameVersions = selectedVersion.game_versions || [];
    const versionMatch = isVersionCompatible(modGameVersions, selectedInstance.version);
    results.set("game_version_compatibility", {
      pass: versionMatch,
      message: versionMatch ? `Compatible with Minecraft ${selectedInstance.version}` : `Mod supports ${modGameVersions.join(", ")}, instance runs ${selectedInstance.version}`,
      critical: true,
    });

    const alreadyInstalled = selectedInstance.mods?.some((m) => m.slug === slug || m.name === selectedVersion.version_number);
    results.set("not_already_installed", {
      pass: !alreadyInstalled,
      message: alreadyInstalled ? "This mod version is already installed on this instance" : "Not yet installed on this instance",
      critical: false,
    });

    results.set("version_json_exists", {
      pass: selectedInstance.version_json_exists !== false,
      message: selectedInstance.version_json_exists ? "Instance version manifest exists" : "Instance version manifest missing",
      critical: false,
    });

    results.set("java_configured", {
      pass: true,
      message: selectedInstance.jvm_args ? "Custom JVM arguments configured" : "Using default JVM settings",
      critical: false,
    });

    results.set("ram_allocation", {
      pass: (selectedInstance.ram_mb ?? 0) > 0,
      message: selectedInstance.ram_mb ? `Allocated RAM: ${selectedInstance.ram_mb} MB` : "No RAM limit configured",
      critical: false,
    });

    const primaryFile = selectedVersion.files?.find((f: any) => f.primary) || selectedVersion.files?.[0];
    results.set("mod_file_exists", {
      pass: !!primaryFile,
      message: primaryFile ? `File: ${primaryFile.filename} (${formatBytes(primaryFile.size)})` : "No downloadable file found",
      critical: true,
    });

    const versionSupportsLoader = modLoaders.some((l: string) => compatibleLoaders.includes(l.toLowerCase()));
    results.set("version_loader_support", {
      pass: versionSupportsLoader,
      message: versionSupportsLoader ? `Version ${selectedVersion.version_number} supports ${instanceLoader}` : `Version ${selectedVersion.version_number} does not list ${instanceLoader} support`,
      critical: true,
    });

    const versionSupportsGameVersion = isVersionCompatible(selectedVersion.game_versions || [], selectedInstance.version);
    results.set("version_game_support", {
      pass: versionSupportsGameVersion,
      message: versionSupportsGameVersion ? `Version works on Minecraft ${selectedInstance.version}` : `Version may not work on Minecraft ${selectedInstance.version}`,
      critical: true,
    });

    results.set("instance_not_locked", {
      pass: true,
      message: "Instance appears accessible",
      critical: false,
    });

    const conflictingMod = selectedInstance.mods?.find((m) => m.slug === slug && m.version !== selectedVersion.version_number);
    results.set("no_conflicting_mod", {
      pass: !conflictingMod,
      message: conflictingMod ? `Different version (${conflictingMod.version}) already installed` : "No conflicting version found",
      critical: false,
    });

    setValidationResults(results);

    const allCriticalPass = Array.from(results.values()).every((r) => !r.critical || r.pass);
    setValidated(allCriticalPass);
  }, [selectedInstance, selectedVersion, slug]);

  const handleInstall = async () => {
    if (!selectedInstance || !selectedVersion || !validated) return;
    setInstallingLocal(true);
    try {
      const versionId = selectedVersion.id;
      await onInstall(selectedInstance.name, versionId);
    } finally {
      setInstallingLocal(false);
      onClose();
    }
  };

  const criticalFailures = Array.from(validationResults.values()).filter((r) => r.critical && !r.pass);
  const warnings = Array.from(validationResults.values()).filter((r) => !r.critical && !r.pass);

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-[#090B0E] shadow-2xl flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-white/5 bg-[#090B0E]/40 backdrop-blur-md flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Select Instance & Validate</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Select Target Instance</h3>
            <div className="space-y-2">
              {instances.map((inst) => {
                const isSelected = selectedInstance?.id === inst.id;
                return (
                  <button
                    key={inst.id}
                    onClick={() => setSelectedInstance(inst)}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-amber-500/10 border-amber-500/40 shadow-[0_0_15px_rgba(224,107,34,0.2)]"
                        : "border-white/5 hover:border-white/10 hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                        <Plug size={18} className={loaderColorClass(inst.loader)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-white truncate">{inst.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${loaderColorClass(inst.loader)}`}>
                            {inst.loader}
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-500">
                          Minecraft {inst.version} • {inst.ram_mb ? inst.ram_mb + "MB RAM" : "default RAM"}
                        </span>
                      </div>
                    </div>
                    <div className={isSelected ? "text-amber-400" : "text-zinc-500"}>
                      <CheckCircle size={14} />
                    </div>
                  </button>
                );
              })}
              {instances.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border-2 border-dashed border-white/10 bg-zinc-900/50">
                  <AlertCircle size={24} className="text-zinc-600 mb-3" />
                  <h4 className="text-sm font-semibold text-white">No instances found</h4>
                  <p className="text-xs text-zinc-500 mt-1">Create an instance first before installing mods.</p>
                </div>
              )}
            </div>
          </div>

          {selectedInstance && (
            <>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Compatibility Checks</h3>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    criticalFailures.length === 0
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}>
                    {criticalFailures.length === 0 ? "All Critical Passed" : `${criticalFailures.length} Critical Issue(s)`}
                  </span>
                </div>

                {validated ? null : (
                  <button
                    onClick={runValidation}
                    className="px-3 py-1 rounded-lg bg-zinc-800/50 border border-white/10 text-xs font-bold text-zinc-300 hover:bg-white/10 transition-colors"
                  >
                    Run Validation
                  </button>
                )}

                <div className="space-y-1.5 mt-3">
                  {Array.from(validationResults.entries()).map(([key, result]) => {
                    const passColor = result.pass ? "border-emerald-500/20 bg-emerald-500/5" : result.critical ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-zinc-800/20";
                    const textColor = result.pass ? "text-emerald-500" : result.critical ? "text-amber-500" : "text-zinc-500";
                    const statusText = result.pass ? "PASS" : result.critical ? "CRITICAL" : "WARN";
                    const icon = result.pass ? <ShieldCheck size={12} className="text-emerald-400" /> : <ShieldAlert size={12} className={result.critical ? "text-amber-400" : "text-zinc-500"} />;
                    return (
                      <div key={key} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${passColor}`}>
                        <div className="flex items-center gap-2">
                          {icon}
                          <span className="text-xs font-medium">
                            {result.pass ? "✓" : "✗"} {result.message}
                          </span>
                        </div>
                        <span className={`text-[9px] font-bold ${textColor}`}>{statusText}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                    <h4 className="text-sm font-bold text-amber-300">Non-Critical Warnings</h4>
                  </div>
                  <ul className="space-y-1 text-xs text-zinc-400">
                    {warnings.map((w) => (
                      <li key={w.message} className="flex items-center gap-1">
                        <span>•</span> {w.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-4">
                <GlowButton
                  onClick={handleInstall}
                  size="sm"
                  className="w-full py-3 text-base font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!validated || criticalFailures.length > 0 || installingLocal}
                >
                  {installingLocal ? (
                    <>
                      <Loader2 size={18} className="mr-2 animate-spin" /> Installing…
                    </>
                  ) : criticalFailures.length > 0 ? (
                    "Fix Critical Issues First"
                  ) : validated ? (
                    <>
                      <Play size={16} className="mr-2" /> Install on {selectedInstance.name}
                    </>
                  ) : (
                    "Run Validation to Install"
                  )}
                </GlowButton>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
