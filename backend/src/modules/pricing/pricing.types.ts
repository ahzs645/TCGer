import type { TrackedPriceItem } from '@tcg/api-types';

export interface PriceProviderQuote {
  price?: number;
  foilPrice?: number;
  etchedPrice?: number;
  reverseHoloPrice?: number;
  currency: string;
  provenance?: PriceProvenance;
}

export interface PriceOriginalQuote {
  amount: number;
  currency: string;
  source: string;
  asOf?: string;
}

export interface PriceMatchProvenance {
  method: 'exact-id' | 'exact-set-number' | 'exact-name' | 'fuzzy';
  confidence: number;
  ambiguous?: boolean;
  providerProductId?: string;
  providerGroupId?: string;
}

export interface PriceProvenance {
  provider: string;
  retrievedAt: string;
  originalQuotes: PriceOriginalQuote[];
  fx?: {
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    source: string;
    asOf: string;
  };
  match?: PriceMatchProvenance;
}

export interface PriceProvider {
  readonly name: string;
  /** Expensive or comparison-only providers opt out of automatic selection. */
  readonly includeInAutomatic?: boolean;
  fetchPrice(
    tcg: string,
    externalId: string,
    context?: Pick<
      TrackedPriceItem,
      'finishCode' | 'condition' | 'language' | 'identifiers' | 'lookupHint'
    >,
  ): Promise<PriceProviderQuote | null>;
}

export interface LivePriceResult {
  source: string;
  price: number;
  currency: string;
  basePrice?: number;
  foilPrice?: number;
  etchedPrice?: number;
  reverseHoloPrice?: number;
  finishCode?: string;
  updatedAt: string;
  provenance?: PriceProvenance;
}

export function isUsablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function parsePrice(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number.parseFloat(value)
        : undefined;
  return isUsablePrice(parsed) ? parsed : undefined;
}

export function normalizePriceQuote(quote: PriceProviderQuote | null): PriceProviderQuote | null {
  if (!quote) return null;
  const normalized = {
    currency: quote.currency.trim().toUpperCase() || 'USD',
    price: isUsablePrice(quote.price) ? quote.price : undefined,
    foilPrice: isUsablePrice(quote.foilPrice) ? quote.foilPrice : undefined,
    etchedPrice: isUsablePrice(quote.etchedPrice) ? quote.etchedPrice : undefined,
    reverseHoloPrice: isUsablePrice(quote.reverseHoloPrice) ? quote.reverseHoloPrice : undefined,
    provenance: quote.provenance,
  };
  return normalized.price ||
    normalized.foilPrice ||
    normalized.etchedPrice ||
    normalized.reverseHoloPrice
    ? normalized
    : null;
}

export function selectPriceForFinish(
  quote: PriceProviderQuote,
  finishCode?: string,
): number | undefined {
  const finish = finishCode?.trim().toLocaleLowerCase() ?? '';
  if (
    finish === 'normal' ||
    finish === 'regular' ||
    finish === 'nonfoil' ||
    finish === 'non-foil' ||
    finish === 'nonholo' ||
    finish === 'non-holo'
  ) {
    return quote.price ?? quote.foilPrice ?? quote.etchedPrice ?? quote.reverseHoloPrice;
  }
  if (finish.includes('reverse')) {
    return quote.reverseHoloPrice ?? quote.foilPrice ?? quote.etchedPrice ?? quote.price;
  }
  if (finish.includes('etched')) {
    return quote.etchedPrice ?? quote.foilPrice ?? quote.price;
  }
  if (finish.includes('foil') || finish.includes('holo')) {
    return quote.foilPrice ?? quote.price;
  }
  return quote.price ?? quote.foilPrice ?? quote.etchedPrice ?? quote.reverseHoloPrice;
}
