import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

describe("administrator bootstrap", () => {
  test("a stale setup-required observation cannot promote a second administrator", async () => {
    const t = createTestConvex();
    // Both callers can observe the same empty state. The mutation must check
    // again inside its own transaction, including direct internal callers.
    expect(await t.query(internal.bridge.getSetupRequired, {})).toBe(true);
    expect(await t.query(internal.bridge.getSetupRequired, {})).toBe(true);
    await t.mutation(internal.bridge.promoteViewerToAdmin, { subject: "first-admin", email: "first@example.com" });
    await expect(t.mutation(internal.bridge.promoteViewerToAdmin, { subject: "second-admin", email: "second@example.com" }))
      .rejects.toThrow("Admin user already exists");
    const admins = await t.run((ctx) => ctx.db.query("users").withIndex("by_is_admin", (q) => q.eq("isAdmin", true)).collect());
    expect(admins.map((user) => user.authSubject)).toEqual(["first-admin"]);
  });

  test("the HTTP endpoint reports a conflict after setup", async () => {
    const t = createTestConvex();
    const headers = (id: string) => ({ Authorization: "Bearer local-test-token", "x-tcger-bridge-key": TEST_BRIDGE_SECRET, "x-tcger-user-id": id });
    expect((await t.fetch("/setup/setup", { method: "POST", headers: headers("first") })).status).toBe(200);
    expect((await t.fetch("/setup/setup", { method: "POST", headers: headers("second") })).status).toBe(409);
  });
});
