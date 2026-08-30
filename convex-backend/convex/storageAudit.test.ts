import { describe, expect, test } from "vitest";
import { reconcileStorageAudit } from "./lib/storageAudit";

describe("physical storage audit reconciliation", () => {
  test("reports correct, missing, wrong, and extra slots", () => {
    const common = { compartmentId: "page-1", compartmentLabel: "Page 1", quantity: 1 };
    const result = reconcileStorageAudit(
      [
        { ...common, slotIndex: 0, externalId: "a", name: "A" },
        { ...common, slotIndex: 1, externalId: "b", name: "B" },
        { ...common, slotIndex: 2, externalId: "c", name: "C" },
      ],
      [
        { ...common, slotIndex: 0, externalId: "a", name: "A" },
        { ...common, slotIndex: 2, externalId: "x", name: "Wrong" },
        { ...common, slotIndex: 3, externalId: "d", name: "Extra" },
      ],
    );
    expect(result.summary).toEqual({ correct: 1, missing: 1, wrong: 1, extra: 1 });
    expect(result.items.map((item) => item.status)).toEqual(["correct", "missing", "wrong", "extra"]);
  });

  test("does not confuse matching external ids from different games", () => {
    const common = {
      compartmentId: "page-1",
      compartmentLabel: "Page 1",
      slotIndex: 0,
      externalId: "shared-001",
      name: "Shared number",
      quantity: 1,
    };
    const result = reconcileStorageAudit(
      [{ ...common, tcg: "pokemon" }],
      [{ ...common, tcg: "magic" }],
    );
    expect(result.summary).toEqual({ correct: 0, missing: 0, wrong: 1, extra: 0 });
  });
});
