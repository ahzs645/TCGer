export const SCANNER_DEFAULT_LANGUAGE_STORAGE_KEY =
  "tcger.scanner.default-language";

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
