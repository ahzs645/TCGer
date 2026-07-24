import { prisma } from '../../lib/prisma';
import { adapterRegistry } from '../adapters/adapter-registry';

export interface PriceProviderQuote {
  price?: number;
  foilPrice?: number;
  reverseHoloPrice?: number;
  currency: string;
}

export interface PriceProvider {
  readonly name: string;
  fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null>;
}

export function isUsablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function normalizePriceQuote(quote: PriceProviderQuote | null): PriceProviderQuote | null {
  if (!quote) return null;
  const normalized = {
    currency: quote.currency.trim().toUpperCase() || 'USD',
    price: isUsablePrice(quote.price) ? quote.price : undefined,
    foilPrice: isUsablePrice(quote.foilPrice) ? quote.foilPrice : undefined,
    reverseHoloPrice: isUsablePrice(quote.reverseHoloPrice) ? quote.reverseHoloPrice : undefined,
  };
  return normalized.price || normalized.foilPrice || normalized.reverseHoloPrice
    ? normalized
    : null;
}

export function selectPriceForFinish(
  quote: PriceProviderQuote,
  finishCode?: string,
): number | undefined {
  const finish = finishCode?.trim().toLocaleLowerCase() ?? '';
  if (finish.includes('reverse')) {
    return quote.reverseHoloPrice ?? quote.foilPrice ?? quote.price;
  }
  if (finish.includes('foil') || finish.includes('holo') || finish.includes('etched')) {
    return quote.foilPrice ?? quote.price;
  }
  return quote.price ?? quote.foilPrice ?? quote.reverseHoloPrice;
}

function readPrice(
  attributes: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  if (!attributes) return undefined;
  for (const key of keys) {
    const raw = attributes[key];
    const value =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : undefined;
    if (isUsablePrice(value)) return value;
  }
  return undefined;
}

class AdapterPriceProvider implements PriceProvider {
  readonly name = 'card-source';

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    const card = await adapterRegistry.get(tcg).fetchCardById(externalId);
    if (!card) return null;
    return normalizePriceQuote({
      currency: 'USD',
      price: readPrice(card.attributes, [
        'market_price',
        'marketPrice',
        'price_usd',
        'set_price',
        'price',
      ]),
      foilPrice: readPrice(card.attributes, [
        'foil_market_price',
        'foilMarketPrice',
        'price_usd_foil',
        'price_usd_etched',
        'holofoil_market_price',
      ]),
      reverseHoloPrice: readPrice(card.attributes, [
        'reverse_holo_market_price',
        'reverseHoloMarketPrice',
      ]),
    });
  }
}

const providers: PriceProvider[] = [new AdapterPriceProvider()];

export function registerPriceProvider(provider: PriceProvider): void {
  if (!providers.some((candidate) => candidate.name === provider.name)) {
    providers.push(provider);
  }
}

async function recordPriceIfFresh(
  cardId: string,
  price: number,
  source: string,
  currency: string,
  finishCode?: string,
) {
  if (!isUsablePrice(price)) return;
  const latest = await prisma.priceHistory.findFirst({
    where: { cardId, source, finishCode: finishCode ?? null },
    orderBy: { recordedAt: 'desc' },
  });
  const latestValue = latest?.price ? Number(latest.price) : undefined;
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  if (latest && latest.recordedAt.getTime() >= sixHoursAgo && latestValue === price) {
    return;
  }
  await recordPrice(cardId, price, source, currency, finishCode);
}

export async function fetchCardPrices(tcg: string, externalId: string, finishCode?: string) {
  const card = await prisma.card.findFirst({
    where: { externalId, tcgGame: { code: tcg } },
    select: { id: true },
  });
  const results: Array<{
    source: string;
    price: number;
    currency: string;
    basePrice?: number;
    foilPrice?: number;
    reverseHoloPrice?: number;
    finishCode?: string;
    updatedAt: string;
    isFallback?: boolean;
  }> = [];

  for (const provider of providers) {
    try {
      const quote = normalizePriceQuote(await provider.fetchPrice(tcg, externalId));
      if (!quote) continue;
      const selected = selectPriceForFinish(quote, finishCode);
      if (!isUsablePrice(selected)) continue;
      results.push({
        source: provider.name,
        price: selected,
        currency: quote.currency,
        basePrice: quote.price,
        foilPrice: quote.foilPrice,
        reverseHoloPrice: quote.reverseHoloPrice,
        finishCode,
        updatedAt: new Date().toISOString(),
      });
      if (card) {
        await recordPriceIfFresh(card.id, selected, provider.name, quote.currency, finishCode);
      }
    } catch (error) {
      console.error(`[pricing] Provider ${provider.name} failed for ${tcg}/${externalId}:`, error);
    }
  }

  if (!results.length && card) {
    const lastKnown = await prisma.priceHistory.findFirst({
      where: {
        cardId: card.id,
        finishCode: finishCode ?? null,
        price: { gt: 0 },
      },
      orderBy: { recordedAt: 'desc' },
    });
    const lastKnownPrice = lastKnown?.price ? Number(lastKnown.price) : undefined;
    if (lastKnown && isUsablePrice(lastKnownPrice)) {
      results.push({
        source: lastKnown.source ?? 'last-known',
        price: lastKnownPrice,
        currency: lastKnown.currency,
        finishCode,
        updatedAt: lastKnown.recordedAt.toISOString(),
        isFallback: true,
      });
    }
  }
  return results;
}

export async function recordPrice(
  cardId: string,
  price: number,
  source: string,
  currency = 'USD',
  finishCode?: string,
) {
  if (!isUsablePrice(price)) {
    throw new Error('Price must be finite and greater than zero');
  }
  await prisma.priceHistory.create({
    data: { cardId, price, source, currency, finishCode },
  });
}

export async function getPriceHistory(cardId: string, limit = 30, finishCode?: string) {
  const history = await prisma.priceHistory.findMany({
    where: { cardId, finishCode: finishCode ?? undefined },
    orderBy: { recordedAt: 'desc' },
    take: limit,
  });
  return history
    .map((entry) => ({
      price: entry.price ? Number(entry.price) : 0,
      source: entry.source,
      currency: entry.currency,
      finishCode: entry.finishCode,
      recordedAt: entry.recordedAt.toISOString(),
    }))
    .filter((entry) => isUsablePrice(entry.price));
}

export async function getPriceAnalyticsMovers(tcg?: string, periodDays = 7) {
  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  const recentPrices = await prisma.priceHistory.findMany({
    where: {
      recordedAt: { gte: since },
      price: { gt: 0 },
      card: tcg ? { tcgGame: { code: tcg } } : undefined,
    },
    include: { card: { include: { tcgGame: true } } },
    orderBy: { recordedAt: 'desc' },
  });

  const cardPrices = new Map<
    string,
    { first: number; last: number; name: string; tcg: string; externalId: string }
  >();
  for (const entry of recentPrices) {
    const price = entry.price ? Number(entry.price) : 0;
    if (!isUsablePrice(price)) continue;
    const key = `${entry.cardId}:${entry.finishCode ?? ''}`;
    const existing = cardPrices.get(key);
    if (!existing) {
      cardPrices.set(key, {
        first: price,
        last: price,
        name: entry.card.name,
        tcg: entry.card.tcgGame.code,
        externalId: entry.card.externalId,
      });
    } else {
      existing.first = price;
    }
  }

  const movers = Array.from(cardPrices.values())
    .filter((card) => card.first > 0)
    .map((card) => ({
      externalId: card.externalId,
      tcg: card.tcg,
      name: card.name,
      priceChange: Math.round((card.last - card.first) * 100) / 100,
      percentChange: Math.round(((card.last - card.first) / card.first) * 10000) / 100,
      currentPrice: card.last,
    }));
  movers.sort((left, right) => right.percentChange - left.percentChange);
  return {
    gainers: movers.filter((mover) => mover.priceChange > 0).slice(0, 20),
    losers: movers
      .filter((mover) => mover.priceChange < 0)
      .sort((left, right) => left.percentChange - right.percentChange)
      .slice(0, 20),
  };
}
