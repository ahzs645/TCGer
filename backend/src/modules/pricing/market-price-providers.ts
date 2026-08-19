import { env } from '../../config/env';
import type { PriceProvider, PriceProviderQuote } from './pricing.types';
import { normalizePriceQuote, parsePrice } from './pricing.types';

const REQUEST_TIMEOUT_MS = 8_000;
const SCRYFALL_REQUEST_DELAY_MS = 120;

let scryfallRateLimitChain: Promise<void> = Promise.resolve();
let nextScryfallRequestAt = 0;

async function waitForScryfallRateLimit(): Promise<void> {
  const waitPromise = scryfallRateLimitChain.then(async () => {
    const wait = Math.max(0, nextScryfallRequestAt - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    nextScryfallRequestAt = Date.now() + SCRYFALL_REQUEST_DELAY_MS;
  });
  scryfallRateLimitChain = waitPromise.catch(() => {});
  await waitPromise;
}

function cardUrl(baseUrl: string, externalId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/cards/${encodeURIComponent(externalId)}`;
}

function lorcastCardUrl(externalId: string): string {
  const baseUrl = env.LORCANA_API_BASE_URL.replace(/\/$/, '');
  const reference = externalId.trim().replace(/^lorcana:/, '');
  const separator = reference.includes('/') ? '/' : ':';
  const segments = reference.split(separator).filter(Boolean);
  if (segments.length === 2) {
    return `${baseUrl}/cards/${segments.map(encodeURIComponent).join('/')}`;
  }
  return cardUrl(baseUrl, reference);
}

function unwrapRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const data = record.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : record;
}

function childRecord(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstPrice(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = parsePrice(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

async function fetchCardJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TCGer/0.1 (pricing integration)',
      },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Pricing request failed with HTTP ${response.status}`);
    }
    return unwrapRecord(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function justTcgVariants(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const data = (payload as Record<string, unknown>).data;
  const card = Array.isArray(data) ? data[0] : data;
  if (!card || typeof card !== 'object' || Array.isArray(card)) return [];
  const variants = (card as Record<string, unknown>).variants;
  return Array.isArray(variants)
    ? variants.filter(
        (variant): variant is Record<string, unknown> =>
          !!variant && typeof variant === 'object' && !Array.isArray(variant),
      )
    : [];
}

export class JustTcgPriceProvider implements PriceProvider {
  readonly name = 'justtcg';

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    // TCGer's Magic IDs are Scryfall UUIDs. Other adapters do not yet expose a
    // JustTCG-compatible identifier, so guessing would waste paid requests.
    if (tcg.toLowerCase() !== 'magic' || !env.JUSTTCG_API_KEY) return null;
    const url = new URL(`${env.JUSTTCG_API_BASE_URL.replace(/\/$/, '')}/cards`);
    url.searchParams.set('scryfallId', externalId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'TCGer/0.1 (pricing integration)',
          'x-api-key': env.JUSTTCG_API_KEY,
        },
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Pricing request failed with HTTP ${response.status}`);
      }

      const variants = justTcgVariants(await response.json());
      const nearMint = variants.filter((variant) => {
        const condition =
          typeof variant.condition === 'string' ? variant.condition.toLowerCase() : '';
        return !condition || condition === 'near mint' || condition === 'nm';
      });
      const candidates = nearMint.length ? nearMint : variants;
      const base = candidates.find((variant) => {
        const printing = typeof variant.printing === 'string' ? variant.printing.toLowerCase() : '';
        return !printing.includes('foil');
      });
      const foil = candidates.find((variant) => {
        const printing = typeof variant.printing === 'string' ? variant.printing.toLowerCase() : '';
        return printing.includes('foil');
      });
      return normalizePriceQuote({
        currency: 'USD',
        price: parsePrice(base?.price),
        foilPrice: parsePrice(foil?.price),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class TcgDexPriceProvider implements PriceProvider {
  readonly name = 'tcgdex-cardmarket';

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    if (tcg.toLowerCase() !== 'pokemon') return null;
    const card = await fetchCardJson(cardUrl(env.TCGDEX_API_BASE_URL, externalId));
    const cardmarket = childRecord(childRecord(card, 'pricing'), 'cardmarket');
    if (!cardmarket) return null;

    return normalizePriceQuote({
      currency: typeof cardmarket.unit === 'string' ? cardmarket.unit : 'EUR',
      // Collection-value order: avg -> avg-holo -> low -> avg1.
      price: firstPrice(cardmarket.avg, cardmarket['avg-holo'], cardmarket.low, cardmarket.avg1),
    });
  }
}

export class ScryfallPriceProvider implements PriceProvider {
  readonly name = 'scryfall';

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    if (tcg.toLowerCase() !== 'magic') return null;
    if (/scryfall\.(io|com)$/i.test(new URL(env.SCRYFALL_API_BASE_URL).hostname)) {
      await waitForScryfallRateLimit();
    }
    const card = await fetchCardJson(cardUrl(env.SCRYFALL_API_BASE_URL, externalId));
    const prices = childRecord(card, 'prices');
    if (!prices) return null;

    const usd = parsePrice(prices.usd);
    const usdFoil = parsePrice(prices.usd_foil);
    const usdEtched = parsePrice(prices.usd_etched);
    const eur = parsePrice(prices.eur);
    const eurFoil = parsePrice(prices.eur_foil);

    // Prefer the currency with a regular price so ordinary copies never inherit
    // a foil-only quote. Keep every finish in that currency for finish-aware
    // collection valuation.
    if (
      usd !== undefined ||
      (eur === undefined && (usdFoil !== undefined || usdEtched !== undefined))
    ) {
      return normalizePriceQuote({
        currency: 'USD',
        price: usd,
        foilPrice: usdFoil,
        etchedPrice: usdEtched,
      });
    }

    if (eur !== undefined || eurFoil !== undefined) {
      return normalizePriceQuote({
        currency: 'EUR',
        price: eur,
        foilPrice: eurFoil,
      });
    }
    return null;
  }
}

export class LorcastPriceProvider implements PriceProvider {
  readonly name = 'lorcast';

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    if (tcg.toLowerCase() !== 'lorcana') return null;
    const card = await fetchCardJson(lorcastCardUrl(externalId));
    const prices = childRecord(card, 'prices');
    if (!prices) return null;

    return normalizePriceQuote({
      currency: 'USD',
      price: firstPrice(prices.usd, prices.usd_foil),
    });
  }
}
