import type {
  Binder,
  TrackedPriceItem,
  TrackedPriceResult,
  TransactionResponse,
} from "@tcg/api-types";

import { trackedPriceLookupKey } from "./collection-price-lots";

export interface PurchasePerformanceLot {
  id: string;
  cardName: string;
  setName?: string;
  imageUrl?: string;
  paidAmount: number;
  paidCurrency: string;
  purchasedAt?: string;
  source?: string;
  currentValue?: number;
  currentCurrency: string;
}

function copyFinish(copy: Binder["cards"][number]["copies"][number]) {
  return copy.finishCode?.trim() || (copy.isFoil ? "foil" : undefined);
}

function exactPriceItem(
  card: Binder["cards"][number],
  copy: Binder["cards"][number]["copies"][number],
): TrackedPriceItem {
  return {
    tcg: card.tcg,
    externalId: card.externalId ?? card.cardId,
    finishCode: copyFinish(copy),
    condition: copy.condition ?? card.condition,
    language: copy.language ?? card.language,
  };
}

export function purchasePriceItems(
  collections: Binder[],
  transactions: TransactionResponse[],
): TrackedPriceItem[] {
  const purchasedEntries = new Set(
    transactions
      .filter((transaction) => transaction.type === "purchase")
      .flatMap((transaction) =>
        transaction.collectionEntryId ? [transaction.collectionEntryId] : [],
      ),
  );
  const byKey = new Map<string, TrackedPriceItem>();
  for (const binder of collections) {
    for (const card of binder.cards) {
      for (const copy of card.copies) {
        if (
          !purchasedEntries.has(copy.id) &&
          copy.acquisitionPrice === undefined
        )
          continue;
        const item = exactPriceItem(card, copy);
        byKey.set(
          trackedPriceLookupKey(
            item.tcg,
            item.externalId,
            item.finishCode,
            item.condition,
            item.language,
          ),
          item,
        );
      }
    }
  }
  return Array.from(byKey.values());
}

export function buildPurchasePerformanceLots(
  collections: Binder[],
  transactions: TransactionResponse[],
  marketPrices: TrackedPriceResult[],
): PurchasePerformanceLot[] {
  const purchaseByEntry = new Map<string, TransactionResponse>();
  for (const transaction of transactions) {
    if (
      transaction.type === "purchase" &&
      transaction.collectionEntryId &&
      !purchaseByEntry.has(transaction.collectionEntryId)
    ) {
      purchaseByEntry.set(transaction.collectionEntryId, transaction);
    }
  }
  const marketByKey = new Map<string, TrackedPriceResult>();
  for (const result of marketPrices) {
    marketByKey.set(
      trackedPriceLookupKey(
        result.tcg,
        result.externalId,
        result.finishCode,
        result.condition,
        result.language,
      ),
      result,
    );
  }

  const lots: PurchasePerformanceLot[] = [];
  for (const binder of collections) {
    for (const card of binder.cards) {
      for (const copy of card.copies) {
        const transaction = purchaseByEntry.get(copy.id);
        if (!transaction && copy.acquisitionPrice === undefined) continue;
        const item = exactPriceItem(card, copy);
        const market = marketByKey.get(
          trackedPriceLookupKey(
            item.tcg,
            item.externalId,
            item.finishCode,
            item.condition,
            item.language,
          ),
        );
        lots.push({
          id: copy.id,
          cardName: card.name,
          setName: card.setName,
          imageUrl: card.imageUrlSmall ?? card.imageUrl,
          paidAmount: transaction?.amount ?? copy.acquisitionPrice ?? 0,
          // Legacy acquisition costs predate currency storage and were USD.
          paidCurrency: transaction?.currency ?? "USD",
          purchasedAt: transaction?.date ?? copy.acquiredAt,
          source: transaction?.platform,
          currentValue: market?.price ?? copy.price ?? card.price,
          currentCurrency: market?.currency ?? "USD",
        });
      }
    }
  }
  return lots;
}

export interface ConvertedPurchaseLot extends PurchasePerformanceLot {
  paidInDisplayCurrency: number;
  valueInDisplayCurrency: number;
  gain: number;
  returnPercent: number;
}

export function convertPurchasePerformanceLots(
  lots: PurchasePerformanceLot[],
  rateFor: (source: string, date?: string) => number | undefined,
): ConvertedPurchaseLot[] {
  return lots.flatMap((lot) => {
    if (lot.currentValue === undefined) return [];
    const paidRate = rateFor(lot.paidCurrency, lot.purchasedAt);
    const currentRate = rateFor(lot.currentCurrency);
    if (paidRate === undefined || currentRate === undefined) return [];
    const paidInDisplayCurrency = lot.paidAmount * paidRate;
    const valueInDisplayCurrency = lot.currentValue * currentRate;
    const gain = valueInDisplayCurrency - paidInDisplayCurrency;
    return [
      {
        ...lot,
        paidInDisplayCurrency,
        valueInDisplayCurrency,
        gain,
        returnPercent:
          paidInDisplayCurrency > 0 ? (gain / paidInDisplayCurrency) * 100 : 0,
      },
    ];
  });
}
