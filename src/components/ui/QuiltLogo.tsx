"use client";

import React from "react";

interface QuiltLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function QuiltLogo({ size = 32, ...props }: QuiltLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      {...props}
    >
      <defs>
        <style>{`
          .stitch { fill: none; stroke: #c4b5a3; stroke-width: 0.5; stroke-linecap: round; }
          .patch-a { fill: #f3e7d7; }
          .patch-b { fill: #d4c3af; }
          .patch-c { fill: #e0d1bd; }
          .patch-d { fill: #c8b7a1; }
          .accent { fill: #e06b22; }
        `}</style>
      </defs>
      <rect x="1" y="1" width="14" height="14" rx="1" className="patch-a" />
      <rect x="3" y="3" width="4" height="4" className="patch-b" />
      <rect x="9" y="3" width="4" height="4" className="patch-c" />
      <rect x="3" y="9" width="4" height="4" className="patch-c" />
      <rect x="9" y="9" width="4" height="4" className="patch-d" />
      <rect x="7" y="7" width="2" height="2" className="accent" />
      <line x1="7" y1="7" x2="7" y2="9" className="stitch" />
      <line x1="7" y1="7" x2="9" y2="7" className="stitch" />
      <line x1="7" y1="9" x2="9" y2="9" className="stitch" />
      <line x1="9" y1="7" x2="9" y2="9" className="stitch" />
      <line x1="1" y1="5" x2="15" y2="5" className="stitch" />
      <line x1="1" y1="11" x2="15" y2="11" className="stitch" />
      <line x1="5" y1="1" x2="5" y2="15" className="stitch" />
      <line x1="11" y1="1" x2="11" y2="15" className="stitch" />
    </svg>
  );
}
