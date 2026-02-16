import { env } from '../../config/env';
import type {
  CardDTO,
  CardPrintsResult,
  PokemonFunctionalAbilityDTO,
  PokemonFunctionalGroupDTO,
  PokemonFunctionalAttackDTO,
  PokemonPrintMetadata,
  PokemonVariantFlags,
  TcgAdapter
} from './types';

const API_ROOT = env.POKEMON_API_BASE_URL.replace(/\/+$/, '');
const CARDS_ENDPOINT = `${API_ROOT}/cards`;
const VARIANT_API_ROOT = env.TCGDEX_API_BASE_URL.replace(/\/+$/, '');
const TCGDEX_CARDS_ENDPOINT = `${VARIANT_API_ROOT}/cards`;
const isTCGdex = /tcgdex-cache/i.test(API_ROOT) || /tcgdex\.net/i.test(new URL(API_ROOT).hostname);
const isRemotePokemon = /pokemontcg\.io$/i.test(new URL(API_ROOT).hostname);
const configuredDelay = Number.parseInt(process.env.POKEMON_MIN_DELAY_MS ?? '', 10);
const DEFAULT_REQUEST_DELAY_MS = isRemotePokemon ? 200 : 0;
const MIN_REQUEST_DELAY_MS = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : DEFAULT_REQUEST_DELAY_MS;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.POKEMON_REQUEST_TIMEOUT_MS ?? '8000', 10);
const configuredVariantConcurrency = Number.parseInt(process.env.POKEMON_VARIANT_FETCH_CONCURRENCY ?? '', 10);
const VARIANT_FETCH_CONCURRENCY = Number.isFinite(configuredVariantConcurrency) && configuredVariantConcurrency > 0 ? configuredVariantConcurrency : 4;

const ENERGY_SYMBOL_MAP: Record<string, string> = {
  C: 'colorless',
  W: 'water',
  R: 'fire',
  G: 'grass',
  L: 'lightning',
  P: 'psychic',
  F: 'fighting',
  D: 'darkness',
  Y: 'fairy',
  M: 'metal',
  N: 'dragon'
};

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
  variants?: PokemonVariantFlags;
  language?: string;
}

interface PokemonAbility {
  name: string;
  text?: string;
  type?: string;
}

interface PokemonAttack {
  name: string;
  cost?: string[];
  damage?: string;
  text?: string;
  convertedEnergyCost?: number;
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
  attacks?: PokemonAttack[];
  abilities?: PokemonAbility[];
  weaknesses?: Array<{ type: string; value?: string }>;
  resistances?: Array<{ type: string; value?: string }>;
  retreatCost?: string[];
  flavorText?: string;
  rules?: string[];
  regulationMark?: string;
}

interface FunctionalSignature {
  key: string;
  normalizedRules: string | null;
}

export class PokemonAdapter implements TcgAdapter {
  readonly game = 'pokemon' as const;
  private readonly tcgdexDetailCache = new Map<string, Promise<TCGdexCardDetail | null>>();

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
        // Fall back to TCGdex if Pokemon API returns no results
        console.log('Pokemon API returned no results, falling back to TCGdex');
        return this.searchTCGdex(trimmedQuery);
      }
      return payload.data.map((card) => this.mapCard(card));
    } catch (error) {
      console.error('PokemonAdapter.searchCards error, falling back to TCGdex:', error);
      return this.searchTCGdex(trimmedQuery);
    }
  }

  private async searchTCGdex(query: string): Promise<CardDTO[]> {
    const url = new URL(TCGDEX_CARDS_ENDPOINT);
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
          const detailResponse = await rateLimitedFetch(`${TCGDEX_CARDS_ENDPOINT}/${card.id}`);
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

  async fetchCardPrints(externalId: string): Promise<CardPrintsResult> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return { mode: 'simple', prints: [], total: 0 };
    }

    try {
      if (isTCGdex) {
        return this.fetchTcgDexPrintsLegacy(trimmedId);
      }
      return this.fetchPokemonFunctionalPrints(trimmedId);
    } catch (error) {
      console.error('PokemonAdapter.fetchCardPrints error', error);
      return { mode: 'simple', prints: [], total: 0 };
    }
  }

  private async fetchTcgDexPrintsLegacy(externalId: string): Promise<CardPrintsResult> {
    const response = await rateLimitedFetch(`${CARDS_ENDPOINT}/${externalId}`);
    if (!response.ok) {
      return { mode: 'simple', prints: [], total: 0 };
    }
    const payload = (await response.json()) as { data: TCGdexCardDetail };
    const detail = payload?.data;
    if (!detail?.name) {
      const fallback = detail ? [this.mapTCGdexDetailCard(detail)] : [];
      return { mode: 'simple', prints: fallback, total: fallback.length };
    }
    const prints = await this.fetchTCGdexPrintsByName(detail.name);
    if (!prints.length) {
      const fallback = [this.mapTCGdexDetailCard(detail)];
      return { mode: 'simple', prints: fallback, total: fallback.length };
    }
    const normalizedName = this.normalizeName(detail.name);
    const narrowed = this.filterEntriesByName(prints, normalizedName);
    const dataset = narrowed.length ? narrowed : prints;
    const ordered = this.deduplicateCards(this.sortByReleaseDate(dataset));
    return { mode: 'simple', prints: ordered, total: ordered.length };
  }

  private async fetchPokemonFunctionalPrints(externalId: string): Promise<CardPrintsResult> {
    const detail = await this.fetchPokemonCardDetailRaw(externalId);
    if (!detail?.name) {
      const fallback = detail ? [this.mapCard(detail)] : [];
      return { mode: 'simple', prints: fallback, total: fallback.length };
    }

    const records = await this.fetchPokemonPrintRecordsByName(detail.name);
    let dataset = records;
    if (!dataset.some((entry) => entry.id === detail.id)) {
      dataset = [detail, ...dataset];
    }

    const normalizedName = this.normalizeName(detail.name);
    const narrowed = this.filterEntriesByName(dataset, normalizedName);
    const pool = narrowed.length ? narrowed : dataset;
    const deduped = this.deduplicateById(pool);

    const groups = this.groupCardsByFunctionalKey(deduped);
    const signature = this.buildFunctionalSignature(detail);
    const targetCards = (signature.key && groups.get(signature.key)) || groups.values().next()?.value || [detail];
    const sortedGroup = this.sortPokemonCardsByReleaseDate(targetCards);
    const prints = await this.enrichPokemonPrints(sortedGroup);
    const functionalGroup = this.buildFunctionalGroupSummary(sortedGroup, signature.key, detail, signature.normalizedRules);

    if (!functionalGroup.category) {
      const category = prints.find((entry) => entry.pokemonPrint?.category)?.pokemonPrint?.category;
      if (category) {
        functionalGroup.category = category;
      }
    }

    return {
      mode: 'pokemon-functional',
      prints,
      total: prints.length,
      functionalGroup
    };
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
      regulationMark: card.regulationMark,
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
      regulationMark: card.regulationMark,
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

  private async fetchPokemonCardDetailRaw(externalId: string): Promise<PokemonCard | null> {
    try {
      const response = await rateLimitedFetch(`${CARDS_ENDPOINT}/${externalId}`, {
        headers: this.buildHeaders()
      });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as { data: PokemonCard };
      return payload?.data ?? null;
    } catch (error) {
      console.error('PokemonAdapter.fetchPokemonCardDetailRaw error', error);
      return null;
    }
  }

  private async fetchPokemonPrintRecordsByName(name: string): Promise<PokemonCard[]> {
    const safeName = name.trim();
    if (!safeName) {
      return [];
    }

    const prints: PokemonCard[] = [];
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
      prints.push(...data);

      const total = payload.totalCount ?? data.length;
      if (prints.length >= total || data.length < pageSize) {
        break;
      }

      page += 1;
    }

    return this.deduplicateById(prints);
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
    return this.deduplicateById(cards);
  }

  private deduplicateById<T extends { id?: string }>(entries: T[]): T[] {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      const key = (entry.id ?? '').toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
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

  private sortPokemonCardsByReleaseDate(cards: PokemonCard[]): PokemonCard[] {
    return [...cards].sort((a, b) => {
      const left = a.set?.releaseDate ? Date.parse(a.set.releaseDate) : 0;
      const right = b.set?.releaseDate ? Date.parse(b.set.releaseDate) : 0;
      return right - left;
    });
  }

  private async enrichPokemonPrints(cards: PokemonCard[]): Promise<CardDTO[]> {
    if (!cards.length) {
      return [];
    }
    return this.mapWithConcurrency(cards, VARIANT_FETCH_CONCURRENCY, async (card) => {
      const dto = this.mapCard(card);
      dto.regulationMark = dto.regulationMark ?? card.regulationMark;
      const metadata = await this.fetchPokemonVariantMetadata(card);
      if (metadata) {
        dto.pokemonPrint = metadata;
        if (metadata.regulationMark && !dto.regulationMark) {
          dto.regulationMark = metadata.regulationMark;
        }
        if (metadata.language) {
          dto.language = metadata.language;
        }
        if (metadata.tcgdexImage && !dto.imageUrl) {
          dto.imageUrl = metadata.tcgdexImage;
        }
        if (metadata.tcgdexImage && !dto.imageUrlSmall) {
          dto.imageUrlSmall = metadata.tcgdexImage;
        }
        if (!metadata.finishes && metadata.variants) {
          metadata.finishes = this.buildFinishList(metadata.variants);
        }
        if (metadata.finishes?.length) {
          dto.pokemonPrint = { ...metadata, finishes: metadata.finishes };
        }
      }
      return dto;
    });
  }

  private buildFunctionalGroupSummary(
    cards: PokemonCard[],
    functionalKey: string,
    reference: PokemonCard,
    normalizedRules: string | null
  ): PokemonFunctionalGroupDTO {
    const sample = cards[0] ?? reference;
    const attackSource = reference.attacks && reference.attacks.length ? reference.attacks : sample?.attacks ?? [];
    const abilitySource = reference.abilities && reference.abilities.length ? reference.abilities : sample?.abilities ?? [];
    const attacks = attackSource.map((attack) => this.mapAttackSummary(attack));
    const abilities = abilitySource.map((ability) => this.mapAbilitySummary(ability));

    return {
      functionalKey: functionalKey || `name:${this.normalizeName(reference.name)}`,
      name: reference.name,
      supertype: reference.supertype ?? sample?.supertype,
      subtypes: reference.subtypes ?? sample?.subtypes,
      hp: reference.hp ?? sample?.hp,
      regulationMark: reference.regulationMark ?? sample?.regulationMark,
      category: reference.supertype,
      normalizedRules,
      attacks: attacks.length ? attacks : undefined,
      abilities: abilities.length ? abilities : undefined,
      rules: reference.rules ?? sample?.rules ?? null
    };
  }

  private mapAttackSummary(attack?: PokemonAttack): PokemonFunctionalAttackDTO {
    return {
      name: attack?.name ?? '',
      cost: attack?.cost,
      text: attack?.text,
      damage: attack?.damage?.toString(),
      convertedEnergyCost: attack?.convertedEnergyCost
    };
  }

  private mapAbilitySummary(ability?: PokemonAbility): PokemonFunctionalAbilityDTO {
    return {
      name: ability?.name ?? '',
      type: ability?.type,
      text: ability?.text
    };
  }

  private filterEntriesByName<T extends { name?: string }>(entries: T[], normalizedName: string): T[] {
    if (!normalizedName) {
      return entries;
    }
    return entries.filter((entry) => this.normalizeName(entry.name) === normalizedName);
  }

  private groupCardsByFunctionalKey(cards: PokemonCard[]): Map<string, PokemonCard[]> {
    const groups = new Map<string, PokemonCard[]>();
    for (const card of cards) {
      const signature = this.buildFunctionalSignature(card);
      const key = signature.key || `name:${this.normalizeName(card.name)}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(card);
    }
    return groups;
  }

  private buildFunctionalSignature(card: PokemonCard): FunctionalSignature {
    const normalizedName = this.normalizeName(card.name);
    const supertypeRaw = (card.supertype || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const supertype = this.normalizeName(supertypeRaw);

    if (!normalizedName) {
      return { key: '', normalizedRules: null };
    }

    if (supertype === 'pokemon' || supertype === 'pokémon') {
      const hpValue = this.normalizeHp(card.hp);
      const stage = this.normalizeStage(card.subtypes) ?? 'unknown';
      const attacksSignature = this.buildAttacksSignature(card.attacks);
      const abilitiesSignature = this.buildAbilitiesSignature(card.abilities);
      const rulesSignature = this.normalizeRulesText(card.rules);
      const regulation = (card.regulationMark || '').trim().toUpperCase();

      const parts = [
        'pokemon',
        normalizedName,
        `hp:${hpValue}`,
        `stage:${stage}`,
        `attacks:${attacksSignature || 'none'}`,
        `abilities:${abilitiesSignature || 'none'}`
      ];
      if (rulesSignature) {
        parts.push(`rules:${rulesSignature}`);
      }
      if (regulation) {
        parts.push(`reg:${regulation}`);
      }

      return { key: parts.join('|'), normalizedRules: rulesSignature };
    }

    if (supertype === 'trainer') {
      const rulesSignature = this.normalizeRulesText(card.rules);
      const regulation = (card.regulationMark || '').trim().toUpperCase();
      const parts = ['trainer', normalizedName];
      if (rulesSignature) {
        parts.push(rulesSignature);
      }
      if (regulation) {
        parts.push(`reg:${regulation}`);
      }
      return { key: parts.join('|'), normalizedRules: rulesSignature };
    }

    if (supertype === 'energy') {
      const isBasic = (card.subtypes || []).some((subtype) => /basic/i.test(subtype));
      if (isBasic) {
        return { key: `basic-energy|${normalizedName}`, normalizedRules: null };
      }
      const rulesSignature = this.normalizeRulesText(card.rules);
      const regulation = (card.regulationMark || '').trim().toUpperCase();
      const parts = ['special-energy', normalizedName];
      if (rulesSignature) {
        parts.push(rulesSignature);
      }
      if (regulation) {
        parts.push(`reg:${regulation}`);
      }
      return { key: parts.join('|'), normalizedRules: rulesSignature };
    }

    return { key: `name:${normalizedName}`, normalizedRules: null };
  }

  private normalizeName(name?: string): string {
    if (!name) {
      return '';
    }
    const stripped = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return stripped.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private normalizeHp(value?: string): string {
    if (!value) {
      return 'na';
    }
    const digits = value.replace(/[^0-9]/g, '');
    return digits || this.normalizeName(value);
  }

  private normalizeStage(subtypes?: string[]): string | null {
    if (!subtypes?.length) {
      return null;
    }
    const map: Record<string, string> = {
      basic: 'basic',
      'basicpokemon': 'basic',
      'basicpokémon': 'basic',
      stage1: 'stage1',
      'stage1pokemon': 'stage1',
      stage2: 'stage2',
      'stage2pokemon': 'stage2',
      vmax: 'vmax',
      vstar: 'vstar',
      gx: 'gx',
      ex: 'ex',
      mega: 'mega'
    };

    for (const subtype of subtypes) {
      const key = this.normalizeName(subtype).replace(/\s+/g, '');
      if (map[key]) {
        return map[key];
      }
    }
    return null;
  }

  private buildAttacksSignature(attacks?: PokemonAttack[]): string {
    if (!attacks?.length) {
      return '';
    }
    return attacks
      .map((attack) => {
        const name = this.normalizeName(attack.name);
        const cost = (attack.cost ?? []).map((symbol) => this.normalizeEnergySymbol(symbol)).join(',');
        const damage = (attack.damage ?? '').toString().trim().toLowerCase() || 'none';
        const text = this.normalizeEffectText(attack.text) || 'none';
        const converted = Number.isFinite(attack.convertedEnergyCost) ? attack.convertedEnergyCost : 0;
        return `${name}|${cost}|${damage}|${text}|${converted}`;
      })
      .join('||');
  }

  private buildAbilitiesSignature(abilities?: PokemonAbility[]): string {
    if (!abilities?.length) {
      return '';
    }
    return abilities
      .map((ability) => {
        const name = this.normalizeName(ability.name);
        const text = this.normalizeEffectText(ability.text) || 'none';
        const type = this.normalizeName(ability.type);
        return `${name}|${type}|${text}`;
      })
      .join('||');
  }

  private normalizeRulesText(rules?: string[]): string | null {
    if (!rules?.length) {
      return null;
    }
    const combined = rules.join(' ');
    const normalized = this.normalizeEffectText(combined);
    return normalized || null;
  }

  private normalizeEffectText(text?: string): string {
    if (!text) {
      return '';
    }
    let normalized = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    normalized = normalized.toLowerCase();
    normalized = normalized.replace(/pok[eé]mon/g, 'pokemon');
    normalized = normalized.replace(/\[([a-z])\]/gi, (_, symbol: string) => ` ${ENERGY_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol.toLowerCase()} `);
    normalized = normalized.replace(/[.,:;!?()[\]{}]/g, ' ');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    return normalized;
  }

  private normalizeEnergySymbol(symbol?: string): string {
    if (!symbol) {
      return '';
    }
    const key = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
    return ENERGY_SYMBOL_MAP[key] ?? symbol.toLowerCase();
  }

  private buildFinishList(variants: PokemonVariantFlags): NonNullable<PokemonPrintMetadata['finishes']> {
    const finishes: NonNullable<PokemonPrintMetadata['finishes']> = [];
    if (variants.normal) {
      finishes.push('normal');
    }
    if (variants.reverse) {
      finishes.push('reverse');
    }
    if (variants.holo) {
      finishes.push('holo');
    }
    if (variants.firstEdition) {
      finishes.push('firstEdition');
    }
    return finishes;
  }

  private async mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
    if (!items.length) {
      return [];
    }
    const results: R[] = new Array(items.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) {
          break;
        }
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  }

  private async fetchPokemonVariantMetadata(card: PokemonCard): Promise<PokemonPrintMetadata | null> {
    const detail = await this.lookupTcgDexCard(card);
    if (!detail) {
      return null;
    }
    const variants = detail.variants ?? {};
    const metadata: PokemonPrintMetadata = {
      tcgdexId: detail.id,
      tcgdexImage: detail.image ? `${detail.image}/high.webp` : undefined,
      variants,
      category: detail.category,
      regulationMark: detail.regulationMark,
      language: detail.language
    };
    const finishes = this.buildFinishList(variants);
    if (finishes.length) {
      metadata.finishes = finishes;
    }
    return metadata;
  }

  private async lookupTcgDexCard(card: PokemonCard): Promise<TCGdexCardDetail | null> {
    if (!VARIANT_API_ROOT || (!card.id && !(card.set?.id && card.number))) {
      return null;
    }

    const attempts: Array<{ cacheKey: string; url: string }> = [];
    if (card.id) {
      attempts.push({
        cacheKey: card.id.toLowerCase(),
        url: `${VARIANT_API_ROOT}/cards/${encodeURIComponent(card.id)}`
      });
    }
    if (card.set?.id && card.number) {
      attempts.push({
        cacheKey: `${card.set.id}-${card.number}`.toLowerCase(),
        url: `${VARIANT_API_ROOT}/sets/${encodeURIComponent(card.set.id)}/cards/${encodeURIComponent(card.number)}`
      });
    }

    for (const attempt of attempts) {
      const detail = await this.getOrFetchTcgDexCard(attempt.cacheKey, attempt.url);
      if (detail) {
        const canonicalKey = detail.id?.toLowerCase();
        if (canonicalKey && !this.tcgdexDetailCache.has(canonicalKey)) {
          this.tcgdexDetailCache.set(canonicalKey, Promise.resolve(detail));
        }
        return detail;
      }
    }

    return null;
  }

  private async getOrFetchTcgDexCard(cacheKey: string, url: string): Promise<TCGdexCardDetail | null> {
    if (this.tcgdexDetailCache.has(cacheKey)) {
      return this.tcgdexDetailCache.get(cacheKey)!;
    }
    const fetchPromise = this.fetchTcgDexCardDetailByUrl(url);
    this.tcgdexDetailCache.set(cacheKey, fetchPromise);
    const detail = await fetchPromise;
    if (!detail) {
      this.tcgdexDetailCache.delete(cacheKey);
    }
    return detail;
  }

  private async fetchTcgDexCardDetailByUrl(url: string): Promise<TCGdexCardDetail | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as unknown;
      const data = (payload as { data?: TCGdexCardDetail }).data ?? (payload as TCGdexCardDetail);
      return data && typeof data.id === 'string' ? data : null;
    } catch (error) {
      console.error('PokemonAdapter.fetchTcgDexCardDetailByUrl error', url, error);
      return null;
    }
  }
}
