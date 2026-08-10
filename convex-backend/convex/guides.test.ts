import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { createTestConvex } from "./test.setup";
import { systemGuideDefinitions } from "../system-guides.generated";

describe("collection guides", () => {
  test("seeds connected art and follows it as exact curated cards", async () => {
    const t = createTestConvex();
    const subject = "guide_collector";
    await t.withIdentity({ subject, name: "Guide Collector" }).mutation(api.users.ensureCurrent, {});
    await t.mutation(internal.guides.seedSystemGuides, {});

    const guides = await t.query(internal.guides.listPublished, { subject });
    expect(guides).toHaveLength(systemGuideDefinitions.length);
    expect(guides.find((guide) => guide.slug === "pokemon-delta-species")?.rule)
      .toMatchObject({ type: "tag", query: "pokemon.delta-species" });
    const connected = guides.find(
      (guide) => guide.slug === "pokemon-crown-zenith-connected-art",
    );
    expect(connected?.rule.type).toBe("manual");

    const items = await t.query(internal.guides.listPublishedItems, {
      subject,
      slug: "pokemon-crown-zenith-connected-art",
    });
    expect(items).toHaveLength(9);
    expect(items.map((item) => item.collectorNumber)).toEqual([
      "GG26",
      "GG27",
      "GG28",
      "GG29",
      "GG30",
      "GG31",
      "GG32",
      "GG33",
      "GG34",
    ]);

    const followed = await t.mutation(internal.guides.follow, {
      subject,
      slug: "pokemon-crown-zenith-connected-art",
    });
    expect(followed.created).toBe(true);

    const persisted = await t.run(async (ctx) => ({
      cards: await ctx.db
        .query("wishlistCards")
        .withIndex("by_wishlist", (query) => query.eq("wishlistId", followed.wishlistId))
        .take(20),
      rules: await ctx.db
        .query("wishlistRules")
        .withIndex("by_wishlist", (query) => query.eq("wishlistId", followed.wishlistId))
        .take(20),
    }));
    expect(persisted.cards).toHaveLength(9);
    expect(persisted.rules).toHaveLength(0);
  });
});
