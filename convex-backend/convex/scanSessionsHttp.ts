import type { HttpRouter } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  errorJson,
  handleConvexError,
  json,
  parseJsonBody,
  requireBridgeIdentity,
} from "./lib/httpBridge";

function bodyRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const tcgs = [
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
] as const;

function invalidOptionalString(
  body: Record<string, unknown>,
  field: string,
  allowNull = false,
) {
  const value = body[field];
  return (
    value !== undefined &&
    typeof value !== "string" &&
    !(allowNull && value === null)
  );
}

export function registerScanSessionRoutes(http: HttpRouter) {
  http.route({
    path: "/scan-sessions",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = bodyRecord(await parseJsonBody(request));
        if (
          (body.name !== undefined && typeof body.name !== "string") ||
          (body.defaultLanguage !== undefined &&
            typeof body.defaultLanguage !== "string")
        ) {
          return errorJson(400, "VALIDATION_ERROR", "Invalid session details");
        }
        return json(
          await ctx.runMutation(internal.scanSessions.createSession, {
            subject: identity.subject,
            name: body.name as string | undefined,
            defaultLanguage: body.defaultLanguage as string | undefined,
          }),
          201,
        );
      } catch (error) {
        return handleConvexError(error, "Failed to create scan session");
      }
    }),
  });

  http.route({
    path: "/scan-sessions/active",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const code = new URL(request.url).searchParams.get("code") ?? undefined;
        return json(
          await ctx.runQuery(internal.scanSessions.findOpenSession, {
            subject: identity.subject,
            code,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to find scan session");
      }
    }),
  });

  http.route({
    path: "/scan-sessions/items",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = bodyRecord(await parseJsonBody(request));
        if (
          typeof body.code !== "string" ||
          typeof body.clientEventId !== "string" ||
          typeof body.tcg !== "string" ||
          !tcgs.includes(body.tcg as (typeof tcgs)[number]) ||
          typeof body.externalId !== "string" ||
          typeof body.name !== "string" ||
          [
            "setCode",
            "setName",
            "rarity",
            "imageUrl",
            "condition",
            "language",
            "finishCode",
            "finishLabel",
          ].some((field) => invalidOptionalString(body, field)) ||
          (body.price !== undefined && typeof body.price !== "number") ||
          (body.confidence !== undefined && typeof body.confidence !== "number")
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Missing or invalid scan item identity",
          );
        }
        return json(
          await ctx.runMutation(internal.scanSessions.addItem, {
            subject: identity.subject,
            code: body.code,
            clientEventId: body.clientEventId,
            tcg: body.tcg as (typeof tcgs)[number],
            externalId: body.externalId,
            name: body.name,
            setCode:
              typeof body.setCode === "string" ? body.setCode : undefined,
            setName:
              typeof body.setName === "string" ? body.setName : undefined,
            rarity: typeof body.rarity === "string" ? body.rarity : undefined,
            imageUrl:
              typeof body.imageUrl === "string" ? body.imageUrl : undefined,
            price: typeof body.price === "number" ? body.price : undefined,
            confidence:
              typeof body.confidence === "number" ? body.confidence : undefined,
            condition:
              typeof body.condition === "string" ? body.condition : undefined,
            language:
              typeof body.language === "string" ? body.language : undefined,
            finishCode:
              typeof body.finishCode === "string" ? body.finishCode : undefined,
            finishLabel:
              typeof body.finishLabel === "string"
                ? body.finishLabel
                : undefined,
          }),
          201,
        );
      } catch (error) {
        return handleConvexError(error, "Failed to add scan item");
      }
    }),
  });

  http.route({
    pathPrefix: "/scan-sessions/",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const parts = new URL(request.url).pathname
          .replace(/^\/scan-sessions\//, "")
          .split("/")
          .filter(Boolean);
        if (parts.length === 2 && parts[1] === "items") {
          return json(
            await ctx.runQuery(internal.scanSessions.listItems, {
              subject: identity.subject,
              sessionId: parts[0] as Id<"scanSessions">,
            }),
          );
        }
        if (parts.length === 1) {
          return json(
            await ctx.runQuery(internal.scanSessions.getSession, {
              subject: identity.subject,
              sessionId: parts[0] as Id<"scanSessions">,
            }),
          );
        }
        return errorJson(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        return handleConvexError(error, "Failed to fetch scan session");
      }
    }),
  });

  http.route({
    pathPrefix: "/scan-sessions/items/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const itemId = new URL(request.url).pathname.replace(
          /^\/scan-sessions\/items\//,
          "",
        ) as Id<"scanSessionItems">;
        const body = bodyRecord(await parseJsonBody(request));
        const editableFields = [
          "language",
          "condition",
          "finishCode",
          "finishLabel",
        ];
        if (
          !editableFields.some((field) => body[field] !== undefined) ||
          invalidOptionalString(body, "language") ||
          invalidOptionalString(body, "condition") ||
          invalidOptionalString(body, "finishCode", true) ||
          invalidOptionalString(body, "finishLabel", true)
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Invalid or empty scan item update",
          );
        }
        return json(
          await ctx.runMutation(internal.scanSessions.updateItem, {
            subject: identity.subject,
            itemId,
            language:
              typeof body.language === "string" ? body.language : undefined,
            condition:
              typeof body.condition === "string" ? body.condition : undefined,
            finishCode:
              body.finishCode === null || typeof body.finishCode === "string"
                ? body.finishCode
                : undefined,
            finishLabel:
              body.finishLabel === null || typeof body.finishLabel === "string"
                ? body.finishLabel
                : undefined,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to update scan item");
      }
    }),
  });

  http.route({
    pathPrefix: "/scan-sessions/items/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const itemId = new URL(request.url).pathname.replace(
          /^\/scan-sessions\/items\//,
          "",
        ) as Id<"scanSessionItems">;
        return json(
          await ctx.runMutation(internal.scanSessions.removeItem, {
            subject: identity.subject,
            itemId,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to remove scan item");
      }
    }),
  });

  http.route({
    pathPrefix: "/scan-sessions/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const parts = new URL(request.url).pathname
          .replace(/^\/scan-sessions\//, "")
          .split("/")
          .filter(Boolean);
        if (parts.length !== 2 || parts[1] !== "items")
          return errorJson(404, "NOT_FOUND", "Route not found");
        return json(
          await ctx.runMutation(internal.scanSessions.clearItems, {
            subject: identity.subject,
            sessionId: parts[0] as Id<"scanSessions">,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to clear scan items");
      }
    }),
  });

  http.route({
    pathPrefix: "/scan-sessions/",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const parts = new URL(request.url).pathname
          .replace(/^\/scan-sessions\//, "")
          .split("/")
          .filter(Boolean);
        if (parts.length !== 2 || parts[1] !== "commit")
          return errorJson(404, "NOT_FOUND", "Route not found");
        const body = bodyRecord(await parseJsonBody(request));
        if (typeof body.binderId !== "string")
          return errorJson(400, "VALIDATION_ERROR", "binderId is required");
        const itemIds =
          Array.isArray(body.itemIds) &&
          body.itemIds.every((value) => typeof value === "string")
            ? (body.itemIds as Id<"scanSessionItems">[])
            : undefined;
        if (body.itemIds !== undefined && itemIds === undefined)
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "itemIds must be an array of scan item IDs",
          );
        return json(
          await ctx.runMutation(internal.scanSessions.commitSession, {
            subject: identity.subject,
            sessionId: parts[0] as Id<"scanSessions">,
            binderId: body.binderId as Id<"binders">,
            itemIds,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to commit scan session");
      }
    }),
  });
}
