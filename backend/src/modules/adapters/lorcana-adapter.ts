import type { TcgSet } from '@tcg/api-types';
import { CardDTO, TcgAdapter } from './types';

const API_ROOT = 'https://api.lorcast.com/v0';
const configuredDelay = Number.parseInt(process.env.LORCANA_MIN_DELAY_MS ?? '', 10);
const DEFAULT_REQUEST_DELAY_MS = 100;
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

interface LorcastCard {
  id?: string;
  name?: string;
  version?: string;
  layout?: string;
  released_at?: string;
  image_uris?: {
    digital?: { small?: string; normal?: string; large?: string };
    small?: string;
    normal?: string;
    large?: string;
  };
  cost?: number;
  inkwell?: boolean;
  ink?: string;
  type?: string[];
  classifications?: string[];
  text?: string;
  keywords?: string[];
  move_cost?: number;
  strength?: number;
  willpower?: number;
  lore?: number;
  rarity?: string;
  illustrators?: string[];
  collector_number?: string;
  lang?: string;
  flavor_text?: string;
  tcgplayer_id?: number;
  set?: {
    id?: string;
    name?: string;
    code?: string;
    released_at?: string;
  };
}

interface LorcastSet {
  id?: string;
  name?: string;
  code?: string;
  released_at?: string;
  card_count?: number;
}

export class LorcanaAdapter implements TcgAdapter {
  readonly game = 'lorcana' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    try {
      const url = new URL(`${API_ROOT}/cards/search`);
      url.searchParams.set('q', trimmedQuery);

      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`Lorcana search failed: ${response.status}`);
      }
      const payload = await response.json();
      const cards = payload?.results ?? (Array.isArray(payload) ? payload : []);
      return cards.slice(0, 20).map((card: LorcastCard) => this.mapCard(card));
    } catch (error) {
      console.error('LorcanaAdapter.searchCards error', error);
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
      console.error('LorcanaAdapter.fetchCardById error', error);
      return null;
    }
  }

  async fetchSets(): Promise<TcgSet[]> {
    try {
      const response = await rateLimitedFetch(`${API_ROOT}/sets`);
      if (!response.ok) {
        throw new Error(`Lorcana sets fetch failed: ${response.status}`);
      }
      const payload = await response.json();
      const sets = payload?.results ?? (Array.isArray(payload) ? payload : []);

      return sets.map((s: LorcastSet) => ({
        code: s.code ?? s.id ?? '',
        name: s.name ?? 'Unknown Set',
        tcg: this.game as const,
        releaseDate: s.released_at,
        totalCards: s.card_count
      })).sort((a: TcgSet, b: TcgSet) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    } catch (error) {
      console.error('LorcanaAdapter.fetchSets error', error);
      return [];
    }
  }

  async fetchSetCards(setCode: string): Promise<CardDTO[]> {
    try {
      const url = new URL(`${API_ROOT}/cards/search`);
      url.searchParams.set('q', `set:${setCode}`);

      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`Lorcana set cards fetch failed: ${response.status}`);
      }
      const payload = await response.json();
      const cards = payload?.results ?? (Array.isArray(payload) ? payload : []);
      return cards.map((card: LorcastCard) => this.mapCard(card));
    } catch (error) {
      console.error('LorcanaAdapter.fetchSetCards error', error);
      return [];
    }
  }

  private mapCard(card: LorcastCard): CardDTO {
    const images = card.image_uris?.digital ?? card.image_uris ?? {};
    const fullName = card.version ? `${card.name} - ${card.version}` : (card.name ?? 'Unknown');

    return {
      id: card.id ?? '',
      tcg: this.game,
      name: fullName,
      setCode: card.set?.code,
      setName: card.set?.name,
      rarity: card.rarity,
      collectorNumber: card.collector_number,
      releasedAt: card.released_at ?? card.set?.released_at,
      imageUrl: images.large ?? images.normal ?? images.small,
      imageUrlSmall: images.small ?? images.normal ?? images.large,
      attributes: {
        ink: card.ink,
        cost: card.cost,
        inkwell: card.inkwell,
        type: card.type,
        classifications: card.classifications,
        text: card.text,
        keywords: card.keywords,
        strength: card.strength,
        willpower: card.willpower,
        lore: card.lore,
        flavor_text: card.flavor_text,
        illustrators: card.illustrators
      }
    };
  }
}
