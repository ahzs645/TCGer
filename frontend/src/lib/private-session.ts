import { useAuthStore } from "@/stores/auth";
import { API_BASE_URL } from "@/lib/api/base-url";

/** An in-memory generation also rejects A → B → A and credential rotation. */
let generation = 0;
const listeners = new Set<() => void>();

export class SessionChangedError extends Error {
  constructor() {
    super(
      "The account or server changed. Reopen this action in the current session.",
    );
    this.name = "SessionChangedError";
  }
}

export function privateSessionGeneration(): number {
  return generation;
}

export function subscribePrivateSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function capturePrivateSession(token?: string | null) {
  const initial = useAuthStore.getState();
  const origin = {
    generation,
    server: API_BASE_URL,
    userId: initial.user?.id,
    token: initial.token,
    authenticated: initial.isAuthenticated,
  };
  const current = () => {
    const auth = useAuthStore.getState();
    return (
      origin.generation === generation &&
      origin.server === API_BASE_URL &&
      origin.userId === auth.user?.id &&
      origin.token === auth.token &&
      origin.authenticated === auth.isAuthenticated &&
      (token === undefined || token === auth.token)
    );
  };
  return {
    user: initial.user,
    current,
    assertCurrent() {
      if (!current()) throw new SessionChangedError();
    },
  };
}

export type PrivateSession = ReturnType<typeof capturePrivateSession>;

/** Every store publication, including catch/finally, uses the captured session. */
export function sessionSetter<T extends (...args: never[]) => unknown>(
  publish: T,
  session: PrivateSession,
): T {
  return ((...args: Parameters<T>) => {
    if (session.current()) return publish(...args);
  }) as T;
}

useAuthStore.subscribe((state, previous) => {
  if (
    state.user?.id === previous.user?.id &&
    state.token === previous.token &&
    state.isAuthenticated === previous.isAuthenticated
  )
    return;
  generation += 1;
  for (const listener of [...listeners]) listener();
});
