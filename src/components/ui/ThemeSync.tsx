import { useEffect } from "react";
import { useLauncherStore } from "../../stores";

/**
 * Writes the active theme into the CSS custom properties the design system in
 * `index.css` reads (`.glass-card`, `.panel-dark`, `.outline-btn`, ...).
 *
 * Those classes are used on every page, so this is what makes a theme change
 * reach the whole app — the pages themselves keep using their own inline
 * styles for the parts that are already theme-aware.
 */
export function ThemeSync() {
  const { themeColors } = useLauncherStore();

  useEffect(() => {
    const root = document.documentElement;
    const set = (name: string, value: string) => root.style.setProperty(name, value);

    set("--x-accent", themeColors.accent);
    set("--x-accent2", themeColors.accent2);
    set("--x-accent-text", themeColors.accent_text);
    set("--x-text", themeColors.text_main);
    set("--x-text-sub", themeColors.text_sub);
    set("--x-text-muted", themeColors.text_muted);
    set("--x-border", themeColors.border);
    set("--x-border-soft", `${themeColors.accent}38`);
    set("--x-surface", `${themeColors.bg_card}66`);
    set("--x-surface-hover", `${themeColors.bg_hover}99`);
    set("--x-trace", `${themeColors.border}aa`);
    set("--x-trace-strong", `${themeColors.border_bright}cc`);
  }, [themeColors]);

  return null;
}
