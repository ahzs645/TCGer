import { prisma } from '../../lib/prisma';
import { fetchLiveCardPrices } from './live-pricing.service';
import { isUsablePrice } from './pricing.types';
import type { PriceSource } from '@tcg/api-types';

export * from './live-pricing.service';

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

export async function fetchCardPrices(
  tcg: string,
  externalId: string,
  finishCode?: string,
  source: PriceSource = 'automatic',
) {
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

  const liveResults = await fetchLiveCardPrices(tcg, externalId, finishCode, source);
  for (const result of liveResults) {
    results.push(result);
    if (card) {
      await recordPriceIfFresh(card.id, result.price, result.source, result.currency, finishCode);
    }
  }

  if (!results.length && card) {
    const lastKnown = await prisma.priceHistory.findFirst({
      where: {
        cardId: card.id,
        finishCode: finishCode ?? null,
        source: source === 'automatic' ? undefined : source,
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
