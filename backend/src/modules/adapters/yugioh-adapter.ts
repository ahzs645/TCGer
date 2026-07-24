import { env } from '../../config/env';
import type { TcgSet } from '@tcg/api-types';
import { CardDTO, CardPrintsResult, TcgAdapter } from './types';
import {
  canonicalizeYugiohSetCode,
  extractYugiohCollectorNumber,
  extractYugiohLanguageCode,
  extractYugiohSetPrefix
} from './yugioh-set-code';
import {
  buildYugiohPrintingKey,
  parseYugiohPrintingKey
} from './yugioh-printing-key';

const API_ROOT = env.YGO_API_BASE_URL.replace(/\/+$/, '');
const CARDINFO_URL = `${API_ROOT}/cardinfo.php`;
const isRemoteYgo = /ygoprodeck\.com$/i.test(new URL(API_ROOT).hostname);
const configuredDelay = Number.parseInt(process.env.YGO_MIN_DELAY_MS ?? '', 10);
const DEFAULT_REQUEST_DELAY_MS = isRemoteYgo ? 75 : 0;
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
  card_images?: YgoCardImage[]; // eslint-disable-line camelcase
  card_sets?: YgoCardSet[]; // eslint-disable-line camelcase
}

interface YgoCardImage {
  id?: number | string;
  image_url: string; // eslint-disable-line camelcase
  image_url_small: string; // eslint-disable-line camelcase
}

interface YgoCardSet {
  set_code: string; // eslint-disable-line camelcase
  set_name: string; // eslint-disable-line camelcase
  set_rarity: string; // eslint-disable-line camelcase
  set_price?: string; // eslint-disable-line camelcase
  /**
   * Not present in the standard YGOPRODeck response, but accepted from enriched
   * mirrors that can prove which artwork belongs to a printing.
   */
  card_image_id?: number | string; // eslint-disable-line camelcase
}

type YugiohCardDTO = CardDTO & {
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
};

export class YugiohAdapter implements TcgAdapter {
  readonly game = 'yugioh' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    const url = new URL(CARDINFO_URL);
    if (trimmedQuery) {
      url.searchParams.set('fname', trimmedQuery);
    }
    url.searchParams.set('num', '20');
    url.searchParams.set('offset', '0');

    try {
      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`YGO search failed: ${response.status}`);
      }
      const payload = (await response.json()) as YgoApiResponse;
      if (!payload?.data?.length) {
        return [];
      }
      return payload.data.map((card) => this.mapRepresentativeCard(card));
    } catch (error) {
      console.error('YugiohAdapter.searchCards error', error);
      return [];
    }
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return null;
    }

    const requestedPrinting = parseYugiohPrintingKey(trimmedId);
    const url = new URL(CARDINFO_URL);
    url.searchParams.set('id', requestedPrinting?.baseExternalId ?? trimmedId);

    try {
      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as YgoApiResponse;
      const card = payload?.data?.[0];
      if (!card) {
        return null;
      }

      if (!requestedPrinting) {
        return this.mapRepresentativeCard(card);
      }
      return this.mapAllPrintings(card).find((printing) => printing.id === trimmedId) ?? null;
    } catch (error) {
      console.error('YugiohAdapter.fetchCardById error', error);
      return null;
    }
  }

  async fetchCardPrints(externalId: string): Promise<CardPrintsResult> {
    const trimmedId = externalId.trim();
    if (!trimmedId) {
      return { mode: 'simple', prints: [], total: 0 };
    }

    const requestedPrinting = parseYugiohPrintingKey(trimmedId);
    const baseExternalId = requestedPrinting?.baseExternalId ?? trimmedId;
    const url = new URL(CARDINFO_URL);
    url.searchParams.set('id', baseExternalId);

    try {
      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`YGO prints fetch failed: ${response.status}`);
      }
      const payload = (await response.json()) as YgoApiResponse;
      const card = payload?.data?.[0];
      if (!card) {
        return { mode: 'simple', prints: [], total: 0 };
      }

      const prints = this.mapAllPrintings(card);
      return { mode: 'simple', prints, total: prints.length };
    } catch (error) {
      console.error('YugiohAdapter.fetchCardPrints error', error);
      return { mode: 'simple', prints: [], total: 0 };
    }
  }

  async fetchSets(): Promise<TcgSet[]> {
    try {
      const response = await rateLimitedFetch(`${API_ROOT}/cardsets.php`);
      if (!response.ok) {
        throw new Error(`YGO sets fetch failed: ${response.status}`);
      }
      const payload = (await response.json()) as Array<{
        set_name: string;
        set_code: string;
        num_of_cards: number;
        tcg_date?: string;
      }>;

      return (payload ?? []).map((s) => ({
        code: s.set_code,
        name: s.set_name,
        tcg: 'yugioh' as const,
        releaseDate: s.tcg_date,
        totalCards: s.num_of_cards
      })).sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    } catch (error) {
      console.error('YugiohAdapter.fetchSets error', error);
      return [];
    }
  }

  async fetchSetCards(setCode: string): Promise<CardDTO[]> {
    try {
      const url = new URL(CARDINFO_URL);
      url.searchParams.set('cardset', setCode);
      url.searchParams.set('num', '250');
      url.searchParams.set('offset', '0');

      const response = await rateLimitedFetch(url.toString());
      if (!response.ok) {
        throw new Error(`YGO set cards fetch failed: ${response.status}`);
      }
      const payload = (await response.json()) as YgoApiResponse;
      return (payload.data ?? []).flatMap((card) => {
        const matchingSet = this.findCardSet(card, setCode);
        return matchingSet ? [this.mapPrinting(card, matchingSet)] : [];
      });
    } catch (error) {
      console.error('YugiohAdapter.fetchSetCards error', error);
      return [];
    }
  }

  private mapRepresentativeCard(card: YgoCard): CardDTO {
    return this.mapPrinting(card, card.card_sets?.[0]);
  }

  private mapAllPrintings(card: YgoCard): CardDTO[] {
    const sets = card.card_sets ?? [];
    if (!sets.length) {
      return [this.mapPrinting(card)];
    }

    const seen = new Set<string>();
    return sets.flatMap((set) => {
      const printing = this.mapPrinting(card, set);
      if (seen.has(printing.id)) {
        return [];
      }
      seen.add(printing.id);
      return [printing];
    });
  }

  private mapPrinting(card: YgoCard, printingSet?: YgoCardSet): YugiohCardDTO {
    const image = this.resolvePrintingImage(card, printingSet);
    const artworkId = image?.id !== undefined ? String(image.id) : undefined;
    const baseExternalId = String(card.id);
    const printingKey = buildYugiohPrintingKey({
      baseExternalId,
      setCode: printingSet?.set_code,
      rarity: printingSet?.set_rarity,
      artworkId
    });

    return {
      id: printingKey,
      tcg: this.game,
      name: card.name,
      baseExternalId,
      printingKey,
      artworkId,
      setCode: printingSet?.set_code,
      setName: printingSet?.set_name,
      rarity: printingSet?.set_rarity,
      collectorNumber: printingSet
        ? extractYugiohCollectorNumber(printingSet.set_code)
        : undefined,
      language: printingSet ? extractYugiohLanguageCode(printingSet.set_code) : undefined,
      imageUrl: image?.image_url,
      imageUrlSmall: image?.image_url_small,
      attributes: {
        type: card.type,
        race: card.race,
        description: card.desc,
        atk: card.atk,
        def: card.def,
        level: card.level,
        attribute: card.attribute,
        archetype: card.archetype,
        set_price: printingSet?.set_price
      }
    };
  }

  private findCardSet(card: YgoCard, requestedSet: string): YgoCardSet | undefined {
    const canonicalRequested = canonicalizeYugiohSetCode(requestedSet);
    const requestedName = normalizeSetName(requestedSet);
    const requestedPrefix = canonicalRequested.includes('-')
      ? extractYugiohSetPrefix(canonicalRequested)
      : canonicalRequested;
    const sets = card.card_sets ?? [];

    return (
      sets.find((set) => canonicalizeYugiohSetCode(set.set_code) === canonicalRequested) ??
      sets.find((set) => normalizeSetName(set.set_name) === requestedName) ??
      sets.find((set) => extractYugiohSetPrefix(set.set_code) === requestedPrefix)
    );
  }

  private resolvePrintingImage(card: YgoCard, printingSet?: YgoCardSet): YgoCardImage | undefined {
    const images = card.card_images ?? [];
    const associatedImageId = printingSet?.card_image_id;
    if (associatedImageId !== undefined) {
      const associated = images.find((image) => String(image.id) === String(associatedImageId));
      if (associated) {
        return associated;
      }
    }
    return images[0];
  }

  private buildFallback(query: string): CardDTO {
    return this.mapRepresentativeCard({
      id: 46986414,
      name: query ? `Dark Magician (${query})` : 'Dark Magician',
      type: 'Monster / Spellcaster',
      attribute: 'DARK',
      level: 7,
      atk: 2500,
      def: 2100,
      desc: 'The ultimate wizard in terms of attack and defense.',
      card_images: [
        {
          id: 46986414,
          image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg',
          image_url_small: 'https://images.ygoprodeck.com/images/cards_small/46986414.jpg'
        }
      ],
      card_sets: [
        {
          set_code: 'SDY-006',
          set_name: 'Starter Deck: Yugi',
          set_rarity: 'Ultra Rare'
        }
      ]
    });
  }
}

function normalizeSetName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
