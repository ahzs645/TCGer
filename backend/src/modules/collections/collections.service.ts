import type { Collection as PrismaCollection, Prisma } from '@prisma/client';
import type {
  CreateBinderInput,
  UpdateBinderInput,
  AddCardInput,
  UpdateCardInput
} from '@tcg/api-types';

import { prisma } from '../../lib/prisma';

// Re-export shared types for existing consumers
export type { CreateBinderInput, UpdateBinderInput } from '@tcg/api-types';

// Local + exported aliases matching existing naming convention
export type AddCardToBinderInput = AddCardInput;
export type UpdateCollectionCardInput = UpdateCardInput;

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
  },
  tags: {
    include: {
      tag: true
    }
  }
} as const;

type PrismaCollectionWithCard = Prisma.CollectionGetPayload<{
  include: typeof collectionInclude;
}>;

type CollectionTagDto = {
  id: string;
  label: string;
  colorHex: string;
};

type CollectionCopyDto = {
  id: string;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  tags: CollectionTagDto[];
};

type BinderSnapshot = {
  id: string;
  name?: string;
  colorHex?: string;
};

type AggregatedCollectionCard = {
  id: string;
  cardId: string;
  externalId?: string;
  tcg: 'yugioh' | 'magic' | 'pokemon';
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  binderId?: string;
  binderName?: string;
  binderColorHex?: string;
  priceHistory: { price: number; recordedAt: string }[];
  copies: CollectionCopyDto[];
  conditionSummary?: string;
};

const CONDITION_SORT_ORDER = [
  'GEM MINT',
  'MINT',
  'NEAR MINT',
  'NM',
  'LIGHTLY PLAYED',
  'LP',
  'MODERATE PLAY',
  'MP',
  'HEAVY PLAY',
  'HP',
  'DAMAGED',
  'DMG'
];

const DEFAULT_TAG_COLORS = ['#F97316', '#0EA5E9', '#22C55E', '#E879F9', '#FACC15', '#6366F1'];

function normalizeHexColor(input?: string | null) {
  if (!input) {
    return null;
  }
  const trimmed = input.trim().replace(/^#/, '').toUpperCase();
  if (!/^([0-9A-F]{6})$/.test(trimmed)) {
    return null;
  }
  return `#${trimmed}`;
}

function hashLabel(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash << 5) - hash + label.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickTagColor(label: string) {
  const index = hashLabel(label) % DEFAULT_TAG_COLORS.length;
  return DEFAULT_TAG_COLORS[index];
}

function getBinderSnapshot(collection: PrismaCollectionWithCard, fallback?: BinderSnapshot): BinderSnapshot {
  if (collection.binder) {
    return {
      id: collection.binder.id,
      name: collection.binder.name ?? undefined,
      colorHex: collection.binder.colorHex ?? undefined
    };
  }

  if (collection.binderId) {
    return {
      id: collection.binderId,
      name: undefined,
      colorHex: undefined
    };
  }

  return fallback ?? {
    id: UNSORTED_BINDER_ID,
    name: 'Unsorted',
    colorHex: UNSORTED_BINDER_COLOR
  };
}

function mapCollectionCopy(collection: PrismaCollectionWithCard): CollectionCopyDto {
  return {
    id: collection.id,
    condition: collection.condition ?? undefined,
    language: collection.language ?? undefined,
    notes: collection.notes ?? undefined,
    price: collection.price ? parseFloat(collection.price.toString()) : undefined,
    acquisitionPrice: collection.acquisitionPrice ? parseFloat(collection.acquisitionPrice.toString()) : undefined,
    serialNumber: collection.serialNumber ?? undefined,
    acquiredAt: collection.acquiredAt ? collection.acquiredAt.toISOString() : undefined,
    tags:
      collection.tags?.map((entry) => ({
        id: entry.tag.id,
        label: entry.tag.label,
        colorHex: entry.tag.colorHex
      })) ?? []
  };
}

function getConditionRank(value: string | undefined) {
  if (!value) {
    return CONDITION_SORT_ORDER.length + 10;
  }
  const normalized = value.trim().toUpperCase();
  const idx = CONDITION_SORT_ORDER.indexOf(normalized);
  return idx === -1 ? CONDITION_SORT_ORDER.length + 5 : idx;
}

function summarizeConditionRange(copies: CollectionCopyDto[]) {
  const values = copies
    .map((copy) => copy.condition?.trim())
    .filter((value): value is string => Boolean(value));
  if (!values.length) {
    return undefined;
  }
  const sorted = values.sort((a, b) => getConditionRank(a) - getConditionRank(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first === last ? first : `${first} – ${last}`;
}

function aggregateCollectionEntries(
  collections: PrismaCollectionWithCard[],
  fallbackBinder?: BinderSnapshot
): AggregatedCollectionCard[] {
  const grouped = new Map<string, AggregatedCollectionCard>();

  for (const entry of collections) {
    const copyPayload = mapCollectionCopy(entry);
    const binderMeta = getBinderSnapshot(entry, fallbackBinder);
    const card = entry.card;
    const key = `${binderMeta.id ?? UNSORTED_BINDER_ID}:${card.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: copyPayload.id,
        cardId: card.id,
        externalId: card.externalId ?? undefined,
        tcg: card.tcgGame.code as 'yugioh' | 'magic' | 'pokemon',
        name: card.name,
        setCode: card.setCode ?? undefined,
        setName: card.setName ?? undefined,
        rarity: card.rarity ?? undefined,
        imageUrl: card.imageUrl ?? undefined,
        imageUrlSmall: card.imageUrlSmall ?? undefined,
        quantity: 0,
        condition: undefined,
        language: undefined,
        notes: undefined,
        price: undefined,
        binderId: binderMeta.id ?? undefined,
        binderName: binderMeta.name,
        binderColorHex: binderMeta.colorHex ?? undefined,
        priceHistory: card.priceHistory.map((history) => ({
          price: history.price ? parseFloat(history.price.toString()) : 0,
          recordedAt: history.recordedAt.toISOString()
        })),
        copies: []
      });
    }

    const group = grouped.get(key)!;
    group.copies.push(copyPayload);
    group.quantity = group.copies.length;

    if (!group.condition && copyPayload.condition) {
      group.condition = copyPayload.condition;
    }
    if (!group.language && copyPayload.language) {
      group.language = copyPayload.language;
    }
    if (!group.notes && copyPayload.notes) {
      group.notes = copyPayload.notes;
    }
    if (!group.price && copyPayload.price !== undefined) {
      group.price = copyPayload.price;
    }
  }

  return Array.from(grouped.values()).map((card) => ({
    ...card,
    conditionSummary: summarizeConditionRange(card.copies)
  }));
}

async function resolveTagIds(
  tx: Prisma.TransactionClient,
  userId: string,
  existingTagIds?: string[],
  newTags?: { label: string; colorHex?: string }[]
) {
  const resolved: string[] = [];

  if (existingTagIds?.length) {
    const found = await tx.tag.findMany({
      where: {
        userId,
        id: { in: existingTagIds }
      },
      select: { id: true }
    });
    resolved.push(...found.map((tag) => tag.id));
  }

  if (newTags?.length) {
    for (const tagInput of newTags) {
      const label = tagInput.label.trim();
      if (!label) {
        continue;
      }
      const normalizedColor = normalizeHexColor(tagInput.colorHex) ?? pickTagColor(label);
      const created = await tx.tag.upsert({
        where: {
          userId_label: {
            userId,
            label
          }
        },
        update: {
          colorHex: normalizedColor,
          updatedAt: new Date()
        },
        create: {
          userId,
          label,
          colorHex: normalizedColor
        }
      });
      resolved.push(created.id);
    }
  }

  return resolved;
}

async function syncCollectionTags(
  tx: Prisma.TransactionClient,
  userId: string,
  collectionId: string,
  existingTagIds?: string[],
  newTags?: { label: string; colorHex?: string }[]
) {
  const wantsExisting = existingTagIds !== undefined;
  const wantsNew = Boolean(newTags?.length);
  if (!wantsExisting && !wantsNew) {
    return;
  }
  const tagIds = await resolveTagIds(tx, userId, existingTagIds, newTags);
  await tx.collectionTag.deleteMany({ where: { collectionId } });
  if (tagIds.length) {
    await tx.collectionTag.createMany({ data: tagIds.map((tagId) => ({ collectionId, tagId })) });
  }
}

async function applyQuantityAdjustment(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    cardId: string;
    binderId: string | null;
    desiredQuantity: number;
    template: PrismaCollectionWithCard;
    tagIds: string[];
    preserveId: string;
  }
) {
  const { userId, cardId, binderId, desiredQuantity, template, tagIds, preserveId } = params;
  const existing = await tx.collection.findMany({
    where: {
      userId,
      cardId,
      binderId
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  const currentCount = existing.length;
  const delta = desiredQuantity - currentCount;
  if (delta === 0) {
    return;
  }

  if (delta > 0) {
    for (let index = 0; index < delta; index += 1) {
      const created = await tx.collection.create({
        data: {
          userId,
          cardId,
          binderId,
          quantity: 1,
          condition: template.condition,
          language: template.language,
          notes: template.notes,
          price: template.price,
          acquisitionPrice: template.acquisitionPrice,
          serialNumber: null,
          acquiredAt: null
        }
      });
      if (tagIds.length) {
        await tx.collectionTag.createMany({
          data: tagIds.map((tagId) => ({
            collectionId: created.id,
            tagId
          }))
        });
      }
    }
    return;
  }

  let remainingToDelete = Math.abs(delta);
  const deletable = existing
    .filter((entry) => entry.id !== preserveId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  for (const entry of deletable) {
    if (remainingToDelete <= 0) {
      break;
    }
    await tx.collection.delete({ where: { id: entry.id } });
    remainingToDelete -= 1;
  }

  if (remainingToDelete > 0) {
    throw new Error('Unable to reduce quantity to the requested amount.');
  }
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

function parseOptionalDate(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return new Date(value);
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
    cards: aggregateCollectionEntries(binder.collections)
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
    cards: aggregateCollectionEntries(looseCollections, {
      id: UNSORTED_BINDER_ID,
      name: 'Unsorted',
      colorHex: UNSORTED_BINDER_COLOR
    })
  });

  return formattedBinders;
}

export async function getUserBinder(userId: string, binderId: string) {
  const binders = await getUserBinders(userId);
  const binder = binders.find((entry) => entry.id === binderId);

  if (!binder) {
    throw new Error('Binder not found');
  }

  return binder;
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
    cards: aggregateCollectionEntries(updated.collections)
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
  const cardId = input.cardId;
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

  const copiesToCreate = Math.max(1, input.quantity ?? 1);
  const serialNumber = sanitizeOptionalText(input.serialNumber) ?? undefined;
  const acquiredAt = parseOptionalDate(input.acquiredAt ?? undefined) ?? undefined;

  const createdEntries = await prisma.$transaction(async (tx) => {
    const created = [] as PrismaCollection[];
    for (let index = 0; index < copiesToCreate; index += 1) {
      const entry = await tx.collection.create({
        data: {
          userId,
          cardId,
          binderId,
          quantity: 1,
          condition: input.condition,
          language: input.language,
          notes: input.notes,
          price: input.price,
          acquisitionPrice: input.acquisitionPrice,
          serialNumber,
          acquiredAt
        }
      });

      if (input.tags?.length || input.newTags?.length) {
        await syncCollectionTags(tx, userId, entry.id, input.tags, input.newTags);
      }

      created.push(entry);
    }
    return created;
  });

  // Update binder's updatedAt
  await prisma.binder.update({
    where: { id: binderId },
    data: { updatedAt: new Date() }
  });

  return createdEntries[0];
}

export async function addCardToLibrary(userId: string, input: AddCardToBinderInput) {
  // Ensure card exists, create if not (reuse logic)
  const cardId = input.cardId;
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

  const copiesToCreate = Math.max(1, input.quantity ?? 1);
  const serialNumber = sanitizeOptionalText(input.serialNumber) ?? undefined;
  const acquiredAt = parseOptionalDate(input.acquiredAt ?? undefined) ?? undefined;

  const createdEntries = await prisma.$transaction(async (tx) => {
    const created = [] as PrismaCollection[];
    for (let index = 0; index < copiesToCreate; index += 1) {
      const entry = await tx.collection.create({
        data: {
          userId,
          cardId,
          binderId: null,
          quantity: 1,
          condition: input.condition,
          language: input.language,
          notes: input.notes,
          price: input.price,
          acquisitionPrice: input.acquisitionPrice,
          serialNumber,
          acquiredAt
        }
      });

      if (input.tags?.length || input.newTags?.length) {
        await syncCollectionTags(tx, userId, entry.id, input.tags, input.newTags);
      }

      created.push(entry);
    }
    return created;
  });

  return createdEntries[0];
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
    },
    include: {
      tags: true
    }
  });

  if (!collection) {
    throw new Error('Collection entry not found');
  }

  const desiredCardId = input.cardOverride?.cardId?.trim();
  const wantsCardOverride = Boolean(desiredCardId && desiredCardId !== collection.cardId);

  const updatePayload: Prisma.CollectionUpdateInput = {};

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
  const normalizedSerial = sanitizeOptionalText(input.serialNumber);
  if (normalizedSerial !== undefined) {
    updatePayload.serialNumber = normalizedSerial;
  }
  const parsedAcquiredAt = parseOptionalDate(input.acquiredAt);
  if (parsedAcquiredAt !== undefined) {
    updatePayload.acquiredAt = parsedAcquiredAt;
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

  const shouldSyncTags = input.tags !== undefined || Boolean(input.newTags?.length);

  const updated = await prisma.$transaction(async (tx) => {
    const hasFieldUpdates = Object.keys(updatePayload).length > 0;

    if (wantsCardOverride && desiredCardId) {
      let targetCard = await tx.card.findUnique({ where: { id: desiredCardId } });
      if (!targetCard) {
        const payload = input.cardOverride?.cardData;
        if (!payload) {
          throw new Error('Card data is required when selecting a new print.');
        }
        const tcgGame = await tx.tcgGame.findFirst({
          where: { code: payload.tcg }
        });
        if (!tcgGame) {
          throw new Error(`TCG game '${payload.tcg}' not found`);
        }
        targetCard = await tx.card.create({
          data: {
            id: desiredCardId,
            tcgGameId: tcgGame.id,
            externalId: payload.externalId,
            name: payload.name,
            setCode: payload.setCode,
            setName: payload.setName,
            rarity: payload.rarity,
            imageUrl: payload.imageUrl,
            imageUrlSmall: payload.imageUrlSmall
          }
        });
      }

      await tx.collection.updateMany({
        where: {
          userId,
          binderId: resolvedBinderId,
          cardId: collection.cardId
        },
        data: {
          cardId: desiredCardId
        }
      });
    }

    const updatedCollection = hasFieldUpdates
      ? await tx.collection.update({
          where: { id: collectionId },
          data: updatePayload,
          include: collectionInclude
        })
      : await tx.collection.findUniqueOrThrow({
          where: { id: collectionId },
          include: collectionInclude
        });

    let workingCollection = updatedCollection as PrismaCollectionWithCard;

    if (shouldSyncTags) {
      await syncCollectionTags(tx, userId, collectionId, input.tags, input.newTags);
      const refreshed = await tx.collection.findUnique({
        where: { id: collectionId },
        include: collectionInclude
      });
      if (refreshed) {
        workingCollection = refreshed as PrismaCollectionWithCard;
      }
    }

    const destinationBinderId = hasTargetBinder ? resolvedTargetBinderId : resolvedBinderId;
    if (input.quantity !== undefined) {
      await applyQuantityAdjustment(tx, {
        userId,
        cardId: workingCollection.cardId,
        binderId: destinationBinderId ?? null,
        desiredQuantity: input.quantity,
        template: workingCollection,
        tagIds: workingCollection.tags.map((entry) => entry.tag.id),
        preserveId: workingCollection.id
      });
    }

    return workingCollection;
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

  const destinationBinderId = hasTargetBinder ? resolvedTargetBinderId : resolvedBinderId;
  const relatedEntries = await prisma.collection.findMany({
    where: {
      userId,
      cardId: updated.cardId,
      binderId: destinationBinderId
    },
    include: collectionInclude
  });

  const aggregated = aggregateCollectionEntries(relatedEntries, !destinationBinderId
    ? { id: UNSORTED_BINDER_ID, name: 'Unsorted', colorHex: UNSORTED_BINDER_COLOR }
    : undefined);

  return aggregated[0] ?? null;
}

export async function getUserTags(userId: string) {
  const tags = await prisma.tag.findMany({
    where: { userId },
    orderBy: { label: 'asc' }
  });

  return tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    colorHex: tag.colorHex,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString()
  }));
}

export async function createUserTag(userId: string, input: { label: string; colorHex?: string }) {
  const label = input.label.trim();
  if (!label) {
    throw new Error('Label is required');
  }
  const colorHex = normalizeHexColor(input.colorHex) ?? pickTagColor(label);

  const tag = await prisma.tag.upsert({
    where: {
      userId_label: {
        userId,
        label
      }
    },
    update: {
      colorHex,
      updatedAt: new Date()
    },
    create: {
      userId,
      label,
      colorHex
    }
  });

  return {
    id: tag.id,
    label: tag.label,
    colorHex: tag.colorHex,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString()
  };
}
