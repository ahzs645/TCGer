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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const tcgs = new Set<TcgCode>([
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
]);

export function registerAlertsAutomationsRoutes(http: HttpRouter) {
  http.route({
    path: "/alerts",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(
          await ctx.runQuery(internal.alertsAutomations.listAlerts, {
            subject: identity.subject,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to list alerts");
      }
    }),
  });
  http.route({
    path: "/alerts",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = record(await parseJsonBody(request));
        if (
          typeof body.externalId !== "string" ||
          typeof body.tcg !== "string" ||
          !tcgs.has(body.tcg as TcgCode) ||
          typeof body.cardName !== "string" ||
          typeof body.targetPrice !== "number" ||
          !(body.targetPrice > 0) ||
          (body.direction !== "above" && body.direction !== "below") ||
          (body.currency !== undefined &&
            (typeof body.currency !== "string" ||
              !/^[A-Za-z]{3}$/.test(body.currency))) ||
          (body.cooldownHours !== undefined &&
            (typeof body.cooldownHours !== "number" ||
              !Number.isInteger(body.cooldownHours) ||
              body.cooldownHours < 1 ||
              body.cooldownHours > 720))
        )
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Invalid price alert payload",
          );
        return json(
          await ctx.runMutation(internal.alertsAutomations.createAlert, {
            subject: identity.subject,
            externalId: body.externalId,
            tcg: body.tcg as TcgCode,
            cardName: body.cardName,
            imageUrl:
              typeof body.imageUrl === "string" ? body.imageUrl : undefined,
            finishCode:
              typeof body.finishCode === "string" ? body.finishCode : undefined,
            targetPrice: body.targetPrice,
            direction: body.direction,
            currency:
              typeof body.currency === "string" ? body.currency : undefined,
            cooldownHours:
              typeof body.cooldownHours === "number" ? body.cooldownHours : undefined,
          }),
          201,
        );
      } catch (error) {
        return handleConvexError(error, "Failed to create alert");
      }
    }),
  });
  http.route({
    pathPrefix: "/alerts/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const alertId = new URL(request.url).pathname.replace(
          /^\/alerts\//,
          "",
        ) as Id<"priceAlerts">;
        const body = record(await parseJsonBody(request));
        if (
          (body.targetPrice !== undefined &&
            (typeof body.targetPrice !== "number" ||
              !(body.targetPrice > 0))) ||
          (body.direction !== undefined &&
            body.direction !== "above" &&
            body.direction !== "below") ||
          (body.isActive !== undefined && typeof body.isActive !== "boolean")
          || (body.cooldownHours !== undefined &&
            (typeof body.cooldownHours !== "number" ||
              !Number.isInteger(body.cooldownHours) ||
              body.cooldownHours < 1 ||
              body.cooldownHours > 720))
        )
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Invalid price alert update",
          );
        return json(
          await ctx.runMutation(internal.alertsAutomations.updateAlert, {
            subject: identity.subject,
            alertId,
            targetPrice: body.targetPrice as number | undefined,
            direction: body.direction as "above" | "below" | undefined,
            isActive: body.isActive as boolean | undefined,
            cooldownHours: body.cooldownHours as number | undefined,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to update alert");
      }
    }),
  });
  http.route({
    path: "/alerts/evaluate",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(await ctx.runMutation(internal.alertsAutomations.evaluateForSubject, {
          subject: identity.subject,
        }));
      } catch (error) {
        return handleConvexError(error, "Failed to evaluate price alerts");
      }
    }),
  });
  http.route({
    pathPrefix: "/alerts/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const alertId = new URL(request.url).pathname.replace(
          /^\/alerts\//,
          "",
        ) as Id<"priceAlerts">;
        await ctx.runMutation(internal.alertsAutomations.deleteAlert, {
          subject: identity.subject,
          alertId,
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete alert");
      }
    }),
  });

  http.route({
    path: "/automations",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(
          await ctx.runQuery(internal.alertsAutomations.listAutomations, {
            subject: identity.subject,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to list automations");
      }
    }),
  });
  http.route({
    path: "/automations",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = record(await parseJsonBody(request));
        if (
          typeof body.name !== "string" ||
          typeof body.trigger !== "string" ||
          typeof body.action !== "string" ||
          !body.config ||
          typeof body.config !== "object" ||
          Array.isArray(body.config)
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Invalid automation payload",
          );
        }
        return json(
          await ctx.runMutation(internal.alertsAutomations.createAutomation, {
            subject: identity.subject,
            name: body.name,
            trigger: body.trigger,
            action: body.action,
            config: body.config as Record<string, unknown>,
            enabled:
              typeof body.enabled === "boolean" ? body.enabled : undefined,
          }),
          201,
        );
      } catch (error) {
        return handleConvexError(error, "Failed to create automation");
      }
    }),
  });
  http.route({
    pathPrefix: "/automations/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const automationId = new URL(request.url).pathname.replace(
          /^\/automations\//,
          "",
        ) as Id<"automations">;
        const body = record(await parseJsonBody(request));
        return json(
          await ctx.runMutation(internal.alertsAutomations.updateAutomation, {
            subject: identity.subject,
            automationId,
            name: typeof body.name === "string" ? body.name : undefined,
            trigger:
              typeof body.trigger === "string" ? body.trigger : undefined,
            action: typeof body.action === "string" ? body.action : undefined,
            config:
              body.config &&
              typeof body.config === "object" &&
              !Array.isArray(body.config)
                ? (body.config as Record<string, unknown>)
                : undefined,
            enabled:
              typeof body.enabled === "boolean" ? body.enabled : undefined,
          }),
        );
      } catch (error) {
        return handleConvexError(error, "Failed to update automation");
      }
    }),
  });
  http.route({
    pathPrefix: "/automations/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const automationId = new URL(request.url).pathname.replace(
          /^\/automations\//,
          "",
        ) as Id<"automations">;
        await ctx.runMutation(internal.alertsAutomations.deleteAutomation, {
          subject: identity.subject,
          automationId,
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete automation");
      }
    }),
  });
}
