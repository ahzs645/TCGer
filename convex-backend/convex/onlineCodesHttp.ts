import type { HttpRouter } from "convex/server";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import {
  errorJson,
  handleConvexError,
  json,
  noContent,
  parseJsonBody,
  requireBridgeIdentity,
} from "./lib/httpBridge";
import type { TcgCode } from "./lib/validators";

const TCGS: readonly TcgCode[] = [
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
];
const STATUSES = ["unused", "redeemed", "invalid", "traded"] as const;
const SOURCES = ["camera", "manual", "import"] as const;

type Status = (typeof STATUSES)[number];
type Source = (typeof SOURCES)[number];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isTcg(value: unknown): value is TcgCode {
  return typeof value === "string" && TCGS.includes(value as TcgCode);
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && STATUSES.includes(value as Status);
}

function isSource(value: unknown): value is Source {
  return typeof value === "string" && SOURCES.includes(value as Source);
}

function parseIsoTimestamp(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function codeId(request: Request): Id<"onlineCodes"> | null {
  const segments = new URL(request.url).pathname
    .replace(/^\/online-codes\//, "")
    .split("/")
    .filter(Boolean);
  return segments.length === 1
    ? (decodeURIComponent(segments[0]!) as Id<"onlineCodes">)
    : null;
}

export function registerOnlineCodesRoutes(http: HttpRouter) {
  http.route({
    path: "/online-codes",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const search = new URL(request.url).searchParams;
        const tcgValue = search.get("tcg") ?? undefined;
        const statusValue = search.get("status") ?? undefined;
        if (
          (tcgValue !== undefined && !isTcg(tcgValue)) ||
          (statusValue !== undefined && !isStatus(statusValue))
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Invalid TCG or status filter",
          );
        }
        return json(
          await ctx.runQuery(internal.onlineCodes.list, {
            subject: identity.subject,
            tcg: tcgValue,
            status: statusValue,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to fetch online codes");
      }
    }),
  });

  http.route({
    path: "/online-codes/bulk",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = asRecord(await parseJsonBody(request));
        if (
          !isTcg(body.tcg) ||
          !isSource(body.source) ||
          !Array.isArray(body.codes) ||
          body.codes.length < 1 ||
          body.codes.length > 250 ||
          (body.productName !== undefined &&
            typeof body.productName !== "string") ||
          (body.notes !== undefined && typeof body.notes !== "string")
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }

        const codes: Array<{ code: string; capturedAt?: number }> = [];
        for (const raw of body.codes) {
          const item = asRecord(raw);
          const capturedAt = parseIsoTimestamp(item.capturedAt);
          if (typeof item.code !== "string" || capturedAt === null) {
            return errorJson(
              400,
              "VALIDATION_ERROR",
              "Each code entry is invalid",
            );
          }
          codes.push({ code: item.code, capturedAt });
        }

        const result = await ctx.runMutation(internal.onlineCodes.createBatch, {
          subject: identity.subject,
          tcg: body.tcg,
          codes,
          source: body.source,
          productName: body.productName as string | undefined,
          notes: body.notes as string | undefined,
        });
        return json(result, 201);
      } catch (error) {
        return handleConvexError(error, "Failed to save online codes");
      }
    }),
  });

  http.route({
    pathPrefix: "/online-codes/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const id = codeId(request);
        const body = asRecord(await parseJsonBody(request));
        if (
          !id ||
          (body.status !== undefined && !isStatus(body.status)) ||
          (body.productName !== undefined &&
            body.productName !== null &&
            typeof body.productName !== "string") ||
          (body.notes !== undefined &&
            body.notes !== null &&
            typeof body.notes !== "string")
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }

        return json(
          await ctx.runMutation(internal.onlineCodes.update, {
            subject: identity.subject,
            codeId: id,
            status: body.status as Status | undefined,
            productName:
              typeof body.productName === "string"
                ? body.productName
                : undefined,
            notes: typeof body.notes === "string" ? body.notes : undefined,
            clearProductName: body.productName === null,
            clearNotes: body.notes === null,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to update online code");
      }
    }),
  });

  http.route({
    pathPrefix: "/online-codes/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const id = codeId(request);
        if (!id) return errorJson(404, "NOT_FOUND", "Route not found");
        await ctx.runMutation(internal.onlineCodes.remove, {
          subject: identity.subject,
          codeId: id,
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete online code");
      }
    }),
  });
}
