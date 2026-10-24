import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Megaphone } from "lucide-react";
import { useLauncherStore } from "../../stores";
import { subscribeAnnouncements, appliesToMe, type Announcement } from "../../lib/announcements";

/**
 * The "upper strip" — a text band that continuously scrolls left ➜ right in a
 * loop, carrying every live announcement flagged for the ticker.
 */
export function AnnouncementTicker() {
  const { themeColors } = useLauncherStore();
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    return subscribeAnnouncements((list) => {
      setItems(list.filter((a) => a.ticker && appliesToMe(a)).slice(0, 8));
    });
  }, []);

  const tickerItems = useMemo(() => {
    return items.map((a) => ({
      id: a.id || "",
      text: a.body?.trim() || a.title?.trim() || "Announcement",
      type: a.type,
      priority: a.priority,
    }));
  }, [items]);

  if (tickerItems.length === 0) return null;

  // Duration scales with content length so the speed stays readable.
  const totalChars = tickerItems.reduce((n, i) => n + i.text.length + 6, 0);
  const duration = Math.max(14, Math.min(60, totalChars / 6));

  const strip = (
    <div className="flex items-center shrink-0">
      {tickerItems.map((item) => (
        <span key={item.id} className="flex items-center whitespace-nowrap px-6">
          <span
            className="text-[11px] font-semibold tracking-wide"
            style={{ color: item.priority === "high" ? themeColors.warn : themeColors.text_main }}
          >
            {item.type === "ping" ? "🔔 " : item.type === "update" ? "🚀 " : item.type === "event" ? "🎉 " : "📢 "}
            {item.text}
          </span>
          <span className="mx-4 opacity-40" style={{ color: themeColors.accent }}>◆</span>
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="relative w-full h-[30px] overflow-hidden flex items-center shrink-0"
      style={{
        background: `linear-gradient(90deg, ${themeColors.accent}26, ${themeColors.bg_card}dd 18%, ${themeColors.bg_card}dd 82%, ${themeColors.accent}26)`,
        borderBottom: `1px solid ${themeColors.accent}33`,
      }}
      role="marquee"
      aria-label="Announcements"
    >
      <div
        className="absolute left-0 top-0 bottom-0 flex items-center px-3 z-10"
        style={{
          background: `linear-gradient(90deg, ${themeColors.bg_main}, ${themeColors.bg_main}00)`,
        }}
      >
        <Megaphone size={14} style={{ color: themeColors.accent }} />
      </div>

      {/* Two identical copies animate -50% ➜ 0% for a seamless RIGHTWARD loop. */}
      <motion.div
        className="flex items-center whitespace-nowrap will-change-transform"
        animate={{ x: ["-50%", "0%"] }}
        transition={{ duration, ease: "linear", repeat: Infinity }}
        style={{ paddingLeft: "2rem" }}
      >
        {strip}
        {strip}
      </motion.div>

      <div
        className="absolute right-0 top-0 bottom-0 w-10 pointer-events-none"
        style={{ background: `linear-gradient(270deg, ${themeColors.bg_main}, ${themeColors.bg_main}00)` }}
      />
    </div>
  );
}
