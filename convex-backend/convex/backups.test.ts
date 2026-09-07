import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../mobile-parity/fixtures/portable-backup-v2.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const headers = (subject: string) => ({
  Authorization: "Bearer local-test-token",
  "Content-Type": "application/json",
  "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
  "x-tcger-user-id": subject,
  "x-tcger-user-email": `${subject}@example.com`,
  "x-tcger-username": subject,
});
describe("portable backup HTTP transactions", () => {
  test("imports preserve physical copies metadata and future sections, and reimport is idempotent", async () => {
    const t = createTestConvex();
    const auth = headers("backup-owner");
    for (let i = 0; i < 2; i++) {
      const response = await t.fetch("/backups", {
        method: "POST",
        headers: auth,
        body: JSON.stringify(fixture),
      });
      expect(await response.json()).toMatchObject({
        importedCopies: 3,
        importedBinders: 1,
      });
      expect(response.status).toBe(200);
    }
    const response = await t.fetch("/backups", { headers: auth });
    expect(response.status).toBe(200);
    const exported = await response.json();
    const cards = exported.binders.flatMap((b: any) => b.cards);
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c: any) => c.id)).size).toBe(3);
    expect(
      cards.find((c: any) => c.details.serialNumber === "physical-1"),
    ).toMatchObject({
      condition: "LP",
      price: 10.5,
      acquisitionPrice: 4.25,
      details: { gradingCompany: "PSA", gradingScore: "9" },
    });
    expect(exported.sections.futureFeature).toEqual(
      fixture.sections.futureFeature,
    );
    expect(exported.sections.transactions).toHaveLength(1);
    expect(exported.sections.onlineCodes).toHaveLength(1);
  });
  test("a late validation error rolls back all preceding writes", async () => {
    const t = createTestConvex();
    const auth = headers("backup-failure");
    const bad = structuredClone(fixture);
    bad.sections.onlineCodes[0].status = "not-a-status";
    const result = await t.fetch("/backups", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(bad),
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    const state = await (await t.fetch("/backups", { headers: auth })).json();
    expect(state.binders.flatMap((b: any) => b.cards)).toHaveLength(0);
    expect(state.sections.transactions).toHaveLength(0);
  });
  test("recovery restores the earlier state without touching another account", async () => {
    const t = createTestConvex();
    const a = headers("backup-a"),
      b = headers("backup-b");
    for (const auth of [a, b])
      expect(
        (
          await t.fetch("/backups", {
            method: "POST",
            headers: auth,
            body: JSON.stringify(fixture),
          })
        ).status,
      ).toBe(200);
    expect(
      (await t.fetch("/backups/recovery", { method: "POST", headers: a }))
        .status,
    ).toBe(200);
    const restored = await (await t.fetch("/backups", { headers: a })).json();
    expect(
      restored.binders.flatMap((binder: any) => binder.cards),
    ).toHaveLength(0);
    expect(restored.wishlists).toHaveLength(0);
    expect(restored.sections.onlineCodes).toHaveLength(0);
    expect(restored.sections.transactions).toHaveLength(0);
    const untouched = await (await t.fetch("/backups", { headers: b })).json();
    expect(
      untouched.binders.flatMap((binder: any) => binder.cards),
    ).toHaveLength(3);
  });
});
