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
import { API_BASE_URL as DEMO_API_BASE_URL } from './api/base-url';

const STORAGE_KEY = 'tcg-demo-mode';

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
  if (url.startsWith(DEMO_API_BASE_URL)) {
    const path = url.slice(DEMO_API_BASE_URL.length); // e.g. "/auth/login"
    const method = init?.method?.toUpperCase() ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    return handleDemoRequest(method, path, body);
  }

  // Intercept Better Auth session requests so they don't hang on GitHub Pages
  // where no backend server exists.  Better Auth uses /api/auth/* endpoints.
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/api/auth/')) {
      return handleBetterAuthDemo(parsed.pathname);
    }
  } catch {
    // relative URL or parse failure — ignore
  }

  // Everything else goes through the real fetch
  return realFetch!(input, init);
}

/**
 * Stub handler for Better Auth endpoints in demo mode.
 * Returns minimal valid responses so the auth client resolves quickly
 * instead of hanging on a missing server.
 */
function handleBetterAuthDemo(pathname: string): Promise<Response> {
  const jsonResponse = (data: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    );

  if (pathname.includes('get-session')) {
    return jsonResponse({ session: null, user: null });
  }

  // Default: return empty OK for any other auth endpoint
  return jsonResponse({});
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
