import assert from "node:assert/strict";
import test from "node:test";

import { validateMetadataContract } from "./publish-ios-scan-pack.mjs";

function magicRow(overrides = {}) {
  return {
    annIndex: 0,
    cardId: "printing-a",
    exactPrintingId: "printing-a",
    recognitionFamilyId: "magic:visual:oracle-a:art-a:style",
    visualIdentityId: "magic:printing:printing-a:front",
    name: "Shared Art",
    game: "magic",
    imageURL: "https://example.invalid/a.jpg",
    setCode: "one",
    collectorNumber: "10",
    releaseDate: "2024-02-02",
    faceSide: "front",
    printings: [{
      cardId: "printing-a",
      exactPrintingId: "printing-a",
      imageURL: "https://example.invalid/a.jpg",
      setCode: "one",
      collectorNumber: "10",
      releaseDate: "2024-02-02",
    }],
    ...overrides,
  };
}

test("Magic scanner metadata includes exact-print verification fields", () => {
  assert.doesNotThrow(() => validateMetadataContract([magicRow()], "magic"));
  assert.throws(
    () => validateMetadataContract([magicRow({ collectorNumber: null })], "magic"),
    /collectorNumber/,
  );
});

test("Magic scanner metadata remains row-aligned with packed vectors", () => {
  const second = magicRow({
    annIndex: 1,
    cardId: "printing-b",
    exactPrintingId: "printing-b",
    visualIdentityId: "magic:printing:printing-b:front",
  });
  assert.throws(
    () => validateMetadataContract([second, magicRow({ annIndex: 1 })], "magic"),
    /annIndex mismatch/,
  );
});
