import { publishInventoryChange } from "@/lib/inventory-events";
import {
  capturePrivateSession,
  SessionChangedError,
} from "@/lib/private-session";
import { useAuthStore } from "@/stores/auth";

/**
 * Bind private HTTP work to its originating account, including delayed JSON/blob
 * decoding. Cancellation is an optimization; this identity check is the boundary.
 */
export async function sessionFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const session = capturePrivateSession();
  const auth = useAuthStore.getState();
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const authorization = headers.get("Authorization");
  if (
    (auth.isAuthenticated || typeof window !== "undefined") &&
    authorization?.startsWith("Bearer ") &&
    authorization.slice(7) !== auth.token
  ) {
    throw new SessionChangedError();
  }
  const checkResponse = (response: Response): Response =>
    new Proxy(response, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === "clone") return () => checkResponse(target.clone());
        if (
          ["json", "text", "blob", "arrayBuffer", "formData", "bytes"].includes(
            String(property),
          ) &&
          typeof value === "function"
        ) {
          return async (...args: unknown[]) => {
            try {
              const result = await value.apply(target, args);
              session.assertCurrent();
              return result;
            } catch (error) {
              session.assertCurrent();
              throw error;
            }
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  try {
    const response = await fetch(input, init);
    session.assertCurrent();
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const url = String(input instanceof Request ? input.url : input);
    if (
      response.ok &&
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      /\/(collections|sealed|finance|trades|decks|backups)(?:\/|\?|$)/.test(
        url,
      ) &&
      !/\/(preview|export|template)(?:\?|$)/.test(url)
    ) {
      publishInventoryChange(session);
    }
    return checkResponse(response);
  } catch (error) {
    session.assertCurrent();
    throw error;
  }
}
