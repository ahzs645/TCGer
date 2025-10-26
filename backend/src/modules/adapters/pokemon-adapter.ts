import { env } from '../../config/env';
import { CardDTO, TcgAdapter } from './types';

const API_ROOT = env.POKEMON_API_BASE_URL.replace(/\/+$/, '');
const CARDS_ENDPOINT = `${API_ROOT}/cards`;
const isTCGdex = /tcgdex-cache/i.test(API_ROOT) || /tcgdex\.net/i.test(new URL(API_ROOT).hostname);
const isRemotePokemon = /pokemontcg\.io$/i.test(new URL(API_ROOT).hostname);
const configuredDelay = Number.parseInt(process.env.POKEMON_MIN_DELAY_MS ?? '', 10);
const DEFAULT_REQUEST_DELAY_MS = isRemotePokemon ? 200 : 0;
const MIN_REQUEST_DELAY_MS = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : DEFAULT_REQUEST_DELAY_MS;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.POKEMON_REQUEST_TIMEOUT_MS ?? '8000', 10);

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

interface PokemonSearchResponse {
  data: PokemonCard[];
  page?: number;
  pageSize?: number;
  count?: number;
  totalCount?: number;
}

interface TCGdexSearchResponse {
  data: TCGdexCardSummary[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

interface TCGdexCardSummary {
  id: string;
  localId?: string;
  name: string;
  image?: string;
}

interface TCGdexCardDetail {
  id: string;
  localId?: string;
  name: string;
  image?: string;
  hp?: number;
  types?: string[];  // Available on some cards
  stage?: string;
  evolveFrom?: string;
  description?: string;
  rarity?: string;
  category?: string;
  illustrator?: string;
  dexId?: number[];
  set?: {
    id?: string;
    name?: string;
    logo?: string;
    symbol?: string;
  };
  attacks?: Array<{
    name: string;
    cost?: string[];
    damage?: string | number;
    effect?: string;
  }>;
  abilities?: Array<{
    name: string;
    effect?: string;
    type?: string;
  }>;
  weaknesses?: Array<{ type: string; value?: string }>;
  resistances?: Array<{ type: string; value?: string }>;
  retreat?: number;
  regulationMark?: string;
  legal?: {
    standard?: boolean;
    expanded?: boolean;
  };
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
    releaseDate?: string;
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

  private static readonly MAX_PRINT_PAGE_SIZE = 250;
  private static readonly MAX_PRINT_PAGES = 3;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();

    if (isTCGdex) {
      return this.searchTCGdex(trimmedQuery);
    }

    const q = trimmedQuery ? this.buildNameQuery(trimmedQuery) : 'supertype:"Pokémon"';
    const url = new URL(CARDS_ENDPOINT);
    url.searchParams.set('q', q);
    url.searchParams.set('pageSize', '20');

    try {
      const response = await rateLimitedFetch(url.toString(), {
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

  private async searchTCGdex(query: string): Promise<CardDTO[]> {
    const url = new URL(CARDS_ENDPOINT);
    if (query) {
      url.searchParams.set('q', query);
    }
    url.searchParams.set('pageSize', '20');

    try {
      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`TCGdex search failed: ${response.status}`);
      }
      const payload = (await response.json()) as TCGdexSearchResponse;
      if (!payload?.data?.length) {
        return [];
      }

      // Fetch full details for each card to get set name and rarity
      const detailPromises = payload.data.map(async (card) => {
        try {
          const detailResponse = await rateLimitedFetch(`${CARDS_ENDPOINT}/${card.id}`);
          if (detailResponse.ok) {
            const detailPayload = (await detailResponse.json()) as { data: TCGdexCardDetail };
            return detailPayload.data ? this.mapTCGdexDetailCard(detailPayload.data) : this.mapTCGdexCard(card);
          }
        } catch (err) {
          console.error(`Failed to fetch details for card ${card.id}`, err);
        }
        return this.mapTCGdexCard(card);
      });

      return await Promise.all(detailPromises);
    } catch (error) {
      console.error('PokemonAdapter.searchTCGdex error', error);
      return [];
    }
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return null;
    }

    try {
      const response = await rateLimitedFetch(`${CARDS_ENDPOINT}/${trimmedId}`, {
        headers: this.buildHeaders()
      });
      if (!response.ok) {
        return null;
      }

      if (isTCGdex) {
        const payload = (await response.json()) as { data: TCGdexCardDetail };
        return payload?.data ? this.mapTCGdexDetailCard(payload.data) : null;
      }

      const payload = (await response.json()) as { data: PokemonCard };
      return payload?.data ? this.mapCard(payload.data) : null;
    } catch (error) {
      console.error('PokemonAdapter.fetchCardById error', error);
      return null;
    }
  }

  async fetchCardPrints(externalId: string): Promise<CardDTO[]> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return [];
    }

    try {
      if (isTCGdex) {
        const response = await rateLimitedFetch(`${CARDS_ENDPOINT}/${trimmedId}`);
        if (!response.ok) {
          return [];
        }
        const payload = (await response.json()) as { data: TCGdexCardDetail };
        const detail = payload?.data;
        if (!detail?.name) {
          return detail ? [this.mapTCGdexDetailCard(detail)] : [];
        }
        const prints = await this.fetchTCGdexPrintsByName(detail.name);
        if (!prints.length) {
          return [this.mapTCGdexDetailCard(detail)];
        }
        const normalizedName = this.normalizeName(detail.name);
        const narrowed = this.filterPrintsByName(prints, normalizedName);
        const dataset = narrowed.length ? narrowed : prints;
        return this.deduplicateCards(this.sortByReleaseDate(dataset));
      }

      const response = await rateLimitedFetch(`${CARDS_ENDPOINT}/${trimmedId}`, {
        headers: this.buildHeaders()
      });
      if (!response.ok) {
        return [];
      }
      const payload = (await response.json()) as { data: PokemonCard };
      const detail = payload?.data;
      if (!detail?.name) {
        return detail ? [this.mapCard(detail)] : [];
      }
      const prints = await this.fetchPokemonPrintsByName(detail.name);
      if (!prints.length) {
        return [this.mapCard(detail)];
      }
      const ensured = prints.some((entry) => entry.id === detail.id)
        ? prints
        : [this.mapCard(detail), ...prints];
      const normalizedName = this.normalizeName(detail.name);
      const narrowed = this.filterPrintsByName(ensured, normalizedName);
      const dataset = narrowed.length ? narrowed : ensured;
      return this.deduplicateCards(this.sortByReleaseDate(dataset));
    } catch (error) {
      console.error('PokemonAdapter.fetchCardPrints error', error);
      return [];
    }
  }

  private mapTCGdexCard(card: TCGdexCardSummary): CardDTO {
    // For search results, we only have summary data
    // TCGdex image URLs need /high.webp or /low.webp suffix
    const imageUrl = card.image ? `${card.image}/high.webp` : undefined;
    const imageUrlSmall = card.image ? `${card.image}/low.webp` : undefined;

    return {
      id: card.id,
      tcg: this.game,
      name: card.name,
      collectorNumber: card.localId,
      imageUrl,
      imageUrlSmall,
      attributes: {}
    };
  }

  private mapTCGdexDetailCard(card: TCGdexCardDetail): CardDTO {
    // TCGdex image URLs need /high.webp or /low.webp suffix
    const imageUrl = card.image ? `${card.image}/high.webp` : undefined;
    const imageUrlSmall = card.image ? `${card.image}/low.webp` : undefined;

    // TCGdex returns "None" for promo cards, convert to "Promo"
    const rarity = card.rarity === 'None' ? 'Promo' : card.rarity;

    return {
      id: card.id,
      tcg: this.game,
      name: card.name,
      setCode: card.set?.id,
      setName: card.set?.name,
      rarity,
      collectorNumber: card.localId ?? card.id,
      imageUrl,
      imageUrlSmall,
      setSymbolUrl: card.set?.symbol ?? card.set?.logo,
      attributes: {
        hp: card.hp,
        types: card.types,
        evolvesFrom: card.evolveFrom,
        attacks: card.attacks?.map((attack) => attack.name),
        weaknesses: card.weaknesses,
        resistances: card.resistances,
        retreatCost: card.retreat,
        flavorText: card.description
      }
    };
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
      collectorNumber: card.number,
      releasedAt: card.set?.releaseDate,
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
      collectorNumber: '54',
      releasedAt: '2015-08-12',
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

  private async fetchPokemonPrintsByName(name: string): Promise<CardDTO[]> {
    const safeName = name.trim();
    if (!safeName) {
      return [];
    }

    const prints: CardDTO[] = [];
    const pageSize = PokemonAdapter.MAX_PRINT_PAGE_SIZE;
    let page = 1;

    while (page <= PokemonAdapter.MAX_PRINT_PAGES) {
      const url = new URL(CARDS_ENDPOINT);
      url.searchParams.set('q', this.buildNameQuery(safeName));
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', String(pageSize));
      url.searchParams.set('orderBy', '-set.releaseDate,-number');

      const response = await rateLimitedFetch(url.toString(), {
        headers: this.buildHeaders()
      });
      if (!response.ok) {
        break;
      }
      const payload = (await response.json()) as PokemonSearchResponse;
      const data = payload.data ?? [];
      if (!data.length) {
        break;
      }
      prints.push(...data.map((entry) => this.mapCard(entry)));

      const total = payload.totalCount ?? data.length;
      if (prints.length >= total || data.length < pageSize) {
        break;
      }

      page += 1;
    }

    return this.deduplicateCards(prints);
  }

  private async fetchTCGdexPrintsByName(name: string): Promise<CardDTO[]> {
    const safeName = name.trim();
    if (!safeName) {
      return [];
    }

    const prints: CardDTO[] = [];
    let page = 1;
    const pageSize = 60;

    while (page <= PokemonAdapter.MAX_PRINT_PAGES) {
      const url = new URL(CARDS_ENDPOINT);
      url.searchParams.set('q', safeName);
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', String(pageSize));

      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        break;
      }
      const payload = (await response.json()) as TCGdexSearchResponse;
      const data = payload.data ?? [];
      if (!data.length) {
        break;
      }

      const detailed = await Promise.all(
        data.map(async (entry) => {
          try {
            const detail = await rateLimitedFetch(`${CARDS_ENDPOINT}/${entry.id}`);
            if (!detail.ok) {
              return this.mapTCGdexCard(entry);
            }
            const detailPayload = (await detail.json()) as { data: TCGdexCardDetail };
            return detailPayload?.data ? this.mapTCGdexDetailCard(detailPayload.data) : this.mapTCGdexCard(entry);
          } catch (error) {
            console.error(`Failed to fetch TCGdex print ${entry.id}`, error);
            return this.mapTCGdexCard(entry);
          }
        })
      );

      prints.push(...detailed);

      const total = payload.totalCount ?? data.length;
      if (prints.length >= total || data.length < pageSize) {
        break;
      }

      page += 1;
    }

    return this.deduplicateCards(prints);
  }

  private deduplicateCards(cards: CardDTO[]): CardDTO[] {
    const seen = new Set<string>();
    return cards.filter((card) => {
      if (seen.has(card.id)) {
        return false;
      }
      seen.add(card.id);
      return true;
    });
  }

  private sortByReleaseDate(cards: CardDTO[]): CardDTO[] {
    return [...cards].sort((a, b) => {
      const left = a.releasedAt ? Date.parse(a.releasedAt) : 0;
      const right = b.releasedAt ? Date.parse(b.releasedAt) : 0;
      return right - left;
    });
  }

  private filterPrintsByName(cards: CardDTO[], normalizedName: string): CardDTO[] {
    if (!normalizedName) {
      return cards;
    }
    return cards.filter((card) => this.normalizeName(card.name) === normalizedName);
  }

  private normalizeName(name?: string): string {
    return (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
