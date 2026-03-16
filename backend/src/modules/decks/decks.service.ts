import { prisma } from '../../lib/prisma';
import type { CreateDeckInput, UpdateDeckInput, AddDeckCardInput, UpdateDeckCardInput, DeckAnalysis } from '@tcg/api-types';

// ---------------------------------------------------------------------------
// Deck CRUD
// ---------------------------------------------------------------------------

export async function getUserDecks(userId: string) {
  const decks = await prisma.deck.findMany({
    where: { userId },
    include: { cards: true },
    orderBy: { updatedAt: 'desc' }
  });
  return decks.map(formatDeck);
}

export async function getDeck(userId: string, deckId: string) {
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId },
    include: { cards: { orderBy: { name: 'asc' } } }
  });
  if (!deck) {
    const error = new Error('Deck not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return formatDeck(deck);
}

export async function createDeck(userId: string, input: CreateDeckInput) {
  const deck = await prisma.deck.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      tcg: input.tcg,
      format: input.format,
      colorHex: input.colorHex,
      isPublic: input.isPublic ?? false
    },
    include: { cards: true }
  });
  return formatDeck(deck);
}

export async function updateDeck(userId: string, deckId: string, input: UpdateDeckInput) {
  await getDeck(userId, deckId); // ownership check
  const deck = await prisma.deck.update({
    where: { id: deckId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.format !== undefined && { format: input.format }),
      ...(input.colorHex !== undefined && { colorHex: input.colorHex }),
      ...(input.isPublic !== undefined && { isPublic: input.isPublic })
    },
    include: { cards: true }
  });
  return formatDeck(deck);
}

export async function deleteDeck(userId: string, deckId: string) {
  await getDeck(userId, deckId); // ownership check
  await prisma.deck.delete({ where: { id: deckId } });
}

// ---------------------------------------------------------------------------
// Deck Cards
// ---------------------------------------------------------------------------

export async function addCardToDeck(userId: string, deckId: string, input: AddDeckCardInput) {
  await getDeck(userId, deckId);
  const card = await prisma.deckCard.upsert({
    where: {
      deckId_externalId_isSideboard: {
        deckId,
        externalId: input.externalId,
        isSideboard: input.isSideboard ?? false
      }
    },
    create: {
      deckId,
      externalId: input.externalId,
      tcg: input.tcg,
      name: input.name,
      quantity: input.quantity ?? 1,
      isCommander: input.isCommander ?? false,
      isSideboard: input.isSideboard ?? false,
      imageUrl: input.imageUrl,
      imageUrlSmall: input.imageUrlSmall,
      setCode: input.setCode,
      setName: input.setName,
      cardData: input.cardData ?? undefined
    },
    update: {
      quantity: { increment: input.quantity ?? 1 }
    }
  });
  return card;
}

export async function updateDeckCard(userId: string, deckId: string, cardId: string, input: UpdateDeckCardInput) {
  await getDeck(userId, deckId);
  return prisma.deckCard.update({
    where: { id: cardId },
    data: {
      ...(input.quantity !== undefined && { quantity: input.quantity }),
      ...(input.isCommander !== undefined && { isCommander: input.isCommander }),
      ...(input.isSideboard !== undefined && { isSideboard: input.isSideboard })
    }
  });
}

export async function removeDeckCard(userId: string, deckId: string, cardId: string) {
  await getDeck(userId, deckId);
  await prisma.deckCard.delete({ where: { id: cardId } });
}

// ---------------------------------------------------------------------------
// Deck Analysis
// ---------------------------------------------------------------------------

export async function analyzeDeck(userId: string, deckId: string): Promise<DeckAnalysis> {
  const deck = await getDeck(userId, deckId);
  const cards = deck.cards;

  const manaCurve: Record<number, number> = {};
  const colorDistribution: Record<string, number> = {};
  const typeDistribution: Record<string, number> = {};
  const rarityDistribution: Record<string, number> = {};
  let totalCmc = 0;
  let cmcCardCount = 0;
  let mainDeckCount = 0;
  let sideboardCount = 0;

  for (const card of cards) {
    const qty = card.quantity;
    const data = (card.cardData as Record<string, unknown>) || {};

    if (card.isSideboard) {
      sideboardCount += qty;
    } else {
      mainDeckCount += qty;
    }

    // Mana curve (MTG CMC or generic cost)
    const cmc = Number(data.cmc ?? data.level ?? 0);
    if (cmc >= 0) {
      manaCurve[cmc] = (manaCurve[cmc] || 0) + qty;
      totalCmc += cmc * qty;
      cmcCardCount += qty;
    }

    // Color distribution
    const colors = (data.colors as string[]) || [];
    if (colors.length === 0) {
      colorDistribution['Colorless'] = (colorDistribution['Colorless'] || 0) + qty;
    }
    for (const color of colors) {
      colorDistribution[color] = (colorDistribution[color] || 0) + qty;
    }

    // Type distribution
    const cardType = (data.cardType as string) || (data.type as string) || 'Unknown';
    const mainType = cardType.split(/[—\-\/]/)[0].trim();
    typeDistribution[mainType] = (typeDistribution[mainType] || 0) + qty;

    // Rarity
    const rarity = (data.rarity as string) || 'unknown';
    rarityDistribution[rarity] = (rarityDistribution[rarity] || 0) + qty;
  }

  return {
    totalCards: mainDeckCount + sideboardCount,
    mainDeckCount,
    sideboardCount,
    manaCurve,
    colorDistribution,
    typeDistribution,
    rarityDistribution,
    averageCmc: cmcCardCount > 0 ? Math.round((totalCmc / cmcCardCount) * 100) / 100 : 0
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDeck(deck: any) {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    tcg: deck.tcg,
    format: deck.format,
    colorHex: deck.colorHex,
    isPublic: deck.isPublic,
    cards: (deck.cards || []).map((c: any) => ({
      id: c.id,
      externalId: c.externalId,
      tcg: c.tcg,
      name: c.name,
      quantity: c.quantity,
      isCommander: c.isCommander,
      isSideboard: c.isSideboard,
      imageUrl: c.imageUrl,
      imageUrlSmall: c.imageUrlSmall,
      setCode: c.setCode,
      setName: c.setName,
      cardData: c.cardData
    })),
    cardCount: (deck.cards || []).reduce((sum: number, c: any) => sum + c.quantity, 0),
    createdAt: deck.createdAt.toISOString(),
    updatedAt: deck.updatedAt.toISOString()
  };
}
