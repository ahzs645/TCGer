import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  errorJson,
  handleConvexError,
  json,
  requireBridgeIdentity,
  requireBridgeKey
} from "./lib/httpBridge";

const analyticsApi = internal.analytics;
const PERIOD_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "1y": 365
};

function parsePeriod(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  const parsed = PERIOD_DAYS[normalized] ??
    (/^-?\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : 30);
  return Math.min(365, Math.max(1, parsed));
}

export function registerAnalyticsRoutes(http: HttpRouter) {
  http.route({
    path: "/analytics/value",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const periodDays = parsePeriod(new URL(request.url).searchParams.get("period"));
        return json(
          await ctx.runQuery(analyticsApi.getValueHistory, {
            subject: identity.subject,
            periodDays
          })
        );
      } catch (error) {
        return handleConvexError(error, "Failed to fetch collection value history");
      }
    })
  });

  http.route({
    path: "/analytics/value/breakdown",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(
          await ctx.runQuery(analyticsApi.getValueBreakdown, {
            subject: identity.subject
          })
        );
      } catch (error) {
        return handleConvexError(error, "Failed to fetch collection value breakdown");
      }
    })
  });

  http.route({
    path: "/analytics/distribution",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const dimension = new URL(request.url).searchParams.get("by") || "tcg";
        return json(
          await ctx.runQuery(analyticsApi.getDistribution, {
            subject: identity.subject,
            dimension
          })
        );
      } catch (error) {
        return handleConvexError(error, "Failed to fetch collection distribution");
      }
    })
  });

  http.route({
    pathPrefix: "/public/collections/",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        requireBridgeKey(request);
        const segments = new URL(request.url).pathname
          .replace(/^\/public\/collections\//, "")
          .split("/")
          .filter(Boolean);
        if (segments.length !== 1) {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        const collection = await ctx.runQuery(analyticsApi.getPublicCollection, {
          shareToken: decodeURIComponent(segments[0]!)
        });
        return collection
          ? json(collection)
          : errorJson(404, "NOT_FOUND", "Collection not found or is private");
      } catch (error) {
        return handleConvexError(error, "Failed to fetch public collection");
      }
    })
  });
}
