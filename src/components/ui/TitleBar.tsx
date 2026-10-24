import { appWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useLauncherStore } from "../../stores";
import { Minus, Square, X, Sun, Moon, User } from "lucide-react";
import { getSession, onSessionChanged, type XrylothSession } from "../../lib/auth";

const FALLBACK_AVATAR = "https://mc-heads.net/avatar/8660ba3e76424a96b46f0b738fcc8806?size=64";

function avatarUrl(uuid?: string) {
  const t = (uuid || "").replace(/-/g, "");
  return t.length === 32 ? `https://mc-heads.net/avatar/${t}?size=64` : FALLBACK_AVATAR;
}

/**
 * Title bar: brand on the left, account + window controls on the right.
 *
 * Everything here is a white-on-black trace — 1px hairlines at
 * `rgba(255,255,255,0.15)` around glass, pure white icons, no colour except the
 * red close button (where colour carries meaning).
 */
export function TitleBar() {
  const { themeColors, liveVersion, themeMode, setThemeMode, settings } = useLauncherStore();
  const [session, setSession] = useState<XrylothSession | null>(() => getSession());
  const [avatarOk, setAvatarOk] = useState(true);

  useEffect(() => onSessionChanged(setSession), []);

  const username = settings.username || settings.cracked_username || settings.ely_by_username || session?.username || "player";
  const uuid = settings.mc_uuid || settings.ely_uuid || "";

  const control = "w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-white/10";

  return (
    <div data-tauri-drag-region className="flex items-center justify-between h-10 px-3 shrink-0 select-none relative"
      style={{
        background: `${themeColors.bg_nav}d9`,
        borderBottom: `1px solid ${themeColors.border}`,
        backdropFilter: "blur(32px) saturate(1.4)",
        WebkitBackdropFilter: "blur(32px) saturate(1.4)",
      }}>
      <div className="absolute bottom-0 left-0 right-0 h-px" style={{
        background: `linear-gradient(90deg, transparent, ${themeColors.border_bright}, ${themeColors.border}, transparent)`,
      }} />

      {/* Brand — crisp white mark + bold typography + the live release tag */}
      <div className="flex items-center gap-2.5 ml-0.5" data-tauri-drag-region>
        <img
          src="/logo.png"
          alt="Xryloth"
          className="w-[22px] h-[22px] object-contain rounded-md"
          style={{ boxShadow: `0 0 0 1px ${themeColors.accent}26` }}
        />
        <div className="leading-none" data-tauri-drag-region>
          <span className="tinycaps text-[11px] font-black tracking-[0.18em]" style={{ color: themeColors.text_main }}>XRYLOTH</span>
          <span className="tinycaps text-[9px] font-bold tracking-[0.28em] ml-1.5" style={{ color: themeColors.text_muted }}>CLIENT</span>
        </div>
        <span
          className="tinycaps text-[9px] font-bold tracking-[0.12em] px-2 py-[3px] rounded-md"
          style={{ color: themeColors.text_sub, border: `1px solid ${themeColors.border}`, background: `${themeColors.bg_card2}` }}
          title="Live release version"
        >
          v{liveVersion}
        </span>
      </div>

      {/* Account badge + window controls */}
      <div className="flex items-center gap-2">
        {!username && (
          <button
            onClick={() => useLauncherStore.getState().setPage("accounts")}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold tinycaps tracking-[0.12em] transition-all duration-200"
            style={{
              background: `linear-gradient(135deg, ${themeColors.accent} 0%, ${themeColors.accent2} 100%)`,
              color: themeColors.accent_text,
              boxShadow: `0 4px 16px ${themeColors.accent}30`,
            }}
            title="Sign in to your Xryloth account"
          >
            SIGN IN
          </button>
        )}

        <button
          onClick={() => useLauncherStore.getState().setPage("accounts")}
          className="hidden sm:flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-xl transition-all duration-200 hover:bg-white/[0.06]"
          style={{ background: `${themeColors.bg_card2}`, border: `1px solid ${themeColors.border_bright}` }}
          title="Accounts & skins"
        >
          {avatarOk ? (
            <img
              src={avatarUrl(uuid)}
              alt=""
              className="w-[22px] h-[22px] rounded-lg"
              style={{ imageRendering: "pixelated", border: `1px solid ${themeColors.border_bright}` }}
              onError={() => setAvatarOk(false)}
            />
          ) : (
            <span className="w-[22px] h-[22px] rounded-lg flex items-center justify-center" style={{ background: `${themeColors.bg_hover}aa` }}>
              <User size={12} style={{ color: themeColors.text_sub }} />
            </span>
          )}
          <span className="text-[11px] font-semibold max-w-[110px] truncate" style={{ color: themeColors.text_main }}>{username}</span>
        </button>

        <span className="w-px h-5" style={{ background: `${themeColors.border}` }} />

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            className={control}
            title={themeMode === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {themeMode === "dark" ? (
              <Sun size={12} style={{ color: themeColors.text_sub }} />
            ) : (
              <Moon size={12} style={{ color: themeColors.text_sub }} />
            )}
          </button>
          <button onClick={() => appWindow.minimize()} className={control} title="Minimise">
            <Minus size={13} style={{ color: themeColors.text_main }} />
          </button>
          <button onClick={() => appWindow.toggleMaximize()} className={control} title="Maximise">
            <Square size={9} style={{ color: themeColors.text_main }} />
          </button>
          <button onClick={() => appWindow.close()} className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-red-500/80" title="Close">
            <X size={13} style={{ color: themeColors.text_main }} />
          </button>
        </div>
      </div>
    </div>
  );
}
