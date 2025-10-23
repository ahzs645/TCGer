import { CardDTO, TcgAdapter } from './types';

const BASE_URL = 'https://api.scryfall.com/cards';

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
      const response = await fetch(url.toString());
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
      const response = await fetch(`${BASE_URL}/${trimmedId}`);
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
      id: '9f292732-5b25-41bd-8c4c-5dd744b501f5',
      tcg: this.game,
      name: query ? `Black Lotus (${query})` : 'Black Lotus',
      setCode: 'lea',
      setName: 'Limited Edition Alpha',
      rarity: 'Rare',
      imageUrl: 'https://c1.scryfall.com/file/scryfall-cards/large/front/9/f/9f292732-5b25-41bd-8c4c-5dd744b501f5.jpg',
      imageUrlSmall: 'https://c1.scryfall.com/file/scryfall-cards/small/front/9/f/9f292732-5b25-41bd-8c4c-5dd744b501f5.jpg',
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
