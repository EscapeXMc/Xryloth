import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Megaphone, Bell, Rocket, PartyPopper, Image as ImageIcon, Video } from "lucide-react";
import { useLauncherStore } from "../../stores";
import {
  subscribeAnnouncements, appliesToMe, playPingSound, hasSeen, markSeen,
  type Announcement,
} from "../../lib/announcements";

const TYPE_META: Record<string, { icon: any; label: string; colorKey: string }> = {
  ping: { icon: Bell, label: "Ping", colorKey: "warn" },
  update: { icon: Rocket, label: "Update", colorKey: "accent" },
  event: { icon: PartyPopper, label: "Event", colorKey: "success" },
  info: { icon: Megaphone, label: "Announcement", colorKey: "accent" },
};

function timeAgo(ts?: number) {
  if (!ts) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Full announcement card with optional image / video. */
export function AnnouncementPopup({ item, onClose }: { item: Announcement; onClose: () => void }) {
  const { themeColors } = useLauncherStore();
  const meta = TYPE_META[item.type] || TYPE_META.info;
  const Icon = meta.icon;
  const accent = (themeColors as any)[meta.colorKey] || themeColors.accent;
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    setMediaError(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  const hasMedia = item.mediaType !== "none" && !!item.mediaUrl && !mediaError;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
        style={{ background: themeColors.bg_card, border: `1px solid ${accent}55`, boxShadow: `0 24px 80px ${accent}33` }}
      >
        {hasMedia && (
          <div className="relative w-full bg-black flex items-center justify-center" style={{ maxHeight: "46vh" }}>
            {item.mediaType === "video" ? (
              <video
                src={item.mediaUrl}
                controls
                autoPlay
                muted
                loop
                playsInline
                className="w-full max-h-[46vh] object-contain"
                onError={() => setMediaError(true)}
              />
            ) : (
              <img
                src={item.mediaUrl}
                alt={item.title || "Announcement"}
                className="w-full max-h-[46vh] object-contain"
                onError={() => setMediaError(true)}
              />
            )}
          </div>
        )}

        <div className="p-5 overflow-y-auto">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}22`, color: accent }}>
              <Icon size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${accent}22`, color: accent }}>
                  {meta.label.toUpperCase()}
                </span>
                <span className="text-[10px]" style={{ color: themeColors.text_muted }}>
                  by {item.createdBy || "Admin"} · {timeAgo(item.createdAt)}
                </span>
              </div>
              {item.title?.trim() && (
                <h3 className="tinycaps text-lg font-bold mt-2" style={{ color: themeColors.text_main }}>{item.title}</h3>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg shrink-0" style={{ color: themeColors.text_muted, background: `${themeColors.bg_hover}66` }} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {item.body?.trim() && (
            <p className="text-sm mt-3 whitespace-pre-wrap leading-relaxed" style={{ color: themeColors.text_sub }}>{item.body}</p>
          )}

          {!hasMedia && item.mediaType !== "none" && item.mediaUrl && (
            <p className="text-[11px] mt-3 flex items-center gap-1" style={{ color: themeColors.warn }}>
              {item.mediaType === "video" ? <Video size={12} /> : <ImageIcon size={12} />} Media could not be loaded.
            </p>
          )}

          <p className="text-[10px] mt-4" style={{ color: themeColors.text_muted }}>
            Someone may have pinged you — check the Announcements page for all updates.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Global host: subscribes to /announcements once, then for every NEW
 * announcement that applies to this user and asks for a popup (or is a ping)
 * it plays the Discord-style chime and shows the card. Rendered once in App.
 */
const POPUP_RECENCY_MS = 15 * 60 * 1000; // don't re-pop old, non-targeted news on open

export function AnnouncementHost() {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [firstLoad, setFirstLoad] = useState(true);

  useEffect(() => {
    return subscribeAnnouncements((list) => {
      const now = Date.now();
      const fresh: Announcement[] = [];
      for (const a of list) {
        if (!a.id || hasSeen(a.id)) continue;
        const wantsPopup = a.popup || a.type === "ping";
        if (!wantsPopup) continue;
        if (!appliesToMe(a)) continue;
        // Targeted pings always surface; untargeted news only if recent, so
        // opening the launcher doesn't fire every historic announcement.
        const targeted = !!a.targetUid;
        if (firstLoad && !targeted && (now - (a.createdAt || 0)) > POPUP_RECENCY_MS) continue;
        fresh.push(a);
      }
      // Mark everything as seen so we never ping twice.
      markSeen(list.map((a) => a.id!).filter(Boolean));

      if (fresh.length) {
        fresh.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (fresh.some((a) => a.type === "ping")) playPingSound();
        setQueue((q) => [...q, ...fresh]);
      }
      if (firstLoad) setFirstLoad(false);
    });
  }, []);

  const top = queue[0];
  return (
    <AnimatePresence>
      {top && (
        <AnnouncementPopup
          key={top.id}
          item={top}
          onClose={() => setQueue((q) => q.filter((x) => x.id !== top.id))}
        />
      )}
    </AnimatePresence>
  );
}
