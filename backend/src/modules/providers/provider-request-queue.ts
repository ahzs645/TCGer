export interface ProviderRequestPolicy {
  minIntervalMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
}

interface ProviderState {
  chain: Promise<void>;
  nextRequestAt: number;
  cooldownUntil: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const states = new Map<string, ProviderState>();

function stateFor(provider: string): ProviderState {
  const existing = states.get(provider);
  if (existing) return existing;
  const created = { chain: Promise.resolve(), nextRequestAt: 0, cooldownUntil: 0 };
  states.set(provider, created);
  return created;
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

async function reserveRequest(provider: string, minIntervalMs: number): Promise<ProviderState> {
  const state = stateFor(provider);
  const turn = state.chain.then(async () => {
    const waitUntil = Math.max(state.nextRequestAt, state.cooldownUntil);
    await delay(waitUntil - Date.now());
    state.nextRequestAt = Date.now() + minIntervalMs;
  });
  state.chain = turn.catch(() => undefined);
  await turn;
  return state;
}

/**
 * Applies one shared schedule and cooldown to every request for a provider.
 * 429 and transient 5xx responses are retried, honoring Retry-After when sent.
 */
export async function fetchWithProviderPolicy(
  provider: string,
  input: string | URL,
  init: RequestInit = {},
  policy: ProviderRequestPolicy = {},
): Promise<Response> {
  const minIntervalMs = Math.max(0, policy.minIntervalMs ?? 0);
  const maxRetries = Math.max(0, policy.maxRetries ?? 2);
  const retryBaseMs = Math.max(50, policy.retryBaseMs ?? 500);
  const timeoutMs = Math.max(250, policy.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  for (let attempt = 0; ; attempt += 1) {
    const state = await reserveRequest(provider, minIntervalMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      const retryable =
        response.status === 429 || response.status === 408 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) return response;

      const retryAfter = retryAfterMilliseconds(response.headers.get('retry-after'));
      const backoff = retryAfter ?? retryBaseMs * 2 ** attempt;
      state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + backoff);
      // Release the response body before retrying on runtimes with limited pools.
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + retryBaseMs * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function resetProviderRequestQueuesForTests(): void {
  states.clear();
}
