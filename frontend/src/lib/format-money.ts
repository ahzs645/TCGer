/**
 * The single money formatter for the web client.
 *
 * Before this existed the frontend had five of them: two hardcoding `en-US`,
 * two passing `undefined` (so the *browser's* locale decided, and the same
 * amount rendered as `US$28.50` for a Canadian reader and `$28.50` for an
 * American one), and fifteen raw `` `$${n.toFixed(2)}` `` template literals
 * with no thousands separator at all. One collection value could render four
 * ways in a single session — `$1,273.64`, `$1273.64`, `US$1,273.64`, `$1,274`.
 *
 * The locale is pinned deliberately: currency presentation must not change
 * between two users looking at the same collection.
 */
const MONEY_LOCALE = "en-US";
const DEFAULT_CURRENCY = "USD";

export interface FormatMoneyOptions {
  /** ISO 4217 code. Falls back to USD if the code is not recognised. */
  currency?: string;
  /** Drop the cents — for axis ticks and other dense labels. */
  compact?: boolean;
  /** Prefix non-negative values with `+`, for deltas. */
  signed?: boolean;
}

function formatterFor(currency: string, compact: boolean): Intl.NumberFormat {
  const fractionDigits = compact ? 0 : 2;
  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }
}

export function formatMoney(
  value: number | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  const {
    currency = DEFAULT_CURRENCY,
    compact = false,
    signed = false,
  } = options;
  const amount = Number.isFinite(value) ? (value as number) : 0;
  const formatted = formatterFor(currency, compact).format(Math.abs(amount));
  if (amount < 0) return `-${formatted}`;
  return signed ? `+${formatted}` : formatted;
}

/** `$1,274` — cents dropped, for chart axes and other dense labels. */
export function formatMoneyCompact(
  value: number | null | undefined,
  currency = DEFAULT_CURRENCY,
): string {
  return formatMoney(value, { currency, compact: true });
}

/** `+$63.68` / `-$12.00` — for period-over-period deltas. */
export function formatMoneyDelta(
  value: number | null | undefined,
  currency = DEFAULT_CURRENCY,
): string {
  return formatMoney(value, { currency, signed: true });
}
