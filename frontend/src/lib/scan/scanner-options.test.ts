import assert from "node:assert/strict";
import test from "node:test";

import { SCANNER_LANGUAGES, normalizeScannerLanguage } from "./scanner-options";

test("accepts every supported scanner language", () => {
  for (const language of SCANNER_LANGUAGES) {
    assert.equal(normalizeScannerLanguage(language), language);
  }
});

test("falls back to English for missing or unsupported stored values", () => {
  assert.equal(normalizeScannerLanguage(undefined), "English");
  assert.equal(normalizeScannerLanguage("Klingon"), "English");
});
