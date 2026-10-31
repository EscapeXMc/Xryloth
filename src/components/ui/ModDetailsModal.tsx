"use client";

import { CachedImage } from "./CachedImage";
import React, { useCallback, useEffect, useState } from "react";
import {
  X,
  ExternalLink,
  Download,
  Users,
  Shield,
  Package,
  FileText,
  File,
  Check,
  AlertCircle,
  Play,
} from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { GlowButton } from "./GlowButton";
import { api } from "../../lib/api";
import { useLauncherStore } from "../../stores";
import { InstallValidationModal } from "./InstallValidationModal";
import { useToast } from "./Toast";

interface ModDetailsModalProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  category: "mod" | "modpack" | "resourcepack";
  instanceName?: string;
  installing?: boolean;
  installed?: boolean;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(iso: string | undefined) {
  if (!iso) return "Unknown";
  return DATE_FMT.format(new Date(iso));
}

function formatSize(bytes: number | undefined) {
  if (!bytes) return "Unknown";
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
  return bytes.toString() + " B";
}

function formatNumber(n: number | undefined) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export function ModDetailsModal({
  open,
  onClose,
  slug,
  category,
  instanceName,
  installing = false,
  installed = false,
}: ModDetailsModalProps) {
  const { instances, setSelectedInstance } = useLauncherStore();
  const { toast } = useToast();
  const [project, setProject] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"description" | "versions">("description");
  const [selectedVersion, setSelectedVersion] = useState<any>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installingLocal, setInstallingLocal] = useState(installing);

  useEffect(() => {
    if (!open || !slug) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [proj, vers] = await Promise.all([
          api.mods.getProject(slug),
          api.mods.getVersions(slug),
        ]);
        if (!cancelled) {
          setProject(proj);
          setVersions(Array.isArray(vers) ? vers : []);
          setSelectedVersion(vers[0] || null);
        }
      } catch (err) {
        console.error("Failed to load mod details:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, slug]);

  if (!open) return null;

  // Loading skeleton
  if (loading || !project) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-3xl max-h-[85vh] rounded-2xl border border-white/10 bg-[#090B0E] shadow-2xl flex flex-col p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white">Loading details…</h2>
            <button onClick={onClose} className="text-zinc-400 hover:text-white p-1">
              <X size={16} />
            </button>
          </div>
          <div className="h-48 rounded-xl bg-zinc-900/40 animate-pulse mb-4" />
          <div className="space-y-3">
            <div className="h-4 rounded-full bg-zinc-800/50 animate-pulse w-3/4" />
            <div className="h-3 rounded-full bg-zinc-800/50 animate-pulse w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  const downloads = project.downloads;
  const followers = project.followers;
  const license = project.license;
  const primaryFile =
    selectedVersion?.files?.find((f: any) => f.primary) ||
    selectedVersion?.files?.[0];

  const handleInstallClick = () => {
    if (!instances || instances.length === 0) {
      // No instances available - show error via install modal still
      setShowInstallModal(true);
      return;
    }
    setShowInstallModal(true);
  };

  return (
    <>
      {/* Main Details Modal */}
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        {/* Modal */}
        <div className="relative w-full max-w-[900px] max-h-[95vh] overflow-hidden rounded-2xl border border-white/10 bg-[#090B0E] shadow-2xl flex flex-col animate-in fade-in zoom-in duration-200">
          {/* Top Bar */}
          <div className="px-6 py-4 border-b border-white/5 bg-[#090B0E]/40 backdrop-blur-md z-10 flex items-center justify-between">
            <button onClick={onClose} className="text-zinc-400 hover:text-white p-1">
              <X size={16} />
            </button>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
              {category === "modpack" ? <Package size={12} /> : <Shield size={12} />}
              {category?.toUpperCase()}
            </div>
          </div>

          {/* Banner Section */}
          <div className="relative h-44 w-full overflow-hidden">
            {project.featured_gallery || project.gallery?.[0]?.url ? (
              <CachedImage
                src={project.featured_gallery || project.gallery![0].url}
                alt={project.title}
                className="w-full h-full object-cover opacity-20 blur-[1px]"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-b from-zinc-900/40 via-zinc-950/40 to-black/60" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#090B0E] via-[#090B0E]/70 to-transparent" />

            {/* Content */}
            <div className="absolute inset-0 z-10 flex flex-col justify-end p-6">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 w-full">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {project.icon_url ? (
                      <CachedImage
                        src={project.icon_url}
                        alt={project.title}
                        className="w-12 h-12 rounded-lg border border-white/10 object-cover bg-zinc-800 shadow-md"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border border-white/10 bg-zinc-800 flex items-center justify-center text-sm font-bold text-amber-500">
                        {project.title.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-black/40 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold backdrop-blur-md uppercase tracking-wider">
                      {project.project_type}
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold text-white leading-tight drop-shadow-md">{project.title}</h1>
                  <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5">
                    <Users size={12} /> by{" "}
                    {project.team?.name || project.author || "Unknown Author"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="px-2.5 py-0.5 rounded text-[9px] font-bold text-zinc-400 border border-white/5 bg-zinc-800/50">
                    {formatNumber(downloads)} downloads
                  </span>
                  <span className="px-2.5 py-0.5 rounded text-[9px] font-bold text-zinc-400 border border-white/5 bg-zinc-800/50">
                    {formatNumber(followers)} followers
                  </span>
                  {license?.name && (
                    <span className="px-2.5 py-0.5 rounded text-[9px] font-bold text-zinc-400 border border-white/5 bg-zinc-800/50">
                      {license.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Body: Sidebar + Content */}
          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
            {/* Right Sidebar: Metadata (lg:col-span-4) */}
            <div className="lg:col-span-4 space-y-6">
              {/* Links */}
              <div className="rounded-xl border border-white/5 bg-[#0D0F12]/40 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                  Links
                </h3>
                <div className="space-y-1.5">
                  {project.source_url && (
                    <a
                      href={project.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs transition-colors"
                    >
                      <span>View Source Code</span>
                      <ExternalLink size={12} className="text-zinc-500" />
                    </a>
                  )}
                  {project.wiki_url && (
                    <a
                      href={project.wiki_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs transition-colors"
                    >
                      <span>Visit Wiki</span>
                      <ExternalLink size={12} className="text-zinc-500" />
                    </a>
                  )}
                  {project.discord_url && (
                    <a
                      href={project.discord_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs transition-colors"
                    >
                      <span>Join Discord Server</span>
                      <ExternalLink size={12} className="text-zinc-500" />
                    </a>
                  )}
                  {project.issues_url && (
                    <a
                      href={project.issues_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs transition-colors"
                    >
                      <span>Report Issues</span>
                      <FileText size={12} className="text-zinc-500" />
                    </a>
                  )}
                </div>
              </div>

              {/* Details */}
              <div className="rounded-xl border border-white/5 bg-[#0D0F12]/40 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                  Details
                </h3>
                <div className="space-y-2 text-xs text-zinc-400">
                  <div className="flex justify-between">
                    <span>License</span>
                    <span className="text-white font-medium">{license?.name || "Open Source"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Client-side</span>
                    <span className={`text-white font-medium ${project.client_side === false ? "text-zinc-500" : ""}`}>
                      {project.client_side === false ? "No" : "Yes"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Server-side</span>
                    <span className={`text-white font-medium ${project.server_side === false ? "text-zinc-500" : ""}`}>
                      {project.server_side === false ? "No" : "Yes"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Published</span>
                    <span className="text-white font-medium">{formatDate(project.date_published)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Updated</span>
                    <span className="text-white font-medium">{formatDate(project.date_updated || project.date_modified)}</span>
                  </div>
                </div>
              </div>

              {/* Game Versions */}
              {project.game_versions?.length && (
                <div className="rounded-xl border border-white/5 bg-[#0D0F12]/40 p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                    Game Versions
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {project.game_versions.slice(0, 8).map((v: string) => (
                      <span
                        key={v}
                        className="px-2 py-0.5 rounded text-[9px] font-bold text-zinc-300 border border-white/10 bg-zinc-800/50"
                      >
                        {v}
                      </span>
                    ))}
                    {project.game_versions.length > 8 && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold text-zinc-500 border border-white/10 bg-zinc-800/20">
                        +{project.game_versions.length - 8}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Categories / Loaders */}
              <div className="rounded-xl border border-white/5 bg-[#0D0F12]/40 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                  Platforms
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {project.loaders?.map((l: string) => (
                    <span
                      key={l}
                      className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tighter bg-zinc-800/50 text-zinc-400 border border-white/10"
                    >
                      {l}
                    </span>
                  ))}
                  {project.categories?.slice(0, 4).map((c: string) => (
                    <span
                      key={c}
                      className="px-2 py-0.5 rounded text-[9px] font-bold text-zinc-300 bg-zinc-800/50 border border-white/10"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Content (lg:col-span-8) */}
            <div className="lg:col-span-8 flex flex-col h-full">
              {/* Tabs */}
              <div className="flex gap-1 border-b border-white/10 pb-2">
                <button
                  onClick={() => setActiveTab("description")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === "description"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  Description
                </button>
                <button
                  onClick={() => setActiveTab("versions")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === "versions"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  Versions{" "}
                  <span className="text-xs font-normal text-zinc-500">({versions.length})</span>
                </button>
              </div>

              {/* Description Tab */}
              {activeTab === "description" && (
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="rounded-xl border border-zinc-800/50 bg-[#0D0F12]/40 p-5">
                    {project.body ? (
                      <MarkdownRenderer text={project.body} />
                    ) : (
                      <div className="text-xs text-zinc-500 italic">
                        No description available.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Versions Tab */}
              {activeTab === "versions" && (
                <div className="flex-1 overflow-y-auto p-4">
                  {versions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <File size={32} className="text-zinc-500 mb-3" />
                      <p className="text-xs text-zinc-500">No versions available</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {versions.map((ver) => {
                        const file =
                          ver.files?.find((f: any) => f.primary) || ver.files?.[0];
                        return (
                          <div
                            key={ver.id}
                            className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-zinc-800/40 hover:border-white/20 hover:bg-zinc-800/60 transition-all group cursor-pointer"
                            onClick={() => setSelectedVersion(ver)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-bold text-white text-sm truncate">
                                  {ver.name || ver.version_number}
                                </h4>
                                {selectedVersion?.id === ver.id && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-bold border border-amber-500/30">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                {ver.loaders?.join(" · ") || "—"}
                                <span>•</span>
                                {ver.game_versions?.join(" · ") || "—"}
                                <span>•</span>
                                {formatDate(ver.publish_date)}
                                {file?.size && (
                                  <>
                                    <span>•</span>
                                    <span>{formatSize(file.size)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVersion(ver);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-300 bg-white/5 border border-white/10 hover:bg-amber-500/20 hover:text-amber-400 hover:border-amber-500/30 transition-colors shrink-0"
                            >
                              {selectedVersion?.id === ver.id ? "Selected" : "Select"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sticky Footer: Install Bar */}
          <div className="border-t border-white/10 px-6 py-4 bg-[#090B0E]/80 backdrop-blur-md flex items-center justify-between z-20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-zinc-500">Slug:</span>
              <span className="text-xs font-mono text-zinc-300 truncate max-w-[160px]">
                {project.slug}
              </span>
            </div>
            <GlowButton
              onClick={handleInstallClick}
              size="sm"
              className="w-full md:w-auto py-2.5 text-base font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={installing || installed || !selectedVersion}
            >
              {installed ? (
                "Installed"
              ) : installingLocal ? (
                "Installing…"
              ) : (
                `Install ${selectedVersion?.version_number || "Latest"}`
              )}
            </GlowButton>
          </div>
        </div>
      </div>

      {/* Install Validation Modal (overlay on top) */}
      {showInstallModal && (
        <InstallValidationModal
          open={showInstallModal}
          onClose={() => setShowInstallModal(false)}
          slug={slug}
          category={category}
          instanceName={instanceName}
          instances={instances}
          modVersions={versions}
          onInstall={async (instanceName, versionId) => {
            setShowInstallModal(false);
            setInstallingLocal(true);
            try {
              if (category === "modpack") {
                const result = await api.mods.installModpack(instanceName, slug, versionId || "");
                if (!result.success) {
                  toast("error", "Install Failed", result.error || "Failed to install modpack", 6000);
                  setInstallingLocal(false);
                  return;
                }
                toast("success", "Modpack Installed!", `"${project?.name || slug}" has been installed.`);
              } else if (category === "resourcepack") {
                const result = await api.mods.installResourcepack(instanceName, slug, versionId || "");
                if (!result.success) {
                  toast("error", "Install Failed", result.error || "Failed to install resource pack", 6000);
                  setInstallingLocal(false);
                  return;
                }
                toast("success", "Resource Pack Installed!", `"${project?.name || slug}" has been installed.`);
              } else {
                const result = await api.mods.install(instanceName, slug, versionId || "");
                if (!result.success) {
                  toast("error", "Install Failed", result.error || "Failed to install mod", 6000);
                  setInstallingLocal(false);
                  return;
                }
                toast("success", "Mod Installed!", `"${project?.name || slug}" has been installed.`);
              }
            } catch (err: any) {
              console.error("Install error:", err);
              toast("error", "Installation Failed", err.message || "An unexpected error occurred", 6000);
              setInstallingLocal(false);
            } finally {
              setInstallingLocal(false);
            }
          }}
        />
      )}
    </>
  );
}
