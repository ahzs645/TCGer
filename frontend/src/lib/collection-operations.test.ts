import assert from "node:assert/strict";
import test from "node:test";

import { allocateCostCents, collectorNumberKey } from "./collection-operations";

test("cost allocation preserves every cent for equal shares", () => {
  const result = allocateCostCents(1000, [
    { copyId: "a", weight: 1 },
    { copyId: "b", weight: 1 },
    { copyId: "c", weight: 1 },
  ]);
  assert.deepEqual(
    result.map((line) => line.amountCents),
    [334, 333, 333],
  );
  assert.equal(
    result.reduce((sum, line) => sum + line.amountCents, 0),
    1000,
  );
});

test("cost allocation supports proportional shares", () => {
  const result = allocateCostCents(999, [
    { copyId: "one", weight: 1 },
    { copyId: "two", weight: 2 },
  ]);
  assert.deepEqual(
    result.map((line) => line.amountCents),
    [333, 666],
  );
});

test("collector numbers normalize typing-friendly prefixes", () => {
  assert.equal(collectorNumberKey("  #025/165 "), "025/165");
});
