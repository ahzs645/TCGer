import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const psaCacheValidator = v.union(
  v.null(),
  v.object({
    certNumber: v.string(),
    grader: v.literal("PSA"),
    grade: v.optional(v.number()),
    gradeLabel: v.optional(v.string()),
    labelType: v.optional(v.string()),
    year: v.optional(v.string()),
    brand: v.optional(v.string()),
    subject: v.optional(v.string()),
    searchableName: v.optional(v.string()),
    cardNumber: v.optional(v.string()),
    variety: v.optional(v.string()),
    category: v.optional(v.string()),
    population: v.optional(v.number()),
    populationHigher: v.optional(v.number()),
    specId: v.optional(v.string()),
    cardId: v.optional(v.id("cards")),
    providerResponseHash: v.string(),
    retrievedAt: v.string(),
    refreshAfter: v.string(),
    cached: v.boolean(),
  }),
);

type PsaCacheRow = Pick<
  Doc<"psaCertCache">,
  | "certNumber"
  | "cardId"
  | "grade"
  | "gradeLabel"
  | "labelType"
  | "year"
  | "brand"
  | "subject"
  | "searchableName"
  | "cardNumber"
  | "variety"
  | "category"
  | "population"
  | "populationHigher"
  | "specId"
  | "providerResponseHash"
  | "retrievedAt"
  | "refreshAfter"
>;

function toPsaCache(row: PsaCacheRow, cached: boolean) {
  return {
    certNumber: row.certNumber,
    grader: "PSA" as const,
    grade: row.grade,
    gradeLabel: row.gradeLabel,
    labelType: row.labelType,
    year: row.year,
    brand: row.brand,
    subject: row.subject,
    searchableName: row.searchableName,
    cardNumber: row.cardNumber,
    variety: row.variety,
    category: row.category,
    population: row.population,
    populationHigher: row.populationHigher,
    specId: row.specId,
    cardId: row.cardId,
    providerResponseHash: row.providerResponseHash,
    retrievedAt: new Date(row.retrievedAt).toISOString(),
    refreshAfter: new Date(row.refreshAfter).toISOString(),
    cached,
  };
}

export const getPsaCert = internalQuery({
  args: { certNumber: v.string() },
  returns: psaCacheValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("psaCertCache")
      .withIndex("by_cert_number", (q) => q.eq("certNumber", args.certNumber))
      .unique();
    return row ? toPsaCache(row, true) : null;
  },
});

export const putPsaCert = internalMutation({
  args: {
    certNumber: v.string(),
    grade: v.optional(v.number()),
    gradeLabel: v.optional(v.string()),
    labelType: v.optional(v.string()),
    year: v.optional(v.string()),
    brand: v.optional(v.string()),
    subject: v.optional(v.string()),
    searchableName: v.optional(v.string()),
    cardNumber: v.optional(v.string()),
    variety: v.optional(v.string()),
    category: v.optional(v.string()),
    population: v.optional(v.number()),
    populationHigher: v.optional(v.number()),
    specId: v.optional(v.string()),
    providerResponseHash: v.string(),
    retrievedAt: v.string(),
    refreshAfter: v.string(),
  },
  returns: psaCacheValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("psaCertCache")
      .withIndex("by_cert_number", (q) => q.eq("certNumber", args.certNumber))
      .unique();
    const value = {
      certNumber: args.certNumber,
      grade: args.grade,
      gradeLabel: args.gradeLabel,
      labelType: args.labelType,
      year: args.year,
      brand: args.brand,
      subject: args.subject,
      searchableName: args.searchableName,
      cardNumber: args.cardNumber,
      variety: args.variety,
      category: args.category,
      population: args.population,
      populationHigher: args.populationHigher,
      specId: args.specId,
      providerResponseHash: args.providerResponseHash,
      retrievedAt: Date.parse(args.retrievedAt),
      refreshAfter: Date.parse(args.refreshAfter),
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("psaCertCache", value);
    const row = existing ? { ...existing, ...value } : value;
    return toPsaCache(row, false);
  },
});
