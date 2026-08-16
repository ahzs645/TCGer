import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_ACTIVITY_ITEMS,
  initialDemoActivityReadIds,
  parseDemoActivityReadIds,
  serializeDemoActivityReadIds,
} from "./demo-activity";

test("starts the older demo activity entries as read", () => {
  const readIds = initialDemoActivityReadIds();
  assert.deepEqual(
    [...readIds].sort(),
    DEMO_ACTIVITY_ITEMS.filter((item) => item.initiallyRead)
      .map((item) => item.id)
      .sort(),
  );
});

test("round trips persisted read state and discards unknown entries", () => {
  const serialized = serializeDemoActivityReadIds([
    "trade-modern-mage",
    "removed-demo-notification",
  ]);
  assert.deepEqual(
    [...parseDemoActivityReadIds(serialized)],
    ["trade-modern-mage"],
  );
});

test("preserves an intentionally empty read state", () => {
  assert.equal(parseDemoActivityReadIds("[]").size, 0);
});

test("falls back to seeded read state for corrupt storage", () => {
  assert.deepEqual(
    [...parseDemoActivityReadIds("not-json")].sort(),
    [...initialDemoActivityReadIds()].sort(),
  );
});
