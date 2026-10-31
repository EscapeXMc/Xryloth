"use client";

import React from "react";

interface OptifineLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function OptifineLogo({ size = 32, ...props }: OptifineLogoProps) {
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
          .gold { fill: #e1a000; }
          .shadow { fill: #45151b; }
        `}</style>
      </defs>
      <g>
        <rect x="4" y="4" width="3" height="1" className="gold" />
        <rect x="3" y="5" width="1" height="6" className="gold" />
        <rect x="6" y="5" width="1" height="6" className="gold" />
        <rect x="4" y="11" width="3" height="1" className="gold" />
        <rect x="4" y="5" width="2" height="1" className="shadow" />
        <rect x="3" y="11" width="1" height="1" className="shadow" />
        <rect x="4" y="12" width="3" height="1" className="shadow" />
        <rect x="7" y="11" width="1" height="1" className="shadow" />
        <rect x="9" y="4" width="4" height="1" className="gold" />
        <rect x="9" y="5" width="1" height="7" className="gold" />
        <rect x="10" y="5" width="1" height="2" className="gold" />
        <rect x="10" y="7" width="2" height="1" className="gold" />
        <rect x="11" y="5" width="2" height="1" className="shadow" />
        <rect x="10" y="8" width="1" height="1" className="shadow" />
        <rect x="9" y="12" width="1" height="1" className="shadow" />
      </g>
    </svg>
  );
}
