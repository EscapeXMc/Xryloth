import { motion } from "framer-motion";
import { useState } from "react";
import { useLauncherStore } from "../../stores";
import type { ReactNode } from "react";

interface GlowButtonProps {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

/**
 * The launcher's button system.
 *
 * Monochrome by design (on the default `black` theme):
 *   primary   — solid white, bold obsidian text. The one loud element on screen.
 *   secondary — white outline on the dark panel; inverts to white fill on hover.
 *   danger    — the only place colour is allowed, because it means "destructive".
 *
 * The white fill is `themeColors.accent` and the text on it is
 * `themeColors.accent_text`, so switching to another theme still produces a
 * legible pair rather than a hardcoded white-on-white.
 */
export function GlowButton({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled = false,
  className = "",
  fullWidth = false,
  style,
}: GlowButtonProps) {
  const { themeColors } = useLauncherStore();
  const [hovered, setHovered] = useState(false);

  const offWhite = themeColors.accent2 || "#e4e4e7";

  const variants: Record<string, { bg: string; bgHover: string; color: string; border: string; borderHover: string; shadow: string; shadowHover: string }> = {
    primary: {
      bg: `linear-gradient(135deg, ${themeColors.accent} 0%, ${offWhite} 100%)`,
      bgHover: `linear-gradient(135deg, #ffffff 0%, ${themeColors.accent} 100%)`,
      color: themeColors.accent_text,
      border: `${themeColors.accent}00`,
      borderHover: `${themeColors.accent}00`,
      shadow: `0 4px 18px rgba(0,0,0,0.4)`,
      shadowHover: `0 6px 26px rgba(0,0,0,0.45), 0 0 0 3px ${themeColors.accent}1f`,
    },
    secondary: {
      bg: "transparent",
      bgHover: themeColors.accent,
      color: themeColors.text_main,
      border: `${themeColors.accent}47`,
      borderHover: themeColors.accent,
      shadow: "none",
      shadowHover: `0 0 0 3px ${themeColors.accent}14`,
    },
    danger: {
      bg: `linear-gradient(135deg, ${themeColors.danger} 0%, ${themeColors.danger}cc 100%)`,
      bgHover: `linear-gradient(135deg, ${themeColors.danger} 0%, ${themeColors.danger} 100%)`,
      color: "#ffffff",
      border: `${themeColors.danger}00`,
      borderHover: `${themeColors.danger}00`,
      shadow: `0 4px 18px ${themeColors.danger}30`,
      shadowHover: `0 6px 26px ${themeColors.danger}45`,
    },
  };

  const sizes: Record<string, string> = {
    sm: "px-3.5 py-1.5 text-[11px] rounded-xl",
    md: "px-5 py-2.5 text-[12px] rounded-xl",
    lg: "px-8 py-3.5 text-sm rounded-2xl",
  };

  const v = variants[variant];

  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`tinycaps font-bold transition-all duration-200 relative overflow-hidden ${sizes[size]} ${fullWidth ? "w-full" : ""} ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      style={{
        background: hovered && !disabled ? v.bgHover : v.bg,
        color: hovered && !disabled && variant === "secondary" ? themeColors.accent_text : v.color,
        border: `1px solid ${hovered && !disabled ? v.borderHover : v.border}`,
        boxShadow: disabled ? "none" : hovered ? v.shadowHover : v.shadow,
        backdropFilter: variant === "secondary" ? "blur(12px)" : undefined,
        WebkitBackdropFilter: variant === "secondary" ? "blur(12px)" : undefined,
        ...style,
      }}
    >
      <span className="relative z-10 flex items-center justify-center gap-1.5">{children}</span>
    </motion.button>
  );
}
