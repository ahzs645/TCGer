import { prisma } from '../../lib/prisma';

export interface CreateBinderInput {
  name: string;
  description?: string;
}

export interface UpdateBinderInput {
  name?: string;
  description?: string;
}

export interface AddCardToBinderInput {
  cardId: string;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
}

export async function getUserBinders(userId: string) {
  const binders = await prisma.binder.findMany({
    where: { userId },
    include: {
      collections: {
        include: {
          card: {
            include: {
              tcgGame: true,
              yugiohCard: true,
              magicCard: true,
              pokemonCard: true,
              priceHistory: {
                orderBy: { recordedAt: 'desc' },
                take: 10
              }
            }
          }
        }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });

  // Transform to match frontend expected format
  return binders.map((binder) => ({
    id: binder.id,
    name: binder.name,
    description: binder.description ?? '',
    createdAt: binder.createdAt.toISOString(),
    updatedAt: binder.updatedAt.toISOString(),
    cards: binder.collections.map((collection) => {
      const card = collection.card;
      const tcgGame = card.tcgGame;

      // Build attributes based on TCG type
      let attributes: Record<string, unknown> = {};
      if (card.yugiohCard) {
        attributes = {
          type: card.yugiohCard.cardType,
          attribute: card.yugiohCard.attribute,
          level: card.yugiohCard.level,
          atk: card.yugiohCard.atk,
          def: card.yugiohCard.def
        };
      } else if (card.magicCard) {
        attributes = {
          mana_cost: card.magicCard.manaCost,
          type_line: card.magicCard.cardType,
          oracle_text: card.magicCard.oracleText,
          power: card.magicCard.power,
          toughness: card.magicCard.toughness
        };
      } else if (card.pokemonCard) {
        attributes = {
          hp: card.pokemonCard.hp,
          types: [card.pokemonCard.pokemonType],
          attacks: card.pokemonCard.attacks
        };
      }

      return {
        id: collection.id,
        cardId: card.id,
        tcg: tcgGame.code as 'yugioh' | 'magic' | 'pokemon',
        name: card.name,
        setCode: card.setCode ?? undefined,
        setName: card.setName ?? undefined,
        rarity: card.rarity ?? undefined,
        imageUrl: card.imageUrl ?? undefined,
        imageUrlSmall: card.imageUrlSmall ?? undefined,
        quantity: collection.quantity,
        condition: collection.condition ?? undefined,
        language: collection.language ?? undefined,
        notes: collection.notes ?? undefined,
        price: collection.price ? parseFloat(collection.price.toString()) : undefined
      };
    })
  }));
}

export async function createBinder(userId: string, input: CreateBinderInput) {
  const binder = await prisma.binder.create({
    data: {
      userId,
      name: input.name,
      description: input.description
    }
  });

  return {
    id: binder.id,
    name: binder.name,
    description: binder.description ?? '',
    createdAt: binder.createdAt.toISOString(),
    updatedAt: binder.updatedAt.toISOString(),
    cards: []
  };
}

export async function updateBinder(userId: string, binderId: string, input: UpdateBinderInput) {
  // Verify ownership
  const binder = await prisma.binder.findFirst({
    where: { id: binderId, userId }
  });

  if (!binder) {
    throw new Error('Binder not found');
  }

  const updated = await prisma.binder.update({
    where: { id: binderId },
    data: {
      name: input.name ?? binder.name,
      description: input.description ?? binder.description
    }
  });

  return {
    id: updated.id,
    name: updated.name,
    description: updated.description ?? '',
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString()
  };
}

export async function deleteBinder(userId: string, binderId: string) {
  // Verify ownership
  const binder = await prisma.binder.findFirst({
    where: { id: binderId, userId }
  });

  if (!binder) {
    throw new Error('Binder not found');
  }

  await prisma.binder.delete({
    where: { id: binderId }
  });
}

export async function addCardToBinder(userId: string, binderId: string, input: AddCardToBinderInput) {
  // Verify binder ownership
  const binder = await prisma.binder.findFirst({
    where: { id: binderId, userId }
  });

  if (!binder) {
    throw new Error('Binder not found');
  }

  // Create collection entry
  const collection = await prisma.collection.create({
    data: {
      userId,
      cardId: input.cardId,
      binderId,
      quantity: input.quantity,
      condition: input.condition,
      language: input.language,
      notes: input.notes,
      price: input.price,
      acquisitionPrice: input.acquisitionPrice
    }
  });

  // Update binder's updatedAt
  await prisma.binder.update({
    where: { id: binderId },
    data: { updatedAt: new Date() }
  });

  return collection;
}

export async function removeCardFromBinder(userId: string, binderId: string, collectionId: string) {
  // Verify ownership
  const collection = await prisma.collection.findFirst({
    where: {
      id: collectionId,
      userId,
      binderId
    }
  });

  if (!collection) {
    throw new Error('Collection entry not found');
  }

  await prisma.collection.delete({
    where: { id: collectionId }
  });

  // Update binder's updatedAt
  await prisma.binder.update({
    where: { id: binderId },
    data: { updatedAt: new Date() }
  });
}
