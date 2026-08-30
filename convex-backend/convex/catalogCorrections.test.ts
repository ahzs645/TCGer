import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import { createTestConvex } from "./test.setup";

async function seedUsers() {
  const t = createTestConvex();
  await t.run(async (ctx) => {
    const timestamp = Date.now();
    for (const user of [
      { authSubject: "catalog-admin", email: "admin@example.test", isAdmin: true },
      { authSubject: "catalog-viewer", email: "viewer@example.test", isAdmin: false },
    ]) {
      await ctx.db.insert("users", {
        ...user,
        showCardNumbers: true,
        showPricing: true,
        enabledYugioh: true,
        enabledMagic: true,
        enabledPokemon: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  });
  return t;
}

describe("catalog correction overlays", () => {
  test("keeps provider identity immutable and resolves the newest revision", async () => {
    const t = await seedUsers();
    const first = await t.mutation(internal.catalogCorrections.create, {
      subject: "catalog-admin",
      tcg: "yugioh",
      targetType: "printing",
      targetKey: "yugioh:print:lob-en005",
      patch: { rarity: "Ultra Rare", attributes: { atk: 2500 } },
      reason: "Correct provider rarity and attack",
    });
    const second = await t.mutation(internal.catalogCorrections.create, {
      subject: "catalog-admin",
      tcg: "yugioh",
      targetType: "printing",
      targetKey: "yugioh:print:lob-en005",
      patch: { rarity: "Quarter Century Secret Rare", attributes: { atk: 2500 } },
      reason: "Correct exact reprint rarity",
    });

    const effective = await t.query(internal.catalogCorrections.listEffective, {
      subject: "catalog-viewer",
      tcg: "yugioh",
    });
    expect(effective).toHaveLength(1);
    expect(effective[0]).toMatchObject({
      id: second.id,
      revision: 2,
      targetKey: "yugioh:print:lob-en005",
      patch: { rarity: "Quarter Century Secret Rare" },
    });

    const rolledBack = await t.mutation(internal.catalogCorrections.rollback, {
      subject: "catalog-admin",
      correctionId: second.id,
    });
    expect(rolledBack).toMatchObject({
      revision: 3,
      action: "upsert",
      patch: first.patch,
    });
  });

  test("rejects non-admin mutations", async () => {
    const t = await seedUsers();
    await expect(
      t.mutation(internal.catalogCorrections.create, {
        subject: "catalog-viewer",
        tcg: "yugioh",
        targetType: "identity",
        targetKey: "46986414",
        patch: { name: "Dark Magician" },
        reason: "Attempted correction",
      }),
    ).rejects.toThrow("Admin access required");
  });
});
