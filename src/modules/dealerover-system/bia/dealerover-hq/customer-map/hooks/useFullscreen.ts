"use client";

import * as React from "react";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * True browser fullscreen for a caller-owned element (not just full-bleed layout).
 *
 * Takes the element to fullscreen as a parameter (null until mounted), the
 * current `isFullscreen` state (kept in sync when the user exits with Esc),
 * and a `toggle`. Vendor-prefixed Safari APIs are handled; calls are wrapped
 * so an unsupported/denied request is a no-op. A synthetic `resize` is
 * dispatched on toggle so MapLibre refits its canvas.
 */
export function useFullscreen<T extends HTMLElement>(element: T | null) {
  const elementRef = React.useRef<T | null>(null);
  React.useEffect(() => {
    elementRef.current = element;
  }, [element]);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  React.useEffect(() => {
    const onChange = () => {
      const doc = document as FullscreenDocument;
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      setIsFullscreen(Boolean(active) && active === elementRef.current);
      window.dispatchEvent(new Event("resize"));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = React.useCallback(async () => {
    const target = elementRef.current;
    if (!target) return;
    const doc = document as FullscreenDocument;
    const fullscreenTarget = target as FullscreenElement;
    try {
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      if (active) {
        await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      } else {
        await (fullscreenTarget.requestFullscreen?.() ?? fullscreenTarget.webkitRequestFullscreen?.());
      }
    } catch {
      // Unsupported or denied — leave state unchanged.
    }
    window.dispatchEvent(new Event("resize"));
  }, []);

  return { isFullscreen, toggle };
}
