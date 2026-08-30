import type { HttpRouter } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { errorJson, handleConvexError, json, noContent, parseJsonBody, requireBridgeIdentity } from "./lib/httpBridge";

export function registerDomainRoutes(http: HttpRouter) {
  http.route({ path: "/storage/audits/preview", method: "POST", handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request);
      const source = body.source === "latest-binder-scan" || body.source === "import" ? body.source : "manual";
      const observations = Array.isArray(body.observations) ? body.observations.map((row: any) => ({ compartmentId: String(row.compartmentId ?? "") as Id<"storageCompartments">, slotIndex: Number(row.slotIndex), collectionEntryId: typeof row.collectionEntryId === "string" ? row.collectionEntryId as Id<"collectionEntries"> : undefined, externalId: typeof row.externalId === "string" ? row.externalId : undefined, tcg: typeof row.tcg === "string" ? row.tcg : undefined, name: typeof row.name === "string" ? row.name : undefined, quantity: typeof row.quantity === "number" ? row.quantity : undefined })) : undefined;
      return json(await ctx.runQuery(internal.storage.previewAudit, { subject: identity.subject, containerId: String(body.containerId ?? "") as Id<"storageContainers">, compartmentId: typeof body.compartmentId === "string" ? body.compartmentId as Id<"storageCompartments"> : undefined, source, observations }));
    } catch (error) { return handleConvexError(error, "Failed to preview physical audit"); }
  }) });
  http.route({ path: "/storage/audits", method: "POST", handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request);
      const source = body.source === "latest-binder-scan" || body.source === "import" ? body.source : "manual";
      const observations = Array.isArray(body.observations) ? body.observations.map((row: any) => ({ compartmentId: String(row.compartmentId ?? "") as Id<"storageCompartments">, slotIndex: Number(row.slotIndex), collectionEntryId: typeof row.collectionEntryId === "string" ? row.collectionEntryId as Id<"collectionEntries"> : undefined, externalId: typeof row.externalId === "string" ? row.externalId : undefined, tcg: typeof row.tcg === "string" ? row.tcg : undefined, name: typeof row.name === "string" ? row.name : undefined, quantity: typeof row.quantity === "number" ? row.quantity : undefined })) : undefined;
      return json(await ctx.runMutation(internal.storage.commitAudit, { subject: identity.subject, containerId: String(body.containerId ?? "") as Id<"storageContainers">, compartmentId: typeof body.compartmentId === "string" ? body.compartmentId as Id<"storageCompartments"> : undefined, source, observations }), 201);
    } catch (error) { return handleConvexError(error, "Failed to save physical audit"); }
  }) });
  http.route({ path: "/storage/containers", method: "GET", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); return json(await ctx.runQuery(internal.storage.list, { subject: identity.subject })); }
    catch (error) { return handleConvexError(error, "Failed to list storage containers"); }
  }) });
  http.route({ path: "/storage/containers", method: "POST", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request); return json(await ctx.runMutation(internal.storage.createContainer, { subject: identity.subject, name: String(body.name ?? ""), kind: body.kind === "binder" || body.kind === "box" || body.kind === "case" || body.kind === "other" ? body.kind : "other", binderId: typeof body.binderId === "string" ? body.binderId as Id<"binders"> : undefined, order: typeof body.order === "number" ? body.order : undefined, isUnsorted: body.isUnsorted === true, locked: body.locked === true }), 201); }
    catch (error) { return handleConvexError(error, "Failed to create storage container"); }
  }) });
  http.route({ path: "/storage/compartments", method: "POST", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request); return json(await ctx.runMutation(internal.storage.createCompartment, { subject: identity.subject, containerId: String(body.containerId ?? "") as Id<"storageContainers">, label: String(body.label ?? ""), order: Number(body.order), pageNumber: typeof body.pageNumber === "number" ? body.pageNumber : undefined, rows: Number(body.rows), columns: Number(body.columns), capacity: Number(body.capacity), locked: body.locked === true }), 201); }
    catch (error) { return handleConvexError(error, "Failed to create storage compartment"); }
  }) });
  http.route({ path: "/storage/placements", method: "POST", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request); return json(await ctx.runMutation(internal.storage.place, { subject: identity.subject, compartmentId: String(body.compartmentId ?? "") as Id<"storageCompartments">, collectionEntryId: String(body.collectionEntryId ?? "") as Id<"collectionEntries">, slotIndex: Number(body.slotIndex), quantity: Number(body.quantity ?? 1), allowDuplicateStacking: body.allowDuplicateStacking === true }), 201); }
    catch (error) { return handleConvexError(error, "Failed to place collection entry"); }
  }) });
  http.route({ pathPrefix: "/storage/containers/", method: "PATCH", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request); const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-1); return json(await ctx.runMutation(internal.storage.updateContainer, { subject: identity.subject, containerId: String(id ?? "") as Id<"storageContainers">, name: typeof body.name === "string" ? body.name : undefined, order: typeof body.order === "number" ? body.order : undefined, locked: typeof body.locked === "boolean" ? body.locked : undefined })); }
    catch (error) { return handleConvexError(error, "Failed to update storage container"); }
  }) });
  http.route({ pathPrefix: "/storage/compartments/", method: "PATCH", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request); const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-1); return json(await ctx.runMutation(internal.storage.updateCompartment, { subject: identity.subject, compartmentId: String(id ?? "") as Id<"storageCompartments">, label: typeof body.label === "string" ? body.label : undefined, order: typeof body.order === "number" ? body.order : undefined, pageNumber: typeof body.pageNumber === "number" ? body.pageNumber : undefined, locked: typeof body.locked === "boolean" ? body.locked : undefined })); }
    catch (error) { return handleConvexError(error, "Failed to update storage compartment"); }
  }) });
  http.route({ pathPrefix: "/storage/placements/", method: "DELETE", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-1); if (!id) return errorJson(400, "BAD_REQUEST", "Placement id is required"); await ctx.runMutation(internal.storage.removePlacement, { subject: identity.subject, placementId: id as Id<"storagePlacements"> }); return noContent(); }
    catch (error) { return handleConvexError(error, "Failed to remove storage placement"); }
  }) });
  http.route({ path: "/collections/rapid-entry", method: "POST", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request); return json(await ctx.runMutation(internal.collectionOperations.rapidSetEntry, { subject: identity.subject, binderId: String(body.binderId ?? "") as Id<"binders">, tcg: String(body.tcg ?? ""), setCode: String(body.setCode ?? ""), entries: Array.isArray(body.entries) ? body.entries : [] }), 201); }
    catch (error) { return handleConvexError(error, "Failed rapid set entry"); }
  }) });
  http.route({ path: "/finance/acquisition-cost-split", method: "POST", handler: httpAction(async (ctx, request) => {
    try { const identity = await requireBridgeIdentity(ctx, request); const body = await parseJsonBody(request); return json(await ctx.runMutation(internal.collectionOperations.splitAcquisitionCost, { subject: identity.subject, totalCents: Number(body.totalCents), currency: String(body.currency ?? "USD"), mode: body.mode === "weighted" ? "weighted" : "equal", lines: Array.isArray(body.lines) ? body.lines.map((line: any) => ({ collectionEntryId: String(line.collectionEntryId ?? "") as Id<"collectionEntries">, weight: typeof line.weight === "number" ? line.weight : undefined })) : [], notes: typeof body.notes === "string" ? body.notes : undefined }), 201); }
    catch (error) { return handleConvexError(error, "Failed acquisition cost split"); }
  }) });
}
