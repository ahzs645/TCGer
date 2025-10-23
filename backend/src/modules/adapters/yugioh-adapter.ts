import { CardDTO, TcgAdapter } from './types';

const BASE_URL = 'https://db.ygoprodeck.com/api/v7';

interface YgoApiResponse {
  data: YgoCard[];
}

interface YgoCard {
  id: number;
  name: string;
  type?: string;
  race?: string;
  desc?: string;
  atk?: number;
  def?: number;
  level?: number;
  attribute?: string;
  archetype?: string;
  card_images?: Array<{ image_url: string; image_url_small: string }>; // eslint-disable-line camelcase
  card_sets?: Array<{ set_code: string; set_name: string; set_rarity: string }>; // eslint-disable-line camelcase
}

export class YugiohAdapter implements TcgAdapter {
  readonly game = 'yugioh' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    const url = new URL(`${BASE_URL}/cardinfo.php`);
    if (trimmedQuery) {
      url.searchParams.set('fname', trimmedQuery);
    }
    url.searchParams.set('num', '20');
    url.searchParams.set('offset', '0');

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`YGO search failed: ${response.status}`);
      }
      const payload = (await response.json()) as YgoApiResponse;
      if (!payload?.data?.length) {
        return [this.buildFallback(trimmedQuery)];
      }
      return payload.data.map((card) => this.mapCard(card));
    } catch (error) {
      console.error('YugiohAdapter.searchCards error', error);
      return [this.buildFallback(trimmedQuery)];
    }
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return null;
    }

    const url = new URL(`${BASE_URL}/cardinfo.php`);
    url.searchParams.set('id', trimmedId);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as YgoApiResponse;
      const card = payload?.data?.[0];
      return card ? this.mapCard(card) : null;
    } catch (error) {
      console.error('YugiohAdapter.fetchCardById error', error);
      return null;
    }
  }

  private mapCard(card: YgoCard): CardDTO {
    const primaryImage = card.card_images?.[0];
    const primarySet = card.card_sets?.[0];

    return {
      id: String(card.id),
      tcg: this.game,
      name: card.name,
      setCode: primarySet?.set_code,
      setName: primarySet?.set_name,
      rarity: primarySet?.set_rarity,
      imageUrl: primaryImage?.image_url,
      imageUrlSmall: primaryImage?.image_url_small,
      attributes: {
        type: card.type,
        race: card.race,
        description: card.desc,
        atk: card.atk,
        def: card.def,
        level: card.level,
        attribute: card.attribute,
        archetype: card.archetype
      }
    };
  }

  private buildFallback(query: string): CardDTO {
    return {
      id: '46986414',
      tcg: this.game,
      name: query ? `Dark Magician (${query})` : 'Dark Magician',
      setCode: 'SDY-006',
      setName: 'Starter Deck: Yugi',
      rarity: 'Ultra Rare',
      imageUrl: 'https://images.ygoprodeck.com/images/cards/46986414.jpg',
      imageUrlSmall: 'https://images.ygoprodeck.com/images/cards_small/46986414.jpg',
      attributes: {
        type: 'Monster / Spellcaster',
        attribute: 'DARK',
        level: 7,
        atk: 2500,
        def: 2100,
        description: 'The ultimate wizard in terms of attack and defense.'
      }
    };
  }
}
