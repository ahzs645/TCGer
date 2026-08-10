import { Router } from 'express';
import {
  guideCardSearchQuerySchema,
  type Card,
  type CollectionGuideItemResponse,
  type CollectionGuideResponse,
  type GuideCardMembership,
  type GuideCardSearchResult
} from '@tcg/api-types';

import { env } from '../../config/env';
import {
  getSetCards,
  searchAllCards,
  searchCardsByArtist
} from '../../modules/cards/cards.service';
import { normalizeSearchText } from '../../utils/search-text';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { buildProxyHeaders, proxyToConvexHttp } from './convex-http.proxy';

export const convexGuidesRouter = Router();

convexGuidesRouter.use(requireAuth);

async function fetchConvexJson<T>(req: AuthRequest, path: string): Promise<T> {
  const response = await fetch(new URL(path, env.CONVEX_HTTP_ORIGIN), {
    headers: buildProxyHeaders(req)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw Object.assign(new Error(body?.message ?? 'Guide service request failed'), {
      status: response.status
    });
  }
  return response.json() as Promise<T>;
}

function itemToCard(item: CollectionGuideItemResponse): Card {
  return {
    id: item.externalId,
    tcg: item.tcg,
    name: item.name,
    setCode: item.setCode,
    setName: item.setName,
    collectorNumber: item.collectorNumber,
    rarity: item.rarity,
    artist: item.artist,
    imageUrl: item.imageUrl,
    imageUrlSmall: item.imageUrlSmall,
    attributes: item.variant
      ? { artist: item.artist, variant: item.variant }
      : item.artist
        ? { artist: item.artist }
        : undefined
  };
}

function cardArtist(card: Card): string | undefined {
  if (card.artist) return card.artist;
  const value = card.attributes?.artist ?? card.attributes?.illustrator;
  return typeof value === 'string' ? value : undefined;
}

function searchableText(card: Card, memberships: GuideCardMembership[]): string {
  return normalizeSearchText(
    [
      card.name,
      card.setCode,
      card.setName,
      card.collectorNumber,
      card.rarity,
      cardArtist(card),
      ...memberships.flatMap((membership) => [
        membership.title,
        membership.category,
        membership.groupLabel,
        ...membership.tags
      ])
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
  );
}

async function expandGuide(
  req: AuthRequest,
  guide: CollectionGuideResponse
): Promise<Array<{ card: Card; membership: GuideCardMembership }>> {
  const membershipBase = {
    guideId: guide.id,
    slug: guide.slug,
    title: guide.title,
    category: guide.category,
    tags: guide.tags
  };

  if (guide.rule.type === 'manual') {
    const items = await fetchConvexJson<CollectionGuideItemResponse[]>(
      req,
      `/guides/${encodeURIComponent(guide.slug)}/items`
    );
    return items.map((item) => ({
      card: itemToCard(item),
      membership: {
        ...membershipBase,
        groupKey: item.groupKey,
        groupLabel: item.groupLabel,
        groupOrder: item.groupOrder,
        position: item.position
      }
    }));
  }

  let cards: Card[] = [];
  if (guide.rule.type === 'set') {
    if (guide.rule.setCode) cards = await getSetCards(guide.tcg, guide.rule.setCode);
  } else if (guide.rule.type === 'artist') {
    if (guide.rule.query) {
      cards = await searchCardsByArtist({
        artist: guide.rule.query,
        tcg: guide.tcg,
        unique: guide.rule.includeAllPrintings ? 'prints' : 'cards',
        limit: 2000
      });
    }
  } else if (guide.rule.query) {
    cards = await searchAllCards({
      query: guide.rule.query,
      tcg: guide.tcg,
      unique: guide.rule.includeAllPrintings ? 'prints' : 'cards',
      limit: 2000
    });
  }
  return cards.map((card, position) => ({
    card,
    membership: { ...membershipBase, position }
  }));
}

convexGuidesRouter.get(
  '/cards',
  asyncHandler(async (request, response) => {
    const req = request as AuthRequest;
    const filters = guideCardSearchQuerySchema.parse(req.query);
    const [allGuides, ownedRows] = await Promise.all([
      fetchConvexJson<CollectionGuideResponse[]>(req, '/guides'),
      fetchConvexJson<Array<{ key: string; quantity: number }>>(req, '/guides/owned-card-keys')
    ]);
    const guides = allGuides.filter(
      (guide) =>
        (!filters.tcg || guide.tcg === filters.tcg) &&
        (!filters.guide || guide.slug === filters.guide || guide.id === filters.guide) &&
        (!filters.category || guide.category === filters.category)
    );
    const expansions = await Promise.allSettled(guides.map((guide) => expandGuide(req, guide)));
    const failedGuideSlugs = expansions.flatMap((result, index) =>
      result.status === 'rejected' ? [guides[index]!.slug] : []
    );
    const ownedQuantities = new Map(ownedRows.map((row) => [row.key, row.quantity] as const));
    const merged = new Map<string, GuideCardSearchResult>();
    for (const result of expansions) {
      if (result.status !== 'fulfilled') continue;
      for (const { card, membership } of result.value) {
        const key = `${card.tcg}:${card.id}`;
        const existing = merged.get(key);
        if (existing) {
          if (!existing.matchedGuides.some((candidate) => candidate.guideId === membership.guideId)) {
            existing.matchedGuides.push(membership);
          }
          continue;
        }
        const ownedQuantity = ownedQuantities.get(key) ?? 0;
        merged.set(key, {
          card,
          owned: ownedQuantity > 0,
          ownedQuantity,
          matchedGuides: [membership]
        });
      }
    }

    const query = normalizeSearchText(filters.query);
    const artist = filters.artist ? normalizeSearchText(filters.artist) : undefined;
    const rarity = filters.rarity ? normalizeSearchText(filters.rarity) : undefined;
    const results = [...merged.values()]
      .filter((result) => !query || searchableText(result.card, result.matchedGuides).includes(query))
      .filter((result) => !filters.set || result.card.setCode === filters.set)
      .filter((result) => !artist || normalizeSearchText(cardArtist(result.card) ?? '') === artist)
      .filter((result) => !rarity || normalizeSearchText(result.card.rarity ?? '') === rarity)
      .filter(
        (result) =>
          filters.ownership === 'all' ||
          (filters.ownership === 'owned' ? result.owned : !result.owned)
      )
      .sort(
        (left, right) =>
          left.matchedGuides[0]!.title.localeCompare(right.matchedGuides[0]!.title) ||
          (left.matchedGuides[0]!.groupOrder ?? 0) -
            (right.matchedGuides[0]!.groupOrder ?? 0) ||
          (left.matchedGuides[0]!.position ?? 0) - (right.matchedGuides[0]!.position ?? 0) ||
          left.card.name.localeCompare(right.card.name)
      );

    response.json({
      results: results.slice(0, filters.limit),
      total: results.length,
      failedGuideSlugs
    });
  })
);

convexGuidesRouter.use((req, res, next) => {
  proxyToConvexHttp(req as AuthRequest, res).catch(next);
});
