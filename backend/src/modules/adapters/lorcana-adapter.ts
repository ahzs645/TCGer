import { z } from 'zod';
import type { TcgSet } from '@tcg/api-types';

import { env } from '../../config/env';
import type { CardDTO, TcgAdapter } from './types';

const API_ROOT = env.LORCANA_API_BASE_URL.replace(/\/+$/, '');
const isRemoteApi = /lorcast\.com$/i.test(new URL(API_ROOT).hostname);
const configuredDelay = Number.parseInt(process.env.LORCANA_MIN_DELAY_MS ?? '', 10);
const MIN_REQUEST_DELAY_MS =
  Number.isFinite(configuredDelay) && configuredDelay >= 0
    ? configuredDelay
    : isRemoteApi
      ? 100
      : 0;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.LORCANA_REQUEST_TIMEOUT_MS ?? '8000', 10);

let rateLimitChain: Promise<void> = Promise.resolve();
let nextAllowedRequestTime = 0;

const nullableText = z.string().nullish();
const imageSizeSchema = z
  .object({ small: nullableText, normal: nullableText, large: nullableText })
  .passthrough();
const lorcastCardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: nullableText,
    released_at: nullableText,
    image_uris: z
      .object({
        digital: imageSizeSchema.nullish(),
        small: nullableText,
        normal: nullableText,
        large: nullableText
      })
      .passthrough()
      .nullish(),
    cost: z.number().nullish(),
    inkwell: z.boolean().nullish(),
    ink: nullableText,
    type: z.array(z.string()).nullish(),
    classifications: z.array(z.string()).nullish(),
    text: nullableText,
    keywords: z.array(z.string()).nullish(),
    move_cost: z.number().nullish(),
    strength: z.number().nullish(),
    willpower: z.number().nullish(),
    lore: z.number().nullish(),
    rarity: nullableText,
    illustrators: z.array(z.string()).nullish(),
    collector_number: nullableText,
    lang: nullableText,
    flavor_text: nullableText,
    set: z
      .object({
        id: nullableText,
        name: nullableText,
        code: nullableText,
        released_at: nullableText
      })
      .passthrough()
      .nullish()
  })
  .passthrough();
const lorcastSearchSchema = z.object({ results: z.array(lorcastCardSchema) }).passthrough();
const lorcastSetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    code: nullableText,
    released_at: nullableText,
    card_count: z.number().nullish()
  })
  .passthrough();
const lorcastSetsSchema = z.object({ results: z.array(lorcastSetSchema) }).passthrough();

type LorcastCard = z.infer<typeof lorcastCardSchema>;

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
  return Object.assign(new Error(`Lorcana ${operation} failed: upstream returned ${status}`), {
    status: 502
  });
}

function parseSearch(payload: unknown, operation: string): LorcastCard[] {
  const parsed = lorcastSearchSchema.safeParse(payload);
  if (!parsed.success) {
    throw Object.assign(new Error(`Lorcana ${operation} returned a malformed payload`), {
      status: 502,
      cause: parsed.error
    });
  }
  return parsed.data.results;
}

export class LorcanaAdapter implements TcgAdapter {
  readonly game = 'lorcana' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];
    const url = new URL(`${API_ROOT}/cards/search`);
    url.searchParams.set('q', trimmedQuery);
    url.searchParams.set('unique', 'prints');
    const response = await rateLimitedFetch(url.toString());
    if (!response.ok) throw upstreamError('search', response.status);
    return parseSearch(await response.json(), 'search')
      .slice(0, 20)
      .map((card) => this.mapCard(card));
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const reference = externalId.trim().replace(/^lorcana:/, '');
    if (!reference || reference.startsWith('crd_')) return null;
    const separator = reference.includes('/') ? '/' : ':';
    const [setCode, collectorNumber, ...extra] = reference.split(separator);
    if (!setCode || !collectorNumber || extra.length > 0) return null;

    const response = await rateLimitedFetch(
      `${API_ROOT}/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}`
    );
    if (response.status === 404) return null;
    if (!response.ok) throw upstreamError('card lookup', response.status);
    const parsed = lorcastCardSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw Object.assign(new Error('Lorcana card lookup returned a malformed payload'), {
        status: 502,
        cause: parsed.error
      });
    }
    return this.mapCard(parsed.data);
  }

  async fetchSets(): Promise<TcgSet[]> {
    const response = await rateLimitedFetch(`${API_ROOT}/sets`);
    if (!response.ok) throw upstreamError('sets fetch', response.status);
    const parsed = lorcastSetsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw Object.assign(new Error('Lorcana sets fetch returned a malformed payload'), {
        status: 502,
        cause: parsed.error
      });
    }
    return parsed.data.results
      .map((set) => ({
        code: set.code ?? set.id,
        name: set.name,
        tcg: this.game,
        releaseDate: set.released_at ?? undefined,
        totalCards: set.card_count ?? undefined
      }))
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  }

  async fetchSetCards(setCode: string): Promise<CardDTO[]> {
    const trimmedCode = setCode.trim();
    if (!trimmedCode) return [];
    const url = new URL(`${API_ROOT}/cards/search`);
    url.searchParams.set('q', `set:${trimmedCode}`);
    url.searchParams.set('unique', 'prints');
    const response = await rateLimitedFetch(url.toString());
    if (!response.ok) throw upstreamError('set cards fetch', response.status);
    return parseSearch(await response.json(), 'set cards fetch').map((card) =>
      this.mapCard(card)
    );
  }

  private mapCard(card: LorcastCard): CardDTO {
    const images = card.image_uris?.digital ?? card.image_uris ?? {};
    const printingKey = `lorcana:${card.id}`;
    return {
      id: card.id,
      tcg: this.game,
      baseExternalId: card.id,
      printingKey,
      artworkId: card.id,
      name: card.version ? `${card.name} - ${card.version}` : card.name,
      setCode: card.set?.code ?? undefined,
      setName: card.set?.name ?? undefined,
      rarity: card.rarity ?? undefined,
      collectorNumber: card.collector_number ?? undefined,
      releasedAt: card.released_at ?? card.set?.released_at ?? undefined,
      language: card.lang ?? undefined,
      imageUrl: images.large ?? images.normal ?? images.small ?? undefined,
      imageUrlSmall: images.small ?? images.normal ?? images.large ?? undefined,
      attributes: {
        ink: card.ink,
        cost: card.cost,
        inkwell: card.inkwell,
        type: card.type,
        classifications: card.classifications,
        text: card.text,
        keywords: card.keywords,
        move_cost: card.move_cost,
        strength: card.strength,
        willpower: card.willpower,
        lore: card.lore,
        flavor_text: card.flavor_text,
        illustrators: card.illustrators
      },
      provenance: {
        source: 'lorcast',
        sourceId: card.id,
        fetchedAt: new Date().toISOString(),
        schemaVersion: 'v0'
      }
    };
  }
}
