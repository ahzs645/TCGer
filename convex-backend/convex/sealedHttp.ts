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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validCustomProductBody(body: Record<string, unknown>): boolean {
  return (
    typeof body.tcg === "string" &&
    typeof body.name === "string" &&
    typeof body.productType === "string" &&
    hasValidOptionalStrings(body, ["setCode", "releaseDate", "imageUrl", "upc"]) &&
    (body.releaseDate === undefined || isIsoDateTime(body.releaseDate)) &&
    (body.imageUrl === undefined || isHttpUrl(body.imageUrl)) &&
    (body.cardsPerPack === undefined || isPositiveInteger(body.cardsPerPack)) &&
    (body.packsPerBox === undefined || isPositiveInteger(body.packsPerBox)) &&
    (body.msrp === undefined || isNonnegativeNumber(body.msrp))
  );
}

function customProductInput(body: Record<string, unknown>) {
  return {
    tcg: body.tcg as string,
    name: body.name as string,
    productType: body.productType as string,
    setCode: body.setCode as string | undefined,
    cardsPerPack: body.cardsPerPack as number | undefined,
    packsPerBox: body.packsPerBox as number | undefined,
    releaseDate: body.releaseDate as string | undefined,
    imageUrl: body.imageUrl as string | undefined,
    msrp: body.msrp as number | undefined,
    upc: body.upc as string | undefined,
  };
}

function singleProductId(request: Request): string | null {
  const segments = new URL(request.url).pathname
    .replace(/^\/sealed\/products\//, "")
    .split("/")
    .filter(Boolean);
  return segments.length === 1 ? decodeURIComponent(segments[0]!) : null;
}

export function registerSealedRoutes(http: HttpRouter) {
  http.route({
    path: "/sealed/products",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        await ctx.runMutation(internal.sealed.seedCatalog, {});
        const tcg = new URL(request.url).searchParams.get("tcg") ?? undefined;
        const products = await ctx.runQuery(internal.sealed.listProducts, {
          subject: identity.subject,
          tcg,
        });
        return json(products);
      } catch (error) {
        return handleConvexError(error, "Failed to fetch sealed products");
      }
    }),
  });

  http.route({
    path: "/sealed/products",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = asRecord(await parseJsonBody(request));
        if (!validCustomProductBody(body)) {
          return errorJson(400, "VALIDATION_ERROR", "Payload validation failed");
        }
        const product = await ctx.runMutation(internal.sealed.createCustomProduct, {
          subject: identity.subject,
          ...customProductInput(body),
        });
        return json(product, 201);
      } catch (error) {
        return handleConvexError(error, "Failed to create custom sealed product");
      }
    }),
  });

  http.route({
    pathPrefix: "/sealed/products/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const productId = singleProductId(request);
        if (!productId) return errorJson(404, "NOT_FOUND", "Route not found");
        const body = asRecord(await parseJsonBody(request));
        if (!validCustomProductBody(body)) {
          return errorJson(400, "VALIDATION_ERROR", "Payload validation failed");
        }
        return json(await ctx.runMutation(internal.sealed.updateCustomProduct, {
          subject: identity.subject,
          productId: productId as Id<"sealedProducts">,
          ...customProductInput(body),
        }));
      } catch (error) {
        return handleConvexError(error, "Failed to update custom sealed product");
      }
    }),
  });

  http.route({
    pathPrefix: "/sealed/products/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const productId = singleProductId(request);
        if (!productId) return errorJson(404, "NOT_FOUND", "Route not found");
        await ctx.runMutation(internal.sealed.deleteCustomProduct, {
          subject: identity.subject,
          productId: productId as Id<"sealedProducts">,
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete custom sealed product");
      }
    }),
  });

  http.route({
    path: "/sealed/open-pack",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        await requireBridgeIdentity(ctx, request);
        const body = asRecord(await parseJsonBody(request));
        if (typeof body.tcg !== "string" || typeof body.setCode !== "string") {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }
        const result = await ctx.runQuery(internal.sealed.simulatePackOpening, {
          tcg: body.tcg,
          setCode: body.setCode,
        });
        return json(result);
      } catch (error) {
        return handleConvexError(error, "Failed to simulate pack opening");
      }
    }),
  });

  http.route({
    path: "/sealed/inventory",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const inventory = await ctx.runQuery(internal.sealed.listInventory, {
          subject: identity.subject,
        });
        return json(inventory);
      } catch (error) {
        return handleConvexError(error, "Failed to fetch sealed inventory");
      }
    }),
  });

  http.route({
    path: "/sealed/openings",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const openings = await ctx.runQuery(
          internal.sealed.listOpeningLedgers,
          {
            subject: identity.subject,
          },
        );
        return json(openings);
      } catch (error) {
        return handleConvexError(
          error,
          "Failed to fetch sealed opening ledgers",
        );
      }
    }),
  });

  http.route({
    path: "/sealed/inventory",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = asRecord(await parseJsonBody(request));
        if (
          typeof body.productId !== "string" ||
          (body.quantity !== undefined && !isPositiveInteger(body.quantity)) ||
          (body.purchasePrice !== undefined &&
            !isNonnegativeNumber(body.purchasePrice)) ||
          (body.purchaseDate !== undefined &&
            !isIsoDateTime(body.purchaseDate)) ||
          !hasValidOptionalStrings(body, ["notes"])
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }
        const inventory = await ctx.runMutation(internal.sealed.addInventory, {
          subject: identity.subject,
          productId: body.productId as Id<"sealedProducts">,
          quantity: body.quantity as number | undefined,
          purchasePrice: body.purchasePrice as number | undefined,
          purchaseDate: body.purchaseDate as string | undefined,
          notes: body.notes as string | undefined,
        });
        return json(inventory, 201);
      } catch (error) {
        return handleConvexError(error, "Failed to add sealed inventory");
      }
    }),
  });

  http.route({
    pathPrefix: "/sealed/inventory/",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = new URL(request.url).pathname
          .replace(/^\/sealed\/inventory\//, "")
          .split("/")
          .filter(Boolean);
        if (segments.length !== 2 || segments[1] !== "open") {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        const body = asRecord(await parseJsonBody(request));
        if (
          (body.openedQuantity !== undefined &&
            !isPositiveInteger(body.openedQuantity)) ||
          (body.collectionIds !== undefined &&
            (!Array.isArray(body.collectionIds) ||
              body.collectionIds.length > 500 ||
              !body.collectionIds.every((id) => typeof id === "string"))) ||
          (body.openedAt !== undefined && !isIsoDateTime(body.openedAt)) ||
          !hasValidOptionalStrings(body, ["notes"]) ||
          (typeof body.notes === "string" && body.notes.length > 2_000)
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }
        const opening = await ctx.runMutation(internal.sealed.createOpening, {
          subject: identity.subject,
          inventoryId: segments[0] as Id<"sealedInventory">,
          openedQuantity: body.openedQuantity as number | undefined,
          collectionIds: body.collectionIds as
            | Id<"collectionEntries">[]
            | undefined,
          openedAt: body.openedAt as string | undefined,
          notes: body.notes as string | undefined,
        });
        return json(opening, 201);
      } catch (error) {
        return handleConvexError(error, "Failed to create sealed opening");
      }
    }),
  });

  http.route({
    pathPrefix: "/sealed/openings/cards/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = new URL(request.url).pathname
          .replace(/^\/sealed\/openings\/cards\//, "")
          .split("/")
          .filter(Boolean);
        if (segments.length !== 2 || segments[1] !== "sale") {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        const body = asRecord(await parseJsonBody(request));
        if (
          !isNonnegativeNumber(body.proceeds) ||
          (body.soldAt !== undefined && !isIsoDateTime(body.soldAt))
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }
        const card = await ctx.runMutation(
          internal.sealed.recordOpenedCardSale,
          {
            subject: identity.subject,
            openedCardId: segments[0] as Id<"sealedOpenedCards">,
            proceeds: body.proceeds,
            soldAt: body.soldAt as string | undefined,
          },
        );
        return json(card);
      } catch (error) {
        return handleConvexError(error, "Failed to record opened card sale");
      }
    }),
  });

  http.route({
    pathPrefix: "/sealed/inventory/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = new URL(request.url).pathname
          .replace(/^\/sealed\/inventory\//, "")
          .split("/")
          .filter(Boolean);
        if (segments.length !== 1) {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        const body = asRecord(await parseJsonBody(request));
        const hasUpdate = [
          "quantity",
          "purchasePrice",
          "purchaseDate",
          "notes",
        ].some((field) => body[field] !== undefined);
        if (
          !hasUpdate ||
          (body.quantity !== undefined && !isPositiveInteger(body.quantity)) ||
          (body.purchasePrice !== undefined &&
            !isNonnegativeNumber(body.purchasePrice)) ||
          (body.purchaseDate !== undefined &&
            !isIsoDateTime(body.purchaseDate)) ||
          !hasValidOptionalStrings(body, ["notes"])
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "Payload validation failed",
          );
        }
        const inventory = await ctx.runMutation(
          internal.sealed.updateInventory,
          {
            subject: identity.subject,
            itemId: segments[0] as Id<"sealedInventory">,
            quantity: body.quantity as number | undefined,
            purchasePrice: body.purchasePrice as number | undefined,
            purchaseDate: body.purchaseDate as string | undefined,
            notes: body.notes as string | undefined,
          },
        );
        return json(inventory);
      } catch (error) {
        return handleConvexError(error, "Failed to update sealed inventory");
      }
    }),
  });

  http.route({
    pathPrefix: "/sealed/inventory/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = new URL(request.url).pathname
          .replace(/^\/sealed\/inventory\//, "")
          .split("/")
          .filter(Boolean);
        if (segments.length !== 1) {
          return errorJson(404, "NOT_FOUND", "Route not found");
        }
        await ctx.runMutation(internal.sealed.deleteInventory, {
          subject: identity.subject,
          itemId: segments[0] as Id<"sealedInventory">,
        });
        return noContent();
      } catch (error) {
        return handleConvexError(error, "Failed to delete sealed inventory");
      }
    }),
  });
}
