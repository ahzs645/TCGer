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

export interface LivePriceResult {
  source: string;
  price: number;
  currency: string;
  basePrice?: number;
  foilPrice?: number;
  reverseHoloPrice?: number;
  finishCode?: string;
  updatedAt: string;
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
