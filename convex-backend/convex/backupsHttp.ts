import { ConvexError } from "convex/values";
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  normalizePortableBackup,
  type PortableBackup,
} from "../../packages/api-types/src/portable-backup";
import {
  handleConvexError,
  json,
  requireBridgeIdentity,
} from "./lib/httpBridge";

function base64(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
async function exportDocument(
  ctx: ActionCtx,
  subject: string,
  captured?: string,
): Promise<PortableBackup> {
  const result = normalizePortableBackup(
    JSON.parse(
      captured ??
        (await ctx.runQuery(internal.backups.exportData, { subject })),
    ),
  );
  const ownedCopyImages = (result.sections.copyImageStorageIds ?? {}) as Record<
    string,
    Id<"_storage">[]
  >;
  delete result.sections.copyImageStorageIds;
  const retainedId = result.sections.retainedStorageId as
    | Id<"_storage">
    | undefined;
  delete result.sections.retainedStorageId;
  if (retainedId) {
    const retained = await ctx.storage.get(retainedId);
    if (!retained)
      throw new Error("Preserved backup sections could not be read");
    result.sections = {
      ...JSON.parse(await retained.text()),
      ...result.sections,
    };
  }
  const pages = (result.sections.binderPages ?? []) as Array<
    Record<string, any>
  >;
  const images: Record<string, string> = {};
  for (const page of pages) {
    if (page.imageStorageId) {
      const blob = await ctx.storage.get(page.imageStorageId);
      if (!blob)
        throw new Error(`Photo for binder page ${page.pageNumber} is missing`);
      images[page.id] = base64(new Uint8Array(await blob.arrayBuffer()));
    }
    delete page.imageStorageId;
    delete page._importedImageStorageId;
  }
  result.sections.binderPageImages = images;
  const copyImages: Record<string, string[]> = {};
  for (const [copyId, ids] of Object.entries(ownedCopyImages)) {
    copyImages[copyId] = [];
    for (const id of ids) {
      const blob = await ctx.storage.get(id);
      if (!blob) throw new Error("A saved copy photo could not be read");
      copyImages[copyId]!.push(
        base64(new Uint8Array(await blob.arrayBuffer())),
      );
    }
  }
  result.sections.copyImages = {
    ...((result.sections.copyImages ?? {}) as object),
    ...copyImages,
  };
  delete result.sections._importedCopyImages;
  return result;
}
export function registerBackupRoutes(http: HttpRouter) {
  http.route({
    path: "/backups",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(await exportDocument(ctx, identity.subject));
      } catch (error) {
        return handleConvexError(error, "Could not export a complete backup");
      }
    }),
  });
  for (const path of ["/backups", "/backups/recovery"])
    http.route({
      path,
      method: "POST",
      handler: httpAction(async (ctx, request) => {
        const staged: Id<"_storage">[] = [];
        try {
          const identity = await requireBridgeIdentity(ctx, request);
          let backup: PortableBackup;
          if (path.endsWith("/recovery")) {
            const recoveryId = await ctx.runQuery(internal.backups.recovery, {
              subject: identity.subject,
            });
            const recovery = recoveryId && (await ctx.storage.get(recoveryId));
            if (!recovery) throw new Error("No recovery point is available");
            backup = normalizePortableBackup(JSON.parse(await recovery.text()));
          } else {
            const raw = await request.text();
            if (raw.length > 48 * 1024 * 1024)
              throw new Error("Backup exceeds the 48 MB upload limit");
            try {
              backup = normalizePortableBackup(JSON.parse(raw));
            } catch (error) {
              throw new ConvexError({
                code: "BAD_REQUEST",
                message:
                  error instanceof Error
                    ? error.message
                    : "Invalid backup document",
              });
            }
          }
          // Read the current durable state before uploading or changing anything.
          const expectedSnapshot = await ctx.runQuery(
            internal.backups.exportData,
            { subject: identity.subject },
          );
          const before = await exportDocument(
            ctx,
            identity.subject,
            expectedSnapshot,
          );
          const recoveryStorageId = await ctx.storage.store(
            new Blob([JSON.stringify(before)], { type: "application/json" }),
          );
          staged.push(recoveryStorageId);
          const sectionsStorageId = await ctx.storage.store(
            new Blob(
              [
                JSON.stringify(
                  path.endsWith("/recovery")
                    ? backup.sections
                    : { ...before.sections, ...backup.sections },
                ),
              ],
              { type: "application/json" },
            ),
          );
          staged.push(sectionsStorageId);
          const pages = (backup.sections.binderPages ?? []) as Array<
            Record<string, any>
          >;
          const images = (backup.sections.binderPageImages ?? {}) as Record<
            string,
            string
          >;
          for (const page of pages) {
            delete page._importedImageStorageId;
            delete page.imageStorageId;
            if (images[page.id]) {
              const binary = atob(images[page.id]!);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              const storageId = await ctx.storage.store(
                new Blob([bytes], { type: "image/jpeg" }),
              );
              staged.push(storageId);
              page._importedImageStorageId = storageId;
            }
          }
          const copyImages = (backup.sections.copyImages ?? {}) as Record<
            string,
            string[]
          >;
          const importedCopyImages: Record<string, Id<"_storage">[]> = {};
          for (const [copyId, images] of Object.entries(copyImages)) {
            importedCopyImages[copyId] = [];
            for (const image of images) {
              const binary = atob(image);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              const storageId = await ctx.storage.store(
                new Blob([bytes], { type: "image/jpeg" }),
              );
              staged.push(storageId);
              importedCopyImages[copyId]!.push(storageId);
            }
          }
          backup.sections._importedCopyImages = importedCopyImages;
          // Binary payloads stay in storage; only identifiers cross the mutation boundary.
          delete backup.sections.binderPageImages;
          delete backup.sections.copyImages;
          const result = await ctx.runMutation(internal.backups.importData, {
            subject: identity.subject,
            document: JSON.stringify(backup),
            sectionsStorageId,
            recoveryStorageId,
            expectedSnapshot,
            replace: path.endsWith("/recovery"),
          });
          return json({ ...result, recoveryAvailable: true });
        } catch (error) {
          await Promise.all(staged.map((id) => ctx.storage.delete(id)));
          return handleConvexError(
            error,
            error instanceof Error
              ? error.message
              : "Backup import failed; no data was changed",
          );
        }
      }),
    });
}
