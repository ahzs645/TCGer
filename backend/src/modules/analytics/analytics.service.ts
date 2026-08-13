import { prisma } from '../../lib/prisma';
import type {
  CollectionValueHistory,
  CollectionValueBreakdown,
  CollectionDistribution,
  CollectionDuplicates,
} from '@tcg/api-types';
import { isUsablePrice } from '../pricing/pricing.service';

function storedCollectionValue(
  collectionPrice: unknown,
  finishCode: string | null,
  history: Array<{ price: unknown; finishCode: string | null }>,
) {
  const manual = collectionPrice == null ? undefined : Number(collectionPrice);
  if (isUsablePrice(manual)) return manual;
  const matching = history.find((entry) => (entry.finishCode ?? null) === (finishCode ?? null));
  const matchingPrice = matching?.price == null ? undefined : Number(matching.price);
  if (isUsablePrice(matchingPrice)) return matchingPrice;
  const fallback = history.find((entry) => isUsablePrice(Number(entry.price)));
  return fallback?.price == null ? 0 : Number(fallback.price);
}

export async function getCollectionValueHistory(
  userId: string,
  periodDays = 30,
  tcg?: string,
): Promise<CollectionValueHistory> {
  const since = new Date();
  since.setDate(since.getDate() - periodDays);

  // Get all user's cards with price history
  const collections = await prisma.collection.findMany({
    where: {
      userId,
      card: tcg ? { tcgGame: { code: tcg } } : undefined,
    },
    include: {
      card: {
        include: {
          priceHistory: {
            orderBy: { recordedAt: 'desc' },
            take: 120,
          },
        },
      },
    },
  });

  // Build daily value map
  const dailyValues = new Map<string, number>();
  let currentValue = 0;

  for (const col of collections) {
    const price = storedCollectionValue(col.price, col.finishCode, col.card.priceHistory);
    currentValue += price * col.quantity;

    for (const ph of col.card.priceHistory.filter((entry) => entry.recordedAt >= since)) {
      const dateKey = ph.recordedAt.toISOString().split('T')[0];
      const phPrice = ph.price ? parseFloat(ph.price.toString()) : 0;
      dailyValues.set(dateKey, (dailyValues.get(dateKey) || 0) + phPrice * col.quantity);
    }
  }

  const history = Array.from(dailyValues.entries())
    .map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const firstValue = history.length > 0 ? history[0].value : currentValue;
  const changePercent =
    firstValue > 0 ? Math.round(((currentValue - firstValue) / firstValue) * 10000) / 100 : 0;

  return {
    history,
    currentValue: Math.round(currentValue * 100) / 100,
    changePercent,
    changePeriod: `${periodDays}d`,
  };
}

export async function getCollectionValueBreakdown(
  userId: string,
): Promise<CollectionValueBreakdown> {
  const collections = await prisma.collection.findMany({
    where: { userId },
    include: {
      card: {
        include: {
          tcgGame: true,
          priceHistory: {
            orderBy: { recordedAt: 'desc' },
            take: 20,
          },
        },
      },
      binder: { select: { id: true, name: true } },
    },
  });

  const byTcg = new Map<string, { value: number; cardCount: number }>();
  const byBinder = new Map<string, { binderName: string; value: number; cardCount: number }>();
  const cardValues: Array<{
    externalId: string;
    tcg: string;
    name: string;
    value: number;
    imageUrl?: string;
  }> = [];

  for (const col of collections) {
    const price = storedCollectionValue(col.price, col.finishCode, col.card.priceHistory);
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
        imageUrl: col.card.imageUrl || undefined,
      });
    }
  }

  cardValues.sort((a, b) => b.value - a.value);

  return {
    byTcg: Array.from(byTcg.entries()).map(([tcg, data]) => ({
      tcg,
      value: Math.round(data.value * 100) / 100,
      cardCount: data.cardCount,
    })),
    byBinder: Array.from(byBinder.entries()).map(([binderId, data]) => ({
      binderId,
      binderName: data.binderName,
      value: Math.round(data.value * 100) / 100,
      cardCount: data.cardCount,
    })),
    topCards: cardValues.slice(0, 20),
  };
}

export async function getCollectionDistribution(
  userId: string,
  dimension: string,
  tcg?: string,
): Promise<CollectionDistribution> {
  const collections = await prisma.collection.findMany({
    where: {
      userId,
      card: tcg ? { tcgGame: { code: tcg } } : undefined,
    },
    include: {
      card: {
        include: { tcgGame: true, magicCard: true, yugiohCard: true, pokemonCard: true },
      },
    },
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
        label =
          col.card.magicCard?.cardType ||
          col.card.yugiohCard?.cardType ||
          col.card.pokemonCard?.pokemonType ||
          'Unknown';
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
      percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { dimension, entries, total };
}

export async function getCollectionDuplicates(
  userId: string,
  keepCount = 1,
  tcg?: string,
): Promise<CollectionDuplicates> {
  const normalizedKeepCount = Math.min(100, Math.max(1, Math.trunc(keepCount)));
  const collections = await prisma.collection.findMany({
    where: {
      userId,
      card: tcg ? { tcgGame: { code: tcg } } : undefined,
    },
    include: {
      card: { include: { tcgGame: true } },
      binder: { select: { id: true, name: true } },
    },
    orderBy: { id: 'asc' },
    take: 5_001,
  });
  if (collections.length > 5_000) {
    const error = new Error(
      'Duplicate analytics supports up to 5,000 collection entries'
    ) as Error & { status: number; code: string };
    error.status = 422;
    error.code = 'LIMIT_EXCEEDED';
    throw error;
  }
  type GroupedDuplicate = {
    card: (typeof collections)[number]['card'];
    quantity: number;
    storedValue: number;
    pricedCopies: Array<{ quantity: number; unitPrice: number }>;
    binders: Map<string, { binderName: string; quantity: number }>;
    conditions: Map<string, number>;
  };
  const grouped = new Map<string, GroupedDuplicate>();

  for (const collection of collections) {
    const quantity = Math.max(0, Math.trunc(collection.quantity));
    if (quantity === 0) continue;
    const unitPrice = Number(collection.price ?? 0);
    const usablePrice = isUsablePrice(unitPrice) ? unitPrice : 0;
    const item: GroupedDuplicate = grouped.get(collection.cardId) ?? {
      card: collection.card,
      quantity: 0,
      storedValue: 0,
      pricedCopies: [],
      binders: new Map(),
      conditions: new Map(),
    };
    item.quantity += quantity;
    item.storedValue += usablePrice * quantity;
    item.pricedCopies.push({ quantity, unitPrice: usablePrice });

    const binderId = collection.binderId ?? '__library__';
    const binderSummary = item.binders.get(binderId) ?? {
      binderName: collection.binder?.name ?? 'Unsorted',
      quantity: 0,
    };
    binderSummary.quantity += quantity;
    item.binders.set(binderId, binderSummary);

    const condition = collection.condition?.trim() || 'Unspecified';
    item.conditions.set(condition, (item.conditions.get(condition) ?? 0) + quantity);
    grouped.set(collection.cardId, item);
  }

  const items = [...grouped.entries()]
    .flatMap(([cardId, item]) => {
      if (item.quantity <= normalizedKeepCount) return [];

      let copiesToKeep = normalizedKeepCount;
      let retainedValue = 0;
      for (const priced of [...item.pricedCopies].sort(
        (left, right) => right.unitPrice - left.unitPrice,
      )) {
        const retainedCopies = Math.min(copiesToKeep, priced.quantity);
        retainedValue += retainedCopies * priced.unitPrice;
        copiesToKeep -= retainedCopies;
        if (copiesToKeep === 0) break;
      }

      const storedValue = Math.round(item.storedValue * 100) / 100;
      return [{
        cardId,
        externalId: item.card.externalId,
        tcg: item.card.tcgGame.code,
        name: item.card.name,
        setCode: item.card.setCode ?? undefined,
        setName: item.card.setName ?? undefined,
        collectorNumber: item.card.collectorNumber ?? undefined,
        rarity: item.card.rarity ?? undefined,
        imageUrl: item.card.imageUrlSmall ?? item.card.imageUrl ?? undefined,
        quantity: item.quantity,
        excessCopies: item.quantity - normalizedKeepCount,
        storedValue,
        excessStoredValue: Math.round((storedValue - retainedValue) * 100) / 100,
        binders: [...item.binders.entries()]
          .map(([binderId, summary]) => ({ binderId, ...summary }))
          .sort((left, right) =>
            right.quantity - left.quantity ||
            left.binderName.localeCompare(right.binderName)
          ),
        conditions: [...item.conditions.entries()]
          .map(([condition, quantity]) => ({ condition, quantity }))
          .sort((left, right) =>
            right.quantity - left.quantity ||
            left.condition.localeCompare(right.condition)
          )
      }];
    })
    .sort((left, right) =>
      right.excessCopies - left.excessCopies ||
      right.excessStoredValue - left.excessStoredValue ||
      left.name.localeCompare(right.name)
    );

  return {
    keepCount: normalizedKeepCount,
    totalPrintings: items.length,
    totalExcessCopies: items.reduce((sum, item) => sum + item.excessCopies, 0),
    totalStoredValue:
      Math.round(items.reduce((sum, item) => sum + item.storedValue, 0) * 100) / 100,
    totalExcessStoredValue:
      Math.round(items.reduce((sum, item) => sum + item.excessStoredValue, 0) * 100) / 100,
    items,
  };
}
