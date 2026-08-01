import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  errorJson,
  handleConvexError,
  json,
  noContent,
  parseJsonBody,
  requireBridgeIdentity
} from "./lib/httpBridge";
import type { TcgCode } from "./lib/validators";

const tradesApi = internal.trades;
const TCG_CODES = new Set<TcgCode>([
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball"
]);

type TradeCardInput = {
  externalId: string;
  tcg: TcgCode;
  name: string;
  quantity: number;
  imageUrl?: string;
  estimatedValue?: number;
};

function parseCardList(value: unknown, required: boolean): TradeCardInput[] | null {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) return null;
  const cards: TradeCardInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const card = raw as Record<string, unknown>;
    const quantity = card.quantity === undefined ? 1 : card.quantity;
    if (
      typeof card.externalId !== "string" || !card.externalId ||
      typeof card.tcg !== "string" || !TCG_CODES.has(card.tcg as TcgCode) ||
      typeof card.name !== "string" || !card.name ||
      typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 ||
      (card.imageUrl !== undefined && typeof card.imageUrl !== "string") ||
      (card.estimatedValue !== undefined &&
        (typeof card.estimatedValue !== "number" || !Number.isFinite(card.estimatedValue)))
    ) {
      return null;
    }
    cards.push({
      externalId: card.externalId,
      tcg: card.tcg as TcgCode,
      name: card.name,
      quantity,
      imageUrl: card.imageUrl as string | undefined,
      estimatedValue: card.estimatedValue as number | undefined
    });
  }
  return cards;
}

function tradeSegments(request: Request) {
  return new URL(request.url).pathname.replace(/^\/trades\//, "").split("/").filter(Boolean);
}

export function registerTradesRoutes(http: HttpRouter) {
  http.route({
    path: "/trades",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(await ctx.runQuery(tradesApi.list, { subject: identity.subject }));
      } catch (error) {
        return handleConvexError(error, "Failed to fetch trades");
      }
    })
  });

  http.route({
    path: "/trades",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = await parseJsonBody(request);
        const senderCards = parseCardList(body.senderCards, true);
        const receiverCards = parseCardList(body.receiverCards, false);
        if (
          typeof body.receiverId !== "string" || !body.receiverId ||
          (body.message !== undefined && typeof body.message !== "string") ||
          !senderCards || !receiverCards
        ) {
          return errorJson(400, "VALIDATION_ERROR", "Invalid trade payload");
        }
        const trade = await ctx.runMutation(tradesApi.create, {
          subject: identity.subject,
          receiverId: body.receiverId,
          message: body.message,
          senderCards,
          receiverCards
        });
        return json(trade, 201);
      } catch (error) {
        return handleConvexError(error, "Failed to create trade");
      }
    })
  });

  http.route({
    path: "/trades/matches",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(await ctx.runQuery(tradesApi.findMatches, { subject: identity.subject }));
      } catch (error) {
        return handleConvexError(error, "Failed to find trade matches");
      }
    })
  });

  http.route({
    pathPrefix: "/trades/",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = tradeSegments(request);
        if (segments.length !== 1) return errorJson(404, "NOT_FOUND", "Route not found");
        return json(
          await ctx.runQuery(tradesApi.get, {
            subject: identity.subject,
            tradeId: segments[0]
          })
        );
      } catch (error) {
        return handleConvexError(error, "Failed to fetch trade");
      }
    })
  });

  http.route({
    pathPrefix: "/trades/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = tradeSegments(request);
        const operation = segments[1];
        const status =
          operation === "accept" ? "accepted" :
            operation === "decline" ? "declined" :
              operation === "cancel" ? "cancelled" : null;
        if (segments.length !== 2 || !status) {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        return json(
          await ctx.runMutation(tradesApi.setStatus, {
            subject: identity.subject,
            tradeId: segments[0],
            status
          })
        );
      } catch (error) {
        return handleConvexError(error, "Failed to update trade status");
      }
    })
  });

  http.route({
    pathPrefix: "/trades/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = tradeSegments(request);
        if (segments.length !== 1) return errorJson(404, "NOT_FOUND", "Route not found");
        await ctx.runMutation(tradesApi.remove, {
          subject: identity.subject,
          tradeId: segments[0]
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete trade");
      }
    })
  });
}
