import type { TcgSet } from '@tcg/api-types';
import { CardDTO, TcgAdapter } from './types';

const API_ROOT = 'https://www.apitcg.com/api/dragonball-fusion';
const configuredDelay = Number.parseInt(process.env.DRAGONBALL_MIN_DELAY_MS ?? '', 10);
const DEFAULT_REQUEST_DELAY_MS = 150;
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

interface DBSCard {
  id?: string;
  cardId?: string;
  name?: string;
  color?: string;
  type?: string;
  rarity?: string;
  power?: string | number;
  comboPower?: string | number;
  energy?: string | number;
  comboEnergy?: string | number;
  era?: string;
  character?: string;
  specialTrait?: string;
  skill?: string;
  image?: string;
  imageUrl?: string;
  set?: string;
  setName?: string;
  setCode?: string;
  cardNumber?: string;
}

interface DBSSet {
  id?: string;
  name?: string;
  code?: string;
  cardCount?: number;
  releaseDate?: string;
}

export class DragonBallAdapter implements TcgAdapter {
  readonly game = 'dragonball' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    try {
      const url = new URL(`${API_ROOT}/cards`);
      url.searchParams.set('property', 'name');
      url.searchParams.set('value', trimmedQuery);

      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`Dragon Ball search failed: ${response.status}`);
      }
      const payload = await response.json();
      const cards = Array.isArray(payload) ? payload : (payload?.data ?? payload?.cards ?? []);
      return cards.slice(0, 20).map((card: DBSCard) => this.mapCard(card));
    } catch (error) {
      console.error('DragonBallAdapter.searchCards error', error);
      return [];
    }
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return null;
    }

    try {
      const response = await rateLimitedFetch(`${API_ROOT}/cards/${encodeURIComponent(trimmedId)}`);
      if (!response.ok) {
        return null;
      }
      const card = await response.json();
      return card ? this.mapCard(card) : null;
    } catch (error) {
      console.error('DragonBallAdapter.fetchCardById error', error);
      return null;
    }
  }

  async fetchSets(): Promise<TcgSet[]> {
    try {
      const response = await rateLimitedFetch(`${API_ROOT}/sets`);
      if (!response.ok) {
        throw new Error(`Dragon Ball sets fetch failed: ${response.status}`);
      }
      const payload = await response.json();
      const sets = Array.isArray(payload) ? payload : (payload?.data ?? payload?.sets ?? []);

      return sets.map((s: DBSSet) => ({
        code: s.code ?? s.id ?? '',
        name: s.name ?? 'Unknown Set',
        tcg: this.game as const,
        releaseDate: s.releaseDate,
        totalCards: s.cardCount
      })).sort((a: TcgSet, b: TcgSet) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    } catch (error) {
      console.error('DragonBallAdapter.fetchSets error', error);
      return [];
    }
  }

  async fetchSetCards(setCode: string): Promise<CardDTO[]> {
    try {
      const url = new URL(`${API_ROOT}/cards`);
      url.searchParams.set('property', 'set');
      url.searchParams.set('value', setCode);

      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`Dragon Ball set cards fetch failed: ${response.status}`);
      }
      const payload = await response.json();
      const cards = Array.isArray(payload) ? payload : (payload?.data ?? payload?.cards ?? []);
      return cards.map((card: DBSCard) => this.mapCard(card));
    } catch (error) {
      console.error('DragonBallAdapter.fetchSetCards error', error);
      return [];
    }
  }

  private mapCard(card: DBSCard): CardDTO {
    const cardId = card.cardId ?? card.id ?? card.cardNumber ?? '';
    const imageUrl = card.image ?? card.imageUrl;

    return {
      id: cardId,
      tcg: this.game,
      name: card.name ?? 'Unknown',
      setCode: card.setCode ?? card.set,
      setName: card.setName ?? card.set,
      rarity: card.rarity,
      collectorNumber: card.cardNumber,
      imageUrl,
      imageUrlSmall: imageUrl,
      attributes: {
        color: card.color,
        type: card.type,
        power: card.power,
        comboPower: card.comboPower,
        energy: card.energy,
        comboEnergy: card.comboEnergy,
        era: card.era,
        character: card.character,
        specialTrait: card.specialTrait,
        skill: card.skill
      }
    };
  }
}
