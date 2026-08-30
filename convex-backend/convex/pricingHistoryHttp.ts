import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  errorJson,
  handleConvexError,
  json,
  parseJsonBody,
  requireBridgeIdentity,
} from "./lib/httpBridge";
import type { TcgCode } from "./lib/validators";

const tcgs = new Set<TcgCode>([
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function registerPricingHistoryRoutes(http: HttpRouter) {
  http.route({
    path: "/prices/snapshots",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = record(await parseJsonBody(request));
        const rows = Array.isArray(body.snapshots)
          ? body.snapshots.map(record)
          : [];
        if (!rows.length || rows.length > 500) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "One to 500 price snapshots are required",
          );
        }
        const snapshots = rows.map((row) => {
          if (
            typeof row.tcg !== "string" ||
            !tcgs.has(row.tcg as TcgCode) ||
            typeof row.externalId !== "string" ||
            typeof row.source !== "string" ||
            typeof row.nativePrice !== "number" ||
            !(row.nativePrice > 0) ||
            typeof row.nativeCurrency !== "string"
          )
            throw new Error("Invalid price snapshot");
          return {
            tcg: row.tcg as TcgCode,
            externalId: row.externalId,
            finishCode:
              typeof row.finishCode === "string" ? row.finishCode : undefined,
            source: row.source,
            provider:
              typeof row.provider === "string" ? row.provider : undefined,
            capturedAt:
              typeof row.capturedAt === "number" ? row.capturedAt : Date.now(),
            sourceUpdatedAt:
              typeof row.sourceUpdatedAt === "number" ? row.sourceUpdatedAt : undefined,
            nativePrice: row.nativePrice,
            nativeCurrency: row.nativeCurrency,
            convertedPrice:
              typeof row.convertedPrice === "number"
                ? row.convertedPrice
                : undefined,
            convertedCurrency:
              typeof row.convertedCurrency === "string"
                ? row.convertedCurrency
                : undefined,
            fxRate: typeof row.fxRate === "number" ? row.fxRate : undefined,
            fxSource:
              typeof row.fxSource === "string" ? row.fxSource : undefined,
            fxAsOf: typeof row.fxAsOf === "string" ? row.fxAsOf : undefined,
            matchMethod:
              typeof row.matchMethod === "string" ? row.matchMethod : undefined,
            matchConfidence:
              typeof row.matchConfidence === "number"
                ? row.matchConfidence
                : undefined,
            providerProductId:
              typeof row.providerProductId === "string"
                ? row.providerProductId
                : undefined,
            language:
              typeof row.language === "string" ? row.language : undefined,
          };
        });
        return json(
          await ctx.runMutation(internal.pricingHistory.recordSnapshots, {
            subject: identity.subject,
            snapshots,
          }),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Invalid price snapshot"
        ) {
          return errorJson(400, "VALIDATION_ERROR", error.message);
        }
        return handleConvexError(error, "Failed to record price snapshots");
      }
    }),
  });

  http.route({
    path: "/prices/analytics/movers",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const url = new URL(request.url);
        const rawTcg = url.searchParams.get("tcg");
        const tcg =
          rawTcg && tcgs.has(rawTcg as TcgCode)
            ? (rawTcg as TcgCode)
            : undefined;
        const periodDays = Math.max(
          1,
          Math.min(365, Number(url.searchParams.get("period")) || 7),
        );
        return json(
          await ctx.runQuery(internal.pricingHistory.movers, {
            subject: identity.subject,
            tcg,
            periodDays,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to calculate price movers");
      }
    }),
  });
}
