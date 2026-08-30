import type { Card } from '@tcg/api-types';
import { env } from '../../config/env';
import type { PriceProvider, PriceProviderQuote } from './pricing.types';
import { normalizePriceQuote, parsePrice } from './pricing.types';
import { fetchWithProviderPolicy } from '../providers/provider-request-queue';

const REQUEST_TIMEOUT_MS = 10_000;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((value): value is JsonRecord => !!value)
    : [];
}

function firstPositive(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = parsePrice(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  provider = 'server-pricing',
): Promise<JsonRecord> {
  const response = await fetchWithProviderPolicy(provider, url, init, {
    maxRetries: env.PROVIDER_MAX_RETRIES,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw new Error(`Pricing request failed with HTTP ${response.status}`);
  }
  const payload = record(await response.json());
  if (!payload) throw new Error('Pricing response was not a JSON object');
  return payload;
}

interface PokeWalletReferences {
  cardmarketEur?: number;
  tcgplayerUsd?: number;
}

const pokeWalletCache = new Map<
  string,
  { expiresAt: number; value: Promise<PokeWalletReferences> }
>();
const pokeWalletSetCodeCache = new Map<string, Promise<string>>();

function splitPokemonExternalId(
  externalId: string,
): { setCode: string; cardNumber: string } | null {
  const separator = externalId.lastIndexOf('-');
  if (separator <= 0 || separator === externalId.length - 1) return null;
  return {
    setCode: externalId.slice(0, separator),
    cardNumber: externalId.slice(separator + 1),
  };
}

async function resolvePokeWalletSetCode(tcgdexSetId: string): Promise<string> {
  const cached = pokeWalletSetCodeCache.get(tcgdexSetId);
  if (cached) return cached;
  const request = (async () => {
    try {
      const base = env.TCGDEX_API_BASE_URL.replace(/\/$/, '');
      const payload = await fetchJson(
        `${base}/sets/${encodeURIComponent(tcgdexSetId)}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'TCGer/0.1 (pricing integration)',
          },
        },
        'tcgdex',
      );
      const set = record(payload.data) ?? payload;
      const official = record(set.abbreviation)?.official;
      const candidate =
        (typeof official === 'string' && official.trim()) ||
        (typeof set.tcgOnline === 'string' && set.tcgOnline.trim()) ||
        (typeof set.id === 'string' && set.id.trim()) ||
        tcgdexSetId;
      return candidate.toUpperCase();
    } catch {
      return tcgdexSetId.toUpperCase();
    }
  })();
  pokeWalletSetCodeCache.set(tcgdexSetId, request);
  return request;
}

function normalizedCardNumber(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, '');
}

function pickPokeWalletHit(
  results: JsonRecord[],
  setCode: string,
  cardNumber: string,
): JsonRecord | null {
  const normalizedSet = setCode.trim().toLowerCase();
  const normalizedNumber = normalizedCardNumber(cardNumber);
  return (
    results.find((candidate) => {
      const info = record(candidate.card_info);
      return (
        String(info?.set_code ?? '')
          .trim()
          .toLowerCase() === normalizedSet &&
        normalizedCardNumber(info?.card_number) === normalizedNumber
      );
    }) ?? null
  );
}

async function fetchPokeWalletReferences(externalId: string): Promise<PokeWalletReferences> {
  const cached = pokeWalletCache.get(externalId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const identifiers = splitPokemonExternalId(externalId);
  if (!identifiers) return {};
  const request = (async () => {
    const pokeWalletSetCode = await resolvePokeWalletSetCode(identifiers.setCode);
    const url = new URL('/search', env.POKEWALLET_API_BASE_URL);
    url.searchParams.set('q', `${pokeWalletSetCode} ${identifiers.cardNumber}`);
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '20');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'TCGer/0.1 (pricing integration)',
    };
    if (env.POKEWALLET_PROXY_SECRET) {
      headers['X-Proxy-Secret'] = env.POKEWALLET_PROXY_SECRET;
    } else if (env.POKEWALLET_API_KEY) {
      headers['X-API-Key'] = env.POKEWALLET_API_KEY;
    }

    const payload = await fetchJson(url.toString(), { headers }, 'pokewallet');
    const hit = pickPokeWalletHit(
      records(payload.results),
      pokeWalletSetCode,
      identifiers.cardNumber,
    );
    if (!hit) return {};

    const cardmarketRows = records(record(hit.cardmarket)?.prices).sort((left, right) => {
      const leftNormal = left.variant_type === 'normal' ? 0 : 1;
      const rightNormal = right.variant_type === 'normal' ? 0 : 1;
      return leftNormal - rightNormal;
    });
    let cardmarketEur: number | undefined;
    for (const row of cardmarketRows) {
      cardmarketEur = firstPositive(row.avg1, row.avg7, row.avg30, row.trend, row.avg, row.low);
      if (cardmarketEur !== undefined) break;
    }

    let tcgplayerUsd: number | undefined;
    for (const row of records(record(hit.tcgplayer)?.prices)) {
      tcgplayerUsd = firstPositive(row.mid_price, row.market_price);
      if (tcgplayerUsd !== undefined) break;
    }
    return { cardmarketEur, tcgplayerUsd };
  })();

  pokeWalletCache.set(externalId, { expiresAt: Date.now() + 60_000, value: request });
  try {
    return await request;
  } catch (error) {
    pokeWalletCache.delete(externalId);
    throw error;
  }
}

type PokeWalletMode = 'cardmarket' | 'tcgplayer' | 'blended';

export class PokeWalletPriceProvider implements PriceProvider {
  readonly name: string;
  readonly includeInAutomatic: boolean;

  constructor(private readonly mode: PokeWalletMode) {
    this.name = `pokewallet-${mode}`;
    this.includeInAutomatic = mode === 'blended';
  }

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    if (
      tcg.toLowerCase() !== 'pokemon' ||
      (!env.POKEWALLET_API_KEY && !env.POKEWALLET_PROXY_SECRET)
    ) {
      return null;
    }
    const references = await fetchPokeWalletReferences(externalId);
    if (this.mode === 'cardmarket') {
      const quote = normalizePriceQuote({ currency: 'EUR', price: references.cardmarketEur });
      return quote
        ? {
            ...quote,
            provenance: {
              provider: this.name,
              retrievedAt: new Date().toISOString(),
              originalQuotes: quote.price
                ? [{ amount: quote.price, currency: 'EUR', source: this.name }]
                : [],
            },
          }
        : null;
    }
    if (this.mode === 'tcgplayer') {
      const quote = normalizePriceQuote({ currency: 'USD', price: references.tcgplayerUsd });
      return quote
        ? {
            ...quote,
            provenance: {
              provider: this.name,
              retrievedAt: new Date().toISOString(),
              originalQuotes: quote.price
                ? [{ amount: quote.price, currency: 'USD', source: this.name }]
                : [],
            },
          }
        : null;
    }
    if (!env.PRICE_USD_TO_EUR || !env.PRICE_FX_SOURCE || !env.PRICE_FX_AS_OF) return null;
    const convertedTcgplayer = references.tcgplayerUsd
      ? references.tcgplayerUsd * env.PRICE_USD_TO_EUR
      : undefined;
    const values = [references.cardmarketEur, convertedTcgplayer].filter(
      (value): value is number => value !== undefined && value > 0,
    );
    const blended = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : undefined;
    const quote = normalizePriceQuote({ currency: 'EUR', price: blended });
    return quote
      ? {
          ...quote,
          provenance: {
            provider: this.name,
            retrievedAt: new Date().toISOString(),
            originalQuotes: [
              ...(references.cardmarketEur
                ? [
                    {
                      amount: references.cardmarketEur,
                      currency: 'EUR',
                      source: 'pokewallet-cardmarket',
                    },
                  ]
                : []),
              ...(references.tcgplayerUsd
                ? [
                    {
                      amount: references.tcgplayerUsd,
                      currency: 'USD',
                      source: 'pokewallet-tcgplayer',
                    },
                  ]
                : []),
            ],
            fx: {
              fromCurrency: 'USD',
              toCurrency: 'EUR',
              rate: env.PRICE_USD_TO_EUR,
              source: env.PRICE_FX_SOURCE,
              asOf: env.PRICE_FX_AS_OF,
            },
          },
        }
      : null;
  }
}

let ebayToken: { value: string; expiresAt: number } | null = null;

async function getEbayAppToken(): Promise<string> {
  if (ebayToken && ebayToken.expiresAt > Date.now()) return ebayToken.value;
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error('eBay Browse API credentials are not configured');
  }
  const host = env.EBAY_USE_SANDBOX ? 'api.sandbox.ebay.com' : 'api.ebay.com';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });
  const payload = await fetchJson(
    `https://${host}/identity/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    'ebay',
  );
  const value = typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!value) throw new Error('eBay token response did not include an access token');
  const expiresIn = Number(payload.expires_in) || 7_200;
  ebayToken = { value, expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1_000 };
  return value;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function filteredListingPrices(payload: JsonRecord): { prices: number[]; currency: string } {
  const rows = records(payload.itemSummaries);
  const candidates = rows
    .map((row) => ({
      value: parsePrice(record(row.price)?.value),
      currency: String(record(row.price)?.currency ?? '')
        .trim()
        .toUpperCase(),
    }))
    .filter((row): row is { value: number; currency: string } => !!row.value && !!row.currency);
  if (!candidates.length) return { prices: [], currency: 'USD' };
  const currency = candidates[0].currency;
  const sameCurrency = candidates
    .filter((row) => row.currency === currency)
    .map((row) => row.value);
  const center = median(sameCurrency);
  if (!center) return { prices: [], currency };
  const ratioFiltered = sameCurrency.filter(
    (price) => price >= center * 0.2 && price <= center * 5,
  );
  return { prices: ratioFiltered, currency };
}

type CardLoader = (tcg: string, externalId: string) => Promise<Card | null>;

export class EbayActivePriceProvider implements PriceProvider {
  readonly name = 'ebay-active';
  readonly includeInAutomatic = false;

  constructor(private readonly loadCard: CardLoader) {}

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return null;
    const card = await this.loadCard(tcg, externalId);
    if (!card) return null;
    const query = [card.name, card.setName, card.collectorNumber, tcg, 'card']
      .filter((part): part is string => !!part?.trim())
      .join(' ');
    const host = env.EBAY_USE_SANDBOX ? 'api.sandbox.ebay.com' : 'api.ebay.com';
    const url = new URL(`https://${host}/buy/browse/v1/item_summary/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '50');
    const token = await getEbayAppToken();
    const payload = await fetchJson(
      url.toString(),
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': env.EBAY_MARKETPLACE_ID,
        },
      },
      'ebay',
    );
    const listings = filteredListingPrices(payload);
    return normalizePriceQuote({ currency: listings.currency, price: median(listings.prices) });
  }
}
