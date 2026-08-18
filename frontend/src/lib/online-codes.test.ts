import assert from "node:assert/strict";
import test from "node:test";

import {
  getOnlineCodeGame,
  groupOnlineCodes,
  normalizeOnlineCode,
  parseOnlineCodeInput,
} from "./online-codes";

test("online code input trims, deduplicates, and preserves display formatting", () => {
  assert.deepEqual(
    parseOnlineCodeInput(" abcd-1234 \nABCD-1234, WXYZ-9876\nno"),
    ["abcd-1234", "WXYZ-9876"],
  );
  assert.equal(normalizeOnlineCode(" ab cd-1234 "), "ABCD-1234");
});

test("accepts and identifies printed MTG Arena redemption codes", () => {
  const code = "ABCDE-12345-FGHIJ-67890-KLMNO";
  assert.deepEqual(parseOnlineCodeInput(`${code}\n${code.toLowerCase()}`), [
    code,
  ]);
  assert.equal(getOnlineCodeGame("magic").service, "MTG Arena");
});

test("online codes are grouped into redemption blocks", () => {
  assert.deepEqual(groupOnlineCodes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
