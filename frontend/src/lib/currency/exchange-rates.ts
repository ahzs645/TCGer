export interface SupportedCurrency {
  isoCode: string;
  name: string;
  symbol?: string;
}

export interface ExchangeRateQuote {
  date: string;
  base: string;
  quote: string;
  rate: number;
  fetchedAt: number;
  providerName: string;
}

interface FrankfurterCurrency {
  iso_code: string;
  name: string;
  symbol?: string;
}

interface FrankfurterRate {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

const API_BASE_URL = "https://api.frankfurter.dev/v2";
const LATEST_RATE_LIFETIME_MS = 12 * 60 * 60 * 1000;
const memoryCache = new Map<string, ExchangeRateQuote>();

export const FALLBACK_CURRENCIES: SupportedCurrency[] = [
  { isoCode: "AUD", name: "Australian Dollar", symbol: "$" },
  { isoCode: "CAD", name: "Canadian Dollar", symbol: "$" },
  { isoCode: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { isoCode: "EUR", name: "Euro", symbol: "€" },
  { isoCode: "GBP", name: "British Pound", symbol: "£" },
  { isoCode: "JPY", name: "Japanese Yen", symbol: "¥" },
  { isoCode: "USD", name: "United States Dollar", symbol: "$" },
];

function normalizedCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("Currency must be a three-letter ISO code.");
  }
  return normalized;
}

function normalizedDate(value?: string): string | undefined {
  if (!value) return undefined;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("Historical exchange-rate dates must use YYYY-MM-DD.");
  }
  return day;
}

export function exchangeRateCacheKey(
  source: string,
  destination: string,
  date?: string,
): string {
  const day = normalizedDate(date) ?? "latest";
  return `${normalizedCurrency(source)}:${normalizedCurrency(destination)}:${day}`;
}

function readSessionCache(key: string): ExchangeRateQuote | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(`tcger.fx.${key}`);
    if (!raw) return undefined;
    const quote = JSON.parse(raw) as ExchangeRateQuote;
    return Number.isFinite(quote.rate) && quote.rate > 0 ? quote : undefined;
  } catch {
    return undefined;
  }
}

function saveSessionCache(key: string, quote: ExchangeRateQuote) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`tcger.fx.${key}`, JSON.stringify(quote));
  } catch {
    // Currency conversion remains usable if browser storage is unavailable.
  }
}

async function fetchRate(
  source: string,
  destination: string,
  date: string | undefined,
  provider: string | undefined,
): Promise<ExchangeRateQuote> {
  const url = new URL(`${API_BASE_URL}/rate/${source}/${destination}`);
  if (provider) url.searchParams.set("providers", provider);
  if (date) url.searchParams.set("date", date);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Exchange-rate service unavailable.");
  const result = (await response.json()) as FrankfurterRate;
  if (!Number.isFinite(result.rate) || result.rate <= 0) {
    throw new Error("No exchange rate is available for this currency pair.");
  }
  return {
    ...result,
    fetchedAt: Date.now(),
    providerName: provider
      ? "Bank of Canada via Frankfurter"
      : "Frankfurter central-bank blend",
  };
}

export async function getExchangeRate(
  sourceValue: string,
  destinationValue: string,
  dateValue?: string,
): Promise<ExchangeRateQuote> {
  const source = normalizedCurrency(sourceValue);
  const destination = normalizedCurrency(destinationValue);
  const date = normalizedDate(dateValue);
  if (source === destination) {
    return {
      date: date ?? new Date().toISOString().slice(0, 10),
      base: source,
      quote: destination,
      rate: 1,
      fetchedAt: Date.now(),
      providerName: "No conversion needed",
    };
  }

  const key = exchangeRateCacheKey(source, destination, date);
  const cached = memoryCache.get(key) ?? readSessionCache(key);
  const isFresh =
    !!cached &&
    (date !== undefined ||
      Date.now() - cached.fetchedAt < LATEST_RATE_LIFETIME_MS);
  if (cached && isFresh) {
    memoryCache.set(key, cached);
    return cached;
  }

  try {
    let quote: ExchangeRateQuote;
    if (destination === "CAD") {
      try {
        quote = await fetchRate(source, destination, date, "BOC");
      } catch {
        quote = await fetchRate(source, destination, date, undefined);
      }
    } else {
      quote = await fetchRate(source, destination, date, undefined);
    }
    memoryCache.set(key, quote);
    saveSessionCache(key, quote);
    return quote;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

export async function getSupportedCurrencies(): Promise<SupportedCurrency[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/currencies`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Currency service unavailable.");
    const currencies = (await response.json()) as FrankfurterCurrency[];
    return currencies
      .map((currency) => ({
        isoCode: currency.iso_code,
        name: currency.name,
        symbol: currency.symbol,
      }))
      .sort((left, right) => left.isoCode.localeCompare(right.isoCode));
  } catch {
    return FALLBACK_CURRENCIES;
  }
}

export function convertWithRate(amount: number, rate: number): number {
  return Math.round((amount * rate + Number.EPSILON) * 100) / 100;
}
