import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getLibraryBinder, toIso } from "./domain";

type ReaderCtx = QueryCtx | MutationCtx;

export async function requireIdentity(ctx: ReaderCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authentication is required"
    });
  }
  return identity;
}

export async function getViewer(ctx: ReaderCtx): Promise<Doc<"users"> | null> {
  const identity = await requireIdentity(ctx);
  return await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
    .unique();
}

export async function requireViewer(ctx: ReaderCtx): Promise<Doc<"users">> {
  const viewer = await getViewer(ctx);
  if (!viewer) {
    throw new ConvexError({
      code: "USER_NOT_PROVISIONED",
      message: "Run users.ensureCurrent before using the library"
    });
  }
  return viewer;
}

export async function buildViewerResponse(ctx: ReaderCtx, viewer: Doc<"users">) {
  const libraryBinder = await getLibraryBinder(ctx, viewer._id);
  if (!libraryBinder) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Library binder is missing for the current user"
    });
  }

  return {
    id: viewer._id,
    authSubject: viewer.authSubject,
    email: viewer.email,
    name: viewer.name,
    username: viewer.username,
    isAdmin: viewer.isAdmin,
    showCardNumbers: viewer.showCardNumbers,
    showPricing: viewer.showPricing,
    enabledYugioh: viewer.enabledYugioh,
    enabledMagic: viewer.enabledMagic,
    enabledPokemon: viewer.enabledPokemon,
    defaultGame: viewer.defaultGame,
    libraryBinderId: libraryBinder._id,
    createdAt: toIso(viewer.createdAt),
    updatedAt: toIso(viewer.updatedAt)
  };
}
