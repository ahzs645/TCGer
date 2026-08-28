import assert from "node:assert/strict";
import test from "node:test";

import {
  SCANNER_LANGUAGES,
  normalizeScannerLanguage,
  normalizeScannerPrintingMode,
} from "./scanner-options";

test("accepts every supported scanner language", () => {
  for (const language of SCANNER_LANGUAGES) {
    assert.equal(normalizeScannerLanguage(language), language);
  }
});

test("printing mode defaults to quick scan and accepts exact mode", () => {
  assert.equal(normalizeScannerPrintingMode(undefined), "quick_latest");
  assert.equal(
    normalizeScannerPrintingMode("exact_printing"),
    "exact_printing",
  );
  assert.equal(normalizeScannerPrintingMode("guess"), "quick_latest");
});

test("falls back to English for missing or unsupported stored values", () => {
  assert.equal(normalizeScannerLanguage(undefined), "English");
  assert.equal(normalizeScannerLanguage("Klingon"), "English");
});
