"use client";

import React from "react";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function GlassCard({
  children,
  className,
  hover = false,
  glow = false,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={`
        relative rounded-xl p-4 transition-all duration-200
        bg-[#13161C]/80 backdrop-blur-md border border-white/5
        hover:bg-[#161922]/80 hover:border-white/10
        ${hover ? "hover:shadow-[0_0_30px_rgba(224,107,34,0.1)]" : ""}
        ${glow ? "shadow-[0_0_20px_rgba(224,107,34,0.15)]" : ""}
        ${className ?? ""}
      `}
      {...props}
    >
      {children}
    </div>
  );
}