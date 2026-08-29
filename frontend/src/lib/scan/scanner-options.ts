export {
  SCANNER_DEFAULT_LANGUAGE_STORAGE_KEY,
  SCANNER_OCR_ENABLED_STORAGE_KEY,
  SCANNER_PRINTING_MODE_STORAGE_KEY,
} from "@/lib/storage/keys";

import { SCANNER_OCR_ENABLED_STORAGE_KEY } from "@/lib/storage/keys";

const SCANNER_OCR_ENABLED_CHANGE_EVENT =
  "tcger:scanner-ocr-enabled-changed";

export function normalizeScannerOcrEnabled(value: unknown): boolean {
  return value !== "false";
}

export function readScannerOcrEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return normalizeScannerOcrEnabled(
    window.localStorage.getItem(SCANNER_OCR_ENABLED_STORAGE_KEY),
  );
}

export function writeScannerOcrEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SCANNER_OCR_ENABLED_STORAGE_KEY,
    String(enabled),
  );
  window.dispatchEvent(new Event(SCANNER_OCR_ENABLED_CHANGE_EVENT));
}

export function subscribeScannerOcrEnabled(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SCANNER_OCR_ENABLED_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(SCANNER_OCR_ENABLED_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SCANNER_OCR_ENABLED_CHANGE_EVENT, onStoreChange);
  };
}

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
