import {
  gameSnapshotQuote,
  type TrackedPriceItem,
  type TrackedPricesResponse,
} from "@tcg/api-types";
import {
  gamePackageCards,
  installedPackageCapabilities,
} from "@/lib/game-packages/game-package-client";
import { trackedPriceLookupKey } from "./collection-price-lots";

/** Resolve installed data before remote providers. Unknown/expired variants are
 * explicit misses, never a quote borrowed from another finish or currency. */
export async function packageTrackedPrices(
  items: TrackedPriceItem[],
): Promise<{
  remaining: TrackedPriceItem[];
  response?: TrackedPricesResponse;
}> {
  if (typeof indexedDB === "undefined") return { remaining: items };
  const capabilities = (await installedPackageCapabilities()).filter(
    (c) => c.pricing,
  );
  const remaining: TrackedPriceItem[] = [],
    prices: TrackedPricesResponse["prices"] = [];
  const now = Date.now(),
    timestamp = new Date(now).toISOString();
  let refreshAfter = now + 60_000;
  const catalogs = new Map<
    string,
    Awaited<ReturnType<typeof gamePackageCards>>
  >();
  for (const item of items) {
    const sources = capabilities.filter((c) => c.gameId === item.tcg);
    if (sources.length === 0) {
      remaining.push(item);
      continue;
    }
    const key = trackedPriceLookupKey(
      item.tcg,
      item.externalId,
      item.finishCode,
      item.condition,
      item.language,
    );
    if (sources.length !== 1) {
      prices.push({
        ...item,
        key,
        cached: true,
        error:
          "Multiple package price sources; select a package to inspect its quote.",
      });
      continue;
    }
    const source = sources[0]!;
    let cards = catalogs.get(source.packageId);
    if (!cards) {
      cards = await gamePackageCards(source.packageId);
      catalogs.set(source.packageId, cards);
    }
    const card = cards.find((c) => c.id === item.externalId);
    const quote =
      card &&
      gameSnapshotQuote(
        source.pricing!,
        {
          cardId: card.id,
          printingKey: card.printingKey,
          finishCode: item.finishCode,
          condition: item.condition,
          language: item.language,
          currency: "USD",
        },
        now,
      );
    if (!quote) {
      prices.push({
        ...item,
        key,
        cached: true,
        error: "No current USD package quote for this exact variant.",
      });
      continue;
    }
    refreshAfter = Math.min(refreshAfter, Date.parse(quote.expiresAt));
    prices.push({
      ...item,
      key,
      cached: true,
      price: quote.amount,
      currency: quote.currency,
      source: quote.source,
      updatedAt: quote.observedAt,
      provenance: {
        provider: source.packageId,
        retrievedAt: timestamp,
        originalQuotes: [
          {
            amount: quote.amount,
            currency: quote.currency,
            source: quote.source,
            asOf: quote.observedAt,
          },
        ],
        match: { method: "exact-id", confidence: 1 },
      },
    });
  }
  if (!prices.length) return { remaining };
  const fresh = prices.filter((p) => p.price !== undefined).length,
    missing = prices.length - fresh;
  return {
    remaining,
    response: {
      prices,
      refreshedAt: timestamp,
      refreshAfter: new Date(refreshAfter).toISOString(),
      health: {
        status: missing ? "unsafe" : "healthy",
        total: prices.length,
        priced: fresh,
        fresh,
        stale: 0,
        missing,
        failed: 0,
        lowConfidence: 0,
        coverage: (fresh / prices.length) * 100,
        freshnessHours: 0,
        message: `${fresh} of ${prices.length} variants have current publisher snapshot quotes.`,
      },
    },
  };
}
