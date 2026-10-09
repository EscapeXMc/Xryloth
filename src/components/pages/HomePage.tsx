// @ts-nocheck — recovered minified bundle output, see header below.
// ============================================================================
//  HomePage — ORIGINAL default dashboard, recovered byte-for-byte from the
//  production bundle that was built before the rewrite (dist/assets/, 15:43).
//
//  The recovered code is minified ES output, so short identifier names and
//  `_jsx()/_jsxs()` calls are kept intentionally: they reproduce the original
//  UI exactly. A legend of the aliases is below. Do not "prettify" this away
//  without a visual check — it is the reference for the design.
// ============================================================================
import * as f from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { api } from "../../lib/api";
import { invoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import {
  Plus, ChevronRight, Timer, Image, Box, Clock, Play, Loader2, Cpu, Camera,
  AlertTriangle, Zap, History, Settings, Headphones, MonitorPlay, MessageCircle,
  TrendingUp, MemoryStick, Disc, Crown, User,
} from "lucide-react";

// ---- recovered bundle aliases -> real names --------------------------------
const O = motion;                    // motion.div / O.button / O.h1 / O.p
const Ke = AnimatePresence;          // AnimatePresence
const I = api;                       // api.news.get()
const we = useLauncherStore;         // we() -> launcher store state
const vs = invoke;                   // vs("get_screenshots", {...})
const Ni = convertFileSrc;           // Ni(path) -> asset:// URL
const ne = GlassCard;                // glass card
const V = GlowButton;                // primary/secondary/danger button
const $n = Plus;                     // icons
const $i = ChevronRight;
const EM = Timer;
const Ii = Image;
const Ja = Box;
const Kr = Clock;
const Ks = Play;
const Ok = Loader2;
const Sy = Cpu;
const X3 = Camera;
const Xa = AlertTriangle;
const mh = Zap;
const dM = History;
const qr = Settings;
const uM = Headphones;
const vM = MonitorPlay;
const zk = MessageCircle;
const u1 = TrendingUp;               // trend chip arrow
const yM = MemoryStick;               // memory stat icon
const sM = Disc;                      // disk stat icon
const tM = Crown;                     // player card login row
const Gk = User;                      // skin fallback icon

// ---- constants / URL helpers ----------------------------------------------
const Nm = "https://mc-heads.net/avatar/8660ba3e76424a96b46f0b738fcc8806?size=128";

function SR(e) {
  if (!e) return Nm;
  const t = e.replace(/-/g, "");
  return t.length !== 32 ? Nm : `https://mc-heads.net/avatar/${t}?size=128`;
}

function CR(e, t, n = !1) {
  if (n && (e || t)) {
    const s = (e || t || "").replace(/-/g, ""),
      r = `https://skin.ely.by/uuid/${s}.png`;
    return `https://mc-heads.net/body/${s}/200?skin=${encodeURIComponent(r)}`;
  }
  if (e) {
    const s = e.replace(/-/g, "");
    if (s.length === 32) return `https://mc-heads.net/body/${s}/200`;
  }
  return t ? `https://mc-heads.net/body/${encodeURIComponent(t)}/200` : Nm;
}


// ---- shared helpers --------------------------------------------------------
function NR(e) {
  if (e < 60) return `${e}m`;
  const t = Math.floor(e / 60),
    n = e % 60;
  return n > 0 ? `${t}h ${n}m` : `${t}h`;
}

function Xk(e) {
  if (!e) return "never";
  const t = Date.now();
  let n;
  try {
    n = new Date(e).getTime();
  } catch {
    return e;
  }
  if (isNaN(n)) return e;
  const s = t - n;
  if (s < 0) return "just now";
  const r = Math.floor(s / 1e3);
  if (r < 60) return "just now";
  const a = Math.floor(r / 60);
  if (a < 60) return `${a}m ago`;
  const o = Math.floor(a / 60);
  if (o < 24) return `${o}h ago`;
  const l = Math.floor(o / 24);
  if (l === 1) return "yesterday";
  if (l < 7) return `${l}d ago`;
  const c = Math.floor(l / 7);
  return c < 4 ? `${c}w ago` : new Date(e).toLocaleDateString();
}

function ER(e, t, n) {
  const [s, r] = f.useState({
    username: "player",
    uuid: "",
    playtime: 0,
    lastPlayed: "never",
    level: null,
    isCracked: !0,
    hasPremiumSkin: !1,
    capeUrl: null,
  });
  return (
    f.useEffect(() => {
      const a = e.username || e.cracked_username || e.ely_by_username || "player",
        o = e.mc_uuid || e.ely_uuid || "",
        l = Object.values(t).reduce((m, v) => m + (v || 0), 0),
        c = Math.floor(l / 60);
      let u = "never";
      const h = [...n.filter((m) => m.installed)].sort((m, v) => {
        const _ = m.last_played ? new Date(m.last_played).getTime() : 0;
        return (v.last_played ? new Date(v.last_played).getTime() : 0) - _;
      });
      h.length > 0 && h[0].last_played && (u = Xk(h[0].last_played));
      const p = !e.username || e.mc_token === "0" || !o;
      r({
        username: a,
        uuid: o,
        playtime: c,
        lastPlayed: u,
        level: null,
        isCracked: p,
        hasPremiumSkin: !!o,
        capeUrl: null,
      });
    }, [e.username, e.cracked_username, e.ely_by_username, e.mc_uuid, e.ely_uuid, e.mc_token, t, n]),
    s
  );
}

function TR({ skinUrl: e, uuid: t, className: n, size: s = 64 }) {
  const [r, a] = f.useState(!1),
    [o, l] = f.useState(!1),
    c = e || SR(t);
  return _jsxs("div", {
    className: `relative ${n}`,
    style: { width: s, height: s },
    children: [
      _jsxs("div", {
        className:
          "absolute inset-0 rounded-full border-2 border-white/20 overflow-hidden shadow-2xl transform transition-transform duration-300 hover:scale-110",
        children: [
          !r &&
            !o &&
            _jsx("div", {
              className:
                "absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 animate-pulse",
            }),
          o
            ? _jsx("div", {
                className:
                  "absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 flex items-center justify-center",
                children: _jsx(Gk, { size: s * 0.45, className: "text-white/60" }),
              })
            : _jsx("img", {
                src: c,
                alt: "Player skin",
                className: "w-full h-full",
                style: { imageRendering: "pixelated" },
                onLoad: () => a(!0),
                onError: () => l(!0),
              }),
        ],
      }),
      _jsx("div", {
        className:
          "absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-green-500 border-2 border-dark-900 shadow-md",
        children: _jsx("div", {
          className: "absolute inset-0 rounded-full bg-green-500 animate-ping opacity-30",
        }),
      }),
      _jsx("div", {
        className:
          "absolute top-0 left-0 w-5 h-5 rounded-full bg-neutral-500 border-2 border-dark-900 shadow-md opacity-80",
        children: _jsx("div", { className: "absolute inset-0 rounded-full bg-neutral-500 animate-pulse" }),
      }),
    ],
  });
}

function IR({ uuid: e, username: t, isElyby: n, size: s = 120 }) {
  const [r, a] = f.useState(!1),
    [o, l] = f.useState(!1),
    c = CR(e, t, n);
  return _jsxs("div", {
    className: "relative",
    style: { width: s, height: s },
    children: [
      !r &&
        !o &&
        _jsx("div", {
          className:
            "absolute inset-0 rounded-xl bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 animate-pulse",
        }),
      o
        ? _jsx(TR, { uuid: e, className: "w-full h-full", size: s })
        : _jsx("img", {
            src: c,
            alt: "3D skin",
            className: "w-full h-full drop-shadow-2xl",
            style: { imageRendering: "pixelated", filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.5))" },
            onLoad: () => a(!0),
            onError: () => l(!0),
          }),
    ],
  });
}

function Vf({
  title: e,
  icon: t,
  value: n,
  sub: s,
  color: r,
  delay: a,
  trend: o,
  trendValue: l,
  status: c = "online",
}) {
  const u = { online: "bg-green-500", warning: "bg-yellow-500", critical: "bg-red-500" };
  return _jsxs(ne, {
    delay: a,
    className: "p-6 relative overflow-hidden group-hover:shadow-2xl transition-all duration-300",
    children: [
      _jsx("div", { className: `absolute top-0 right-0 w-2 h-2 rounded-full ${u[c]} mt-3 mr-3` }),
      _jsxs("div", {
        className: "flex items-center justify-between mb-5",
        children: [
          _jsxs("div", {
            className: "flex items-center gap-4",
            children: [
              _jsxs("div", {
                className: "w-12 h-12 rounded-xl flex items-center justify-center relative",
                style: { background: `${r}15`, border: `1px solid ${r}25` },
                children: [
                  _jsx(t, { size: 24, style: { color: r }, className: "drop-shadow-sm" }),
                  o &&
                    _jsx("div", {
                      className:
                        "absolute -top-1 -right-1 w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center",
                      children: _jsx(u1, { size: 10, style: { color: "#4ade80" } }),
                    }),
                ],
              }),
              _jsxs("div", {
                children: [
                  _jsx("div", {
                    className: "text-sm font-bold tinycaps",
                    style: { color: "var(--text-main, #e0ecff)" },
                    children: e,
                  }),
                  _jsx("div", {
                    className: "text-[11px] tinycaps mt-0.5",
                    style: { color: "var(--text-muted, #5a6a80)" },
                    children: s,
                  }),
                ],
              }),
            ],
          }),
          o &&
            l &&
            _jsxs("div", {
              className: "flex items-center gap-2",
              children: [
                _jsx("div", { className: "text-sm font-bold", style: { color: r }, children: l }),
                _jsx("div", {
                  className: "w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center",
                  children: _jsx(u1, { size: 14, style: { color: "#4ade80" } }),
                }),
              ],
            }),
        ],
      }),
      _jsx("div", {
        className: "mt-6",
        children: _jsx("div", {
          className: "text-4xl font-extrabold gradient-text",
          style: { "--gradient-color": r },
          children: n,
        }),
      }),
    ],
  });
}

function PR({ username: e, uuid: t, themeColors: n, isElyby: s = !1, playtimeMinutes: r, lastPlayed: a }) {
  const [o, l] = f.useState(!1);
  f.useEffect(() => {
    const d = setTimeout(() => l(!0), 800);
    return () => clearTimeout(d);
  }, []);
  const c = r > 0 ? `${Math.floor(r / 60)}h ${r % 60}m` : "0h",
    u = [
      { icon: Kr, title: `${c} total playtime`, time: a, color: n.accent },
      {
        icon: Ja,
        title: `${r > 0 ? "Instance" : "No instance"} installed`,
        time: a !== "never" ? "recent" : "—",
        color: n.purple,
      },
      { icon: tM, title: "Login as " + (e || "player"), time: s ? "Ely.by" : "Microsoft", color: n.warn },
    ];
  return _jsxs(O.div, {
    initial: { opacity: 0, scale: 0.9, y: 10 },
    animate: { opacity: o ? 1 : 0, scale: o ? 1 : 0.9, y: o ? 0 : 10 },
    transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
    className: "flex flex-col gap-4 p-5 rounded-3xl",
    style: {
      background: `linear-gradient(135deg, ${n.accent}15, ${n.accent}08), linear-gradient(135deg, ${n.purple}10, transparent)`,
      border: `1px solid ${n.accent}25`,
    },
    children: [
      _jsxs("div", {
        className: "flex items-center gap-5",
        children: [
          _jsxs(O.div, {
            whileHover: { scale: 1.08, rotate: 8 },
            transition: { type: "spring", stiffness: 300 },
            className: "relative",
            children: [
              _jsx(IR, { uuid: t, username: e, isElyby: s, size: 88 }),
              _jsx("div", {
                className:
                  "absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-neutral-500 border-2 border-dark-900 shadow-lg",
                children: _jsx("div", {
                  className: "absolute inset-0 rounded-full bg-neutral-500 animate-ping opacity-30",
                }),
              }),
              _jsx("div", {
                className:
                  "absolute -top-2 -left-2 w-5 h-5 rounded-full bg-green-500 border-2 border-dark-900 shadow-md",
                children: _jsx("div", {
                  className: "absolute inset-0 rounded-full bg-green-500 animate-pulse",
                }),
              }),
            ],
          }),
          _jsxs("div", {
            className: "flex-1",
            children: [
              _jsx("div", {
                className: "text-lg font-bold mb-1",
                style: { color: n.text_main },
                children: e,
              }),
              _jsxs("div", {
                className: "text-[12px] tinycaps mt-1 flex items-center gap-3",
                style: { color: n.text_muted },
                children: [
                  _jsxs("div", {
                    className: "flex items-center gap-1.5",
                    children: [
                      _jsx("div", { className: "w-2 h-2 rounded-full bg-green-500 animate-pulse" }),
                      _jsx("span", { children: "Online" }),
                    ],
                  }),
                  _jsx("span", { children: "•" }),
                  _jsxs("span", { children: [c, " played"] }),
                  _jsx("span", { children: "•" }),
                  _jsxs("span", { children: ["Last: ", a] }),
                ],
              }),
            ],
          }),
          _jsx(O.button, {
            whileHover: { scale: 1.05, backgroundColor: n.accent },
            whileTap: { scale: 0.95 },
            className: "px-5 py-3 rounded-xl text-[12px] font-bold tinycaps transition-all shadow-lg",
            style: { background: `${n.accent}20`, color: n.accent, border: `1px solid ${n.accent}30` },
            children: "Edit Profile",
          }),
        ],
      }),
      _jsxs("div", {
        className: "mt-4 pt-4 border-t",
        style: { borderColor: n.border },
        children: [
          _jsx("div", {
            className: "text-xs font-bold tinycaps mb-3",
            style: { color: n.text_muted },
            children: "RECENT ACTIVITY",
          }),
          _jsx("div", {
            className: "space-y-2",
            children: u.map((d, h) =>
              _jsxs(
                O.div,
                {
                  initial: { opacity: 0, x: -10 },
                  animate: { opacity: 1, x: 0 },
                  transition: { delay: 0.5 + h * 0.1, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  className: "flex items-center gap-3 p-3 rounded-xl transition-all hover:bg-white/5",
                  style: { background: `${d.color}10`, border: `1px solid ${d.color}20` },
                  children: [
                    _jsx("div", {
                      className: "w-7 h-7 rounded-lg flex items-center justify-center",
                      style: { background: `${d.color}20`, border: `1px solid ${d.color}30` },
                      children: _jsx(d.icon, { size: 14, style: { color: d.color } }),
                    }),
                    _jsxs("div", {
                      className: "flex-1",
                      children: [
                        _jsx("div", {
                          className: "text-[11px] font-medium",
                          style: { color: n.text_main },
                          children: d.title,
                        }),
                        _jsx("div", {
                          className: "text-[10px] tinycaps",
                          style: { color: n.text_muted },
                          children: d.time,
                        }),
                      ],
                    }),
                  ],
                },
                h,
              ),
            ),
          }),
        ],
      }),
    ],
  });
}

export function HomePage() {
  const {
      themeColors: e,
      instances: t,
      playTimes: n,
      systemInfo: s,
      settings: r,
      setPage: a,
      setSelectedInstance: o,
      setLoading: l,
      loadPlayTimes: c,
      loadSystemInfo: u,
    } = we(),
    d = ER(r, n, t),
    [h, p] = f.useState([]),
    [m, v] = f.useState(!0),
    [_, C] = f.useState([]),
    [y, g] = f.useState([]),
    [b, N] = f.useState(!0),
    j =
      (r.launcher_bg_type === "image" && r.launcher_bg_image) ||
      r.launcher_bg_type === "video" ||
      ((!r.launcher_bg_type || r.launcher_bg_type === "default") && r.launcher_bg_video !== "");
  f.useEffect(() => {
    (c(),
      u(),
      I.news
        .get()
        .then(($) => {
          (p($), v(!1));
        })
        .catch(() => v(!1)));
    const E = t.filter(($) => $.installed),
      k = [...E].sort(($, Y) => {
        const ae = $.last_played ? new Date($.last_played).getTime() : 0;
        return (Y.last_played ? new Date(Y.last_played).getTime() : 0) - ae;
      });
    (C(k),
      N(!0),
      (async () => {
        const $ = [];
        for (const Y of E)
          try {
            const ae = await vs("get_screenshots", { instanceName: Y.name });
            $.push(...ae);
          } catch {}
        ($.sort((Y, ae) => {
          try {
            return new Date(ae.timestamp).getTime() - new Date(Y.timestamp).getTime();
          } catch {
            return 0;
          }
        }),
          g($),
          N(!1));
      })());
  }, [t]);
  const T = Object.values(n).reduce((E, k) => E + (k || 0), 0),
    R = Math.floor(T / 3600),
    S = f.useMemo(() => t.filter((E) => E.installed), [t]),
    W = f.useMemo(() => {
      const E = Object.values(n);
      return E.length > 0 ? Math.floor(Math.max(...E) / 3600) : 0;
    }, [n]),
    U = f.useMemo(() => {
      if (T <= 0) return 0;
      const E = Date.now(),
        k = [
          ...t.filter((Y) => Y.installed && Y.last_played).map((Y) => new Date(Y.last_played).getTime()),
          ...t.filter((Y) => Y.installed && Y.created).map((Y) => new Date(Y.created).getTime()),
        ].filter((Y) => Y > 0);
      if (k.length === 0) return 0;
      const M = Math.min(...k),
        $ = Math.max(1, Math.floor((E - M) / (1e3 * 60 * 60 * 24)));
      return Math.floor(T / 3600 / $);
    }, [T, t]),
    J = f.useMemo(() => {
      let E = 0;
      for (const k of S) (k.version_json_exists || E++, k.mods && k.mods.some((M) => !M.enabled) && E++);
      return E;
    }, [S]);
  f.useMemo(
    () =>
      Object.entries(n)
        .sort(([, E], [, k]) => k - E)
        .slice(0, 5),
    [n],
  );
  const B = f.useMemo(() => {
      const E = new Date().getHours();
      return E < 6
        ? "resting..."
        : E < 12
          ? "good morning"
          : E < 17
            ? "good afternoon"
            : E < 21
              ? "good evening"
              : "good night";
    }, []),
    le = r.username || r.cracked_username || r.ely_by_username || "player",
    H = r.ely_uuid || r.mc_uuid || null,
    P = !!r.ely_by_username && !r.cracked_username && !r.username,
    Z = (E) => {
      (l(!0, `Launching ${E.name}...`), o(E.name), a("instances"));
    };
  return _jsxs("div", {
    className: "space-y-8 max-w-8xl mx-auto",
    children: [
      _jsxs(O.div, {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] },
        className: "relative rounded-3xl overflow-hidden",
        style: {
          background: j
            ? `linear-gradient(145deg, ${e.bg_card}dd, ${e.bg_card2}cc)`
            : `linear-gradient(145deg, ${e.bg_card}, ${e.bg_card2})`,
          border: `1px solid ${e.border}50`,
          boxShadow: `0 8px 40px ${e.accent}12`,
        },
        children: [
          _jsx("div", {
            className: "absolute top-0 left-0 w-72 h-72 rounded-full opacity-30 blur-3xl pointer-events-none",
            style: { background: `radial-gradient(circle, ${e.accent}25, transparent 70%)` },
          }),
          _jsxs("div", {
            className: "relative p-10 flex flex-col lg:flex-row items-center justify-between gap-10",
            children: [
              _jsxs("div", {
                className: "flex-1 space-y-6",
                children: [
                  _jsxs(O.div, {
                    initial: { opacity: 0, x: -15 },
                    animate: { opacity: 1, x: 0 },
                    transition: { delay: 0.2 },
                    className: "space-y-3",
                    children: [
                      _jsxs(O.p, {
                        initial: { opacity: 0 },
                        animate: { opacity: 1 },
                        transition: { delay: 0.3 },
                        className: "text-sm tinycaps font-medium tracking-wide",
                        style: { color: e.text_muted },
                        children: [B, ", ", le],
                      }),
                      _jsxs(O.h1, {
                        initial: { opacity: 0, y: 10 },
                        animate: { opacity: 1, y: 0 },
                        transition: { delay: 0.4 },
                        className: "text-5xl lg:text-6xl font-extrabold tinycaps leading-tight",
                        children: [
                          _jsx("span", { style: { color: e.text_main }, children: "your " }),
                          _jsx("span", { style: { color: e.accent }, children: "adventure" }),
                          _jsx("br", {}),
                          _jsx("span", { style: { color: e.purple }, children: "starts now" }),
                        ],
                      }),
                    ],
                  }),
                  _jsxs(O.p, {
                    initial: { opacity: 0 },
                    animate: { opacity: 1 },
                    transition: { delay: 0.5 },
                    className: "text-sm tinycaps leading-relaxed max-w-lg",
                    style: { color: e.text_muted },
                    children: [
                      S.length,
                      " epic Minecraft world",
                      S.length !== 1 ? "s" : "",
                      " await",
                      S.length === 1 ? "s" : "",
                      " your command.",
                      R > 0 && ` You've played ${R} hours.`,
                    ],
                  }),
                  _jsxs(O.div, {
                    initial: { opacity: 0, y: 15 },
                    animate: { opacity: 1, y: 0 },
                    transition: { delay: 0.6 },
                    className: "flex flex-wrap gap-3 pt-2",
                    children: [
                      _jsxs(V, {
                        size: "lg",
                        onClick: () => a("instances"),
                        className: "flex items-center gap-2",
                        children: [_jsx($n, { size: 18 }), " New Instance"],
                      }),
                      _jsxs(V, {
                        size: "md",
                        variant: "secondary",
                        onClick: () => a("settings"),
                        className: "flex items-center gap-2",
                        children: [_jsx(qr, { size: 16 }), " Customize"],
                      }),
                      _jsxs(V, {
                        size: "md",
                        variant: "secondary",
                        onClick: () => a("chat"),
                        className: "flex items-center gap-2",
                        children: [_jsx(zk, { size: 16 }), " Chat"],
                      }),
                    ],
                  }),
                ],
              }),
              _jsx(O.div, {
                initial: { opacity: 0, x: 15, scale: 0.95 },
                animate: { opacity: 1, x: 0, scale: 1 },
                transition: { delay: 0.5, duration: 0.6 },
                className: "lg:w-[380px]",
                children: _jsx(PR, {
                  username: d.username,
                  uuid: d.uuid || H,
                  isElyby: P,
                  themeColors: e,
                  playtimeMinutes: d.playtime,
                  lastPlayed: d.lastPlayed,
                }),
              }),
            ],
          }),
        ],
      }),
      S.length > 0 &&
        _jsxs("div", {
          className: "space-y-6",
          children: [
            _jsxs("div", {
              className: "flex items-center justify-between px-1",
              children: [
                _jsxs("div", {
                  className: "flex items-center gap-3",
                  children: [
                    _jsx("div", {
                      className: "w-8 h-8 rounded-xl flex items-center justify-center",
                      style: { background: `${e.accent}20`, border: `1px solid ${e.accent}30` },
                      children: _jsx(dM, { size: 16, style: { color: e.accent } }),
                    }),
                    _jsx("h2", {
                      className: "text-base font-bold tinycaps gradient-text",
                      children: "recent games",
                    }),
                    _jsx("div", {
                      className: "hidden sm:block text-[10px] tinycaps px-3 py-1 rounded-full",
                      style: {
                        background: `${e.accent}10`,
                        color: e.text_muted,
                        border: `1px solid ${e.accent}15`,
                      },
                      children: "sorted by last played",
                    }),
                  ],
                }),
                _jsxs("button", {
                  onClick: () => a("instances"),
                  className:
                    "group inline-flex items-center gap-1.5 px-4 py-2 rounded-xl transition-all hover:scale-105 shadow-md",
                  style: { background: `${e.accent}15` },
                  onMouseEnter: (E) => {
                    E.currentTarget.style.background = e.accent + "25";
                  },
                  onMouseLeave: (E) => {
                    E.currentTarget.style.background = e.accent + "15";
                  },
                  children: [
                    _jsx("span", {
                      className: "text-[11px] font-bold tinycaps",
                      style: { color: e.accent },
                      children: "all instances",
                    }),
                    _jsx($i, {
                      size: 12,
                      style: { color: e.accent },
                      className: "group-hover:translate-x-0.5 transition-transform",
                    }),
                  ],
                }),
              ],
            }),
            _.length === 0
              ? _jsxs("div", {
                  className: "text-center py-12 rounded-3xl",
                  style: { background: `${e.bg_card}80`, border: `1px solid ${e.border}30` },
                  children: [
                    _jsx(vM, {
                      size: 40,
                      className: "mx-auto mb-3 opacity-30",
                      style: { color: e.text_muted },
                    }),
                    _jsx("p", {
                      className: "text-sm font-medium mb-1",
                      style: { color: e.text_muted },
                      children: "No recent games",
                    }),
                    _jsx("p", {
                      className: "text-xs mb-4",
                      style: { color: e.text_muted, opacity: 0.6 },
                      children: "Play a game to see it here",
                    }),
                    _jsxs(V, {
                      size: "sm",
                      onClick: () => a("instances"),
                      className: "inline-flex items-center gap-2",
                      children: [_jsx($n, { size: 14 }), " Create Instance"],
                    }),
                  ],
                })
              : _jsxs("div", {
                  className: "flex gap-5 overflow-x-auto pb-4 px-2",
                  style: { scrollbarWidth: "none", msOverflowStyle: "none" },
                  children: [
                    _jsx("style", {
                      children: `
                .hide-scrollbar::-webkit-scrollbar { display: none; }
                .hide-scrollbar { -ms-overflow-style: none; }
              `,
                    }),
                    _jsx("div", {
                      className: "flex gap-5 hide-scrollbar",
                      children: _jsx(Ke, {
                        children: _.slice(0, 8).map((E, k) => {
                          var $;
                          const M = n[E.name] || 0;
                          return _jsx(
                            O.div,
                            {
                              initial: { opacity: 0, y: 16, scale: 0.95 },
                              animate: { opacity: 1, y: 0, scale: 1 },
                              exit: { opacity: 0, scale: 0.9 },
                              transition: { duration: 0.5, delay: k * 0.06, ease: [0.4, 0, 0.2, 1] },
                              whileHover: { scale: 1.04, y: -6 },
                              onClick: () => {
                                (o(E.name), a("instances"));
                              },
                              className: "group relative rounded-2xl overflow-hidden cursor-pointer shrink-0",
                              style: {
                                width: 220,
                                background: `linear-gradient(135deg, ${e.bg_card}ee, ${e.bg_card2}cc)`,
                                border: `1px solid ${e.border}40`,
                                backdropFilter: "blur(16px)",
                                WebkitBackdropFilter: "blur(16px)",
                                boxShadow: `0 4px 20px ${e.accent}10`,
                                transition: "box-shadow 0.3s ease",
                              },
                              onMouseEnter: (Y) => {
                                Y.currentTarget.style.boxShadow = `0 8px 40px ${e.accent}30, 0 0 60px ${e.accent}10`;
                              },
                              onMouseLeave: (Y) => {
                                Y.currentTarget.style.boxShadow = `0 4px 20px ${e.accent}10`;
                              },
                              children: _jsxs("div", {
                                className: "p-5 flex flex-col gap-3 h-[170px]",
                                children: [
                                  _jsxs("div", {
                                    className: "flex items-start justify-between",
                                    children: [
                                      _jsxs("div", {
                                        className: "flex items-center gap-3 min-w-0 flex-1",
                                        children: [
                                          _jsx("span", {
                                            className: "text-2xl shrink-0",
                                            children:
                                              E.icon === "crafting_table"
                                                ? "🔨"
                                                : E.icon === "diamond"
                                                  ? "💎"
                                                  : E.icon === "grass"
                                                    ? "🌱"
                                                    : E.icon === "nether_portal"
                                                      ? "⚡️"
                                                      : "⛏",
                                          }),
                                          _jsxs("div", {
                                            className: "min-w-0",
                                            children: [
                                              _jsx("div", {
                                                className: "text-sm font-bold truncate",
                                                style: { color: e.text_main },
                                                children: E.name,
                                              }),
                                              _jsxs("div", {
                                                className: "text-[10px] tinycaps",
                                                style: { color: e.text_muted },
                                                children: ["MC ", E.version, " · ", E.loader || "Vanilla"],
                                              }),
                                            ],
                                          }),
                                        ],
                                      }),
                                      _jsx("span", {
                                        className: "text-[9px] font-medium px-2 py-1 rounded-full shrink-0",
                                        style: {
                                          background: `${e.accent}15`,
                                          color: e.accent,
                                          border: `1px solid ${e.accent}25`,
                                        },
                                        children:
                                          (($ = E.loader) == null ? void 0 : $.toLowerCase()) || "vanilla",
                                      }),
                                    ],
                                  }),
                                  _jsxs("div", {
                                    className: "flex items-center gap-3 text-[10px]",
                                    style: { color: e.text_muted },
                                    children: [
                                      _jsxs("div", {
                                        className: "flex items-center gap-1",
                                        children: [
                                          _jsx(Kr, { size: 10 }),
                                          _jsx("span", { children: Xk(E.last_played) }),
                                        ],
                                      }),
                                      M > 0 &&
                                        _jsxs("div", {
                                          className: "flex items-center gap-1",
                                          children: [
                                            _jsx(EM, { size: 10 }),
                                            _jsx("span", { children: NR(M) }),
                                          ],
                                        }),
                                    ],
                                  }),
                                  _jsx("div", { className: "flex-1" }),
                                  _jsxs(O.button, {
                                    whileHover: { scale: 1.05 },
                                    whileTap: { scale: 0.95 },
                                    onClick: (Y) => {
                                      (Y.stopPropagation(), Z(E));
                                    },
                                    className:
                                      "w-full py-2.5 rounded-xl text-[12px] font-bold tinycaps flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-lg",
                                    style: {
                                      background: `linear-gradient(135deg, ${e.accent}, ${e.accent2 || e.accent})`,
                                      color: e.accent_text,
                                      boxShadow: `0 4px 16px ${e.accent}40`,
                                    },
                                    children: [_jsx(Ks, { size: 14, fill: "currentColor" }), " Play"],
                                  }),
                                ],
                              }),
                            },
                            E.name,
                          );
                        }),
                      }),
                    }),
                  ],
                }),
          ],
        }),
      t.length > 0 &&
        _jsxs("div", {
          className: "space-y-8",
          children: [
            _jsx("div", {
              className: "flex items-center justify-between px-1",
              children: _jsxs("div", {
                className: "flex items-center gap-3",
                children: [
                  _jsx("div", {
                    className: "w-8 h-8 rounded-xl flex items-center justify-center",
                    style: { background: `${e.accent}20`, border: `1px solid ${e.accent}30` },
                    children: _jsx(mh, { size: 16, style: { color: e.accent } }),
                  }),
                  _jsx("h2", {
                    className: "text-base font-bold tinycaps",
                    style: { color: e.text_main },
                    children: "system dashboard",
                  }),
                  _jsx("div", {
                    className: "hidden md:block text-[10px] tinycaps px-3 py-1 rounded-full",
                    style: { background: `${e.text_muted}10`, color: e.text_muted },
                    children: "Real-time monitoring",
                  }),
                ],
              }),
            }),
            _jsxs("div", {
              className: "grid grid-cols-1 md:grid-cols-3 gap-6",
              children: [
                _jsx(O.div, {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.3, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  children: _jsx(Vf, {
                    title: "cpu usage",
                    icon: Sy,
                    value: `${Math.round(s.cpu)}%`,
                    sub: "Processor load",
                    color: s.cpu > 80 ? e.danger : e.accent,
                    delay: 0.3,
                    trend: s.cpu > 70,
                    trendValue: s.cpu > 70 ? "rising" : "stable",
                    status: s.cpu > 80 ? "critical" : s.cpu > 60 ? "warning" : "online",
                  }),
                }),
                _jsx(O.div, {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.35, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  children: _jsx(Vf, {
                    title: "memory",
                    icon: yM,
                    value: `${(s.ram_used / 1024 / 1024 / 1024).toFixed(1)}g`,
                    sub: `${s.ram_pct}% utilized`,
                    color: e.purple,
                    delay: 0.35,
                    trend: s.ram_pct > 60,
                    trendValue: s.ram_pct > 60 ? "high" : "optimal",
                    status: s.ram_pct > 80 ? "critical" : s.ram_pct > 60 ? "warning" : "online",
                  }),
                }),
                _jsx(O.div, {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.4, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  children: _jsx(Vf, {
                    title: "disk space",
                    icon: sM,
                    value: `${(s.disk_used / 1024 / 1024 / 1024).toFixed(0)}g`,
                    sub: `${s.disk_pct}% used`,
                    color: e.blue,
                    delay: 0.4,
                    trend: s.disk_pct < 80,
                    trendValue: s.disk_pct < 80 ? "healthy" : "caution",
                    status: s.disk_pct > 90 ? "critical" : s.disk_pct > 80 ? "warning" : "online",
                  }),
                }),
              ],
            }),
            _jsxs("div", {
              className: "grid grid-cols-2 md:grid-cols-4 gap-4 mt-6",
              children: [
                _jsx(O.div, {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.45, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  children: _jsxs("div", {
                    className: "group relative p-5 rounded-2xl overflow-hidden",
                    style: { background: `linear-gradient(135deg, ${e.bg_card}ee, ${e.bg_card2}dd)` },
                    children: [
                      _jsx("div", {
                        className:
                          "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                        style: {
                          background: `radial-gradient(circle at 50% 0%, ${e.accent}10, transparent 70%)`,
                        },
                      }),
                      _jsxs("div", {
                        className: "relative z-10",
                        children: [
                          _jsxs("div", {
                            className: "flex items-center gap-3 mb-3",
                            children: [
                              _jsx("div", {
                                className: "w-10 h-10 rounded-xl flex items-center justify-center",
                                style: { background: `${e.accent}15`, border: `1px solid ${e.accent}25` },
                                children: _jsx(Ja, { size: 20, style: { color: e.accent } }),
                              }),
                              _jsxs("div", {
                                children: [
                                  _jsx("div", {
                                    className: "text-xl font-bold gradient-text",
                                    children: t.length,
                                  }),
                                  _jsx("div", {
                                    className: "text-[9px] tinycaps",
                                    style: { color: e.text_muted },
                                    children: "total profiles",
                                  }),
                                ],
                              }),
                            ],
                          }),
                          _jsx("div", {
                            className: "mt-4 pt-3",
                            style: { borderTop: `1px solid ${e.accent}10` },
                            children: _jsxs("div", {
                              className: "flex items-center justify-between text-[9px]",
                              children: [
                                _jsx("span", { style: { color: e.text_muted }, children: "installed" }),
                                _jsx("span", {
                                  style: { color: e.accent, fontWeight: 600 },
                                  children: S.length,
                                }),
                              ],
                            }),
                          }),
                        ],
                      }),
                    ],
                  }),
                }),
                _jsx(O.div, {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.5, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  children: _jsxs("div", {
                    className: "group relative p-5 rounded-2xl overflow-hidden",
                    style: { background: `linear-gradient(135deg, ${e.bg_card}ee, ${e.bg_card2}dd)` },
                    children: [
                      _jsx("div", {
                        className:
                          "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                        style: {
                          background: `radial-gradient(circle at 50% 0%, ${e.purple}10, transparent 70%)`,
                        },
                      }),
                      _jsxs("div", {
                        className: "relative z-10",
                        children: [
                          _jsxs("div", {
                            className: "flex items-center gap-3 mb-3",
                            children: [
                              _jsx("div", {
                                className: "w-10 h-10 rounded-xl flex items-center justify-center",
                                style: { background: `${e.purple}15`, border: `1px solid ${e.purple}25` },
                                children: _jsx(Kr, { size: 20, style: { color: e.purple } }),
                              }),
                              _jsxs("div", {
                                children: [
                                  _jsx("div", {
                                    className: "text-xl font-bold",
                                    style: { color: e.purple },
                                    children: U > 0 ? `${U}h` : "—",
                                  }),
                                  _jsx("div", {
                                    className: "text-[9px] tinycaps",
                                    style: { color: e.text_muted },
                                    children: "daily average",
                                  }),
                                ],
                              }),
                            ],
                          }),
                          _jsx("div", {
                            className: "mt-4 pt-3",
                            style: { borderTop: `1px solid ${e.purple}10` },
                            children: _jsxs("div", {
                              className: "flex items-center justify-between text-[9px]",
                              children: [
                                _jsx("span", { style: { color: e.text_muted }, children: "peak" }),
                                _jsx("span", {
                                  style: { color: e.purple, fontWeight: 600 },
                                  children: W > 0 ? `${W}h` : "—",
                                }),
                              ],
                            }),
                          }),
                        ],
                      }),
                    ],
                  }),
                }),
                _jsx(O.div, {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.55, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  children: _jsxs("div", {
                    className: "group relative p-5 rounded-2xl overflow-hidden",
                    style: { background: `linear-gradient(135deg, ${e.bg_card}ee, ${e.bg_card2}dd)` },
                    children: [
                      _jsx("div", {
                        className:
                          "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                        style: {
                          background: `radial-gradient(circle at 50% 0%, ${e.green}10, transparent 70%)`,
                        },
                      }),
                      _jsxs("div", {
                        className: "relative z-10",
                        children: [
                          _jsxs("div", {
                            className: "flex items-center gap-3 mb-3",
                            children: [
                              _jsx("div", {
                                className: "w-10 h-10 rounded-xl flex items-center justify-center",
                                style: { background: `${e.green}15`, border: `1px solid ${e.green}25` },
                                children: _jsx(uM, { size: 20, style: { color: e.green } }),
                              }),
                              _jsxs("div", {
                                children: [
                                  _jsx("div", {
                                    className: "text-xl font-bold",
                                    style: { color: e.green },
                                    children: "n/a",
                                  }),
                                  _jsx("div", {
                                    className: "text-[9px] tinycaps",
                                    style: { color: e.text_muted },
                                    children: "volume",
                                  }),
                                ],
                              }),
                            ],
                          }),
                          _jsx("div", {
                            className: "mt-4 pt-3",
                            style: { borderTop: `1px solid ${e.green}10` },
                            children: _jsxs("div", {
                              className: "flex items-center justify-between text-[9px]",
                              children: [
                                _jsx("span", { style: { color: e.text_muted }, children: "muted" }),
                                _jsx("span", {
                                  style: { color: e.green, fontWeight: 600 },
                                  children: "quiet",
                                }),
                              ],
                            }),
                          }),
                        ],
                      }),
                    ],
                  }),
                }),
                _jsx(O.div, {
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.6, duration: 0.5, ease: [0.4, 0, 0.2, 1] },
                  children: _jsxs("div", {
                    className: "group relative p-5 rounded-2xl overflow-hidden",
                    style: { background: `linear-gradient(135deg, ${e.bg_card}ee, ${e.bg_card2}dd)` },
                    children: [
                      _jsx("div", {
                        className:
                          "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                        style: {
                          background: `radial-gradient(circle at 50% 0%, ${e.blue}10, transparent 70%)`,
                        },
                      }),
                      _jsxs("div", {
                        className: "relative z-10",
                        children: [
                          _jsxs("div", {
                            className: "flex items-center gap-3 mb-3",
                            children: [
                              _jsx("div", {
                                className: "w-10 h-10 rounded-xl flex items-center justify-center",
                                style: { background: `${e.blue}15`, border: `1px solid ${e.blue}25` },
                                children: _jsx(Xa, { size: 20, style: { color: e.warn } }),
                              }),
                              _jsxs("div", {
                                children: [
                                  _jsx("div", {
                                    className: "text-xl font-bold",
                                    style: { color: e.warn },
                                    children: J,
                                  }),
                                  _jsx("div", {
                                    className: "text-[9px] tinycaps",
                                    style: { color: e.text_muted },
                                    children: "warnings",
                                  }),
                                ],
                              }),
                            ],
                          }),
                          _jsx("div", {
                            className: "mt-4 pt-3",
                            style: { borderTop: `1px solid ${e.blue}10` },
                            children: _jsxs("div", {
                              className: "flex items-center justify-between text-[9px]",
                              children: [
                                _jsx("span", { style: { color: e.text_muted }, children: "alerts" }),
                                _jsx("span", {
                                  style: { color: e.blue, fontWeight: 600 },
                                  children: "healthy",
                                }),
                              ],
                            }),
                          }),
                        ],
                      }),
                    ],
                  }),
                }),
              ],
            }),
          ],
        }),
      S.length > 0 &&
        _jsxs("div", {
          className: "space-y-6",
          children: [
            _jsxs("div", {
              className: "flex items-center justify-between px-1",
              children: [
                _jsxs("div", {
                  className: "flex items-center gap-3",
                  children: [
                    _jsx("div", {
                      className: "w-8 h-8 rounded-xl flex items-center justify-center",
                      style: { background: `${e.purple}20`, border: `1px solid ${e.purple}30` },
                      children: _jsx(X3, { size: 16, style: { color: e.purple } }),
                    }),
                    _jsx("h2", {
                      className: "text-base font-bold tinycaps",
                      style: { color: e.text_main },
                      children: "screenshot gallery",
                    }),
                    y.length > 0 &&
                      _jsxs("div", {
                        className: "hidden sm:block text-[10px] tinycaps px-3 py-1 rounded-full",
                        style: {
                          background: `${e.purple}10`,
                          color: e.text_muted,
                          border: `1px solid ${e.purple}15`,
                        },
                        children: [y.length, " screenshot", y.length !== 1 ? "s" : ""],
                      }),
                  ],
                }),
                y.length > 0 &&
                  _jsxs("button", {
                    onClick: () => a("instances"),
                    className:
                      "group inline-flex items-center gap-1.5 px-4 py-2 rounded-xl transition-all hover:scale-105 shadow-md",
                    style: { background: `${e.purple}15` },
                    onMouseEnter: (E) => {
                      E.currentTarget.style.background = e.purple + "25";
                    },
                    onMouseLeave: (E) => {
                      E.currentTarget.style.background = e.purple + "15";
                    },
                    children: [
                      _jsx("span", {
                        className: "text-[11px] font-bold tinycaps",
                        style: { color: e.purple },
                        children: "View All",
                      }),
                      _jsx($i, {
                        size: 12,
                        style: { color: e.purple },
                        className: "group-hover:translate-x-0.5 transition-transform",
                      }),
                    ],
                  }),
              ],
            }),
            b
              ? _jsx("div", {
                  className: "flex items-center justify-center py-12",
                  children: _jsx(Ok, { size: 24, className: "animate-spin", style: { color: e.purple } }),
                })
              : y.length === 0
                ? _jsxs("div", {
                    className: "text-center py-12 rounded-3xl",
                    style: { background: `${e.bg_card}80`, border: `1px solid ${e.border}30` },
                    children: [
                      _jsx(Ii, {
                        size: 40,
                        className: "mx-auto mb-3 opacity-30",
                        style: { color: e.text_muted },
                      }),
                      _jsx("p", {
                        className: "text-sm font-medium mb-1",
                        style: { color: e.text_muted },
                        children: "No screenshots yet",
                      }),
                      _jsx("p", {
                        className: "text-xs",
                        style: { color: e.text_muted, opacity: 0.6 },
                        children: "Screenshots from your games will appear here",
                      }),
                    ],
                  })
                : _jsxs("div", {
                    className: "flex gap-4 overflow-x-auto pb-4 px-2",
                    style: { scrollbarWidth: "none", msOverflowStyle: "none" },
                    children: [
                      _jsx("style", {
                        children: `
                .hide-scrollbar::-webkit-scrollbar { display: none; }
                .hide-scrollbar { -ms-overflow-style: none; }
              `,
                      }),
                      _jsx("div", {
                        className: "flex gap-4 hide-scrollbar",
                        children: _jsx(Ke, {
                          children: y.slice(0, 16).map((E, k) =>
                            _jsxs(
                              O.div,
                              {
                                initial: { opacity: 0, scale: 0.85 },
                                animate: { opacity: 1, scale: 1 },
                                transition: { duration: 0.4, delay: k * 0.04, ease: [0.4, 0, 0.2, 1] },
                                whileHover: { scale: 1.08, y: -4 },
                                className:
                                  "group relative rounded-2xl overflow-hidden cursor-pointer shrink-0",
                                style: {
                                  width: 200,
                                  height: 140,
                                  border: `2px solid ${e.purple}30`,
                                  backdropFilter: "blur(12px)",
                                  WebkitBackdropFilter: "blur(12px)",
                                  boxShadow: `0 4px 16px ${e.purple}10`,
                                },
                                onMouseEnter: (M) => {
                                  ((M.currentTarget.style.borderColor = e.purple + "70"),
                                    (M.currentTarget.style.boxShadow = `0 8px 32px ${e.purple}30`));
                                },
                                onMouseLeave: (M) => {
                                  ((M.currentTarget.style.borderColor = e.purple + "30"),
                                    (M.currentTarget.style.boxShadow = `0 4px 16px ${e.purple}10`));
                                },
                                children: [
                                  _jsx("img", {
                                    src: Ni(E.path),
                                    alt: E.filename,
                                    className: "w-full h-full object-cover",
                                    loading: "lazy",
                                  }),
                                  _jsx("div", {
                                    className:
                                      "absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                                  }),
                                  _jsxs("div", {
                                    className:
                                      "absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300",
                                    children: [
                                      _jsx("div", {
                                        className: "text-[10px] font-bold truncate",
                                        style: { color: "#fff" },
                                        children: E.instance_name,
                                      }),
                                      _jsx("div", {
                                        className: "text-[9px]",
                                        style: { color: "rgba(255,255,255,0.7)" },
                                        children: (() => {
                                          try {
                                            return new Date(E.timestamp).toLocaleDateString();
                                          } catch {
                                            return "";
                                          }
                                        })(),
                                      }),
                                    ],
                                  }),
                                ],
                              },
                              `${E.instance_name}-${E.filename}`,
                            ),
                          ),
                        }),
                      }),
                    ],
                  }),
          ],
        }),
      t.length === 0 &&
        _jsxs(O.div, {
          initial: { opacity: 0, scale: 0.95 },
          animate: { opacity: 1, scale: 1 },
          className: "relative text-center py-16",
          children: [
            _jsxs("div", {
              className: "absolute inset-0 flex items-center justify-center",
              children: [
                _jsx("div", {
                  className: "w-80 h-80 rounded-full opacity-10 blur-3xl",
                  style: { background: e.accent },
                }),
                _jsx("div", {
                  className: "w-64 h-64 rounded-full opacity-10 blur-3xl",
                  style: { background: e.purple },
                }),
              ],
            }),
            _jsxs("div", {
              className: "relative space-y-8",
              children: [
                _jsx(O.div, {
                  initial: { scale: 0.8, opacity: 0 },
                  animate: { scale: 1, opacity: 1 },
                  transition: { delay: 0.2, type: "spring", stiffness: 300 },
                  className: "w-28 h-28 mx-auto mb-8 rounded-4xl flex items-center justify-center",
                  style: {
                    background: `${e.accent}10`,
                    border: `2px solid ${e.accent}20`,
                    boxShadow: `0 10px 40px ${e.accent}20`,
                  },
                  children: _jsx(Ja, { size: 48, style: { color: e.accent }, className: "drop-shadow-lg" }),
                }),
                _jsxs(O.div, {
                  initial: { opacity: 0, y: 10 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.4 },
                  children: [
                    _jsx("h3", {
                      className: "text-3xl font-bold tinycaps mb-3",
                      style: { color: e.text_main },
                      children: "no instances yet",
                    }),
                    _jsxs("p", {
                      className: "text-xs mb-4 max-w-md mx-auto tinycaps",
                      style: { color: e.text_muted },
                      children: [
                        "create your first Minecraft profile to start playing with ",
                        le,
                        "'s custom setup and personalized 3D player experience",
                      ],
                    }),
                  ],
                }),
                _jsx(O.div, {
                  initial: { opacity: 0, y: 10 },
                  animate: { opacity: 1, y: 0 },
                  transition: { delay: 0.6 },
                  whileHover: { scale: 1.05 },
                  whileTap: { scale: 0.95 },
                  children: _jsxs(V, {
                    onClick: () => a("instances"),
                    className: "inline-flex items-center gap-2 shadow-2xl",
                    children: [_jsx($n, { size: 16 }), " Create First Instance"],
                  }),
                }),
              ],
            }),
          ],
        }),
    ],
  });
}
