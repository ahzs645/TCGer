import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';

export interface CreateBinderInput {
  name: string;
  description?: string;
  colorHex?: string;
}

export interface UpdateBinderInput {
  name?: string;
  description?: string;
  colorHex?: string;
}

export interface AddCardToBinderInput {
  cardId: string;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  cardData?: {
    name: string;
    tcg: string;
    externalId: string;
    setCode?: string;
    setName?: string;
    rarity?: string;
    imageUrl?: string;
    imageUrlSmall?: string;
  };
}

export const UNSORTED_BINDER_ID = '__library__';
const UNSORTED_BINDER_COLOR = '9AA0A6';

const collectionInclude = {
  binder: {
    select: {
      id: true,
      name: true,
      colorHex: true
    }
  },
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
} as const;

type PrismaCollectionWithCard = Prisma.CollectionGetPayload<{
  include: typeof collectionInclude;
}>;

export interface UpdateCollectionCardInput {
  quantity?: number;
  condition?: string | null;
  language?: string | null;
  notes?: string | null;
  targetBinderId?: string;
}

function mapCollectionCard(collection: PrismaCollectionWithCard) {
  const card = collection.card;
  const tcgGame = card.tcgGame;

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

  const binderMeta = collection.binder
    ? {
        id: collection.binder.id,
        name: collection.binder.name ?? undefined,
        colorHex: collection.binder.colorHex ?? undefined
      }
    : collection.binderId
      ? {
          id: collection.binderId,
          name: undefined,
          colorHex: undefined
        }
      : {
          id: UNSORTED_BINDER_ID,
          name: 'Unsorted',
          colorHex: UNSORTED_BINDER_COLOR
        };

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
    price: collection.price ? parseFloat(collection.price.toString()) : undefined,
    binderId: binderMeta?.id ?? undefined,
    binderName: binderMeta?.name,
    binderColorHex: binderMeta?.colorHex ?? undefined
  };
}

function resolveBinderId(binderId: string) {
  return binderId === UNSORTED_BINDER_ID ? null : binderId;
}

function sanitizeOptionalText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function getUserBinders(userId: string) {
  const [binders, looseCollections] = await Promise.all([
    prisma.binder.findMany({
      where: { userId },
      include: {
        collections: {
          include: collectionInclude
        }
      },
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.collection.findMany({
      where: { userId, binderId: null },
      include: collectionInclude,
      orderBy: { updatedAt: 'desc' }
    })
  ]);

  const formattedBinders = binders.map((binder) => ({
    id: binder.id,
    name: binder.name,
    description: binder.description ?? '',
    colorHex: binder.colorHex,
    createdAt: binder.createdAt.toISOString(),
    updatedAt: binder.updatedAt.toISOString(),
    cards: binder.collections.map(mapCollectionCard)
  }));

  const fallbackDate = new Date();
  const latestUpdated = looseCollections.reduce<Date>(
    (latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest),
    looseCollections[0]?.updatedAt ?? fallbackDate
  );

  formattedBinders.unshift({
    id: UNSORTED_BINDER_ID,
    name: 'Unsorted',
    description: 'Cards not yet assigned to a binder',
    colorHex: UNSORTED_BINDER_COLOR,
    createdAt: (looseCollections[0]?.createdAt ?? fallbackDate).toISOString(),
    updatedAt: latestUpdated.toISOString(),
    cards: looseCollections.map(mapCollectionCard)
  });

  return formattedBinders;
}

export async function createBinder(userId: string, input: CreateBinderInput) {
  const binder = await prisma.binder.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      colorHex: input.colorHex
    }
  });

  return {
    id: binder.id,
    name: binder.name,
    description: binder.description ?? '',
    colorHex: binder.colorHex,
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
      description: input.description ?? binder.description,
      colorHex: input.colorHex ?? binder.colorHex
    },
    include: {
      collections: {
        include: collectionInclude
      }
    }
  });

  return {
    id: updated.id,
    name: updated.name,
    description: updated.description ?? '',
    colorHex: updated.colorHex,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    cards: updated.collections.map((collection) => {
      const card = collection.card;
      const tcgGame = card.tcgGame;

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

  // Check if card exists, create if not
  let cardId = input.cardId;
  const existingCard = await prisma.card.findUnique({
    where: { id: cardId }
  });

  if (!existingCard && input.cardData) {
    // Get TCG game ID
    const tcgGame = await prisma.tcgGame.findFirst({
      where: { code: input.cardData.tcg }
    });

    if (!tcgGame) {
      throw new Error(`TCG game '${input.cardData.tcg}' not found`);
    }

    // Create the card
    const newCard = await prisma.card.create({
      data: {
        id: cardId,
        tcgGameId: tcgGame.id,
        externalId: input.cardData.externalId,
        name: input.cardData.name,
        setCode: input.cardData.setCode,
        setName: input.cardData.setName,
        rarity: input.cardData.rarity,
        imageUrl: input.cardData.imageUrl,
        imageUrlSmall: input.cardData.imageUrlSmall
      }
    });
  } else if (!existingCard) {
    throw new Error('Card not found and no card data provided');
  }

  // Create collection entry
  const collection = await prisma.collection.create({
    data: {
      userId,
      cardId,
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

export async function addCardToLibrary(userId: string, input: AddCardToBinderInput) {
  // Ensure card exists, create if not (reuse logic)
  let cardId = input.cardId;
  const existingCard = await prisma.card.findUnique({
    where: { id: cardId }
  });

  if (!existingCard && input.cardData) {
    const tcgGame = await prisma.tcgGame.findFirst({
      where: { code: input.cardData.tcg }
    });

    if (!tcgGame) {
      throw new Error(`TCG game '${input.cardData.tcg}' not found`);
    }

    await prisma.card.create({
      data: {
        id: cardId,
        tcgGameId: tcgGame.id,
        externalId: input.cardData.externalId,
        name: input.cardData.name,
        setCode: input.cardData.setCode,
        setName: input.cardData.setName,
        rarity: input.cardData.rarity,
        imageUrl: input.cardData.imageUrl,
        imageUrlSmall: input.cardData.imageUrlSmall
      }
    });
  } else if (!existingCard) {
    throw new Error('Card not found and no card data provided');
  }

  const collection = await prisma.collection.create({
    data: {
      userId,
      cardId,
      binderId: null,
      quantity: input.quantity,
      condition: input.condition,
      language: input.language,
      notes: input.notes,
      price: input.price,
      acquisitionPrice: input.acquisitionPrice
    }
  });

  return collection;
}

export async function removeCardFromBinder(userId: string, binderId: string, collectionId: string) {
  const resolvedBinderId = resolveBinderId(binderId);

  // Verify ownership
  const collection = await prisma.collection.findFirst({
    where: {
      id: collectionId,
      userId,
      binderId: resolvedBinderId
    }
  });

  if (!collection) {
    throw new Error('Collection entry not found');
  }

  await prisma.collection.delete({
    where: { id: collectionId }
  });

  // Update binder's updatedAt
  if (resolvedBinderId) {
    await prisma.binder.update({
      where: { id: resolvedBinderId },
      data: { updatedAt: new Date() }
    });
  }
}

export async function updateCardInBinder(
  userId: string,
  binderId: string,
  collectionId: string,
  input: UpdateCollectionCardInput
) {
  const resolvedBinderId = resolveBinderId(binderId);
  const hasTargetBinder = typeof input.targetBinderId === 'string';
  const resolvedTargetBinderId = hasTargetBinder ? resolveBinderId(input.targetBinderId as string) : undefined;

  const collection = await prisma.collection.findFirst({
    where: {
      id: collectionId,
      userId,
      binderId: resolvedBinderId
    }
  });

  if (!collection) {
    throw new Error('Collection entry not found');
  }

  const updatePayload: Prisma.CollectionUpdateInput = {};

  if (typeof input.quantity === 'number') {
    updatePayload.quantity = input.quantity;
  }
  const normalizedCondition = sanitizeOptionalText(input.condition);
  if (normalizedCondition !== undefined) {
    updatePayload.condition = normalizedCondition;
  }
  const normalizedLanguage = sanitizeOptionalText(input.language);
  if (normalizedLanguage !== undefined) {
    updatePayload.language = normalizedLanguage;
  }
  const normalizedNotes = sanitizeOptionalText(input.notes);
  if (normalizedNotes !== undefined) {
    updatePayload.notes = normalizedNotes;
  }
  if (hasTargetBinder) {
    if (resolvedTargetBinderId) {
      const targetBinder = await prisma.binder.findFirst({
        where: { id: resolvedTargetBinderId, userId }
      });
      if (!targetBinder) {
        throw new Error('Binder not found');
      }
      updatePayload.binder = {
        connect: { id: targetBinder.id }
      };
    } else {
      updatePayload.binder = {
        disconnect: true
      };
    }
  }

  const updated = await prisma.collection.update({
    where: { id: collectionId },
    data: updatePayload,
    include: collectionInclude
  });

  if (resolvedBinderId) {
    await prisma.binder.update({
      where: { id: resolvedBinderId },
      data: { updatedAt: new Date() }
    });
  }
  if (hasTargetBinder && resolvedTargetBinderId && resolvedTargetBinderId !== resolvedBinderId) {
    await prisma.binder.update({
      where: { id: resolvedTargetBinderId },
      data: { updatedAt: new Date() }
    });
  }

  return mapCollectionCard(updated as PrismaCollectionWithCard);
}
