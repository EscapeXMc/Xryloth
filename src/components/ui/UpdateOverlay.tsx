import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { GlowButton } from "./GlowButton";
import {
  Download, RefreshCcw, X, Terminal, CheckCircle2, AlertTriangle, Rocket,
} from "lucide-react";
import {
  getUpdateState, subscribeUpdate, startUpdate, dismissUpdate, type UpdateState,
} from "../../lib/updater";

function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function UpdateOverlay() {
  const { themeColors } = useLauncherStore();
  const [st, setSt] = useState<UpdateState>(getUpdateState());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeUpdate(setSt), []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [st.logs]);

  const open = st.stage !== "idle";
  const busy = st.stage === "downloading" || st.stage === "applying";
  const version = st.info?.latest_version;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="w-[540px] max-h-[82vh] rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: `${themeColors.bg_card}ee`,
              border: `1px solid ${themeColors.border}`,
              boxShadow: `0 24px 80px rgba(0,0,0,0.5), 0 0 40px ${themeColors.accent}15`,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${themeColors.border}` }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${themeColors.accent}15` }}>
                  {st.stage === "error" ? (
                    <AlertTriangle size={18} style={{ color: themeColors.danger }} />
                  ) : busy ? (
                    <RefreshCcw size={18} className="animate-spin" style={{ color: themeColors.accent }} />
                  ) : (
                    <Download size={18} style={{ color: themeColors.accent }} />
                  )}
                </div>
                <div>
                  <h2 className="tinycaps text-sm font-bold" style={{ color: themeColors.text_main }}>
                    {st.stage === "error" ? "Update Failed" : busy ? "Updating Xryloth" : "Launcher Update"}
                  </h2>
                  <p className="text-[10px]" style={{ color: themeColors.text_muted }}>
                    {version ? `v${st.info?.current_version} → v${version}` : "Xryloth"}
                  </p>
                </div>
              </div>
              {!busy && (
                <button onClick={dismissUpdate} className="p-1 rounded-lg" style={{ color: themeColors.text_muted }}>
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Body */}
            <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
              {st.stage === "available" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                    style={{ background: `${themeColors.accent}15`, color: themeColors.accent }}>
                    <Rocket size={13} />
                    <span>A new version <b>v{version}</b> is available.</span>
                  </div>
                  {st.info?.release_notes ? (
                    <div>
                      <p className="text-[9px] tinycaps font-semibold tracking-wider mb-1.5" style={{ color: themeColors.text_muted }}>
                        What's new
                      </p>
                      <div className="rounded-xl p-3 text-[11px] whitespace-pre-wrap max-h-52 overflow-y-auto font-mono leading-relaxed"
                        style={{ background: `${themeColors.bg_card2}cc`, border: `1px solid ${themeColors.border}`, color: themeColors.text_sub }}>
                        {st.info.release_notes}
                      </div>
                    </div>
                  ) : null}
                  <p className="text-[11px]" style={{ color: themeColors.text_muted }}>
                    The installer is the same file used for a fresh install — selecting
                    {" "}<b>Update Now</b> downloads it, replaces the old files, then restarts Xryloth.
                  </p>
                </div>
              )}

              {busy && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] tinycaps font-medium" style={{ color: themeColors.text_sub }}>
                      {st.stage === "applying" ? "Installing..." : "Downloading..."}
                    </span>
                    <span className="text-[10px] tinycaps font-bold" style={{ color: themeColors.accent }}>
                      {Math.round(st.percent)}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: themeColors.bg_card2 }}>
                    <motion.div className="h-full rounded-full"
                      animate={{ width: `${st.percent}%` }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      style={{
                        background: `linear-gradient(90deg, ${themeColors.accent}, ${themeColors.purple || themeColors.accent2})`,
                        boxShadow: `0 0 12px ${themeColors.accent}40`,
                      }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: themeColors.text_muted }}>
                    <span>{fmtBytes(st.downloaded)}{st.total > 0 ? ` / ${fmtBytes(st.total)}` : ""}</span>
                    {st.stage === "downloading" && <span>{fmtBytes(st.speed)}/s</span>}
                  </div>
                </div>
              )}

              {st.stage === "error" && (
                <div className="rounded-xl p-3 text-[11px] font-mono"
                  style={{ background: `${themeColors.danger}15`, color: themeColors.danger, border: `1px solid ${themeColors.danger}30` }}>
                  {st.error || "Something went wrong while updating."}
                </div>
              )}

              {/* Log terminal (download / install) */}
              {st.logs.length > 0 && st.stage !== "error" && (
                <div className="mt-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Terminal size={11} style={{ color: themeColors.text_muted }} />
                    <span className="text-[9px] tinycaps font-semibold tracking-wider" style={{ color: themeColors.text_muted }}>
                      UPDATE LOG
                    </span>
                  </div>
                  <div ref={logRef}
                    className="rounded-xl overflow-y-auto font-mono text-[11px] leading-relaxed p-3"
                    style={{
                      background: `${themeColors.bg_card2}cc`,
                      border: `1px solid ${themeColors.border}`,
                      maxHeight: "220px",
                      minHeight: "100px",
                      scrollbarWidth: "thin",
                      scrollbarColor: `${themeColors.accent}30 transparent`,
                    }}>
                    {st.logs.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all"
                        style={{ color: line.toLowerCase().includes("failed") || line.toLowerCase().includes("error") ? themeColors.danger : themeColors.text_sub }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${themeColors.border}` }}>
              {st.stage === "available" && (
                <>
                  <GlowButton size="sm" variant="secondary" onClick={dismissUpdate}>Later</GlowButton>
                  <GlowButton size="sm" onClick={startUpdate} className="flex items-center gap-1">
                    <Download size={12} /> Update Now
                  </GlowButton>
                </>
              )}
              {busy && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} style={{ color: themeColors.success }} />
                  <span className="text-[10px]" style={{ color: themeColors.text_muted }}>
                    {st.stage === "applying"
                      ? "Xryloth will close and restart automatically."
                      : "Please keep the launcher open..."}
                  </span>
                </div>
              )}
              {st.stage === "error" && (
                <>
                  <GlowButton size="sm" variant="secondary" onClick={dismissUpdate} className="flex items-center gap-1">
                    <X size={12} /> Close
                  </GlowButton>
                  <GlowButton size="sm" onClick={startUpdate} className="flex items-center gap-1">
                    <RefreshCcw size={12} /> Retry
                  </GlowButton>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
