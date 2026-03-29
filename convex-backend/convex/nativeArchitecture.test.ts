import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

describe("convex native architecture", () => {
  test("provisions an authenticated viewer with a default library binder", async () => {
    const t = convexTest(schema, modules);
    const asAvery = t.withIdentity({
      subject: "user_avery",
      email: "avery@example.com",
      name: "Avery"
    });

    const viewer = await asAvery.mutation(api.users.ensureCurrent, {
      username: "avery"
    });
    const binders = await asAvery.query(api.binders.list);

    expect(viewer.authSubject).toBe("user_avery");
    expect(viewer.username).toBe("avery");
    expect(binders).toHaveLength(1);
    expect(binders[0]).toMatchObject({
      kind: "library",
      name: "Library"
    });
  });

  test("creates a native binder and isolates data per user", async () => {
    const t = convexTest(schema, modules);
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });
    const asJordan = t.withIdentity({ subject: "user_jordan", name: "Jordan" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    await asJordan.mutation(api.users.ensureCurrent, {});
    await asAvery.mutation(api.binders.create, {
      name: "Trade Binder",
      colorHex: "22c55e"
    });

    const averyBinders = await asAvery.query(api.binders.list);
    const jordanBinders = await asJordan.query(api.binders.list);

    expect(averyBinders.map((binder) => binder.name)).toEqual(["Library", "Trade Binder"]);
    expect(jordanBinders.map((binder) => binder.name)).toEqual(["Library"]);
  });

  test("adds cards to a binder with native tags and returns hydrated entries", async () => {
    const t = convexTest(schema, modules);
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Commander Staples",
      colorHex: "2563eb"
    });

    const entry = await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      quantity: 2,
      card: {
        tcg: "magic",
        externalId: "smothering-tithe",
        name: "Smothering Tithe",
        setCode: "RNA",
        setName: "Ravnica Allegiance",
        rarity: "Rare",
        imageUrl: "https://example.com/tithe.jpg"
      },
      newTags: [
        { label: "For Trade", colorHex: "4caf50" },
        { label: "Staple", colorHex: "f59e0b" }
      ]
    });

    const detail = await asAvery.query(api.binders.get, { binderId: binder.id });

    expect(entry.card.name).toBe("Smothering Tithe");
    expect(entry.quantity).toBe(2);
    expect(entry.tags.map((tag) => tag.label).sort()).toEqual(["For Trade", "Staple"]);
    expect(detail.entryCount).toBe(1);
    expect(detail.entries[0].card.externalId).toBe("smothering-tithe");
  });

  test("updates and moves entries between binders", async () => {
    const t = convexTest(schema, modules);
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    const tradeBinder = await asAvery.mutation(api.binders.create, {
      name: "Trade Binder",
      colorHex: "22c55e"
    });
    const pcBinder = await asAvery.mutation(api.binders.create, {
      name: "Personal Collection",
      colorHex: "ef4444"
    });

    const created = await asAvery.mutation(api.collections.addToBinder, {
      binderId: tradeBinder.id,
      card: {
        tcg: "pokemon",
        externalId: "sv1-001",
        name: "Bulbasaur",
        setCode: "SV1"
      }
    });

    const updated = await asAvery.mutation(api.collections.update, {
      entryId: created.id,
      binderId: pcBinder.id,
      quantity: 3,
      notes: "Moved into PC"
    });

    const tradeDetail = await asAvery.query(api.binders.get, { binderId: tradeBinder.id });
    const pcDetail = await asAvery.query(api.binders.get, { binderId: pcBinder.id });

    expect(updated.quantity).toBe(3);
    expect(updated.notes).toBe("Moved into PC");
    expect(updated.binderId).toBe(pcBinder.id);
    expect(tradeDetail.entryCount).toBe(0);
    expect(pcDetail.entryCount).toBe(1);
  });

  test("serves a native health endpoint through Convex HTTP actions", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/health");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "ok",
      backend: "convex-native"
    });
  });
});
