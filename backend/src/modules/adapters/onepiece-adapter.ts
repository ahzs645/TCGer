import type { TcgSet } from '@tcg/api-types';
import { CardDTO, TcgAdapter } from './types';

const API_ROOT = 'https://optcgapi.com/api';
const configuredDelay = Number.parseInt(process.env.ONEPIECE_MIN_DELAY_MS ?? '', 10);
const DEFAULT_REQUEST_DELAY_MS = 200;
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

interface OPCard {
  card_id?: string;
  card_name?: string;
  card_color?: string;
  card_type?: string;
  card_cost?: string;
  card_power?: string;
  card_counter?: string;
  card_attribute?: string;
  card_effect?: string;
  card_trigger?: string;
  card_rarity?: string;
  card_set?: string;
  card_set_id?: string;
  card_image?: string;
  card_image_id?: string;
}

interface OPSet {
  set_id?: number;
  set_name?: string;
  set_code?: string;
  set_num_cards?: number;
}

export class OnePieceAdapter implements TcgAdapter {
  readonly game = 'onepiece' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    try {
      // OPTCG API uses filtered endpoint with card_name filter
      const url = `${API_ROOT}/sets/filtered/?card_name=${encodeURIComponent(trimmedQuery)}`;
      const response = await rateLimitedFetch(url);
      if (!response.ok) {
        throw new Error(`One Piece search failed: ${response.status}`);
      }
      const payload = await response.json();
      const cards = Array.isArray(payload) ? payload : [];
      return cards.slice(0, 20).map((card: OPCard) => this.mapCard(card));
    } catch (error) {
      console.error('OnePieceAdapter.searchCards error', error);
      return [];
    }
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return null;
    }

    try {
      const response = await rateLimitedFetch(`${API_ROOT}/sets/card/${encodeURIComponent(trimmedId)}/`);
      if (!response.ok) {
        return null;
      }
      const card = await response.json();
      return card ? this.mapCard(card) : null;
    } catch (error) {
      console.error('OnePieceAdapter.fetchCardById error', error);
      return null;
    }
  }

  async fetchSets(): Promise<TcgSet[]> {
    try {
      const response = await rateLimitedFetch(`${API_ROOT}/allSets/`);
      if (!response.ok) {
        throw new Error(`One Piece sets fetch failed: ${response.status}`);
      }
      const payload = await response.json();
      const sets = Array.isArray(payload) ? payload : [];

      return sets.map((s: OPSet) => ({
        code: s.set_code ?? String(s.set_id ?? ''),
        name: s.set_name ?? 'Unknown Set',
        tcg: this.game as const,
        totalCards: s.set_num_cards
      }));
    } catch (error) {
      console.error('OnePieceAdapter.fetchSets error', error);
      return [];
    }
  }

  async fetchSetCards(setCode: string): Promise<CardDTO[]> {
    try {
      const url = `${API_ROOT}/sets/filtered/?card_set=${encodeURIComponent(setCode)}`;
      const response = await rateLimitedFetch(url);
      if (!response.ok) {
        throw new Error(`One Piece set cards fetch failed: ${response.status}`);
      }
      const payload = await response.json();
      const cards = Array.isArray(payload) ? payload : [];
      return cards.map((card: OPCard) => this.mapCard(card));
    } catch (error) {
      console.error('OnePieceAdapter.fetchSetCards error', error);
      return [];
    }
  }

  private mapCard(card: OPCard): CardDTO {
    const cardId = card.card_id ?? card.card_image_id ?? '';
    const imageUrl = card.card_image
      ? card.card_image
      : card.card_image_id
        ? `https://en.onepiece-cardgame.com/images/cardlist/card/${card.card_image_id}.png`
        : undefined;

    return {
      id: cardId,
      tcg: this.game,
      name: card.card_name ?? 'Unknown',
      setCode: card.card_set_id ?? card.card_set,
      setName: card.card_set,
      rarity: card.card_rarity,
      imageUrl,
      imageUrlSmall: imageUrl,
      attributes: {
        color: card.card_color,
        type: card.card_type,
        cost: card.card_cost,
        power: card.card_power,
        counter: card.card_counter,
        attribute: card.card_attribute,
        effect: card.card_effect,
        trigger: card.card_trigger
      }
    };
  }
}
