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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasValidOptionalStrings(
  body: Record<string, unknown>,
  fields: string[],
) {
  return fields.every(
    (field) => body[field] === undefined || typeof body[field] === "string",
  );
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function registerFinanceRoutes(http: HttpRouter) {
  http.route({
    path: "/finance/transactions",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const transactions = await ctx.runQuery(
          internal.finance.listTransactions,
          {
            subject: identity.subject,
          },
        );
        return json(transactions);
      } catch (error) {
        return handleConvexError(error, "Failed to fetch transactions");
      }
    }),
  });

  http.route({
    path: "/finance/transactions",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = asRecord(await parseJsonBody(request));
        if (
          (body.type !== "purchase" &&
            body.type !== "sale" &&
            body.type !== "trade") ||
          typeof body.amount !== "number" ||
          !Number.isFinite(body.amount) ||
          body.amount <= 0 ||
          (body.quantity !== undefined &&
            (!Number.isInteger(body.quantity) ||
              (body.quantity as number) < 1)) ||
          (body.date !== undefined && !isIsoDateTime(body.date)) ||
          !hasValidOptionalStrings(body, [
            "cardId",
            "externalId",
            "tcg",
            "cardName",
            "currency",
            "platform",
            "notes",
          ]) ||
          (body.currency !== undefined &&
            !/^[A-Za-z]{3}$/.test(body.currency as string))
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }
        const transaction = await ctx.runMutation(
          internal.finance.createTransaction,
          {
            subject: identity.subject,
            type: body.type,
            cardId: body.cardId as string | undefined,
            externalId: body.externalId as string | undefined,
            tcg: body.tcg as string | undefined,
            cardName: body.cardName as string | undefined,
            quantity: body.quantity as number | undefined,
            amount: body.amount,
            currency: body.currency as string | undefined,
            platform: body.platform as string | undefined,
            notes: body.notes as string | undefined,
            date: body.date as string | undefined,
          },
        );
        return json(transaction, 201);
      } catch (error) {
        return handleConvexError(error, "Failed to create transaction");
      }
    }),
  });

  http.route({
    pathPrefix: "/finance/transactions/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const url = new URL(request.url);
        const segments = url.pathname
          .replace(/^\/finance\/transactions\//, "")
          .split("/")
          .filter(Boolean);
        if (segments.length !== 1) {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        await ctx.runMutation(internal.finance.deleteTransaction, {
          subject: identity.subject,
          transactionId: segments[0] as Id<"transactions">,
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete transaction");
      }
    }),
  });

  http.route({
    path: "/finance/summary",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const summary = await ctx.runQuery(internal.finance.getSummary, {
          subject: identity.subject,
        });
        return json(summary);
      } catch (error) {
        return handleConvexError(error, "Failed to fetch finance summary");
      }
    }),
  });

  http.route({
    path: "/finance/summary/by-currency",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const summary = await ctx.runQuery(
          internal.finance.getSummaryByCurrency,
          { subject: identity.subject },
        );
        return json(summary);
      } catch (error) {
        return handleConvexError(
          error,
          "Failed to fetch finance summary by currency",
        );
      }
    }),
  });
}
