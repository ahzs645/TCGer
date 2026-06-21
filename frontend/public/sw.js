/**
 * TCGer service worker — offline-first PWA + server-free scanner assets.
 *
 * Caching strategy:
 *   - scan-index manifest  → network-first (so an index version bump is picked
 *                            up), cache fallback when offline.
 *   - scan-index artifacts → cache-first (immutable per version; the loader
 *                            re-fetches a new file name / re-validates by version).
 *   - model + wasm + OCR   → cache-first (DINOv2 ONNX, ORT wasm, Tesseract from
 *                            CDNs; opaque responses allowed) → fully offline scan.
 *   - navigations          → network-first with cached app-shell fallback.
 *
 * Bump CACHE_VERSION to roll all caches.
 */

const CACHE_VERSION = "tcger-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const SCAN_CACHE = `${CACHE_VERSION}-scan`;
const MODEL_CACHE = `${CACHE_VERSION}-model`;

const APP_SHELL = ["/", "/scan", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isModelAsset(url) {
  return (
    /huggingface\.co|hf\.co|cdn-lfs|jsdelivr\.net|unpkg\.com/.test(url.host) ||
    url.pathname.includes("/models/") ||
    url.pathname.includes("ort-wasm") ||
    url.pathname.includes("tesseract") ||
    /\.(onnx|wasm)(\?|$)/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname === "/scan-index/manifest.json") {
    event.respondWith(networkFirst(req, SCAN_CACHE));
    return;
  }
  if (url.pathname.startsWith("/scan-index/")) {
    event.respondWith(cacheFirst(req, SCAN_CACHE));
    return;
  }
  if (isModelAsset(url)) {
    event.respondWith(cacheFirst(req, MODEL_CACHE));
    return;
  }
  if (url.origin === self.location.origin && req.mode === "navigate") {
    event.respondWith(networkFirst(req, STATIC_CACHE));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const fallback = await cache.match(req);
    if (fallback) return fallback;
    throw err;
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const fallback = await cache.match(req);
    if (fallback) return fallback;
    throw err;
  }
}
