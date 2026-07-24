import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { createTestConvex } from "./test.setup";

describe("transactional collection Bulk Add", () => {
  test("creates one physical entry per copy and preserves exact printing variants", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "bulk_avery", name: "Avery" });
    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Bulk Binder"
    });

    const result = await asAvery.mutation(api.collections.bulkAdd, {
      defaults: {
        binderId: binder.id,
        condition: "NM",
        language: "EN"
      },
      rows: [
        {
          rowId: "dark-magician-lob",
          quantity: 2,
          card: {
            tcg: "yugioh",
            externalId: "yugioh:print:v1:46986414:LOB-EN005:ultra:46986414",
            baseExternalId: "46986414",
            printingKey: "yugioh:print:v1:46986414:LOB-EN005:ultra:46986414",
            artworkId: "46986414",
            name: "Dark Magician",
            setCode: "LOB-EN005",
            rarity: "Ultra Rare",
            collectorNumber: "005"
          },
          overrides: {
            finishCode: "holo",
            finishLabel: "Holo",
            edition: "1st Edition"
          }
        },
        {
          rowId: "dark-magician-lart",
          card: {
            tcg: "yugioh",
            externalId: "yugioh:print:v1:46986414:LART-EN019:ultra:999",
            baseExternalId: "46986414",
            printingKey: "yugioh:print:v1:46986414:LART-EN019:ultra:999",
            artworkId: "999",
            name: "Dark Magician",
            setCode: "LART-EN019",
            rarity: "Ultra Rare",
            collectorNumber: "019"
          },
          overrides: {
            isSealedPromo: true
          }
        }
      ]
    });

    expect(result).toMatchObject({ addedRows: 2, addedCopies: 3 });
    expect(new Set(result.entryIds).size).toBe(3);

    const detail = await asAvery.query(api.binders.get, { binderId: binder.id });
    expect(detail.entries).toHaveLength(3);
    expect(detail.entries.every((entry) => entry.quantity === 1)).toBe(true);
    expect(
      detail.entries.filter((entry) => entry.card.setCode === "LOB-EN005")
    ).toHaveLength(2);
    expect(
      detail.entries.find((entry) => entry.card.setCode === "LART-EN019")
    ).toMatchObject({
      isSealedPromo: true,
      card: { artworkId: "999" }
    });
  });

  test("rolls back every write when a later staged row fails", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "bulk_rollback", name: "Avery" });
    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Rollback Binder"
    });

    await expect(
      asAvery.mutation(api.collections.bulkAdd, {
        defaults: { binderId: binder.id },
        rows: [
          {
            rowId: "valid-first-row",
            card: {
              tcg: "pokemon",
              externalId: "base1-4",
              printingKey: "pokemon:base1-4",
              name: "Charizard",
              setCode: "base1"
            }
          },
          {
            rowId: "invalid-later-row",
            card: {
              tcg: "pokemon",
              externalId: "base1-2",
              printingKey: "pokemon:base1-2",
              name: "Blastoise",
              setCode: "base1"
            },
            overrides: {
              newTags: [{ label: " " }]
            }
          }
        ]
      })
    ).rejects.toThrow("Tag label is required");

    const detail = await asAvery.query(api.binders.get, { binderId: binder.id });
    expect(detail.entries).toEqual([]);
    const persisted = await t.run(async (ctx) => ({
      cards: await ctx.db.query("cards").take(10),
      audits: await ctx.db.query("collectionMutationAudits").take(10)
    }));
    expect(persisted.cards).toEqual([]);
    expect(persisted.audits).toEqual([]);
  });
});
