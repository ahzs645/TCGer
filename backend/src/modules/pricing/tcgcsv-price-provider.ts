import type { TrackedPriceItem } from '@tcg/api-types';
import { env } from '../../config/env';
import { fetchWithProviderPolicy } from '../providers/provider-request-queue';
import type { PriceProvider, PriceProviderQuote } from './pricing.types';
import { normalizePriceQuote, parsePrice } from './pricing.types';

type JsonRecord = Record<string, unknown>;

interface Cached<T> {
  expiresAt: number;
  value: Promise<T>;
}

interface GroupMatch {
  categoryId: number;
  groupId: string;
  confidence: number;
  method: 'exact-id' | 'exact-name' | 'fuzzy';
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const categoryGroups = new Map<number, Cached<JsonRecord[]>>();
const groupPayloads = new Map<string, Cached<{ products: JsonRecord[]; prices: JsonRecord[] }>>();

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function responseRows(payload: unknown): JsonRecord[] {
  const root = asRecord(payload);
  if (!root || root.success === false) {
    const errors = Array.isArray(root?.errors) ? root?.errors.join('; ') : 'invalid response';
    throw new Error(`TCGCSV request failed: ${errors}`);
  }
  return Array.isArray(root.results)
    ? root.results.map(asRecord).filter((row): row is JsonRecord => !!row)
    : [];
}

async function fetchRows(path: string): Promise<JsonRecord[]> {
  const response = await fetchWithProviderPolicy(
    'tcgcsv',
    `${env.TCGCSV_API_BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TCGer/0.1 (self-hosted TCG collection manager)',
      },
    },
    {
      minIntervalMs: env.TCGCSV_MIN_INTERVAL_MS,
      maxRetries: env.PROVIDER_MAX_RETRIES,
      timeoutMs: 30_000,
    },
  );
  if (!response.ok) throw new Error(`TCGCSV request failed with HTTP ${response.status}`);
  return responseRows(await response.json());
}

function cached<K extends string | number, T>(
  cache: Map<K, Cached<T>>,
  key: K,
  loader: () => Promise<T>,
) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = loader();
  cache.set(key, { expiresAt: Date.now() + DAY_MS, value });
  value.catch(() => cache.delete(key));
  return value;
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function groupTail(value: unknown): string {
  return normalize(
    String(value ?? '')
      .replace(/^[^:]{1,12}:\s*/, '')
      .replace(/^[A-Za-z0-9]{1,6}\s*[-–—]\s*/, '')
      .replace(/\s+Base Set$/i, ''),
  );
}

export function normalizeTcgCsvCollectorNumber(value: unknown): string {
  return normalize(String(value ?? '').split('/')[0]).replace(/^0+(?=\d)/, '');
}

function categoryFor(language?: string): number {
  return language?.trim().toLowerCase() === 'japanese' ? 85 : 3;
}

function groupId(group: JsonRecord): string {
  return String(group.groupId ?? group.groupID ?? group.id ?? '');
}

async function groupsFor(categoryId: number): Promise<JsonRecord[]> {
  return cached(categoryGroups, categoryId, () => fetchRows(`${categoryId}/groups`));
}

export function matchTcgCsvGroup(
  groups: JsonRecord[],
  setCode: string | undefined,
  setName: string | undefined,
  categoryId: number,
): GroupMatch | null {
  const code = normalize(setCode);
  const name = normalize(setName);
  const exact = groups.filter((group) => {
    const keys = [normalize(group.abbreviation), normalize(group.name), groupTail(group.name)];
    return (!!code && keys.includes(code)) || (!!name && keys.includes(name));
  });
  if (exact.length === 1) {
    const exactId = !!code && normalize(exact[0].abbreviation) === code;
    return {
      categoryId,
      groupId: groupId(exact[0]),
      confidence: 1,
      method: exactId ? 'exact-id' : 'exact-name',
    };
  }
  // Refuse ambiguous exact or suffix matches; a missing quote is safer than a
  // confident price from the wrong printing or language catalog.
  if (exact.length > 1 || name.length < 3) return null;
  const suffix = groups.filter((group) => normalize(group.name).endsWith(name));
  return suffix.length === 1
    ? { categoryId, groupId: groupId(suffix[0]), confidence: 0.8, method: 'fuzzy' }
    : null;
}

function numberOf(product: JsonRecord): string {
  const extended = Array.isArray(product.extendedData) ? product.extendedData : [];
  const field = extended
    .map(asRecord)
    .find((row) => String(row?.name ?? '').toLowerCase() === 'number');
  return normalizeTcgCsvCollectorNumber(field?.value);
}

function priceValue(row: JsonRecord): number | undefined {
  return parsePrice(row.marketPrice) ?? parsePrice(row.midPrice);
}

function quoteFor(productId: string, rows: JsonRecord[]): PriceProviderQuote | null {
  const matches = rows.filter((row) => String(row.productId ?? '') === productId);
  const find = (...names: string[]) => {
    for (const name of names) {
      const row = matches.find((candidate) => candidate.subTypeName === name);
      const value = row ? priceValue(row) : undefined;
      if (value) return value;
    }
    return undefined;
  };
  return normalizePriceQuote({
    currency: 'USD',
    price: find('Normal', 'Unlimited'),
    foilPrice: find('Holofoil', 'Unlimited Holofoil', '1st Edition Holofoil'),
    reverseHoloPrice: find('Reverse Holofoil'),
  });
}

type TcgCsvContext = Pick<TrackedPriceItem, 'language' | 'lookupHint'>;

export class TcgCsvPriceProvider implements PriceProvider {
  readonly name = 'tcgcsv';

  async fetchPrice(
    tcg: string,
    _externalId: string,
    context?: TcgCsvContext,
  ): Promise<PriceProviderQuote | null> {
    if (tcg.trim().toLowerCase() !== 'pokemon') return null;
    const collectorNumber = normalizeTcgCsvCollectorNumber(context?.lookupHint?.collectorNumber);
    const setCode = context?.lookupHint?.setCode;
    const setName = context?.lookupHint?.setName;
    if (!collectorNumber || (!setCode && !setName)) return null;

    const categoryId = categoryFor(context?.language);
    const match = matchTcgCsvGroup(await groupsFor(categoryId), setCode, setName, categoryId);
    if (!match?.groupId) return null;
    const cacheKey = `${match.categoryId}:${match.groupId}`;
    const payload = await cached(groupPayloads, cacheKey, async () => {
      const [products, prices] = await Promise.all([
        fetchRows(`${match.categoryId}/${match.groupId}/products`),
        fetchRows(`${match.categoryId}/${match.groupId}/prices`),
      ]);
      return { products, prices };
    });

    const products = payload.products.filter((product) => numberOf(product) === collectorNumber);
    if (products.length !== 1) return null;
    const providerProductId = String(products[0].productId ?? '');
    if (!providerProductId) return null;
    const quote = quoteFor(providerProductId, payload.prices);
    if (!quote) return null;
    return {
      ...quote,
      provenance: {
        provider: this.name,
        retrievedAt: new Date().toISOString(),
        originalQuotes: [
          ...[quote.price]
            .filter((amount): amount is number => !!amount)
            .map((amount) => ({ amount, currency: 'USD', source: this.name })),
          ...[quote.foilPrice]
            .filter((amount): amount is number => !!amount)
            .map((amount) => ({ amount, currency: 'USD', source: `${this.name}:foil` })),
          ...[quote.reverseHoloPrice]
            .filter((amount): amount is number => !!amount)
            .map((amount) => ({ amount, currency: 'USD', source: `${this.name}:reverse-holo` })),
        ],
        match: {
          method: match.method,
          confidence: match.confidence,
          providerProductId,
          providerGroupId: match.groupId,
        },
      },
    };
  }
}
