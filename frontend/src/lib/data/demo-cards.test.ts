import assert from "node:assert/strict";
import test from "node:test";

import { isSyntheticDemoCardId, splitDemoPrintingCode } from "./demo-cards";

test("splits demo printing codes into routable set and collector values", () => {
  assert.deepEqual(splitDemoPrintingCode("MH2-138"), {
    setCode: "MH2",
    collectorNumber: "138",
  });
  assert.deepEqual(splitDemoPrintingCode("LOB-070"), {
    setCode: "LOB",
    collectorNumber: "070",
  });
});

test("leaves a set-only demo code intact", () => {
  assert.deepEqual(splitDemoPrintingCode("PROMO"), {
    setCode: "PROMO",
  });
});

test("recognizes only seeded demo card identifiers", () => {
  assert.equal(isSyntheticDemoCardId("mtg-004"), true);
  assert.equal(isSyntheticDemoCardId("external-card-004"), false);
});
