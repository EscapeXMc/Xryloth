"use client";

import React, { useEffect, useState } from "react";
import {
  getCachedImage,
  isRemoteImage,
  subscribeImageCache,
} from "../../lib/imageCache";

/**
 * Resolve `src` to its display URL: local cached asset when available,
 * original remote URL as last resort. Non-remote sources pass through
 * instantly. If the backend later revalidates and finds an updated copy,
 * the hook swaps to the new file automatically.
 */
export function useCachedImageUrl(src?: string | null): string | undefined {
  const [display, setDisplay] = useState<string | undefined>(() =>
    src && !isRemoteImage(src) ? src : undefined
  );

  useEffect(() => {
    if (!src) {
      setDisplay(undefined);
      return;
    }
    if (!isRemoteImage(src)) {
      setDisplay(src);
      return;
    }
    let alive = true;
    getCachedImage(src).then((u) => {
      if (alive) setDisplay(u);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    if (!src || !isRemoteImage(src)) return;
    return subscribeImageCache((url, d) => {
      if (url === src) setDisplay(d);
    });
  }, [src]);

  return display;
}

export interface CachedImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
}

/**
 * Drop-in `<img>` that serves remote images from the local disk cache.
 * - remote src: shows the local copy instantly (no webview re-download);
 *   while resolving, the element keeps its CSS box (no src attribute).
 * - if the local asset fails to load, falls back to the original remote URL
 *   once; if that also fails, the caller's onError runs (same contract as
 *   a plain <img>), so existing hide-on-error handlers keep working.
 */
export function CachedImage({ src, ...rest }: CachedImageProps) {
  const display = useCachedImageUrl(src);
  const original = src || undefined;

  return (
    <img
      {...rest}
      src={display}
      data-cache="1"
      onError={(e) => {
        const el = e.currentTarget;
        const triedRemote =
          !original || display === original || el.dataset.fb === "1";
        if (!triedRemote) {
          el.dataset.fb = "1";
          el.src = original;
          return;
        }
        const userOnError = rest.onError as
          | ((ev: React.SyntheticEvent<HTMLImageElement, Event>) => void)
          | undefined;
        if (userOnError) userOnError(e);
      }}
    />
  );
}
