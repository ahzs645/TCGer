import { CardDTO, TcgAdapter } from './types';

const BASE_URL = 'https://api.scryfall.com/cards';
const DEFAULT_REQUEST_DELAY_MS = 120;
const configuredDelay = Number.parseInt(process.env.SCRYFALL_MIN_DELAY_MS ?? `${DEFAULT_REQUEST_DELAY_MS}`, 10);
const MIN_REQUEST_DELAY_MS = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : DEFAULT_REQUEST_DELAY_MS;

let rateLimitChain: Promise<void> = Promise.resolve();
let nextAllowedRequestTime = 0;

function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

async function rateLimitedFetch(input: string, init?: RequestInit): Promise<Response> {
  const waitPromise = rateLimitChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, nextAllowedRequestTime - now);
    if (wait > 0) {
      await sleep(wait);
    }
    nextAllowedRequestTime = Date.now() + MIN_REQUEST_DELAY_MS;
  });

  rateLimitChain = waitPromise.catch(() => {});
  await waitPromise;

  return fetch(input, init);
}

interface ScryfallSearchResponse {
  data: ScryfallCard[];
}

interface ScryfallCard {
  id: string;
  name: string;
  set: string;
  set_name: string; // eslint-disable-line camelcase
  collector_number?: string; // eslint-disable-line camelcase
  rarity?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
  };
  card_faces?: Array<{
    name?: string;
    image_uris?: {
      small?: string;
      normal?: string;
      large?: string;
    };
    mana_cost?: string; // eslint-disable-line camelcase
    type_line?: string; // eslint-disable-line camelcase
    oracle_text?: string; // eslint-disable-line camelcase
  }>;
  mana_cost?: string; // eslint-disable-line camelcase
  type_line?: string; // eslint-disable-line camelcase
  oracle_text?: string; // eslint-disable-line camelcase
  colors?: string[];
  power?: string;
  toughness?: string;
  artist?: string;
  prices?: {
    usd?: string;
  };
}

export class MagicAdapter implements TcgAdapter {
  readonly game = 'magic' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    const searchQuery = trimmedQuery || 'type:creature';
    const url = new URL(`${BASE_URL}/search`);
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('order', 'name');
    url.searchParams.set('unique', 'cards');
    url.searchParams.set('dir', 'asc');

    try {
      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`Scryfall search failed: ${response.status}`);
      }
      const payload = (await response.json()) as ScryfallSearchResponse;
      if (!payload?.data?.length) {
        return [this.buildFallback(trimmedQuery)];
      }
      return payload.data.slice(0, 20).map((card) => this.mapCard(card));
    } catch (error) {
      console.error('MagicAdapter.searchCards error', error);
      return [this.buildFallback(trimmedQuery)];
    }
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return null;
    }

    try {
      const response = await rateLimitedFetch(`${BASE_URL}/${trimmedId}`);
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as ScryfallCard;
      return this.mapCard(payload);
    } catch (error) {
      console.error('MagicAdapter.fetchCardById error', error);
      return null;
    }
  }

  private mapCard(card: ScryfallCard): CardDTO {
    const face = card.card_faces?.[0];
    const image = card.image_uris ?? face?.image_uris ?? {};
    const symbolUrl = card.set ? `https://svgs.scryfall.io/sets/${card.set}.svg` : undefined;
    const priceUsd = card.prices?.usd ? Number.parseFloat(card.prices.usd) : undefined;

    return {
      id: card.id,
      tcg: this.game,
      name: card.name,
      setCode: card.set,
      setName: card.set_name,
      rarity: card.rarity,
      imageUrl: image.large ?? image.normal ?? image.small,
      imageUrlSmall: image.small ?? image.normal ?? image.large,
      setSymbolUrl: symbolUrl,
      attributes: {
        mana_cost: card.mana_cost ?? face?.mana_cost,
        type_line: card.type_line ?? face?.type_line,
        oracle_text: card.oracle_text ?? face?.oracle_text,
        colors: card.colors,
        power: card.power ?? face?.power,
        toughness: card.toughness ?? face?.toughness,
        artist: card.artist,
        price_usd: priceUsd
      }
    };
  }

  private buildFallback(query: string): CardDTO {
    return {
      id: 'b0faa7f2-b547-42c4-a810-839da50dadfe',
      tcg: this.game,
      name: query ? `Black Lotus (${query})` : 'Black Lotus',
      setCode: 'lea',
      setName: 'Limited Edition Alpha',
      rarity: 'Rare',
      imageUrl: 'https://cards.scryfall.io/large/front/b/0/b0faa7f2-b547-42c4-a810-839da50dadfe.jpg?1559591477',
      imageUrlSmall: 'https://cards.scryfall.io/small/front/b/0/b0faa7f2-b547-42c4-a810-839da50dadfe.jpg?1559591477',
      setSymbolUrl: 'https://svgs.scryfall.io/sets/lea.svg',
      attributes: {
        mana_cost: '{0}',
        type_line: 'Artifact',
        oracle_text: '{T}, Sacrifice Black Lotus: Add three mana of any one color.',
        artist: 'Christopher Rush'
      }
    };
  }
}
