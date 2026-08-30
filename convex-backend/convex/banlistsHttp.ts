import type { HttpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  errorJson,
  handleConvexError,
  json,
  requireBridgeAdmin,
  requireBridgeIdentity,
} from "./lib/httpBridge";

const formats = new Set(["tcg", "traditional", "ocg", "goat"] as const);
type Format = "tcg" | "traditional" | "ocg" | "goat";

function formatFrom(request: Request): Format | null {
  const value = new URL(request.url).searchParams.get("format") ?? "tcg";
  return formats.has(value as Format) ? value as Format : null;
}

export function registerBanlistRoutes(http: HttpRouter) {
  http.route({
    path: "/banlists/current",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const format = formatFrom(request);
        if (!format) return errorJson(400, "BAD_REQUEST", "Unknown Yu-Gi-Oh banlist format");
        return json(await ctx.runQuery(internal.banlists.listCurrent, {
          subject: identity.subject,
          format,
        }));
      } catch (error) {
        return handleConvexError(error, "Failed to load the current banlist");
      }
    }),
  });

  http.route({
    path: "/banlists/sync",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        await requireBridgeAdmin(ctx, identity);
        return json({ synced: await ctx.runAction(internal.banlistSync.syncAll, {}) });
      } catch (error) {
        return handleConvexError(error, "Failed to synchronize banlists");
      }
    }),
  });
}
