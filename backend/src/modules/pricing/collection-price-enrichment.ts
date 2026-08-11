import { resolveCollectionMarketPrice } from './live-pricing.service';

type CollectionPriceInput = {
  price?: number;
  finishCode?: string;
  cardData?: { tcg?: string; externalId?: string };
};

export async function enrichCollectionCardPrice<T extends CollectionPriceInput>(input: T): Promise<T> {
  if (input.price !== undefined) return input;
  const price = await resolveCollectionMarketPrice(input);
  return price === undefined ? input : { ...input, price };
}
