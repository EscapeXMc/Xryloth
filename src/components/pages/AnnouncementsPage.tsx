import { CachedImage } from "../ui/CachedImage";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import { Select } from "../ui/Select";
import { useToast } from "../ui/Toast";
import { confirmDialog } from "../ui/Dialog";
import {
  Megaphone, Bell, Rocket, PartyPopper, Send, Trash2, Image as ImageIcon,
  Video, Upload, Users, Radio, ShieldAlert, Info, Clock,
} from "lucide-react";
import {
  subscribeAnnouncements, postAnnouncement, deleteAnnouncement, isAdmin, appliesToMe,
  type Announcement, type AnnouncementType, type MediaType,
} from "../../lib/announcements";
import { subscribeToOnlineUsers, type ChatUser } from "../../lib/chatService";

const TYPE_META: Record<AnnouncementType, { icon: any; label: string; colorKey: string }> = {
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

// RTDB values are capped at ~10 MB per node; keep base64 uploads well under it.
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

export function AnnouncementsPage() {
  const { themeColors } = useLauncherStore();
  const { toast } = useToast();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const admin = isAdmin();

  // Composer state
  const [type, setType] = useState<AnnouncementType>("info");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("none");
  const [mediaUrl, setMediaUrl] = useState("");
  const [ticker, setTicker] = useState(true);
  const [popup, setPopup] = useState(true);
  const [targetUid, setTargetUid] = useState("");
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [posting, setPosting] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAnnouncements((list) => {
      setItems(list);
      setLoading(false);
    });
    // Never hang on the spinner if the realtime DB is unreachable.
    const t = window.setTimeout(() => setLoading(false), 5000);
    return () => { unsub(); window.clearTimeout(t); };
  }, []);

  // Admin composer needs a user list for targeted (Discord-style) pings.
  useEffect(() => {
    if (!admin) return;
    const unsub = subscribeToOnlineUsers((u) => setUsers(u));
    return unsub;
  }, [admin]);

  const targetUser = useMemo(() => users.find((u) => u.uid === targetUid) || null, [users, targetUid]);

  const resetComposer = () => {
    setType("info");
    setTitle("");
    setBody("");
    setMediaType("none");
    setMediaUrl("");
    setTicker(true);
    setPopup(true);
    setTargetUid("");
  };

  const onPickMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_MEDIA_BYTES) {
      toast("error", "File too large", `Keep media under ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB so it fits the live database.`);
      e.target.value = "";
      return;
    }
    const isVideo = file.type.startsWith("video/");
    setMediaType(isVideo ? "video" : "image");
    const reader = new FileReader();
    reader.onload = () => setMediaUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const publish = async () => {
    if (!title.trim() && !body.trim() && !mediaUrl.trim()) {
      toast("warning", "Nothing to announce", "Add a title, message or media first.");
      return;
    }
    if (type === "ping" && targetUid && !targetUser) {
      toast("warning", "Pick a valid user", "That user is no longer online.");
      return;
    }
    setPosting(true);
    const res = await postAnnouncement({
      title,
      body,
      type,
      mediaType,
      mediaUrl: mediaUrl.trim() || undefined,
      ticker,
      popup: popup || type === "ping",
      priority: type === "ping" ? "high" : "normal",
      targetUid: targetUid || undefined,
      targetUsername: targetUser?.username || targetUser?.displayName || undefined,
    });
    setPosting(false);
    if (res.ok) {
      toast("success", "Announcement sent", type === "ping" ? "The ping is on its way. 🔔" : "It is live for everyone now.");
      resetComposer();
    } else {
      toast("error", "Could not send", res.error || "Try again in a moment.");
    }
  };

  const remove = async (a: Announcement) => {
    if (!a.id) return;
    if (!await confirmDialog("Delete announcement?", "This will permanently delete this announcement for everyone. This action cannot be undone.", { danger: true, confirmLabel: "Delete" })) return;
    const res = await deleteAnnouncement(a.id);
    if (res.ok) toast("success", "Deleted");
    else toast("error", "Delete failed", res.error);
  };

  const userOptions = [
    { value: "", label: "🌍 Everyone" },
    ...users.map((u) => ({
      value: u.uid,
      label: `${u.status === "online" ? "🟢" : "⚪"} ${u.username || u.displayName || u.email}`,
    })),
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone size={20} style={{ color: themeColors.accent }} />
        <h1 className="tinycaps text-xl font-black" style={{ color: themeColors.text_main }}>Announcements</h1>
        <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: `${themeColors.success}18`, color: themeColors.success }}>
          <Radio size={10} /> LIVE
        </span>
      </div>

      {/* Admin composer */}
      {admin && (
        <GlassCard>
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={15} style={{ color: themeColors.warn }} />
            <h3 className="tinycaps text-sm font-semibold" style={{ color: themeColors.text_main }}>Admin Composer</h3>
            <span className="text-[10px] ml-auto" style={{ color: themeColors.text_muted }}>Only admins can publish</span>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Type</label>
                <Select
                  value={type}
                  onChange={(v) => setType(v as AnnouncementType)}
                  options={[
                    { value: "info", label: "📢 Announcement" },
                    { value: "update", label: "🚀 Update" },
                    { value: "event", label: "🎉 Event" },
                    { value: "ping", label: "🔔 Ping (Discord-style)" },
                  ]}
                />
              </div>
              <div>
                <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>
                  {type === "ping" ? "Ping who?" : "Audience"}
                </label>
                <Select
                  value={targetUid}
                  onChange={setTargetUid}
                  disabled={type !== "ping"}
                  options={userOptions}
                  placeholder="🌍 Everyone"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Title</label>
              <GlassInput value={title} onChange={setTitle} placeholder="Big news!" />
            </div>
            <div>
              <label className="text-[11px] block mb-1" style={{ color: themeColors.text_sub }}>Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Write the announcement…"
                className="w-full px-3 py-2.5 rounded-xl text-[12px] outline-none resize-y"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: themeColors.text_main }}
              />
            </div>

            {/* Media */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-[11px]" style={{ color: themeColors.text_sub }}>Media (optional)</label>
                <div className="flex gap-1 ml-auto">
                  {(["none", "image", "video"] as MediaType[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMediaType(m); if (m === "none") setMediaUrl(""); }}
                      className="text-[10px] px-2 py-0.5 rounded-lg flex items-center gap-1"
                      style={{
                        background: mediaType === m ? `${themeColors.accent}22` : "rgba(255,255,255,0.04)",
                        color: mediaType === m ? themeColors.accent : themeColors.text_muted,
                        border: `1px solid ${mediaType === m ? `${themeColors.accent}40` : "transparent"}`,
                      }}
                    >
                      {m === "image" && <ImageIcon size={10} />}
                      {m === "video" && <Video size={10} />}
                      {m === "none" ? "None" : m === "image" ? "Image" : "Video"}
                    </button>
                  ))}
                </div>
              </div>

              {mediaType !== "none" && (
                <div className="space-y-2">
                  <GlassInput value={mediaUrl.startsWith("data:") ? "" : mediaUrl} onChange={setMediaUrl} placeholder="https://… (or upload below)" />
                  <div className="flex items-center gap-2">
                    <GlowButton size="sm" variant="secondary" onClick={() => uploadRef.current?.click()} className="flex items-center gap-1">
                      <Upload size={12} /> Upload {mediaType === "video" ? "video" : "image"}
                    </GlowButton>
                    <input ref={uploadRef} type="file" accept={mediaType === "video" ? "video/*" : "image/*"} className="hidden" onChange={onPickMedia} />
                    {mediaUrl && <span className="text-[10px] truncate" style={{ color: themeColors.text_muted }}>Media attached ✓</span>}
                  </div>
                  {mediaUrl && mediaType === "image" && (
                    <CachedImage src={mediaUrl} alt="" className="max-h-32 rounded-lg" style={{ border: `1px solid ${themeColors.border}` }} />
                  )}
                  {mediaUrl && mediaType === "video" && (
                    <video src={mediaUrl} controls muted className="max-h-32 rounded-lg" style={{ border: `1px solid ${themeColors.border}` }} />
                  )}
                </div>
              )}
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setTicker((v) => !v)} className="text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{ background: ticker ? `${themeColors.accent}18` : "rgba(255,255,255,0.04)", color: ticker ? themeColors.accent : themeColors.text_muted, border: `1px solid ${ticker ? `${themeColors.accent}40` : "transparent"}` }}>
                <Radio size={12} /> Scrolling ticker
              </button>
              <button onClick={() => setPopup((v) => !v)} className="text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{ background: popup ? `${themeColors.accent}18` : "rgba(255,255,255,0.04)", color: popup ? themeColors.accent : themeColors.text_muted, border: `1px solid ${popup ? `${themeColors.accent}40` : "transparent"}` }}>
                <Bell size={12} /> Popup card
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <GlowButton size="sm" onClick={publish} disabled={posting} className="flex items-center gap-1">
                <Send size={13} /> {posting ? "Sending…" : type === "ping" ? "Send Ping" : "Publish"}
              </GlowButton>
              <span className="text-[10px] flex items-center gap-1" style={{ color: themeColors.text_muted }}>
                <Info size={11} /> Pings play a sound + popup instantly for the target.
              </span>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Feed */}
      {!admin && (
        <p className="text-[11px] flex items-center gap-1" style={{ color: themeColors.text_muted }}>
          <Info size={12} /> Announcements and pings from the Xryloth team appear here in real time.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-center py-8" style={{ color: themeColors.text_muted }}>Loading announcements…</p>
      ) : items.length === 0 ? (
        <GlassCard className="text-center py-10">
          <Megaphone size={28} className="mx-auto mb-2" style={{ color: themeColors.text_muted }} />
          <p className="text-sm" style={{ color: themeColors.text_muted }}>No announcements yet.</p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {items.map((a) => {
              const meta = TYPE_META[a.type] || TYPE_META.info;
              const Icon = meta.icon;
              const accent = (themeColors as any)[meta.colorKey] || themeColors.accent;
              const mine = appliesToMe(a) && a.targetUid;
              const hasMedia = a.mediaType !== "none" && !!a.mediaUrl;
              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                >
                  <GlassCard>
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}22`, color: accent }}>
                        <Icon size={17} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${accent}22`, color: accent }}>
                            {meta.label.toUpperCase()}
                          </span>
                          {a.priority === "high" && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${themeColors.danger}18`, color: themeColors.danger }}>HIGH</span>
                          )}
                          {a.targetUid && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: `${themeColors.warn}18`, color: themeColors.warn }}>
                              <Users size={9} /> {a.targetUsername || "a user"}{mine ? " (you)" : ""}
                            </span>
                          )}
                          {a.ticker && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${themeColors.bg_hover}77`, color: themeColors.text_muted }}>TICKER</span>}
                          <span className="text-[10px] ml-auto flex items-center gap-1" style={{ color: themeColors.text_muted }}>
                            <Clock size={9} /> {timeAgo(a.createdAt)}
                          </span>
                        </div>
                        {a.title?.trim() && (
                          <h3 className="text-base font-bold mt-2" style={{ color: themeColors.text_main }}>{a.title}</h3>
                        )}
                        {a.body?.trim() && (
                          <p className="text-sm mt-1 whitespace-pre-wrap leading-relaxed" style={{ color: themeColors.text_sub }}>{a.body}</p>
                        )}
                        {hasMedia && (
                          <div className="mt-3">
                            {a.mediaType === "video" ? (
                              <video src={a.mediaUrl} controls muted loop playsInline className="w-full max-h-72 rounded-xl" style={{ border: `1px solid ${themeColors.border}` }} />
                            ) : (
                              <CachedImage src={a.mediaUrl} alt="" className="w-full max-h-72 object-contain rounded-xl" style={{ border: `1px solid ${themeColors.border}` }} />
                            )}
                          </div>
                        )}
                        <p className="text-[10px] mt-2" style={{ color: themeColors.text_muted }}>
                          by {a.createdBy || "Admin"} · {new Date(a.createdAt || Date.now()).toLocaleString()}
                        </p>
                      </div>
                      {admin && (
                        <button onClick={() => remove(a)} className="p-1.5 rounded-lg shrink-0" style={{ color: themeColors.danger, background: `${themeColors.danger}12` }} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
