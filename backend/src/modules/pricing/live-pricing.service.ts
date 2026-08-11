import { adapterRegistry } from '../adapters/adapter-registry';
import {
  LorcastPriceProvider,
  ScryfallPriceProvider,
  TcgDexPriceProvider,
} from './market-price-providers';
import type { LivePriceResult, PriceProvider, PriceProviderQuote } from './pricing.types';
import {
  isUsablePrice,
  normalizePriceQuote,
  parsePrice,
  selectPriceForFinish,
} from './pricing.types';

export * from './pricing.types';

function readPrice(
  attributes: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  if (!attributes) return undefined;
  for (const key of keys) {
    const value = parsePrice(attributes[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

class AdapterPriceProvider implements PriceProvider {
  readonly name = 'card-source';

  async fetchPrice(tcg: string, externalId: string): Promise<PriceProviderQuote | null> {
    // These games have explicit providers with source-correct currencies and fallbacks.
    if (['pokemon', 'magic', 'lorcana'].includes(tcg.toLowerCase())) return null;
    const card = await adapterRegistry.get(tcg).fetchCardById(externalId);
    if (!card) return null;
    return normalizePriceQuote({
      currency: 'USD',
      price: readPrice(card.attributes, [
        'market_price',
        'marketPrice',
        'price_usd',
        'set_price',
        'price',
      ]),
      foilPrice: readPrice(card.attributes, [
        'foil_market_price',
        'foilMarketPrice',
        'price_usd_foil',
        'price_usd_etched',
        'holofoil_market_price',
      ]),
      reverseHoloPrice: readPrice(card.attributes, [
        'reverse_holo_market_price',
        'reverseHoloMarketPrice',
      ]),
    });
  }
}

const providers: PriceProvider[] = [
  new TcgDexPriceProvider(),
  new ScryfallPriceProvider(),
  new LorcastPriceProvider(),
  new AdapterPriceProvider(),
];

export function registerPriceProvider(provider: PriceProvider): void {
  if (!providers.some((candidate) => candidate.name === provider.name)) {
    providers.push(provider);
  }
}

export async function fetchLiveCardPrices(
  tcg: string,
  externalId: string,
  finishCode?: string,
): Promise<LivePriceResult[]> {
  const results: LivePriceResult[] = [];
  for (const provider of providers) {
    try {
      const quote = normalizePriceQuote(await provider.fetchPrice(tcg, externalId));
      if (!quote) continue;
      const selected = selectPriceForFinish(quote, finishCode);
      if (!isUsablePrice(selected)) continue;
      results.push({
        source: provider.name,
        price: selected,
        currency: quote.currency,
        basePrice: quote.price,
        foilPrice: quote.foilPrice,
        reverseHoloPrice: quote.reverseHoloPrice,
        finishCode,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[pricing] Provider ${provider.name} failed for ${tcg}/${externalId}:`, error);
    }
  }
  return results;
}

export async function resolveCollectionMarketPrice(input: {
  price?: number;
  finishCode?: string;
  cardData?: { tcg?: string; externalId?: string };
}): Promise<number | undefined> {
  if (input.price !== undefined) return input.price;
  const tcg = input.cardData?.tcg;
  const externalId = input.cardData?.externalId;
  if (!tcg || !externalId) return undefined;
  const [quote] = await fetchLiveCardPrices(tcg, externalId, input.finishCode);
  return quote?.price;
}
