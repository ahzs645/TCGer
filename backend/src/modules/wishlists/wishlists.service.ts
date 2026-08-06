import type {
  CreateWishlistInput,
  UpdateWishlistInput,
  AddWishlistCardInput,
  AddWishlistCardsInput,
  CreateWishlistRuleInput,
  UpdateWishlistRuleInput,
  WishlistResponse,
  WishlistCardResponse,
  WishlistRuleResponse
} from '@tcg/api-types';
import type { TcgCode } from '@tcg/api-types';
import type { Prisma, WishlistCard, WishlistRule } from '@prisma/client';

import { prisma } from '../../lib/prisma';

const WISHLIST_CARD_SPECIFIC_FIELDS = [
  'baseExternalId',
  'printingKey',
  'artworkId',
  'releasedAt',
  'regulationMark',
  'language',
  'supertype',
  'formatLegality',
  'dexEntries',
  'region',
  'pokemonPrint',
  'attributes',
  'provenance',
  'legalityPeriods',
  'evolution',
  'functionalIdentity'
] as const satisfies ReadonlyArray<keyof AddWishlistCardInput>;

function compactJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildWishlistCardSpecificSnapshot(
  input: AddWishlistCardInput
): Prisma.InputJsonValue | undefined {
  const snapshot: Partial<AddWishlistCardInput> = {};
  for (const field of WISHLIST_CARD_SPECIFIC_FIELDS) {
    const value = input[field];
    if (value !== undefined) {
      Object.assign(snapshot, { [field]: value });
    }
  }
  return Object.keys(snapshot).length ? compactJsonValue(snapshot) : undefined;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function mergeWishlistCardSpecificSnapshot(
  current: Prisma.JsonValue | null | undefined,
  input: AddWishlistCardInput
): Prisma.InputJsonValue | undefined {
  const next = buildWishlistCardSpecificSnapshot(input);
  if (!next) {
    return current ? compactJsonValue(current) : undefined;
  }
  return compactJsonValue({
    ...asJsonObject(current),
    ...asJsonObject(next)
  });
}

function mapWishlistCard(
  card: WishlistCard,
  ownedQuantity: number
): WishlistCardResponse {
  const metadata = asJsonObject(card.tcgSpecific);
  return {
    id: card.id,
    externalId: card.externalId,
    baseExternalId: metadata.baseExternalId as string | undefined,
    printingKey: metadata.printingKey as string | undefined,
    artworkId: metadata.artworkId as string | undefined,
    tcg: card.tcg as TcgCode,
    name: card.name,
    setCode: card.setCode ?? undefined,
    setName: card.setName ?? undefined,
    rarity: card.rarity ?? undefined,
    imageUrl: card.imageUrl ?? undefined,
    imageUrlSmall: card.imageUrlSmall ?? undefined,
    setSymbolUrl: card.setSymbolUrl ?? undefined,
    setLogoUrl: card.setLogoUrl ?? undefined,
    collectorNumber: card.collectorNumber ?? undefined,
    releasedAt: metadata.releasedAt as string | undefined,
    regulationMark: metadata.regulationMark as string | undefined,
    language: metadata.language as string | undefined,
    supertype: metadata.supertype as string | undefined,
    formatLegality: metadata.formatLegality as WishlistCardResponse['formatLegality'],
    dexEntries: metadata.dexEntries as WishlistCardResponse['dexEntries'],
    region: metadata.region as string | undefined,
    pokemonPrint: metadata.pokemonPrint as WishlistCardResponse['pokemonPrint'],
    attributes: metadata.attributes as Record<string, unknown> | undefined,
    provenance: metadata.provenance as WishlistCardResponse['provenance'],
    legalityPeriods: metadata.legalityPeriods as WishlistCardResponse['legalityPeriods'],
    evolution: metadata.evolution as WishlistCardResponse['evolution'],
    functionalIdentity: metadata.functionalIdentity as WishlistCardResponse['functionalIdentity'],
    notes: card.notes ?? undefined,
    owned: ownedQuantity > 0,
    ownedQuantity,
    createdAt: card.createdAt.toISOString()
  };
}

function mapWishlistRule(rule: WishlistRule): WishlistRuleResponse {
  return {
    id: rule.id,
    type: rule.type as WishlistRuleResponse['type'],
    tcg: (rule.tcg as TcgCode | null) ?? undefined,
    query: rule.query ?? undefined,
    setCode: rule.setCode ?? undefined,
    setName: rule.setName ?? undefined,
    includeAllPrintings: rule.includeAllPrintings,
    autoSync: rule.autoSync,
    lastSyncedAt: rule.lastSyncedAt?.toISOString(),
    lastMatchCount: rule.lastMatchCount ?? undefined,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

/**
 * Ownership across the user's binders, keyed two ways: by exact printing
 * ("tcg:externalId") and by base card ("tcg:baseExternalId", falling back to
 * externalId for cards without one) so wishlists can match any printing.
 */
async function buildOwnershipMaps(userId: string) {
  const ownedCards = await prisma.collection.findMany({
    where: { userId },
    select: {
      card: {
        select: {
          externalId: true,
          baseExternalId: true,
          tcgGame: { select: { code: true } }
        }
      },
      quantity: true
    }
  });

  const exact = new Map<string, number>();
  const base = new Map<string, number>();
  for (const entry of ownedCards) {
    const code = entry.card.tcgGame.code;
    const exactKey = `${code}:${entry.card.externalId}`;
    exact.set(exactKey, (exact.get(exactKey) ?? 0) + entry.quantity);
    const baseKey = `${code}:${entry.card.baseExternalId ?? entry.card.externalId}`;
    base.set(baseKey, (base.get(baseKey) ?? 0) + entry.quantity);
  }
  return { exact, base };
}

function ownedQuantityFor(
  card: WishlistCard,
  matchAnyPrinting: boolean,
  maps: { exact: Map<string, number>; base: Map<string, number> }
): number {
  if (matchAnyPrinting) {
    const metadata = asJsonObject(card.tcgSpecific);
    const baseId = (metadata.baseExternalId as string | undefined) ?? card.externalId;
    return maps.base.get(`${card.tcg}:${baseId}`) ?? 0;
  }
  return maps.exact.get(`${card.tcg}:${card.externalId}`) ?? 0;
}

export async function getUserWishlists(userId: string): Promise<WishlistResponse[]> {
  const wishlists = await prisma.wishlist.findMany({
    where: { userId },
    include: { cards: true, rules: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' }
  });

  const maps = await buildOwnershipMaps(userId);

  return wishlists.map((wishlist) => {
    const cards: WishlistCardResponse[] = wishlist.cards.map((card) =>
      mapWishlistCard(card, ownedQuantityFor(card, wishlist.matchAnyPrinting, maps))
    );

    const totalCards = cards.length;
    const ownedCards = cards.filter((c) => c.owned).length;
    const completionPercent = totalCards > 0 ? Math.round((ownedCards / totalCards) * 100) : 0;

    return {
      id: wishlist.id,
      name: wishlist.name,
      description: wishlist.description ?? undefined,
      colorHex: wishlist.colorHex ?? undefined,
      matchAnyPrinting: wishlist.matchAnyPrinting,
      cards,
      rules: wishlist.rules.map(mapWishlistRule),
      totalCards,
      ownedCards,
      completionPercent,
      createdAt: wishlist.createdAt.toISOString(),
      updatedAt: wishlist.updatedAt.toISOString()
    };
  });
}

export async function getUserWishlist(userId: string, wishlistId: string): Promise<WishlistResponse> {
  const wishlist = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId },
    include: { cards: true, rules: { orderBy: { createdAt: 'asc' } } }
  });

  if (!wishlist) {
    throw new Error('Wishlist not found');
  }

  const maps = await buildOwnershipMaps(userId);

  const cards: WishlistCardResponse[] = wishlist.cards.map((card) =>
    mapWishlistCard(card, ownedQuantityFor(card, wishlist.matchAnyPrinting, maps))
  );

  const totalCards = cards.length;
  const ownedCount = cards.filter((c) => c.owned).length;
  const completionPercent = totalCards > 0 ? Math.round((ownedCount / totalCards) * 100) : 0;

  return {
    id: wishlist.id,
    name: wishlist.name,
    description: wishlist.description ?? undefined,
    colorHex: wishlist.colorHex ?? undefined,
    matchAnyPrinting: wishlist.matchAnyPrinting,
    cards,
    rules: wishlist.rules.map(mapWishlistRule),
    totalCards,
    ownedCards: ownedCount,
    completionPercent,
    createdAt: wishlist.createdAt.toISOString(),
    updatedAt: wishlist.updatedAt.toISOString()
  };
}

export async function createWishlist(
  userId: string,
  input: CreateWishlistInput
): Promise<WishlistResponse> {
  const wishlist = await prisma.wishlist.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      colorHex: input.colorHex,
      matchAnyPrinting: input.matchAnyPrinting ?? false
    },
    include: { cards: true, rules: true }
  });

  return {
    id: wishlist.id,
    name: wishlist.name,
    description: wishlist.description ?? undefined,
    colorHex: wishlist.colorHex ?? undefined,
    matchAnyPrinting: wishlist.matchAnyPrinting,
    cards: [],
    rules: [],
    totalCards: 0,
    ownedCards: 0,
    completionPercent: 0,
    createdAt: wishlist.createdAt.toISOString(),
    updatedAt: wishlist.updatedAt.toISOString()
  };
}

export async function updateWishlist(
  userId: string,
  wishlistId: string,
  input: UpdateWishlistInput
): Promise<WishlistResponse> {
  const existing = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId }
  });

  if (!existing) {
    throw new Error('Wishlist not found');
  }

  await prisma.wishlist.update({
    where: { id: wishlistId },
    data: {
      name: input.name,
      description: input.description,
      colorHex: input.colorHex,
      matchAnyPrinting: input.matchAnyPrinting
    }
  });

  return getUserWishlist(userId, wishlistId);
}

export async function deleteWishlist(userId: string, wishlistId: string): Promise<void> {
  const existing = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId }
  });

  if (!existing) {
    throw new Error('Wishlist not found');
  }

  await prisma.wishlist.delete({ where: { id: wishlistId } });
}

export async function addCardToWishlist(
  userId: string,
  wishlistId: string,
  input: AddWishlistCardInput
): Promise<WishlistCardResponse> {
  const wishlist = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId }
  });

  if (!wishlist) {
    throw new Error('Wishlist not found');
  }

  const existing = await prisma.wishlistCard.findUnique({
    where: {
      wishlistId_externalId_tcg: {
        wishlistId,
        externalId: input.externalId,
        tcg: input.tcg
      }
    },
    select: { tcgSpecific: true }
  });
  const card = await prisma.wishlistCard.upsert({
    where: {
      wishlistId_externalId_tcg: {
        wishlistId,
        externalId: input.externalId,
        tcg: input.tcg
      }
    },
    update: {
      name: input.name,
      setCode: input.setCode,
      setName: input.setName,
      rarity: input.rarity,
      imageUrl: input.imageUrl,
      imageUrlSmall: input.imageUrlSmall,
      setSymbolUrl: input.setSymbolUrl,
      setLogoUrl: input.setLogoUrl,
      collectorNumber: input.collectorNumber,
      tcgSpecific: mergeWishlistCardSpecificSnapshot(existing?.tcgSpecific, input),
      notes: input.notes
    },
    create: {
      wishlistId,
      externalId: input.externalId,
      tcg: input.tcg,
      name: input.name,
      setCode: input.setCode,
      setName: input.setName,
      rarity: input.rarity,
      imageUrl: input.imageUrl,
      imageUrlSmall: input.imageUrlSmall,
      setSymbolUrl: input.setSymbolUrl,
      setLogoUrl: input.setLogoUrl,
      collectorNumber: input.collectorNumber,
      tcgSpecific: buildWishlistCardSpecificSnapshot(input),
      notes: input.notes
    }
  });

  // Check ownership. Each physical copy is its own collection row, so the
  // quantities must be summed to match the list endpoints. When the wishlist
  // matches any printing, count copies sharing the card's base identity too.
  const baseId = input.baseExternalId ?? input.externalId;
  const owned = await prisma.collection.aggregate({
    where: {
      userId,
      card: wishlist.matchAnyPrinting
        ? {
            tcgGame: { code: input.tcg },
            OR: [
              { externalId: input.externalId },
              { externalId: baseId },
              { baseExternalId: baseId }
            ]
          }
        : {
            externalId: input.externalId,
            tcgGame: { code: input.tcg }
          }
    },
    _sum: { quantity: true }
  });

  return mapWishlistCard(card, owned._sum.quantity ?? 0);
}

export async function removeCardFromWishlist(
  userId: string,
  wishlistId: string,
  cardId: string
): Promise<void> {
  const wishlist = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId }
  });

  if (!wishlist) {
    throw new Error('Wishlist not found');
  }

  const card = await prisma.wishlistCard.findFirst({
    where: { id: cardId, wishlistId }
  });

  if (!card) {
    throw new Error('Wishlist card not found');
  }

  await prisma.wishlistCard.delete({ where: { id: cardId } });
}

export async function addCardsToWishlist(
  userId: string,
  wishlistId: string,
  input: AddWishlistCardsInput
): Promise<WishlistResponse> {
  const wishlist = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId }
  });

  if (!wishlist) {
    throw new Error('Wishlist not found');
  }

  // Preserve rich fields that are omitted when a later import only refreshes
  // the card's basic display snapshot.
  await prisma.$transaction(async (tx) => {
    for (const card of input.cards) {
      const key = {
        wishlistId,
        externalId: card.externalId,
        tcg: card.tcg
      };
      const existing = await tx.wishlistCard.findUnique({
        where: { wishlistId_externalId_tcg: key },
        select: { tcgSpecific: true }
      });
      await tx.wishlistCard.upsert({
        where: {
          wishlistId_externalId_tcg: key
        },
        update: {
          name: card.name,
          setCode: card.setCode,
          setName: card.setName,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          imageUrlSmall: card.imageUrlSmall,
          setSymbolUrl: card.setSymbolUrl,
          setLogoUrl: card.setLogoUrl,
          collectorNumber: card.collectorNumber,
          tcgSpecific: mergeWishlistCardSpecificSnapshot(existing?.tcgSpecific, card),
          notes: card.notes
        },
        create: {
          wishlistId,
          externalId: card.externalId,
          tcg: card.tcg,
          name: card.name,
          setCode: card.setCode,
          setName: card.setName,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          imageUrlSmall: card.imageUrlSmall,
          setSymbolUrl: card.setSymbolUrl,
          setLogoUrl: card.setLogoUrl,
          collectorNumber: card.collectorNumber,
          tcgSpecific: buildWishlistCardSpecificSnapshot(card),
          notes: card.notes
        }
      });
    }
  });

  return getUserWishlist(userId, wishlistId);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

async function requireWishlist(userId: string, wishlistId: string) {
  const wishlist = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId }
  });
  if (!wishlist) {
    throw new Error('Wishlist not found');
  }
  return wishlist;
}

export async function addWishlistRule(
  userId: string,
  wishlistId: string,
  input: CreateWishlistRuleInput
): Promise<WishlistRuleResponse> {
  await requireWishlist(userId, wishlistId);

  // Re-adding the same rule should refresh it rather than duplicate it.
  const existing = await prisma.wishlistRule.findFirst({
    where: {
      wishlistId,
      type: input.type,
      tcg: input.tcg ?? null,
      query: input.query ?? null,
      setCode: input.setCode ?? null
    }
  });

  if (existing) {
    const updated = await prisma.wishlistRule.update({
      where: { id: existing.id },
      data: {
        setName: input.setName ?? existing.setName,
        includeAllPrintings: input.includeAllPrintings,
        autoSync: input.autoSync
      }
    });
    return mapWishlistRule(updated);
  }

  const rule = await prisma.wishlistRule.create({
    data: {
      wishlistId,
      type: input.type,
      tcg: input.tcg,
      query: input.query,
      setCode: input.setCode,
      setName: input.setName,
      includeAllPrintings: input.includeAllPrintings,
      autoSync: input.autoSync
    }
  });
  return mapWishlistRule(rule);
}

export async function updateWishlistRule(
  userId: string,
  wishlistId: string,
  ruleId: string,
  input: UpdateWishlistRuleInput
): Promise<WishlistRuleResponse> {
  await requireWishlist(userId, wishlistId);

  const existing = await prisma.wishlistRule.findFirst({
    where: { id: ruleId, wishlistId }
  });
  if (!existing) {
    throw new Error('Wishlist rule not found');
  }

  const rule = await prisma.wishlistRule.update({
    where: { id: ruleId },
    data: {
      autoSync: input.autoSync,
      includeAllPrintings: input.includeAllPrintings,
      lastSyncedAt: input.lastSyncedAt ? new Date(input.lastSyncedAt) : undefined,
      lastMatchCount: input.lastMatchCount
    }
  });
  return mapWishlistRule(rule);
}

export async function removeWishlistRule(
  userId: string,
  wishlistId: string,
  ruleId: string
): Promise<void> {
  await requireWishlist(userId, wishlistId);

  const existing = await prisma.wishlistRule.findFirst({
    where: { id: ruleId, wishlistId }
  });
  if (!existing) {
    throw new Error('Wishlist rule not found');
  }

  await prisma.wishlistRule.delete({ where: { id: ruleId } });
}
