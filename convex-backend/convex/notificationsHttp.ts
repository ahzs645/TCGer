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

function segments(request: Request) {
  return new URL(request.url).pathname.replace(/^\/notifications\/?/, "").split("/").filter(Boolean);
}

export function registerNotificationRoutes(http: HttpRouter) {
  http.route({
    path: "/notifications",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(await ctx.runQuery(internal.notifications.list, { subject: identity.subject }));
      } catch (error) {
        return handleConvexError(error, "Failed to list notifications");
      }
    }),
  });
  http.route({
    path: "/notifications/read-all",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(await ctx.runMutation(internal.notifications.markAllRead, { subject: identity.subject }));
      } catch (error) {
        return handleConvexError(error, "Failed to mark notifications read");
      }
    }),
  });
  http.route({
    path: "/notifications/channels",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(await ctx.runQuery(internal.notifications.listChannels, { subject: identity.subject }));
      } catch (error) {
        return handleConvexError(error, "Failed to list notification channels");
      }
    }),
  });
  http.route({
    path: "/notifications/channels",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = await parseJsonBody(request);
        if ((body.type !== "discord" && body.type !== "telegram") || !body.config || typeof body.config !== "object" || Array.isArray(body.config)) {
          return errorJson(400, "VALIDATION_ERROR", "Discord or Telegram channel configuration is required");
        }
        const config = Object.fromEntries(
          Object.entries(body.config as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
        return json(await ctx.runMutation(internal.notifications.createChannel, {
          subject: identity.subject,
          type: body.type,
          config,
          enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        }), 201);
      } catch (error) {
        return handleConvexError(error, "Failed to create notification channel");
      }
    }),
  });
  http.route({
    pathPrefix: "/notifications/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const route = segments(request);
        if (route.length !== 2 || route[1] !== "read") return errorJson(404, "NOT_FOUND", "Route not found");
        return json(await ctx.runMutation(internal.notifications.markRead, {
          subject: identity.subject,
          notificationId: route[0] as Id<"notifications">,
          read: true,
        }));
      } catch (error) {
        return handleConvexError(error, "Failed to mark notification read");
      }
    }),
  });
  http.route({
    pathPrefix: "/notifications/channels/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const channelId = segments(request).at(-1);
        if (!channelId) return errorJson(400, "BAD_REQUEST", "Channel id is required");
        await ctx.runMutation(internal.notifications.deleteChannel, {
          subject: identity.subject,
          channelId: channelId as Id<"notificationChannels">,
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete notification channel");
      }
    }),
  });
}
