import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";

const BRIDGE_KEY_HEADER = "x-tcger-bridge-key";
const DEVELOPMENT_BRIDGE_SECRET = "tcger-local-convex-bridge-secret-2026";

export type BridgeIdentity = {
  subject: string;
  email?: string;
  name?: string;
  username?: string;
};

export function json(payload: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}

export function textResponse(payload: string, status = 200, headers?: Record<string, string>) {
  return new Response(payload, {
    status,
    headers
  });
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export function errorJson(status: number, error: string, message: string) {
  return json({ error, message }, status);
}

function convexErrorData(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") return null;
  const rawData = (error as { data?: unknown }).data;
  if (rawData && typeof rawData === "object") {
    return rawData as Record<string, unknown>;
  }
  if (typeof rawData === "string") {
    try {
      const parsed = JSON.parse(rawData);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function statusFromConvexError(error: unknown) {
  const code = String(convexErrorData(error)?.code ?? "");
  if (code === "UNAUTHORIZED" || code === "UNAUTHENTICATED" || code === "USER_NOT_PROVISIONED") {
    return 401;
  }
  if (code === "FORBIDDEN") {
    return 403;
  }
  if (code === "CONFLICT") {
    return 409;
  }
  if (code === "NOT_FOUND") {
    return 404;
  }
  return 400;
}

export function handleConvexError(error: unknown, fallback: string) {
  const data = convexErrorData(error);
  if (error instanceof ConvexError || data) {
    return errorJson(
      statusFromConvexError(error),
      String(data?.code ?? "BAD_REQUEST"),
      String(data?.message ?? fallback)
    );
  }
  throw error;
}

export async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// NODE_ENV is unreliable inside Convex (push analysis always reports
// "production"); only localhost deployments may use the baked-in dev secret.
function isLocalDeployment(): boolean {
  const url = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_SITE_URL ?? "";
  if (!url) {
    return true;
  }
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function configuredBridgeSecret(): string | null {
  const configured = process.env.TCGER_BRIDGE_SECRET?.trim();
  if (configured !== undefined) {
    return configured.length >= 32 ? configured : null;
  }

  return isLocalDeployment() ? DEVELOPMENT_BRIDGE_SECRET : null;
}

function secretsMatch(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0;
}

export function requireBridgeKey(request: Request): void {
  const expected = configuredBridgeSecret();
  const provided = request.headers.get(BRIDGE_KEY_HEADER);
  if (!expected || !provided || !secretsMatch(expected, provided)) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Valid bridge credentials are required"
    });
  }
}

export function getBridgeIdentity(request: Request): BridgeIdentity | null {
  const authorization = request.headers.get("authorization");
  const subject = request.headers.get("x-tcger-user-id");
  if (!authorization || !subject) {
    return null;
  }

  return {
    subject,
    email: request.headers.get("x-tcger-user-email") ?? undefined,
    username: request.headers.get("x-tcger-username") ?? undefined,
    name:
      request.headers.get("x-tcger-name") ??
      request.headers.get("x-tcger-username") ??
      undefined
  };
}

export async function requireBridgeIdentity(ctx: any, request: Request) {
  requireBridgeKey(request);
  const identity = getBridgeIdentity(request);
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authorization and x-tcger-user-id are required"
    });
  }
  await ctx.runMutation(internal.bridge.ensureViewer, identity);
  return identity;
}

export async function requireBridgeAdmin(ctx: any, identity: BridgeIdentity) {
  const viewer = await ctx.runQuery(internal.bridge.getViewerProfile, {
    subject: identity.subject
  });

  if (!viewer.isAdmin) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Admin access required"
    });
  }

  return viewer;
}
