/**
 * Demo fetch interceptor.
 *
 * When demo mode is active, this module monkey-patches `globalThis.fetch` so
 * that any request whose URL starts with the API base URL is handled locally
 * by the demo route handler instead of hitting the network.  All other
 * requests (CDN images, Next.js internals, etc.) pass through to the real
 * fetch untouched.
 *
 * This means the API files (auth.ts, collections.ts, …) don't need any
 * demo-mode awareness at all — they just call `fetch()` normally and get
 * back a real `Response` object.
 */

import { handleDemoRequest } from './api/demo-adapter';

const STORAGE_KEY = 'tcg-demo-mode';

const API_BASE_URL = (
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000')
    : 'http://localhost:3000'
).replace(/\/$/, '');

/* ------------------------------------------------------------------ */
/*  Demo-mode flag                                                      */
/* ------------------------------------------------------------------ */

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setDemoMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) {
    localStorage.setItem(STORAGE_KEY, 'true');
    installInterceptor();
  } else {
    localStorage.removeItem(STORAGE_KEY);
    uninstallInterceptor();
  }
}

/* ------------------------------------------------------------------ */
/*  Fetch interceptor                                                   */
/* ------------------------------------------------------------------ */

let realFetch: typeof globalThis.fetch | null = null;

function interceptedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

  // Only intercept requests to our API base URL
  if (url.startsWith(API_BASE_URL)) {
    const path = url.slice(API_BASE_URL.length); // e.g. "/auth/login"
    const method = init?.method?.toUpperCase() ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    return handleDemoRequest(method, path, body);
  }

  // Everything else goes through the real fetch
  return realFetch!(input, init);
}

function installInterceptor(): void {
  if (typeof window === 'undefined') return;
  if (realFetch) return; // already installed
  realFetch = globalThis.fetch;
  globalThis.fetch = interceptedFetch;
}

function uninstallInterceptor(): void {
  if (typeof window === 'undefined') return;
  if (!realFetch) return;
  globalThis.fetch = realFetch;
  realFetch = null;
}

/**
 * Call once on app startup (e.g. in a top-level layout effect) to re-install
 * the interceptor if the user was already in demo mode from a previous session.
 */
export function ensureDemoInterceptor(): void {
  if (isDemoMode()) {
    installInterceptor();
  }
}
