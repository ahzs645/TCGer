import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeOnlineCode,
  detectOnlineCodeGame,
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

test("extracts a redemption code from its QR URL and deduplicates printed text", () => {
  const code = "ZNM1-B6Z2-4PL3-YYM";
  const url = `https://pokemon.com/redeem?2d_code=${code}`;
  assert.equal(canonicalizeOnlineCode(url), code);
  assert.deepEqual(parseOnlineCodeInput(`${url}\n${code}`), [code]);
  assert.equal(normalizeOnlineCode(url), normalizeOnlineCode(code));
  assert.equal(detectOnlineCodeGame(url), "pokemon");
  assert.equal(detectOnlineCodeGame(code), "pokemon");
});

test("accepts and identifies printed MTG Arena redemption codes", () => {
  const code = "ABCDE-12345-FGHIJ-67890-KLMNO";
  assert.deepEqual(parseOnlineCodeInput(`${code}\n${code.toLowerCase()}`), [
    code,
  ]);
  assert.equal(getOnlineCodeGame("magic").service, "MTG Arena");
  assert.equal(detectOnlineCodeGame(code), "magic");
  assert.equal(
    detectOnlineCodeGame("https://magic.wizards.com/en/mtgarena/redeem"),
    "magic",
  );
  assert.equal(detectOnlineCodeGame("PLAYBRO"), undefined);
});

test("online codes are grouped into redemption blocks", () => {
  assert.deepEqual(groupOnlineCodes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
