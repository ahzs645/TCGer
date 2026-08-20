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
        const collectionEntryId = new URL(request.url).searchParams.get("collectionEntryId") ?? undefined;
        const transactions = await ctx.runQuery(
          internal.finance.listTransactions,
          {
            subject: identity.subject,
            collectionEntryId,
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
            "collectionEntryId",
            "cardId",
            "externalId",
            "tcg",
            "cardName",
            "currency",
            "platform",
            "sourceUrl",
            "notes",
          ]) ||
          ["costBasis", "fees", "shippingCost"].some(
            (field) =>
              body[field] !== undefined &&
              (typeof body[field] !== "number" ||
                !Number.isFinite(body[field]) ||
                (body[field] as number) < 0),
          ) ||
          (body.acquiredAt !== undefined && !isIsoDateTime(body.acquiredAt)) ||
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
            collectionEntryId: body.collectionEntryId as string | undefined,
            cardId: body.cardId as string | undefined,
            externalId: body.externalId as string | undefined,
            tcg: body.tcg as string | undefined,
            cardName: body.cardName as string | undefined,
            quantity: body.quantity as number | undefined,
            amount: body.amount,
            currency: body.currency as string | undefined,
            platform: body.platform as string | undefined,
            sourceUrl: body.sourceUrl as string | undefined,
            costBasis: body.costBasis as number | undefined,
            fees: body.fees as number | undefined,
            shippingCost: body.shippingCost as number | undefined,
            acquiredAt: body.acquiredAt as string | undefined,
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
    method: "PATCH",
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
        const body = asRecord(await parseJsonBody(request));
        const nullableStringFields = [
          "collectionEntryId",
          "cardId",
          "externalId",
          "tcg",
          "cardName",
          "platform",
          "sourceUrl",
          "notes",
        ];
        const invalidNullableString = nullableStringFields.some(
          (field) =>
            body[field] !== undefined &&
            body[field] !== null &&
            typeof body[field] !== "string",
        );
        if (
          invalidNullableString ||
          (body.amount !== undefined &&
            (typeof body.amount !== "number" ||
              !Number.isFinite(body.amount) ||
              body.amount <= 0)) ||
          (body.quantity !== undefined &&
            (!Number.isInteger(body.quantity) || (body.quantity as number) < 1)) ||
          (body.currency !== undefined &&
            (typeof body.currency !== "string" || !/^[A-Za-z]{3}$/.test(body.currency))) ||
          (body.date !== undefined && !isIsoDateTime(body.date))
        ) {
          return errorJson(400, "VALIDATION_ERROR", "Payload validation failed");
        }
        const transaction = await ctx.runMutation(internal.finance.updateTransaction, {
          subject: identity.subject,
          transactionId: segments[0] as Id<"transactions">,
          collectionEntryId: body.collectionEntryId as string | null | undefined,
          cardId: body.cardId as string | null | undefined,
          externalId: body.externalId as string | null | undefined,
          tcg: body.tcg as string | null | undefined,
          cardName: body.cardName as string | null | undefined,
          quantity: body.quantity as number | undefined,
          amount: body.amount as number | undefined,
          currency: body.currency as string | undefined,
          platform: body.platform as string | null | undefined,
          sourceUrl: body.sourceUrl as string | null | undefined,
          notes: body.notes as string | null | undefined,
          date: body.date as string | undefined,
        });
        return json(transaction);
      } catch (error) {
        return handleConvexError(error, "Failed to update transaction");
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
    path: "/finance/realized-performance",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const rawPeriod = new URL(request.url).searchParams.get("periodDays");
        const periodDays = rawPeriod === null ? undefined : Number(rawPeriod);
        if (
          periodDays !== undefined &&
          (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 3_650)
        ) {
          return errorJson(400, "VALIDATION_ERROR", "periodDays must be a whole number from 1 to 3650");
        }
        const performance = await ctx.runQuery(
          internal.finance.getRealizedPerformance,
          { subject: identity.subject, periodDays },
        );
        return json(performance);
      } catch (error) {
        return handleConvexError(error, "Failed to fetch realized performance");
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
