"use client";

import React from "react";

export interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "fast-danger";
  fullWidth?: boolean;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function GlowButton({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  ...props
}: GlowButtonProps) {
  const base = `
    flex items-center justify-center gap-2
    font-bold tinycaps transition-all duration-200
    transform active:scale-95 disabled:opacity-50
  `;

  const variants = {
    primary: `bg-gradient-to-r from-xryloth-500 to-xryloth-900 text-xryloth-accent_text shadow-[0_10px_28px_-8px_rgba(224,107,34,0.5),0_0_20px_rgba(224,107,34,0.22),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-3px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_14px_34px_-8px_rgba(224,107,34,0.65),0_0_28px_rgba(224,107,34,0.35),inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-3px_8px_rgba(0,0,0,0.3)] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.45)]`,
    secondary: `bg-[#13161C]/60 border border-white/10 text-white hover:bg-white/10 clay-btn`,
    ghost: `bg-transparent text-xryloth-400 hover:text-white hover:bg-white/10 clay-btn`,
    danger: `bg-[#7f1d1d]/50 border border-red-500/30 text-red-400 hover:bg-[#7f1d1d]/80 clay-btn`,
    "fast-danger": `bg-[#e06b22]/20 border border-fast-accent/30 text-fast-accent hover:bg-[#e06b22]/40 clay-btn`,
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} rounded-xl ${className}`}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l-1.16 1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808l1.16-1.634a7.96 7.96 0 00-1.11-2.596zm8.075-2.596c.57-1.271.92-2.444.92-3.808 0-1.366-.35-2.648-.92-3.808l-1.16 1.634c.705.928 1.11 2.147 1.11 3.563 0 1.366-.35 2.648-.92 3.808l-1.16-1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808l1.16-1.634c-.705-.928-1.11-2.147-1.11-3.563 0-1.366.35-2.648.92-3.808z"
          ></path>
        </svg>
      )}
      {children}
    </button>
  );
}