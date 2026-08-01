"use client";

import { useEffect } from "react";
import { CATALOG_ROOT } from "@/lib/catalog/catalog-assets";

/**
 * Registers the PWA service worker (offline-first scanner assets + installable
 * app). Production-only to avoid caching the dev server. Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      const catalogRoot = new URL(CATALOG_ROOT, window.location.origin);
      const workerUrl = new URL("/sw.js", window.location.origin);
      workerUrl.searchParams.set("catalogOrigin", catalogRoot.origin);
      workerUrl.searchParams.set("catalogPath", catalogRoot.pathname);
      navigator.serviceWorker
        .register(`${workerUrl.pathname}${workerUrl.search}`)
        .catch(() => {
          // SW registration is best-effort; the app works without it.
        });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
