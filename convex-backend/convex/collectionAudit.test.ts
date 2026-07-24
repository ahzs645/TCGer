import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { createTestConvex } from "./test.setup";

describe("collection mutation audit", () => {
  test("records immutable history and applies an idempotent safe undo", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "audit_avery", name: "Avery" });
    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Audit Binder"
    });
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      card: {
        tcg: "magic",
        externalId: "audit-card",
        name: "Audit Card"
      }
    });

    const history = await asAvery.query(api.collections.history, {});
    expect(history[0]).toMatchObject({
      operationKind: "add",
      affectedCopies: 1,
      canUndo: true
    });

    const firstUndo = await asAvery.mutation(api.collections.undo, {
      auditId: history[0]!.id,
      idempotencyKey: "audit-undo-request-1"
    });
    const repeatedUndo = await asAvery.mutation(api.collections.undo, {
      auditId: history[0]!.id,
      idempotencyKey: "audit-undo-request-1"
    });
    expect(repeatedUndo.id).toBe(firstUndo.id);

    const detail = await asAvery.query(api.binders.get, {
      binderId: binder.id
    });
    expect(detail.entries).toHaveLength(0);
    const after = await asAvery.query(api.collections.history, {});
    expect(after[0]?.operationKind).toBe("undo");
    expect(after.find((entry) => entry.id === history[0]!.id)?.canUndo).toBe(
      false
    );
  });

  test("refuses undo when the affected entry has diverged", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "audit_jordan", name: "Jordan" });
    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Divergence Binder"
    });
    const entry = await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      card: {
        tcg: "pokemon",
        externalId: "divergent-card",
        name: "Divergent Card"
      }
    });
    const addAudit = (await asAvery.query(api.collections.history, {}))[0]!;
    await asAvery.mutation(api.collections.update, {
      entryId: entry.id,
      notes: "Changed after the original mutation"
    });

    await expect(
      asAvery.mutation(api.collections.undo, {
        auditId: addAudit.id,
        idempotencyKey: "audit-undo-diverged"
      })
    ).rejects.toThrow(/affected collection copies have changed/i);
  });
});
