import { prisma } from '../../lib/prisma';

// ---------------------------------------------------------------------------
// Multi-source price provider service
// ---------------------------------------------------------------------------

export interface PriceProvider {
  readonly name: string;
  fetchPrice(tcg: string, externalId: string): Promise<{ price: number; currency: string; foilPrice?: number } | null>;
}

// Registry of price providers
const providers: PriceProvider[] = [];

export function registerPriceProvider(provider: PriceProvider): void {
  providers.push(provider);
}

export async function fetchCardPrices(tcg: string, externalId: string) {
  const results = [];
  for (const provider of providers) {
    try {
      const result = await provider.fetchPrice(tcg, externalId);
      if (result) {
        results.push({
          source: provider.name,
          price: result.price,
          currency: result.currency,
          foilPrice: result.foilPrice,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(`[pricing] Provider ${provider.name} failed for ${tcg}/${externalId}:`, err);
    }
  }
  return results;
}

export async function recordPrice(cardId: string, price: number, source: string, currency = 'USD') {
  await prisma.priceHistory.create({
    data: { cardId, price, source, currency }
  });
}

export async function getPriceHistory(cardId: string, limit = 30) {
  const history = await prisma.priceHistory.findMany({
    where: { cardId },
    orderBy: { recordedAt: 'desc' },
    take: limit
  });
  return history.map(h => ({
    price: h.price ? parseFloat(h.price.toString()) : 0,
    source: h.source,
    currency: h.currency,
    recordedAt: h.recordedAt.toISOString()
  }));
}

export async function getPriceAnalyticsMovers(tcg?: string, periodDays = 7) {
  const since = new Date();
  since.setDate(since.getDate() - periodDays);

  // Get cards with price history in the period
  const recentPrices = await prisma.priceHistory.findMany({
    where: {
      recordedAt: { gte: since },
      card: tcg ? { tcgGame: { code: tcg } } : undefined
    },
    include: { card: { include: { tcgGame: true } } },
    orderBy: { recordedAt: 'desc' }
  });

  // Group by card, find price changes
  const cardPrices = new Map<string, { first: number; last: number; name: string; tcg: string; externalId: string }>();
  for (const p of recentPrices) {
    const key = p.cardId;
    const price = p.price ? parseFloat(p.price.toString()) : 0;
    const existing = cardPrices.get(key);
    if (!existing) {
      cardPrices.set(key, { first: price, last: price, name: p.card.name, tcg: p.card.tcgGame.code, externalId: p.card.externalId });
    } else {
      existing.first = price; // Older record overwrites first
    }
  }

  const movers = Array.from(cardPrices.values())
    .filter(c => c.first > 0)
    .map(c => ({
      externalId: c.externalId,
      tcg: c.tcg,
      name: c.name,
      priceChange: Math.round((c.last - c.first) * 100) / 100,
      percentChange: Math.round(((c.last - c.first) / c.first) * 10000) / 100,
      currentPrice: c.last
    }));

  movers.sort((a, b) => b.percentChange - a.percentChange);

  return {
    gainers: movers.filter(m => m.priceChange > 0).slice(0, 20),
    losers: movers.filter(m => m.priceChange < 0).sort((a, b) => a.percentChange - b.percentChange).slice(0, 20)
  };
}
