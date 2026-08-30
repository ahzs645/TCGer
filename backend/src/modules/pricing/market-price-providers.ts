import { env } from '../../config/env';
import type { PriceProvider, PriceProviderQuote } from './pricing.types';
import { normalizePriceQuote, parsePrice } from './pricing.types';
import type { TrackedPriceItem } from '@tcg/api-types';
import { fetchWithProviderPolicy } from '../providers/provider-request-queue';

const REQUEST_TIMEOUT_MS = 8_000;

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

async function fetchCardJson(
  provider: string,
  url: string,
  minIntervalMs = 0,
): Promise<Record<string, unknown> | null> {
  const response = await fetchWithProviderPolicy(
    provider,
    url,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TCGer/0.1 (pricing integration)',
      },
    },
    {
      minIntervalMs,
      maxRetries: env.PROVIDER_MAX_RETRIES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Pricing request failed with HTTP ${response.status}`);
  }
  return unwrapRecord(await response.json());
}

function justTcgCards(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const data = (payload as Record<string, unknown>).data;
  const cards = Array.isArray(data) ? data : [data];
  return cards.filter(
    (card): card is Record<string, unknown> =>
      !!card && typeof card === 'object' && !Array.isArray(card),
  );
}

function justTcgVariants(
  card: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  const variants = card?.variants;
  return Array.isArray(variants)
    ? variants.filter(
        (variant): variant is Record<string, unknown> =>
          !!variant && typeof variant === 'object' && !Array.isArray(variant),
      )
    : [];
}

type JustTcgContext = Pick<
  TrackedPriceItem,
  'finishCode' | 'condition' | 'language' | 'identifiers' | 'lookupHint'
>;

function justTcgLookup(
  tcg: string,
  externalId: string,
  context?: JustTcgContext,
): { name: string; value: string } | null {
  const identifiers = context?.identifiers;
  if (identifiers?.variantId) return { name: 'variantId', value: identifiers.variantId };
  if (identifiers?.tcgplayerSkuId) {
    return { name: 'tcgplayerSkuId', value: identifiers.tcgplayerSkuId };
  }
  if (identifiers?.tcgplayerId) return { name: 'tcgplayerId', value: identifiers.tcgplayerId };
  if (identifiers?.mtgjsonId) return { name: 'mtgjsonId', value: identifiers.mtgjsonId };
  if (identifiers?.scryfallId) return { name: 'scryfallId', value: identifiers.scryfallId };
  if (identifiers?.cardId) return { name: 'cardId', value: identifiers.cardId };
  if (externalId.toLowerCase().startsWith('tcgplayer:')) {
    return { name: 'tcgplayerId', value: externalId.slice('tcgplayer:'.length) };
  }
  return tcg.toLowerCase() === 'magic' ? { name: 'scryfallId', value: externalId } : null;
}

function justTcgCardMatches(
  card: Record<string, unknown>,
  lookup: { name: string; value: string },
) {
  const fieldByLookup: Record<string, string[]> = {
    cardId: ['uuid', 'id'],
    variantId: [],
    tcgplayerId: ['tcgplayerId'],
    mtgjsonId: ['mtgjsonId'],
    scryfallId: ['scryfallId'],
    tcgplayerSkuId: [],
  };
  if (
    (fieldByLookup[lookup.name] ?? []).some(
      (field) => String(card[field] ?? '').toLowerCase() === lookup.value.toLowerCase(),
    )
  ) {
    return true;
  }
  return justTcgVariants(card).some((variant) => {
    const field = lookup.name === 'variantId' ? ['uuid', 'id'] : ['tcgplayerSkuId'];
    return field.some(
      (key) => String(variant[key] ?? '').toLowerCase() === lookup.value.toLowerCase(),
    );
  });
}

function justTcgQuote(
  card: Record<string, unknown> | undefined,
  context?: JustTcgContext,
): PriceProviderQuote | null {
  const variants = justTcgVariants(card);
  const preferredCondition = context?.condition?.trim().toLowerCase() || 'near mint';
  const conditionMatches = variants.filter((variant) => {
    const condition = typeof variant.condition === 'string' ? variant.condition.toLowerCase() : '';
    return condition === preferredCondition;
  });
  const conditionCandidates = conditionMatches.length ? conditionMatches : variants;
  const preferredLanguage = context?.language?.trim().toLowerCase() || 'english';
  const languageMatches = conditionCandidates.filter((variant) =>
    typeof variant.language === 'string'
      ? variant.language.toLowerCase() === preferredLanguage
      : false,
  );
  const candidates = languageMatches.length ? languageMatches : conditionCandidates;
  const base = candidates.find((variant) => {
    const printing = typeof variant.printing === 'string' ? variant.printing.toLowerCase() : '';
    return !printing.includes('foil') && !printing.includes('holo') && !printing.includes('etched');
  });
  const foil = candidates.find((variant) => {
    const printing = typeof variant.printing === 'string' ? variant.printing.toLowerCase() : '';
    return printing.includes('foil') || printing.includes('holo');
  });
  const etched = candidates.find((variant) => {
    const printing = typeof variant.printing === 'string' ? variant.printing.toLowerCase() : '';
    return printing.includes('etched');
  });
  return normalizePriceQuote({
    currency: 'USD',
    price: parsePrice(base?.price),
    foilPrice: parsePrice(foil?.price),
    etchedPrice: parsePrice(etched?.price),
  });
}

export class JustTcgPriceProvider implements PriceProvider {
  readonly name = 'justtcg';

  async fetchPrice(
    tcg: string,
    externalId: string,
    context?: JustTcgContext,
  ): Promise<PriceProviderQuote | null> {
    if (!env.JUSTTCG_API_KEY) return null;
    const lookup = justTcgLookup(tcg, externalId, context);
    if (!lookup) return null;
    const url = new URL(`${env.JUSTTCG_API_BASE_URL.replace(/\/$/, '')}/cards`);
    url.searchParams.set(lookup.name, lookup.value);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchWithProviderPolicy(
        'justtcg',
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'TCGer/0.1 (pricing integration)',
            'x-api-key': env.JUSTTCG_API_KEY,
          },
          signal: controller.signal,
        },
        { maxRetries: env.PROVIDER_MAX_RETRIES, timeoutMs: REQUEST_TIMEOUT_MS },
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Pricing request failed with HTTP ${response.status}`);
      }

      return justTcgQuote(justTcgCards(await response.json())[0], context);
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchBatch(items: TrackedPriceItem[]): Promise<Map<string, PriceProviderQuote>> {
    const quotes = new Map<string, PriceProviderQuote>();
    if (!env.JUSTTCG_API_KEY) return quotes;
    const requests = items.flatMap((item) => {
      const lookup = justTcgLookup(item.tcg, item.externalId, item);
      return lookup ? [{ item, lookup }] : [];
    });
    for (let start = 0; start < requests.length; start += 20) {
      const chunk = requests.slice(start, start + 20);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchWithProviderPolicy(
          'justtcg',
          `${env.JUSTTCG_API_BASE_URL.replace(/\/$/, '')}/cards`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'TCGer/0.1 (pricing integration)',
              'x-api-key': env.JUSTTCG_API_KEY,
            },
            body: JSON.stringify(chunk.map(({ lookup }) => ({ [lookup.name]: lookup.value }))),
            signal: controller.signal,
          },
          { maxRetries: env.PROVIDER_MAX_RETRIES, timeoutMs: REQUEST_TIMEOUT_MS },
        );
        if (!response.ok) throw new Error(`Pricing request failed with HTTP ${response.status}`);
        const cards = justTcgCards(await response.json());
        for (const { item, lookup } of chunk) {
          const quote = justTcgQuote(
            cards.find((card) => justTcgCardMatches(card, lookup)),
            item,
          );
          if (quote)
            quotes.set(
              `${item.tcg}:${item.externalId}:${item.finishCode ?? ''}:${item.condition ?? ''}:${item.language ?? ''}`,
              quote,
            );
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    return quotes;
  }
}

export class TcgDexPriceProvider implements PriceProvider {
  readonly name = 'tcgdex-cardmarket';

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    if (tcg.toLowerCase() !== 'pokemon') return null;
    const card = await fetchCardJson('tcgdex', cardUrl(env.TCGDEX_API_BASE_URL, externalId));
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
    const card = await fetchCardJson(
      'scryfall',
      cardUrl(env.SCRYFALL_API_BASE_URL, externalId),
      env.SCRYFALL_MIN_INTERVAL_MS,
    );
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
    const card = await fetchCardJson('lorcast', lorcastCardUrl(externalId));
    const prices = childRecord(card, 'prices');
    if (!prices) return null;

    return normalizePriceQuote({
      currency: 'USD',
      price: firstPrice(prices.usd, prices.usd_foil),
    });
  }
}
