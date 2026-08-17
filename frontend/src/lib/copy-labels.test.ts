import assert from "node:assert/strict";
import test from "node:test";

import {
  copyCountNoun,
  copyEditAriaLabel,
  copyOrdinalLabel,
  formatCopyCount,
  formatTotalCopyCount,
  individualCopiesLabel,
} from "./copy-labels";

test("omits a redundant ordinal when there is only one copy", () => {
  assert.equal(copyOrdinalLabel(0, 1), null);
  assert.equal(
    copyEditAriaLabel({
      cardName: "Darkrai",
      condition: "Near Mint",
      copyIndex: 0,
      copyCount: 1,
    }),
    "Edit Darkrai copy, Near Mint",
  );
  assert.equal(individualCopiesLabel(1), "Individual copy");
  assert.equal(copyCountNoun(1), "copy");
  assert.equal(formatCopyCount(1), "1 copy");
  assert.equal(formatTotalCopyCount(1), "1 total copy");
});

test("keeps copy ordinals when they distinguish multiple copies", () => {
  assert.equal(copyOrdinalLabel(0, 2), "#1");
  assert.equal(copyOrdinalLabel(1, 2), "#2");
  assert.equal(
    copyEditAriaLabel({
      cardName: "Darkrai",
      condition: "Near Mint",
      copyIndex: 1,
      copyCount: 2,
    }),
    "Edit Darkrai copy 2, Near Mint",
  );
  assert.equal(individualCopiesLabel(2), "Individual copies");
  assert.equal(copyCountNoun(0), "copies");
  assert.equal(copyCountNoun(2), "copies");
  assert.equal(formatCopyCount(2), "2 copies");
  assert.equal(formatTotalCopyCount(0), "0 total copies");
  assert.equal(formatTotalCopyCount(2), "2 total copies");
});
