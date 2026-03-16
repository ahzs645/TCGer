import { prisma } from '../../lib/prisma';
import type { CollectionValueHistory, CollectionValueBreakdown, CollectionDistribution } from '@tcg/api-types';

export async function getCollectionValueHistory(userId: string, periodDays = 30): Promise<CollectionValueHistory> {
  const since = new Date();
  since.setDate(since.getDate() - periodDays);

  // Get all user's cards with price history
  const collections = await prisma.collection.findMany({
    where: { userId },
    include: {
      card: {
        include: {
          priceHistory: {
            where: { recordedAt: { gte: since } },
            orderBy: { recordedAt: 'asc' }
          }
        }
      }
    }
  });

  // Build daily value map
  const dailyValues = new Map<string, number>();
  let currentValue = 0;

  for (const col of collections) {
    const price = col.price ? parseFloat(col.price.toString()) : 0;
    currentValue += price * col.quantity;

    for (const ph of col.card.priceHistory) {
      const dateKey = ph.recordedAt.toISOString().split('T')[0];
      const phPrice = ph.price ? parseFloat(ph.price.toString()) : 0;
      dailyValues.set(dateKey, (dailyValues.get(dateKey) || 0) + phPrice * col.quantity);
    }
  }

  const history = Array.from(dailyValues.entries())
    .map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const firstValue = history.length > 0 ? history[0].value : currentValue;
  const changePercent = firstValue > 0 ? Math.round(((currentValue - firstValue) / firstValue) * 10000) / 100 : 0;

  return {
    history,
    currentValue: Math.round(currentValue * 100) / 100,
    changePercent,
    changePeriod: `${periodDays}d`
  };
}

export async function getCollectionValueBreakdown(userId: string): Promise<CollectionValueBreakdown> {
  const collections = await prisma.collection.findMany({
    where: { userId },
    include: {
      card: { include: { tcgGame: true } },
      binder: { select: { id: true, name: true } }
    }
  });

  const byTcg = new Map<string, { value: number; cardCount: number }>();
  const byBinder = new Map<string, { binderName: string; value: number; cardCount: number }>();
  const cardValues: Array<{ externalId: string; tcg: string; name: string; value: number; imageUrl?: string }> = [];

  for (const col of collections) {
    const price = col.price ? parseFloat(col.price.toString()) : 0;
    const totalPrice = price * col.quantity;
    const tcg = col.card.tcgGame.code;

    // By TCG
    const tcgEntry = byTcg.get(tcg) || { value: 0, cardCount: 0 };
    tcgEntry.value += totalPrice;
    tcgEntry.cardCount += col.quantity;
    byTcg.set(tcg, tcgEntry);

    // By Binder
    const binderId = col.binderId || '__library__';
    const binderName = col.binder?.name || 'Unsorted';
    const binderEntry = byBinder.get(binderId) || { binderName, value: 0, cardCount: 0 };
    binderEntry.value += totalPrice;
    binderEntry.cardCount += col.quantity;
    byBinder.set(binderId, binderEntry);

    // Card values for top cards
    if (totalPrice > 0) {
      cardValues.push({
        externalId: col.card.externalId,
        tcg,
        name: col.card.name,
        value: totalPrice,
        imageUrl: col.card.imageUrl || undefined
      });
    }
  }

  cardValues.sort((a, b) => b.value - a.value);

  return {
    byTcg: Array.from(byTcg.entries()).map(([tcg, data]) => ({
      tcg,
      value: Math.round(data.value * 100) / 100,
      cardCount: data.cardCount
    })),
    byBinder: Array.from(byBinder.entries()).map(([binderId, data]) => ({
      binderId,
      binderName: data.binderName,
      value: Math.round(data.value * 100) / 100,
      cardCount: data.cardCount
    })),
    topCards: cardValues.slice(0, 20)
  };
}

export async function getCollectionDistribution(userId: string, dimension: string): Promise<CollectionDistribution> {
  const collections = await prisma.collection.findMany({
    where: { userId },
    include: {
      card: {
        include: { tcgGame: true, magicCard: true, yugiohCard: true, pokemonCard: true }
      }
    }
  });

  const counts = new Map<string, number>();
  let total = 0;

  for (const col of collections) {
    const qty = col.quantity;
    total += qty;
    let label: string;

    switch (dimension) {
      case 'rarity':
        label = col.card.rarity || 'Unknown';
        break;
      case 'color':
        if (col.card.magicCard?.colors?.length) {
          for (const color of col.card.magicCard.colors) {
            counts.set(color, (counts.get(color) || 0) + qty);
          }
          continue;
        }
        label = col.card.pokemonCard?.pokemonType || col.card.yugiohCard?.attribute || 'Unknown';
        break;
      case 'type':
        label = col.card.magicCard?.cardType || col.card.yugiohCard?.cardType || col.card.pokemonCard?.pokemonType || 'Unknown';
        break;
      case 'tcg':
        label = col.card.tcgGame.code;
        break;
      default:
        label = 'Unknown';
    }

    counts.set(label, (counts.get(label) || 0) + qty);
  }

  const entries = Array.from(counts.entries())
    .map(([label, count]) => ({
      label,
      count,
      percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0
    }))
    .sort((a, b) => b.count - a.count);

  return { dimension, entries, total };
}
