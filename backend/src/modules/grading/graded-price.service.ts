import { env } from '../../config/env';
import { fetchWithProviderPolicy } from '../providers/provider-request-queue';
import { GradingProviderError } from './psa.service';

type JsonRecord = Record<string, unknown>;

export interface GradedPriceInput {
  game?: string;
  name?: string;
  setName?: string;
  collectorNumber?: string;
  grader: string;
  grade: number;
  tcgPlayerId?: string;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function gradeKey(grader: string, grade: number): string | null {
  if (!grader || grader.toLowerCase() === 'raw' || !(grade > 0 && grade <= 10)) return null;
  return `${grader.toLowerCase()}${String(grade).replace('.', '_')}`;
}

function normalizeNumber(value: unknown): string {
  return String(value ?? '')
    .split('/')[0]
    .replace(/^0+(?=\d)/, '')
    .trim()
    .toLowerCase();
}

function cards(payload: unknown): JsonRecord[] {
  const root = record(payload);
  const data = root?.data ?? payload;
  if (Array.isArray(data)) return data.map(record).filter((row): row is JsonRecord => !!row);
  const one = record(data);
  return one ? [one] : [];
}

function bucketPrice(bucket: JsonRecord | null): number | undefined {
  const smart = record(bucket?.smartMarketPrice)?.price;
  for (const value of [smart, bucket?.medianPrice, bucket?.averagePrice]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

async function query(params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${env.POKEMON_PRICE_TRACKER_API_BASE_URL.replace(/\/$/, '')}/cards`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchWithProviderPolicy(
    'pokemon-price-tracker',
    url,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${env.POKEMON_PRICE_TRACKER_API_KEY}`,
        'User-Agent': 'TCGer/0.1 (user-triggered graded pricing)',
      },
    },
    {
      minIntervalMs: env.POKEMON_PRICE_TRACKER_MIN_INTERVAL_MS,
      maxRetries: env.PROVIDER_MAX_RETRIES,
    },
  );
  const payload = await response.json().catch(() => null);
  const detail = record(payload)?.message ?? record(payload)?.error;
  if (!response.ok) {
    throw new GradingProviderError(
      response.status === 429 ? 429 : response.status === 404 ? 404 : 502,
      typeof detail === 'string'
        ? detail
        : `Graded-price lookup failed with HTTP ${response.status}`,
    );
  }
  return payload;
}

export async function fetchGradedPrice(input: GradedPriceInput) {
  if (!env.POKEMON_PRICE_TRACKER_LICENSE_ACK) {
    throw new GradingProviderError(
      503,
      'Graded pricing is disabled until commercial-use licensing is reviewed and acknowledged',
    );
  }
  if (!env.POKEMON_PRICE_TRACKER_API_KEY) {
    throw new GradingProviderError(503, 'The graded-price provider is not configured');
  }
  if (input.game && input.game.toLowerCase() !== 'pokemon') {
    throw new GradingProviderError(400, 'Automatic graded prices currently cover Pokémon only');
  }
  const key = gradeKey(input.grader, input.grade);
  if (!key) throw new GradingProviderError(400, 'A grader and numeric grade are required');
  if (!input.tcgPlayerId && !input.name) {
    throw new GradingProviderError(400, 'A TCGplayer product id or card name is required');
  }

  let matches = input.tcgPlayerId
    ? cards(await query({ tcgPlayerId: input.tcgPlayerId, includeEbay: 'true', limit: '1' }))
    : [];
  if (!matches.length && input.name) {
    matches = cards(
      await query({
        search: input.name,
        ...(input.setName ? { setName: input.setName } : {}),
        includeEbay: 'true',
        limit: '5',
      }),
    );
  }
  const wantedNumber = normalizeNumber(input.collectorNumber);
  const card =
    matches.length === 1
      ? matches[0]
      : matches.find(
          (candidate) => normalizeNumber(candidate.cardNumber ?? candidate.number) === wantedNumber,
        );
  if (!card) throw new GradingProviderError(404, 'No unambiguous graded-price match was found');
  const byGrade = record(record(card.ebay)?.salesByGrade);
  const bucket = record(byGrade?.[key]);
  const price = bucketPrice(bucket);
  if (!price)
    throw new GradingProviderError(404, `No ${input.grader} ${input.grade} sales were found`);
  const count = Number(bucket?.count);
  return {
    price,
    currency: 'USD' as const,
    basis: `${input.grader} ${input.grade} eBay completed sales${count > 0 ? ` (${count} sold)` : ''}`,
    count: count > 0 ? count : undefined,
    source: 'pokemon-price-tracker' as const,
    retrievedAt: new Date().toISOString(),
    userTriggered: true as const,
  };
}
