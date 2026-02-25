import type {
  CreateWishlistInput,
  UpdateWishlistInput,
  AddWishlistCardInput,
  WishlistResponse,
  WishlistCardResponse
} from '@tcg/api-types';
import type { TcgCode } from '@tcg/api-types';

import { prisma } from '../../lib/prisma';

export async function getUserWishlists(userId: string): Promise<WishlistResponse[]> {
  const wishlists = await prisma.wishlist.findMany({
    where: { userId },
    include: { cards: true },
    orderBy: { createdAt: 'desc' }
  });

  // Get all user's collection cards to check ownership
  const ownedCards = await prisma.collection.findMany({
    where: { userId },
    select: {
      card: {
        select: { externalId: true, tcgGame: { select: { code: true } } }
      },
      quantity: true
    }
  });

  // Build ownership map: "tcg:externalId" → total quantity
  const ownershipMap = new Map<string, number>();
  for (const entry of ownedCards) {
    const key = `${entry.card.tcgGame.code}:${entry.card.externalId}`;
    ownershipMap.set(key, (ownershipMap.get(key) ?? 0) + entry.quantity);
  }

  return wishlists.map((wishlist) => {
    const cards: WishlistCardResponse[] = wishlist.cards.map((card) => {
      const ownershipKey = `${card.tcg}:${card.externalId}`;
      const ownedQuantity = ownershipMap.get(ownershipKey) ?? 0;
      return {
        id: card.id,
        externalId: card.externalId,
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
        notes: card.notes ?? undefined,
        owned: ownedQuantity > 0,
        ownedQuantity,
        createdAt: card.createdAt.toISOString()
      };
    });

    const totalCards = cards.length;
    const ownedCards = cards.filter((c) => c.owned).length;
    const completionPercent = totalCards > 0 ? Math.round((ownedCards / totalCards) * 100) : 0;

    return {
      id: wishlist.id,
      name: wishlist.name,
      description: wishlist.description ?? undefined,
      colorHex: wishlist.colorHex ?? undefined,
      cards,
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
    include: { cards: true }
  });

  if (!wishlist) {
    throw new Error('Wishlist not found');
  }

  // Get ownership data
  const ownedCards = await prisma.collection.findMany({
    where: { userId },
    select: {
      card: {
        select: { externalId: true, tcgGame: { select: { code: true } } }
      },
      quantity: true
    }
  });

  const ownershipMap = new Map<string, number>();
  for (const entry of ownedCards) {
    const key = `${entry.card.tcgGame.code}:${entry.card.externalId}`;
    ownershipMap.set(key, (ownershipMap.get(key) ?? 0) + entry.quantity);
  }

  const cards: WishlistCardResponse[] = wishlist.cards.map((card) => {
    const ownershipKey = `${card.tcg}:${card.externalId}`;
    const ownedQuantity = ownershipMap.get(ownershipKey) ?? 0;
    return {
      id: card.id,
      externalId: card.externalId,
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
      notes: card.notes ?? undefined,
      owned: ownedQuantity > 0,
      ownedQuantity,
      createdAt: card.createdAt.toISOString()
    };
  });

  const totalCards = cards.length;
  const ownedCount = cards.filter((c) => c.owned).length;
  const completionPercent = totalCards > 0 ? Math.round((ownedCount / totalCards) * 100) : 0;

  return {
    id: wishlist.id,
    name: wishlist.name,
    description: wishlist.description ?? undefined,
    colorHex: wishlist.colorHex ?? undefined,
    cards,
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
      colorHex: input.colorHex
    },
    include: { cards: true }
  });

  return {
    id: wishlist.id,
    name: wishlist.name,
    description: wishlist.description ?? undefined,
    colorHex: wishlist.colorHex ?? undefined,
    cards: [],
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
      colorHex: input.colorHex
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

  const card = await prisma.wishlistCard.create({
    data: {
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
      notes: input.notes
    }
  });

  // Check ownership
  const owned = await prisma.collection.findFirst({
    where: {
      userId,
      card: {
        externalId: input.externalId,
        tcgGame: { code: input.tcg }
      }
    },
    select: { quantity: true }
  });

  return {
    id: card.id,
    externalId: card.externalId,
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
    notes: card.notes ?? undefined,
    owned: (owned?.quantity ?? 0) > 0,
    ownedQuantity: owned?.quantity ?? 0,
    createdAt: card.createdAt.toISOString()
  };
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
