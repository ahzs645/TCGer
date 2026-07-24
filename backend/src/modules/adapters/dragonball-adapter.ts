import { z } from 'zod';
import type { TcgSet } from '@tcg/api-types';

import { env } from '../../config/env';
import type { CardDTO, TcgAdapter } from './types';

const API_ROOT = env.APITCG_API_BASE_URL.replace(/\/+$/, '');
const TCG_SLUG = 'dragon-ball-super-fusion-world';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.APITCG_REQUEST_TIMEOUT_MS ?? '8000', 10);
const MAX_SET_CARD_PAGES = 10;

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const setSchema = z
  .object({
    _id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().nullish(),
    tcg: z.string().nullish(),
    release_date: z.string().nullish(),
    code: z.string().nullish(),
    logo: z.string().nullish()
  })
  .passthrough();
const productSchema = z
  .object({
    _id: z.union([z.string(), z.number()]),
    type: z.literal('card'),
    name: z.string().min(1),
    description: z.string().nullish(),
    tcg: z.union([z.string(), z.record(z.unknown())]).nullish(),
    set: z.union([z.string(), setSchema]).nullish(),
    images: z
      .array(
        z
          .object({
            small: z.string().nullish(),
            medium: z.string().nullish(),
            large: z.string().nullish()
          })
          .passthrough()
      )
      .nullish(),
    release_date: z.string().nullish(),
    code: z.string().nullish(),
    cardNumber: z.string().nullish(),
    attributes: z.record(attributeValueSchema).nullish()
  })
  .passthrough();
const productListSchema = z
  .object({
    success: z.literal(true),
    data: z.array(productSchema),
    total: z.number().int().nonnegative()
  })
  .passthrough();
const productResponseSchema = z
  .object({ success: z.literal(true), data: productSchema })
  .passthrough();
const setsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(setSchema),
    total: z.number().int().nonnegative()
  })
  .passthrough();

type ApiTcgProduct = z.infer<typeof productSchema>;

function configurationError(): Error & { status: number; code: string } {
  return Object.assign(
    new Error(
      'Dragon Ball Super is not configured: APITCG_API_KEY is required to use this provider'
    ),
    { status: 503, code: 'APITCG_NOT_CONFIGURED' }
  );
}

function requireApiKey(): string {
  if (!env.APITCG_API_KEY) throw configurationError();
  return env.APITCG_API_KEY;
}

async function apiFetch(input: string): Promise<Response> {
  const apiKey = requireApiKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      headers: {
        Accept: 'application/json',
        'x-api-key': apiKey
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function upstreamError(operation: string, status: number): Error & { status: number } {
  return Object.assign(
    new Error(`Dragon Ball Super ${operation} failed: upstream returned ${status}`),
    { status: 502 }
  );
}

function malformedError(operation: string, cause: z.ZodError): Error & { status: number } {
  return Object.assign(
    new Error(`Dragon Ball Super ${operation} returned a malformed payload`),
    { status: 502, cause }
  );
}

export class DragonBallAdapter implements TcgAdapter {
  readonly game = 'dragonball' as const;

  async searchCards(query: string): Promise<CardDTO[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];
    const products = await this.fetchProductPage(
      { name: trimmedQuery, populate: 'set' },
      20,
      1,
      'search'
    );
    return products.data.map((product) => this.mapCard(product));
  }

  async fetchCardById(externalId: string): Promise<CardDTO | null> {
    const productId = externalId.trim().replace(/^dragonball:/, '');
    if (!productId) return null;
    const response = await apiFetch(`${API_ROOT}/api/products/${encodeURIComponent(productId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw upstreamError('card lookup', response.status);
    const parsed = productResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw malformedError('card lookup', parsed.error);
    return this.mapCard(parsed.data.data);
  }

  async fetchSets(): Promise<TcgSet[]> {
    const url = new URL(`${API_ROOT}/api/${TCG_SLUG}/sets`);
    url.searchParams.set('limit', '100');
    const response = await apiFetch(url.toString());
    if (!response.ok) throw upstreamError('sets fetch', response.status);
    const parsed = setsResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw malformedError('sets fetch', parsed.error);
    return parsed.data.data
      .map((set) => ({
        code: set.code ?? set._id,
        name: set.name,
        tcg: this.game,
        releaseDate: set.release_date ?? undefined,
        logoUrl: set.logo ?? undefined
      }))
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  }

  async fetchSetCards(setCode: string): Promise<CardDTO[]> {
    const trimmedCode = setCode.trim();
    if (!trimmedCode) return [];
    const cards: ApiTcgProduct[] = [];
    for (let page = 1; page <= MAX_SET_CARD_PAGES; page += 1) {
      const result = await this.fetchProductPage(
        { set: trimmedCode, populate: 'set' },
        100,
        page,
        'set cards fetch'
      );
      cards.push(...result.data);
      if (cards.length >= result.total || result.data.length < 100) break;
    }
    return cards.map((product) => this.mapCard(product));
  }

  private async fetchProductPage(
    filters: Record<string, string>,
    limit: number,
    page: number,
    operation: string
  ): Promise<z.infer<typeof productListSchema>> {
    const url = new URL(`${API_ROOT}/api/products`);
    url.searchParams.set('tcg', TCG_SLUG);
    url.searchParams.set('type', 'card');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('page', String(page));
    Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await apiFetch(url.toString());
    if (!response.ok) throw upstreamError(operation, response.status);
    const parsed = productListSchema.safeParse(await response.json());
    if (!parsed.success) throw malformedError(operation, parsed.error);
    return parsed.data;
  }

  private mapCard(product: ApiTcgProduct): CardDTO {
    const id = String(product._id);
    const attributes = product.attributes ?? {};
    const set = typeof product.set === 'object' && product.set ? product.set : undefined;
    const image = product.images?.[0];
    const findAttribute = (...names: string[]): string | number | boolean | null | undefined => {
      const normalizedNames = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const entry = Object.entries(attributes).find(([key]) =>
        normalizedNames.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))
      );
      return entry?.[1];
    };

    return {
      id,
      tcg: this.game,
      baseExternalId: id,
      printingKey: `dragonball:${id}`,
      artworkId: id,
      name: product.name,
      setCode: set?.code ?? set?._id ?? (typeof product.set === 'string' ? product.set : undefined),
      setName: set?.name,
      rarity: String(findAttribute('rarity') ?? '') || undefined,
      collectorNumber: product.cardNumber ?? product.code ?? undefined,
      releasedAt: product.release_date ?? set?.release_date ?? undefined,
      imageUrl: image?.large ?? image?.medium ?? image?.small ?? undefined,
      imageUrlSmall: image?.small ?? image?.medium ?? image?.large ?? undefined,
      attributes: {
        ...attributes,
        color: findAttribute('color'),
        type: findAttribute('type', 'card type'),
        power: findAttribute('power'),
        comboPower: findAttribute('combo power', 'comboPower'),
        energy: findAttribute('energy'),
        comboEnergy: findAttribute('combo energy', 'comboEnergy'),
        era: findAttribute('era'),
        character: findAttribute('character'),
        specialTrait: findAttribute('special trait', 'specialTrait'),
        skill: findAttribute('skill')
      },
      provenance: {
        source: 'apitcg',
        sourceId: id,
        fetchedAt: new Date().toISOString(),
        schemaVersion: '2026-07'
      }
    };
  }
}
