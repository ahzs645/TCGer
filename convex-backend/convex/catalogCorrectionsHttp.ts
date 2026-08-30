import type { HttpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { TcgCode } from "./lib/validators";
import {
  errorJson,
  handleConvexError,
  json,
  parseJsonBody,
  requireBridgeIdentity
} from "./lib/httpBridge";

const tcgs = new Set<TcgCode>([
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball"
]);
const patchFields = new Set([
  "name",
  "printedName",
  "searchAliases",
  "setCode",
  "setName",
  "rarity",
  "collectorNumber",
  "releasedAt",
  "imageUrl",
  "imageUrlSmall",
  "language",
  "artist",
  "attributes"
]);

function isTcg(value: unknown): value is TcgCode {
  return typeof value === "string" && tcgs.has(value as TcgCode);
}

function correctionInput(body: Record<string, any>) {
  if (
    !isTcg(body.tcg) ||
    (body.targetType !== "identity" && body.targetType !== "printing") ||
    typeof body.targetKey !== "string" ||
    !body.patch ||
    typeof body.patch !== "object" ||
    Array.isArray(body.patch) ||
    typeof body.reason !== "string"
  ) {
    return null;
  }
  const patch = Object.fromEntries(
    Object.entries(body.patch).filter(([key]) => patchFields.has(key))
  );
  if (!Object.keys(patch).length) return null;
  return {
    tcg: body.tcg,
    targetType: body.targetType as "identity" | "printing",
    targetKey: body.targetKey,
    patch,
    reason: body.reason
  };
}

export function registerCatalogCorrectionRoutes(http: HttpRouter) {
  http.route({
    path: "/catalog-corrections",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const tcgParam = new URL(request.url).searchParams.get("tcg");
        if (tcgParam && !isTcg(tcgParam)) {
          return errorJson(400, "BAD_REQUEST", "Unknown game code");
        }
        return json(
          await ctx.runQuery(internal.catalogCorrections.listEffective, {
            subject: identity.subject,
            tcg: tcgParam as TcgCode | undefined
          })
        );
      } catch (error) {
        return handleConvexError(error, "Failed to list catalog corrections");
      }
    })
  });

  http.route({
    path: "/catalog-corrections/history",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
        return json(
          await ctx.runQuery(internal.catalogCorrections.listHistory, {
            subject: identity.subject,
            limit: Number.isFinite(rawLimit) ? rawLimit : 50
          })
        );
      } catch (error) {
        return handleConvexError(error, "Failed to list catalog correction history");
      }
    })
  });

  http.route({
    path: "/catalog-corrections",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const input = correctionInput(await parseJsonBody(request));
        if (!input) return errorJson(400, "BAD_REQUEST", "Invalid catalog correction");
        return json(
          await ctx.runMutation(internal.catalogCorrections.create, {
            subject: identity.subject,
            ...input
          }),
          201
        );
      } catch (error) {
        return handleConvexError(error, "Failed to create catalog correction");
      }
    })
  });

  http.route({
    pathPrefix: "/catalog-corrections/",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = new URL(request.url).pathname
          .replace(/^\/catalog-corrections\//, "")
          .split("/")
          .filter(Boolean);
        if (segments.length !== 2 || segments[1] !== "rollback") {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        const body = await parseJsonBody(request);
        return json(
          await ctx.runMutation(internal.catalogCorrections.rollback, {
            subject: identity.subject,
            correctionId: segments[0]! as Id<"catalogCorrections">,
            reason: typeof body.reason === "string" ? body.reason : undefined
          }),
          201
        );
      } catch (error) {
        return handleConvexError(error, "Failed to roll back catalog correction");
      }
    })
  });
}
