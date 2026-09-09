import { blankGradingOutcomes } from '@tcg/api-types';
import type { GradingOutcome, GradingSnapshot, GradingSnapshotRequest } from '@tcg/api-types';
import { env } from '../../config/env';
import { queryGradingProvider } from './graded-price.service';
import { GradingProviderError } from './psa.service';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as RecordValue) : {};
const numeric = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const positive = (...values: unknown[]) => values.map(numeric).find((n) => n != null && n > 0);
const entries = (payload: unknown): RecordValue[] => {
  const data = object(payload).data ?? payload;
  return (Array.isArray(data) ? data : [data]).map(object);
};
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** Preserve specialty outcomes separately; auth/qualifiers also count toward missing coverage. */
export function normalizeGradingSnapshot(
  card: RecordValue,
  population: unknown,
  requested: GradingSnapshotRequest,
  warnings: string[] = [],
): GradingSnapshot {
  const graders = new Map<
    string,
    { grader: string; gemRate: number | null; outcomes: GradingOutcome[] }
  >();
  const group = (name: string) => {
    const grader = name.toUpperCase();
    if (!graders.has(grader)) graders.set(grader, { grader, gemRate: null, outcomes: [] });
    return graders.get(grader)!;
  };
  const outcome = (grader: string, suffix: string) => {
    const canonical = suffix.replace(/^g(?=\d)/, '').replace('_', '.');
    const key = grader.toLowerCase() + canonical;
    const g = group(grader);
    let row = g.outcomes.find((r) => r.key === key);
    if (!row) {
      const grade = Number(canonical);
      row = {
        key,
        label: `${grader.toUpperCase()} ${canonical}`,
        source: 'pokemon-price-tracker',
        history: [],
        ...(grade > 0 && grade <= 10 ? { grade } : {}),
      };
      g.outcomes.push(row);
    }
    return row;
  };
  const ebay = object(card.ebay);
  for (const [key, value] of Object.entries(object(ebay.salesByGrade))) {
    const match = key.match(/^(psa|bgs|cgc|sgc|ace|tag|hga|ars|cgcpristine)(.+)$/i);
    if (!match) continue;
    const stats = object(value);
    const row = outcome(match[1], match[2]);
    row.price = positive(
      object(stats.smartMarketPrice).price,
      stats.medianPrice,
      stats.averagePrice,
    );
    const count = numeric(stats.count);
    if (count != null) row.salesCount = Math.floor(count);
    const confidence = text(object(stats.smartMarketPrice).confidence);
    if (confidence) row.confidence = confidence;
    row.history = Object.entries(object(object(ebay.priceHistory)[key]))
      .flatMap(([date, point]) => {
        const price = positive(object(point).average);
        return /^\d{4}-\d{2}-\d{2}$/.test(date.slice(0, 10)) && price != null
          ? [{ date: date.slice(0, 10), price }]
          : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const pop = entries(population).find((e) => String(e.tcgPlayerId) === requested.tcgPlayerId);
  for (const [grader, data] of Object.entries(object(pop?.populationByGrader))) {
    const stats = object(data);
    const gemRate = numeric(stats.gemRate);
    group(grader).gemRate = gemRate != null && gemRate <= 100 ? gemRate / 100 : null;
    let counted = 0;
    for (const [key, value] of Object.entries(stats)) {
      if (!/^(g?\d+(?:_\d+)?|auth|qualifiers|pristine|perfect)$/.test(key)) continue;
      const count = numeric(value);
      if (count != null && Number.isInteger(count)) {
        outcome(grader, key).population = count;
        counted += count;
      }
    }
    const total = numeric(stats.totalPopulation);
    if (total != null && counted > total) {
      warnings.push(
        `${grader} population counts exceed the provider total. Population weights were omitted because specialty outcomes may overlap.`,
      );
      for (const row of group(grader).outcomes) delete row.population;
    }
    if (total != null && total > counted)
      outcome(grader, 'unclassified').population = Math.floor(total - counted);
  }
  const rawQuotes: GradingSnapshot['rawQuotes'] = [];
  const prices = object(card.prices);
  for (const [printing, conditions] of Object.entries(object(prices.variants))) {
    for (const [condition, value] of Object.entries(object(conditions))) {
      const price = positive(object(value).price);
      if (price != null) rawQuotes.push({ printing, condition, price });
    }
  }
  if (!pop)
    warnings.push(
      'Population unavailable. Enter your own scenario weights, or compare individual grade outcomes.',
    );
  if (![...graders.values()].some((g) => g.outcomes.some((r) => r.history.length)))
    warnings.push('No dated graded sales history was returned.');
  return {
    tcgPlayerId: requested.tcgPlayerId,
    name: text(card.name),
    setName: text(card.setName),
    collectorNumber: text(card.cardNumber ?? card.number),
    currency: 'USD',
    source: 'Pokémon Price Tracker · eBay completed sales',
    sourceUrl: 'https://www.pokemonpricetracker.com',
    retrievedAt: new Date().toISOString(),
    priceAsOf: text(ebay.lastUpdated ?? ebay.updatedAt) || null,
    warnings,
    rawQuotes,
    graders: [...graders.values()].map((g) => ({
      ...g,
      outcomes: [
        ...g.outcomes,
        ...blankGradingOutcomes(g.grader).filter(
          (row) => !g.outcomes.some((existing) => existing.key === row.key),
        ),
      ].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0)),
    })),
  };
}

const cache = new Map<string, { until: number; result: GradingSnapshot }>();
const pending = new Map<string, Promise<GradingSnapshot>>();
export async function fetchGradingSnapshot(
  request: GradingSnapshotRequest,
): Promise<GradingSnapshot> {
  if (!env.POKEMON_PRICE_TRACKER_LICENSE_ACK || !env.POKEMON_PRICE_TRACKER_API_KEY)
    throw new GradingProviderError(
      503,
      'Live graded prices are not configured. You can still use manual estimates.',
    );
  const key = `${request.language}:${request.tcgPlayerId}`;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  if (pending.has(key)) return pending.get(key)!;
  const job = (async () => {
    const payload = await queryGradingProvider({
      ...request,
      includeEbay: 'true',
      includeHistory: 'true',
      days: '90',
      limit: '1',
    });
    const matches = entries(payload).filter((c) => String(c.tcgPlayerId) === request.tcgPlayerId);
    if (matches.length !== 1)
      throw new GradingProviderError(
        404,
        'No exact product match. Check the Pokémon TCGplayer product ID and language.',
      );
    let population: unknown;
    const warnings: string[] = [];
    try {
      population = await queryGradingProvider(request, 'population');
    } catch {
      warnings.push(
        'Population lookup failed or is not included in the server’s provider plan. Prices remain usable.',
      );
    }
    const result = normalizeGradingSnapshot(matches[0], population, request, warnings);
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + 6 * 60 * 60 * 1000, result });
    return result;
  })();
  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}

export async function searchGradingCards(request: { search: string; language: string }) {
  if (!env.POKEMON_PRICE_TRACKER_LICENSE_ACK || !env.POKEMON_PRICE_TRACKER_API_KEY)
    throw new GradingProviderError(
      503,
      'Live graded prices are not configured. You can still use manual estimates.',
    );
  const payload = await queryGradingProvider({ ...request, limit: '10' });
  return {
    cards: entries(payload)
      .filter((card) => /^\d+$/.test(text(card.tcgPlayerId)))
      .map((card) => ({
        tcgPlayerId: text(card.tcgPlayerId),
        name: text(card.name),
        setName: text(card.setName),
        collectorNumber: text(card.cardNumber ?? card.number),
      })),
  };
}
