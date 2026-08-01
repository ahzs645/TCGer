import { z } from 'zod';
import type { TcgSet } from '@tcg/api-types';

import { env } from '../../config/env';
import type { CardDTO, CardNameSearchOptions, TcgAdapter } from './types';

const API_ROOT = env.ONEPIECE_API_BASE_URL.replace(/\/+$/, '');
const isRemoteApi = /optcgapi\.com$/i.test(new URL(API_ROOT).hostname);
const configuredDelay = Number.parseInt(process.env.ONEPIECE_MIN_DELAY_MS ?? '', 10);
const MIN_REQUEST_DELAY_MS =
  Number.isFinite(configuredDelay) && configuredDelay >= 0
    ? configuredDelay
    : isRemoteApi
      ? 200
      : 0;
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.ONEPIECE_REQUEST_TIMEOUT_MS ?? '8000',
  10
);

let rateLimitChain: Promise<void> = Promise.resolve();
let nextAllowedRequestTime = 0;

const optionalText = z.string().nullish();
const onePieceCardSchema = z
  .object({
    card_id: optionalText,
    card_name: optionalText,
    card_color: optionalText,
    card_type: optionalText,
    card_cost: optionalText,
    card_power: optionalText,
    card_counter: optionalText,
    counter_amount: optionalText,
    card_attribute: optionalText,
    attribute: optionalText,
    card_effect: optionalText,
    card_text: optionalText,
    card_trigger: optionalText,
    card_rarity: optionalText,
    rarity: optionalText,
    card_set: optionalText,
    set_name: optionalText,
    card_set_id: optionalText,
    set_id: optionalText,
    card_image: optionalText,
    card_image_id: optionalText
  })
  .passthrough()
  .refine(
    (card) => Boolean(card.card_name && (card.card_image_id || card.card_id || card.card_set_id)),
    'One Piece card is missing its name or printing identifier'
  );
const onePieceCardsSchema = z.array(onePieceCardSchema);
const onePieceSetsSchema = z.array(
  z
    .object({
      set_id: z.union([z.string(), z.number()]).nullish(),
      set_name: optionalText,
      set_code: optionalText,
      set_num_cards: z.number().nullish()
    })
    .passthrough()
);

type OnePieceCard = z.infer<typeof onePieceCardSchema>;

function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function rateLimitedFetch(input: string): Promise<Response> {
  const waitPromise = rateLimitChain.then(async () => {
    const wait = Math.max(0, nextAllowedRequestTime - Date.now());
    if (wait > 0) await sleep(wait);
    nextAllowedRequestTime = Date.now() + MIN_REQUEST_DELAY_MS;
  });
  rateLimitChain = waitPromise.catch(() => {});
  await waitPromise;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function upstreamError(operation: string, status: number): Error & { status: number } {
  return Object.assign(new Error(`One Piece ${operation} failed: upstream returned ${status}`), {
    status: 502
  });
}

function parseCards(payload: unknown, operation: string): OnePieceCard[] {
  const parsed = onePieceCardsSchema.safeParse(payload);
  if (!parsed.success) {
    throw Object.assign(new Error(`One Piece ${operation} returned a malformed payload`), {
      status: 502,
      cause: parsed.error
    });
  }
  return parsed.data;
}

export class OnePieceAdapter implements TcgAdapter {
  readonly game = 'onepiece' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const url = new URL(`${API_ROOT}/sets/filtered/`);
    url.searchParams.set('card_name', trimmedQuery);
    const response = await rateLimitedFetch(url.toString());
    if (!response.ok) throw upstreamError('search', response.status);
    return parseCards(await response.json(), 'search')
      .slice(0, 20)
      .map((card) => this.mapCard(card));
  }

  async fetchCardsByName(name: string, options: CardNameSearchOptions): Promise<CardDTO[]> {
    const trimmed = name.trim();
    if (!trimmed) return [];

    // The filtered endpoint returns the full match set in one response; only
    // searchCards truncates it to a preview page.
    const url = new URL(`${API_ROOT}/sets/filtered/`);
    url.searchParams.set('card_name', trimmed);
    const response = await rateLimitedFetch(url.toString());
    if (!response.ok) throw upstreamError('name search', response.status);
    const cards = parseCards(await response.json(), 'name search').map((card) =>
      this.mapCard(card)
    );

    if (options.includeAllPrintings) {
      return cards.slice(0, options.limit);
    }

    // Alternate arts share a base card id; keep the first printing of each.
    const seen = new Set<string>();
    return cards
      .filter((card) => {
        const key = (card.baseExternalId ?? card.id).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, options.limit);
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const requestedId = externalId.trim().replace(/^onepiece:/, '');
    if (!requestedId) return null;

    const baseId = requestedId.replace(/_p\d+$/i, '');
    const response = await rateLimitedFetch(
      `${API_ROOT}/sets/card/${encodeURIComponent(baseId)}/`
    );
    if (response.status === 404) return null;
    if (!response.ok) throw upstreamError('card lookup', response.status);

    const cards = parseCards(await response.json(), 'card lookup');
    const exact = cards.find((card) => card.card_image_id === requestedId);
    const base = cards.find(
      (card) => (card.card_id ?? card.card_set_id ?? card.card_image_id) === requestedId
    );
    const selected = exact ?? base ?? (requestedId === baseId ? cards[0] : undefined);
    return selected ? this.mapCard(selected) : null;
  }

  async fetchSets(): Promise<TcgSet[]> {
    const response = await rateLimitedFetch(`${API_ROOT}/allSets/`);
    if (!response.ok) throw upstreamError('sets fetch', response.status);
    const parsed = onePieceSetsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw Object.assign(new Error('One Piece sets fetch returned a malformed payload'), {
        status: 502,
        cause: parsed.error
      });
    }
    return parsed.data.map((set) => ({
      code: set.set_code ?? String(set.set_id ?? ''),
      name: set.set_name ?? 'Unknown Set',
      tcg: this.game,
      totalCards: set.set_num_cards ?? undefined
    }));
  }

  async fetchSetCards(setCode: string): Promise<CardDTO[]> {
    const trimmedCode = setCode.trim();
    if (!trimmedCode) return [];
    const url = new URL(`${API_ROOT}/sets/filtered/`);
    url.searchParams.set('card_set', trimmedCode);
    const response = await rateLimitedFetch(url.toString());
    if (!response.ok) throw upstreamError('set cards fetch', response.status);
    return parseCards(await response.json(), 'set cards fetch').map((card) =>
      this.mapCard(card)
    );
  }

  private mapCard(card: OnePieceCard): CardDTO {
    const baseExternalId = card.card_id ?? card.card_set_id ?? card.card_image_id ?? '';
    const artworkId = card.card_image_id ?? baseExternalId;
    const printingKey = `onepiece:${artworkId}`;
    const imageUrl =
      card.card_image ??
      (card.card_image_id
        ? `https://en.onepiece-cardgame.com/images/cardlist/card/${card.card_image_id}.png`
        : undefined);

    return {
      id: artworkId,
      tcg: this.game,
      baseExternalId,
      printingKey,
      artworkId,
      name: card.card_name ?? 'Unknown',
      setCode: card.set_id ?? card.card_set ?? undefined,
      setName: card.set_name ?? card.card_set ?? undefined,
      rarity: card.rarity ?? card.card_rarity ?? undefined,
      collectorNumber: card.card_set_id ?? card.card_id ?? undefined,
      imageUrl: imageUrl ?? undefined,
      imageUrlSmall: imageUrl ?? undefined,
      attributes: {
        color: card.card_color,
        type: card.card_type,
        cost: card.card_cost,
        power: card.card_power,
        counter: card.counter_amount ?? card.card_counter,
        attribute: card.attribute ?? card.card_attribute,
        effect: card.card_text ?? card.card_effect,
        trigger: card.card_trigger
      },
      provenance: {
        source: 'optcgapi',
        sourceId: artworkId,
        fetchedAt: new Date().toISOString(),
        schemaVersion: '2026-07'
      }
    };
  }
}
