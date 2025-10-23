import { env } from '../../config/env';
import { CardDTO, TcgAdapter } from './types';

const BASE_URL = 'https://api.pokemontcg.io/v2/cards';

interface PokemonSearchResponse {
  data: PokemonCard[];
}

interface PokemonCard {
  id: string;
  name: string;
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  number?: string;
  rarity?: string;
  images?: {
    small?: string;
    large?: string;
  };
  set?: {
    id?: string;
    name?: string;
    images?: {
      logo?: string;
      symbol?: string;
    };
  };
  attacks?: Array<{ name: string; convertedEnergyCost?: number }>;
  weaknesses?: Array<{ type: string; value?: string }>;
  resistances?: Array<{ type: string; value?: string }>;
  retreatCost?: string[];
  flavorText?: string;
}

export class PokemonAdapter implements TcgAdapter {
  readonly game = 'pokemon' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    const q = trimmedQuery ? this.buildNameQuery(trimmedQuery) : 'supertype:"Pokémon"';
    const url = new URL(BASE_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('pageSize', '20');

    try {
      const response = await fetch(url.toString(), {
        headers: this.buildHeaders()
      });
      if (!response.ok) {
        throw new Error(`Pokemon search failed: ${response.status}`);
      }
      const payload = (await response.json()) as PokemonSearchResponse;
      if (!payload?.data?.length) {
        return [this.buildFallback(trimmedQuery)];
      }
      return payload.data.map((card) => this.mapCard(card));
    } catch (error) {
      console.error('PokemonAdapter.searchCards error', error);
      return [this.buildFallback(trimmedQuery)];
    }
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return null;
    }

    try {
      const response = await fetch(`${BASE_URL}/${trimmedId}`, {
        headers: this.buildHeaders()
      });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as { data: PokemonCard };
      return payload?.data ? this.mapCard(payload.data) : null;
    } catch (error) {
      console.error('PokemonAdapter.fetchCardById error', error);
      return null;
    }
  }

  private mapCard(card: PokemonCard): CardDTO {
    const setSymbol = card.set?.images?.symbol ?? card.set?.images?.logo;
    const retreatCost = Array.isArray(card.retreatCost) ? card.retreatCost.length : undefined;

    return {
      id: card.id,
      tcg: this.game,
      name: card.name,
      setCode: card.set?.id,
      setName: card.set?.name,
      rarity: card.rarity,
      imageUrl: card.images?.large ?? card.images?.small,
      imageUrlSmall: card.images?.small ?? card.images?.large,
      setSymbolUrl: setSymbol,
      attributes: {
        supertype: card.supertype,
        subtypes: card.subtypes,
        hp: card.hp,
        types: card.types,
        evolvesFrom: card.evolvesFrom,
        attacks: card.attacks?.map((attack) => attack.name),
        weaknesses: card.weaknesses,
        resistances: card.resistances,
        retreatCost,
        flavorText: card.flavorText
      }
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };
    if (env.POKEMON_TCG_API_KEY) {
      headers['X-Api-Key'] = env.POKEMON_TCG_API_KEY;
    }
    return headers;
  }

  private buildNameQuery(query: string): string {
    const safeQuery = query.replace(/"/g, '\\"');
    return `name:"${safeQuery}"`;
  }

  private buildFallback(query: string): CardDTO {
    return {
      id: 'xy7-54',
      tcg: this.game,
      name: query ? `Pikachu (${query})` : 'Pikachu',
      setCode: 'xy7',
      setName: 'Ancient Origins',
      rarity: 'Common',
      imageUrl: 'https://images.pokemontcg.io/xy7/54_hires.png',
      imageUrlSmall: 'https://images.pokemontcg.io/xy7/54.png',
      setSymbolUrl: 'https://images.pokemontcg.io/xy7/symbol.png',
      attributes: {
        hp: 60,
        types: ['Lightning'],
        attacks: ['Gnaw', 'Agility'],
        weaknesses: [{ type: 'Fighting', value: '×2' }],
        retreatCost: 1,
        flavorText: 'It occasionally uses an electric shock to recharge a fellow Pikachu that is in a weakened state.'
      }
    };
  }
}
