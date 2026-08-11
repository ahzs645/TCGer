import type { PriceProvider, PriceProviderQuote } from './pricing.types';
import { normalizePriceQuote, parsePrice } from './pricing.types';

/**
 * Loads a captured or otherwise authorized Collectr-compatible product response.
 *
 * The loader is deliberately injected: Collectr's catalog endpoint is private and
 * uses app/session-specific authentication, so TCGer does not reproduce those
 * headers or call it as a production dependency.
 */
export type CollectrTestPayloadLoader = (
  tcg: string,
  externalId: string,
) => Promise<unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapProduct(payload: unknown): Record<string, unknown> | null {
  let current = asRecord(payload);
  for (const key of ['data', 'product', 'product_details', 'productDetails']) {
    const nested = asRecord(current?.[key]);
    if (nested) current = nested;
  }
  return current;
}

export class CollectrTestPriceProvider implements PriceProvider {
  readonly name = 'collectr-test';

  constructor(private readonly loadPayload: CollectrTestPayloadLoader) {}

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    const product = unwrapProduct(await this.loadPayload(tcg, externalId));
    if (!product) return null;

    const currency =
      typeof product.currency === 'string' && product.currency.trim()
        ? product.currency
        : 'USD';

    return normalizePriceQuote({
      currency,
      // Recovered Collectr Product/ProductDetails payload field.
      price: parsePrice(product.market_price),
    });
  }
}
