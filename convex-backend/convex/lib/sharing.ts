import type { MutationCtx } from "../_generated/server";

export async function createUniqueShareToken(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = crypto.randomUUID().replaceAll("-", "");
    const existing = await ctx.db
      .query("binders")
      .withIndex("by_share_token", (q) => q.eq("shareToken", token))
      .unique();
    if (!existing) return token;
  }
  throw new Error("Failed to generate a unique collection share token");
}
