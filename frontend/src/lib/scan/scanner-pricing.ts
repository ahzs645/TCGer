import type {
  PriceSource,
  TrackedPriceItem,
  TrackedPricesResponse,
} from "@tcg/api-types";
import { getTrackedCardPrices } from "@/lib/api/pricing";
import { LatestRequest, type RequestResult } from "@/lib/latest-request";
import { capturePrivateSession } from "@/lib/private-session";
import { trackedPriceLookupKey } from "@/lib/pricing/collection-price-lots";

export const scannerPriceKey = (item: TrackedPriceItem) =>
  trackedPriceLookupKey(
    item.tcg,
    item.externalId,
    item.finishCode,
    item.condition,
    item.language,
  );

/** The optional fields are part of the identity; an unspecified finish is never a foil quote. */
export function scannerPriceItems(
  items: TrackedPriceItem[],
): TrackedPriceItem[] {
  const unique = new Map<string, TrackedPriceItem>();
  for (const item of items) {
    const normalized: TrackedPriceItem = {
      tcg: item.tcg.trim().toLowerCase(),
      externalId: item.externalId.trim(),
      ...(item.finishCode?.trim()
        ? { finishCode: item.finishCode.trim() }
        : {}),
      ...(item.condition?.trim() ? { condition: item.condition.trim() } : {}),
      ...(item.language?.trim() ? { language: item.language.trim() } : {}),
    };
    unique.set(scannerPriceKey(normalized), normalized);
  }
  return [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, item]) => item);
}

export interface ScannerQuote {
  price?: number;
  currency?: string;
  source?: string;
  asOf?: string;
  cached?: boolean;
  freshness: "fresh" | "stale" | "unknown" | "missing";
  message?: string;
}
export interface ScannerPriceSnapshot {
  quotes: Record<string, ScannerQuote>;
  refreshedAt: string;
  refreshAfter: string;
}

export function scannerPriceSnapshot(
  items: TrackedPriceItem[],
  response: TrackedPricesResponse,
  now = Date.now(),
): ScannerPriceSnapshot {
  const quotes: Record<string, ScannerQuote> = {};
  const freshnessHours = Number.isFinite(response.health.freshnessHours)
    ? Math.max(0, response.health.freshnessHours)
    : 24;
  for (const item of scannerPriceItems(items)) {
    const key = scannerPriceKey(item);
    const matches = response.prices.filter(
      (quote) => scannerPriceKey(quote) === key,
    );
    const quote = matches.length === 1 ? matches[0] : undefined;
    if (
      !quote ||
      quote.price === undefined ||
      !Number.isFinite(quote.price) ||
      quote.price < 0 ||
      !/^[A-Za-z]{3}$/.test(quote.currency ?? "")
    ) {
      quotes[key] = {
        freshness: "missing",
        message:
          quote?.error ?? "No quote for this exact printing and copy details.",
      };
      continue;
    }
    const asOf = quote.updatedAt;
    const date = asOf ? Date.parse(asOf) : NaN;
    quotes[key] = {
      price: quote.price,
      currency: quote.currency!.toUpperCase(),
      source: quote.source,
      asOf: Number.isFinite(date) ? asOf : undefined,
      cached: quote.cached,
      freshness:
        !Number.isFinite(date) || date > now + 60_000
          ? "unknown"
          : now - date > freshnessHours * 3_600_000
            ? "stale"
            : "fresh",
    };
  }
  return {
    quotes,
    refreshedAt: response.refreshedAt,
    refreshAfter: response.refreshAfter,
  };
}

/** Shared by automatic refresh and manual retries; fences results AND errors. */
export class ScannerPriceController {
  private latest = new LatestRequest();
  constructor(private load = getTrackedCardPrices) {}
  cancel() {
    this.latest.cancel();
  }
  async refresh(
    token: string,
    items: TrackedPriceItem[],
    source: PriceSource,
    force: boolean,
    publish: (result: RequestResult<ScannerPriceSnapshot>) => void,
  ) {
    const origin = capturePrivateSession(token);
    origin.assertCurrent();
    const requested = scannerPriceItems(items);
    await this.latest.run(
      async () => {
        const response = await this.load(token, requested, force, source);
        origin.assertCurrent();
        return scannerPriceSnapshot(requested, response);
      },
      (result) => {
        if (origin.current()) publish(result);
      },
    );
  }
}
