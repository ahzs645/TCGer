export const SCANNER_DEFAULT_LANGUAGE_STORAGE_KEY =
  "tcger.scanner.default-language";
export const SCANNER_PRINTING_MODE_STORAGE_KEY = "tcger.scanner.printing-mode";

export const SCANNER_PRINTING_MODES = [
  "quick_latest",
  "exact_printing",
] as const;
export type ScannerPrintingMode = (typeof SCANNER_PRINTING_MODES)[number];

export function normalizeScannerPrintingMode(
  value: unknown,
): ScannerPrintingMode {
  return typeof value === "string" &&
    SCANNER_PRINTING_MODES.includes(value as ScannerPrintingMode)
    ? (value as ScannerPrintingMode)
    : "quick_latest";
}

export const SCANNER_LANGUAGES = [
  "English",
  "Japanese",
  "German",
  "French",
  "Italian",
  "Spanish",
  "Portuguese",
  "Korean",
  "Chinese",
] as const;

export type ScannerLanguage = (typeof SCANNER_LANGUAGES)[number];

export function normalizeScannerLanguage(value: unknown): ScannerLanguage {
  return typeof value === "string" &&
    SCANNER_LANGUAGES.includes(value as ScannerLanguage)
    ? (value as ScannerLanguage)
    : "English";
}
