"use client";

import React from "react";

interface ForgeLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function ForgeLogo({ size = 32, ...props }: ForgeLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 1000"
      width={size}
      height={size}
      className="drop-shadow-2xl"
      {...props}
    >
      <defs>
        <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#334155"></stop>
          <stop offset="50%" stop-color="#0f172a"></stop>
          <stop offset="100%" stop-color="#020617"></stop>
        </linearGradient>
        <linearGradient id="amberGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f59e0b"></stop>
          <stop offset="100%" stop-color="#b45309"></stop>
        </linearGradient>
      </defs>
      <g id="anvilGroup" fill="#111827" transform="translate(0, 200)">
        <path d="
            M 180 200 
            C 180 188, 190 180, 202 180
            L 580 180 
            C 585 180, 590 183, 590 188
            C 590 193, 585 198, 580 198
            L 550 198
            L 550 205
            C 610 205, 730 200, 920 220
            C 935 222, 940 228, 925 235
            C 840 270, 720 300, 580 305
            C 530 307, 495 340, 510 400
            C 520 435, 545 470, 600 480
            C 610 482, 615 490, 615 500
            L 615 530
            C 615 538, 608 545, 600 545
            L 490 545
            C 480 545, 475 535, 475 525
            C 475 500, 460 480, 420 480
            C 380 480, 365 500, 365 525
            C 365 535, 360 545, 350 545
            L 240 545
            C 232 545, 225 538, 225 530
            L 225 500
            C 225 490, 230 482, 240 480
            C 295 470, 320 435, 330 400
            C 345 340, 310 307, 260 305
            C 180 300, 120 280, 80 260
            C 68 254, 68 240, 80 235
            C 100 228, 140 215, 180 200
            Z
        "></path>
        <path fill="#ffffff" className="svg-cutout" d="
            M 205 192 
            L 575 192 
            C 578 192, 580 194, 578 196 
            L 202 196 
            C 200 194, 202 192, 205 192 
            Z
        " opacity="0.9"></path>
        <path fill="#ffffff" className="svg-cutout" d="
            M 100 250
            C 140 268, 195 288, 270 292
            C 328 295, 368 335, 350 408
            C 342 438, 320 465, 270 475
            C 255 478, 245 485, 242 495
            C 240 482, 252 472, 265 468
            C 310 458, 330 432, 338 402
            C 354 332, 318 285, 262 282
            C 190 278, 135 258, 95 240
            C 90 238, 95 248, 100 250
            Z
        "></path>
        <path fill="#ffffff" className="svg-cutout" d="
            M 890 232
            C 730 215, 620 212, 565 212
            C 560 212, 558 215, 562 218
            C 615 220, 720 225, 870 242
            C 885 244, 895 238, 890 232
            Z
        "></path>
        <path fill="#ffffff" className="svg-cutout" d="
            M 870 248
            C 735 280, 615 295, 570 292
            C 512 288, 476 332, 490 408
            C 498 438, 520 465, 570 475
            C 585 478, 595 485, 598 495
            C 600 482, 588 472, 575 468
            C 530 458, 510 432, 502 402
            C 486 332, 522 282, 578 282
            C 625 285, 740 270, 875 238
            C 882 236, 880 245, 870 248
            Z
        "></path>
        <path fill="#ffffff" className="svg-cutout" d="
            M 375 528
            C 375 508, 388 492, 420 492
            C 452 492, 465 508, 465 528
            C 465 533, 470 535, 473 528
            C 473 502, 455 482, 420 482
            C 385 482, 367 502, 367 528
            C 367 535, 375 533, 375 528
            Z
        "></path>
      </g>
    </svg>
  );
}
