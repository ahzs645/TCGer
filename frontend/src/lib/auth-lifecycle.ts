import { useAuthStore, type AuthUser } from "@/stores/auth";
import { SessionChangedError } from "@/lib/private-session";

// Auth requests precede a private session, so they need their own intent fence.
// In particular, clearing an already-signed-out store must cancel a pending login.
let epoch = 0;
let revision = 0;
let transitionActive = false;
let signedOut = false;
let publishing = false;
let approved: { userId: string; token: string } | null | undefined;
let mutationQueue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function notify() {
  revision += 1;
  for (const listener of [...listeners]) listener();
}

export const authLifecycleRevision = () => revision;
export function subscribeAuthLifecycle(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function writeAuth(write: () => void) {
  publishing = true;
  try {
    write();
  } finally {
    publishing = false;
  }
}

/** Last user intent wins; serialize cookie mutations so the last one also wins on the server. */
export function beginAuthAction(kind: "signin" | "signout") {
  const origin = ++epoch;
  transitionActive = true;
  signedOut = kind === "signout";
  approved = undefined;
  if (kind === "signout") writeAuth(() => useAuthStore.getState().clearAuth());
  notify();
  const current = () => epoch === origin;
  const assertCurrent = () => {
    if (!current()) throw new SessionChangedError();
  };
  return {
    current,
    assertCurrent,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const task = mutationQueue
        .catch(() => undefined)
        .then(async () => {
          assertCurrent();
          try {
            const result = await operation();
            assertCurrent();
            return result;
          } catch (error) {
            assertCurrent();
            throw error;
          }
        });
      mutationQueue = task.catch(() => undefined);
      return task;
    },
    accept(user: AuthUser, token?: string) {
      assertCurrent();
      transitionActive = false;
      signedOut = false;
      approved = token ? { userId: user.id, token } : undefined;
      writeAuth(() => useAuthStore.getState().setAuth(user, token));
      notify();
    },
    finish() {
      if (!current()) return;
      transitionActive = false;
      if (signedOut) approved = null;
      notify();
    },
  };
}

export function canSynchronizeAuthSession(
  userId?: string,
  token?: string,
): boolean {
  if (transitionActive || approved === undefined) return false;
  return approved === null
    ? !userId && !token
    : !signedOut && approved.userId === userId && approved.token === token;
}

/** Only responses fetched for the current intent can feed Better Auth's session hook. */
export async function authLifecycleFetch(
  delegate: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const origin = epoch;
  const assertCurrent = () => {
    if (origin !== epoch) throw new SessionChangedError();
  };
  const url = String(input instanceof Request ? input.url : input);
  const isSession = /\/get-session(?:\?|$)/.test(url);
  if (isSession && transitionActive) throw new SessionChangedError();
  try {
    const response = await delegate(input, init);
    assertCurrent();
    if (isSession && response.ok) {
      const payload = (await response.clone().json()) as {
        needsRefresh?: boolean;
        user?: { id?: string } | null;
        session?: { token?: string } | null;
      } | null;
      assertCurrent();
      if (transitionActive) throw new SessionChangedError();
      const userId = payload?.user?.id;
      const token = payload?.session?.token;
      if (signedOut && userId) throw new SessionChangedError();
      if (!payload?.needsRefresh) {
        approved = userId && token ? { userId, token } : null;
        notify();
      }
    } else if (isSession && response.status === 401) {
      approved = null;
      notify();
    }
    const protect = (value: Response): Response =>
      new Proxy(value, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          if (property === "clone") return () => protect(target.clone());
          if (
            [
              "json",
              "text",
              "blob",
              "arrayBuffer",
              "formData",
              "bytes",
            ].includes(String(property)) &&
            typeof member === "function"
          ) {
            return async (...args: unknown[]) => {
              const result = await member.apply(target, args);
              assertCurrent();
              return result;
            };
          }
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
    return protect(response);
  } catch (error) {
    assertCurrent();
    throw error;
  }
}

useAuthStore.subscribe((state, previous) => {
  if (
    publishing ||
    (state.user?.id === previous.user?.id &&
      state.token === previous.token &&
      state.isAuthenticated === previous.isAuthenticated)
  )
    return;
  epoch += 1;
  transitionActive = false;
  signedOut = !state.isAuthenticated;
  approved =
    state.user && state.token
      ? { userId: state.user.id, token: state.token }
      : null;
  notify();
});
