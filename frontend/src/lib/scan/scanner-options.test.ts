import assert from "node:assert/strict";
import test from "node:test";

import {
  SCANNER_LANGUAGES,
  normalizeScannerLanguage,
  normalizeScannerOcrEnabled,
  normalizeScannerPrintingMode,
} from "./scanner-options";

test("accepts every supported scanner language", () => {
  for (const language of SCANNER_LANGUAGES) {
    assert.equal(normalizeScannerLanguage(language), language);
  }
});

test("OCR defaults on and accepts the persisted off value", () => {
  assert.equal(normalizeScannerOcrEnabled(undefined), true);
  assert.equal(normalizeScannerOcrEnabled("true"), true);
  assert.equal(normalizeScannerOcrEnabled("false"), false);
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
