import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

const headers = (subject = "page-owner") => ({
  Authorization: "Bearer test",
  "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
  "x-tcger-user-id": subject,
  "x-tcger-user-email": `${subject}@example.com`,
});
const capturedAt = "2026-10-31T12:00:00.000Z";
const placement = {
  slotIndex: 0, cardId: "physical-copy-a", name: "Saved card", tcg: "pokemon", confidence: 1, status: "matched",
  quad: { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } },
};

async function fixture() {
  const t = createTestConvex();
  const binderId = await t.run(async ctx => {
    const fields = { isAdmin: false, showCardNumbers: true, showPricing: true, enabledMagic: true, enabledPokemon: true, enabledYugioh: true, createdAt: 1, updatedAt: 1 };
    const userId = await ctx.db.insert("users", { ...fields, authSubject: "page-owner" });
    await ctx.db.insert("users", { ...fields, authSubject: "page-other" });
    return ctx.db.insert("binders", { userId, kind: "binder", name: "Page recovery", createdAt: 1, updatedAt: 1 });
  });
  const path = `/collections/${binderId}/pages/1`;
  const put = (body: unknown, subject?: string) => t.fetch(path, {
    method: "PUT", headers: { ...headers(subject), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const upload = (revision: string, subject?: string) => {
    const form = new FormData();
    form.set("image", new Blob(["reviewed photo"], { type: "image/png" }), "page.png");
    form.set("expectedRevision", revision);
    return t.fetch(`${path}/image`, { method: "POST", headers: headers(subject), body: form });
  };
  return { t, binderId, path, put, upload };
}

describe("binder page recovery revision guards", () => {
  test("create-only and stale edits preserve the latest page and exact placement identity", async () => {
    const { t, binderId, put } = await fixture();
    const frozen = { expectedRevision: 0, capturedAt, placements: [placement] };
    const created = await put(frozen);
    expect(created.status).toBe(200);
    const original = await created.json();
    expect(original).toMatchObject({ revision: 1, capturedAt, placements: [placement] });
    expect((await put(frozen)).status).toBe(409);
    expect((await put({ ...frozen, expectedRevision: 1 }, "page-other")).status).toBe(404);
    const replacement = { ...frozen, expectedRevision: 1, capturedAt: "2026-10-31T13:00:00.000Z", placements: [{ ...placement, name: "Later edit" }] };
    const changed = await put(replacement);
    expect(changed.status).toBe(200);
    const current = await changed.json();
    expect(current).toMatchObject({ id: original.id, revision: 2, capturedAt: replacement.capturedAt, placements: replacement.placements });
    expect((await put({ ...frozen, expectedRevision: 1 })).status).toBe(409);
    expect(await t.query(internal.bridge.listBinderPages, { subject: "page-owner", binderId })).toEqual([current]);
    expect(await t.run(ctx => ctx.db.query("collectionEntries").collect())).toEqual([]);
    for (const expectedRevision of [-1, 0.5, "1", null]) {
      expect((await put({ ...frozen, expectedRevision })).status).toBe(400);
    }
  });

  test("a lost image response cannot overwrite a newer page or leak rejected upload blobs", async () => {
    const { t, binderId, path, put, upload } = await fixture();
    expect((await put({ expectedRevision: 0, capturedAt, placements: [placement] })).status).toBe(200);
    const uploaded = await upload("1");
    expect(uploaded.status).toBe(201);
    const committed = await uploaded.json();
    expect(committed.revision).toBe(2);
    expect(committed.imageUrl).toBeTruthy();
    const committedPage = await t.run(ctx => ctx.db.query("binderPages").first());
    expect(committedPage?.imageStorageId).toBeTruthy();
    const blobBefore = await t.run(async ctx => (await ctx.storage.get(committedPage!.imageStorageId!))?.text());
    expect(blobBefore).toBe("reviewed photo");
    expect((await upload("1")).status).toBe(409);
    expect((await upload("2", "page-other")).status).toBe(404);
    expect(await t.query(internal.bridge.listBinderPages, { subject: "page-owner", binderId })).toEqual([committed]);
    expect(await t.run(ctx => ctx.db.system.query("_storage").collect())).toHaveLength(1);
    expect((await upload("0")).status).toBe(400);
    expect((await upload("1.5")).status).toBe(400);
    expect((await t.fetch(`${path}/image`, { method: "DELETE", headers: headers() })).status).toBe(204);
    const [removed] = await t.query(internal.bridge.listBinderPages, { subject: "page-owner", binderId });
    expect(removed.revision).toBe(3);
    expect(removed.imageUrl).toBeUndefined();
    expect(await t.run(ctx => ctx.db.system.query("_storage").collect())).toHaveLength(0);
    expect((await upload("2")).status).toBe(409);
    expect(await t.run(ctx => ctx.db.system.query("_storage").collect())).toHaveLength(0);
  });
});
