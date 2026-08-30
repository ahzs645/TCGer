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

function psaCertFromPath(request: Request) {
  const path = new URL(request.url).pathname.replace(
    /^\/provider-cache\/psa\//,
    "",
  );
  return /^\d{6,12}$/.test(path) ? path : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function registerProviderCacheRoutes(http: HttpRouter) {
  http.route({
    pathPrefix: "/provider-cache/psa/",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        await requireBridgeIdentity(ctx, request);
        const certNumber = psaCertFromPath(request);
        if (!certNumber)
          return errorJson(
            400,
            "BAD_REQUEST",
            "Invalid PSA certification number",
          );
        const result = await ctx.runQuery(internal.providerCache.getPsaCert, {
          certNumber,
        });
        return result
          ? json(result)
          : errorJson(404, "NOT_FOUND", "PSA cache entry not found");
      } catch (error) {
        return handleConvexError(error, "Failed to read PSA cache");
      }
    }),
  });

  http.route({
    pathPrefix: "/provider-cache/psa/",
    method: "PUT",
    handler: httpAction(async (ctx, request) => {
      try {
        await requireBridgeIdentity(ctx, request);
        const certNumber = psaCertFromPath(request);
        const body = asRecord(await parseJsonBody(request));
        if (
          !certNumber ||
          typeof body.providerResponseHash !== "string" ||
          typeof body.retrievedAt !== "string" ||
          typeof body.refreshAfter !== "string" ||
          !Number.isFinite(Date.parse(body.retrievedAt)) ||
          !Number.isFinite(Date.parse(body.refreshAfter))
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Invalid PSA cache payload",
          );
        }
        const string = (key: string) =>
          typeof body[key] === "string" ? (body[key] as string) : undefined;
        const number = (key: string) =>
          typeof body[key] === "number" && Number.isFinite(body[key])
            ? (body[key] as number)
            : undefined;
        const result = await ctx.runMutation(
          internal.providerCache.putPsaCert,
          {
            certNumber,
            grade: number("grade"),
            gradeLabel: string("gradeLabel"),
            labelType: string("labelType"),
            year: string("year"),
            brand: string("brand"),
            subject: string("subject"),
            searchableName: string("searchableName"),
            cardNumber: string("cardNumber"),
            variety: string("variety"),
            category: string("category"),
            population: number("population"),
            populationHigher: number("populationHigher"),
            specId: string("specId"),
            providerResponseHash: body.providerResponseHash,
            retrievedAt: body.retrievedAt,
            refreshAfter: body.refreshAfter,
          },
        );
        return json(result);
      } catch (error) {
        return handleConvexError(error, "Failed to persist PSA cache");
      }
    }),
  });
}
