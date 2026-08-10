import type { Collection as PrismaCollection, Prisma } from '@prisma/client';
import type {
  CreateBinderInput,
  UpdateBinderInput,
  AddCardInput,
  UpdateCardInput,
  CardDataPayload,
  CollectionCard,
  CollectionCardCopy,
  TcgCode
} from '@tcg/api-types';

import { prisma } from '../../lib/prisma';
import {
  createCollectionAudit,
  snapshotCollectionEntries
} from './collection-audit.service';

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

type CollectionCopyDto = CollectionCardCopy;

type BinderSnapshot = {
  id: string;
  name?: string;
  colorHex?: string;
};

type AggregatedCollectionCard = CollectionCard;

const CARD_SPECIFIC_FIELDS = [
  'printingKind',
  'sanctionedPlayLegal',
  'originalPrintingKey',
  'releasedAt',
  'setSymbolUrl',
  'setLogoUrl',
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
] as const satisfies ReadonlyArray<keyof CardDataPayload>;

type CardSpecificSnapshot = Pick<CardDataPayload, (typeof CARD_SPECIFIC_FIELDS)[number]>;

const CARD_IDENTITY_SPECIFIC_FIELDS = [
  'supertype',
  'attributes',
  'evolution',
  'functionalIdentity'
] as const satisfies ReadonlyArray<keyof CardDataPayload>;

function compactJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildCardSpecificSnapshot(input: CardDataPayload): Prisma.InputJsonValue | undefined {
  const snapshot: Partial<CardSpecificSnapshot> = {};
  for (const field of CARD_SPECIFIC_FIELDS) {
    const value = input[field];
    if (value !== undefined) {
      Object.assign(snapshot, { [field]: value });
    }
  }
  return Object.keys(snapshot).length ? compactJsonValue(snapshot) : undefined;
}

function buildCardIdentitySpecificSnapshot(input: CardDataPayload): Prisma.InputJsonValue | undefined {
  const snapshot: Partial<CardDataPayload> = {};
  for (const field of CARD_IDENTITY_SPECIFIC_FIELDS) {
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

function mergeLegalityPeriods(current: unknown, incoming: unknown): unknown[] | undefined {
  const periods = new Map<string, Record<string, unknown>>();
  for (const value of [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(incoming) ? incoming : [])
  ]) {
    const period = asJsonObject(value);
    if (typeof period.format !== 'string') {
      continue;
    }
    const key = [
      period.format.trim().toLowerCase(),
      typeof period.rotation === 'string' ? period.rotation.trim().toLowerCase() : '',
      typeof period.validFrom === 'string' ? period.validFrom : ''
    ].join('|');
    periods.set(key, period);
  }
  return periods.size ? [...periods.values()] : undefined;
}

function mergeCardSpecificSnapshot(
  current: Prisma.JsonValue | null | undefined,
  input: CardDataPayload
): Prisma.InputJsonValue | undefined {
  const next = buildCardSpecificSnapshot(input);
  if (!next) {
    return current ? compactJsonValue(current) : undefined;
  }
  const currentObject = asJsonObject(current);
  const nextObject = asJsonObject(next);
  const legalityPeriods = mergeLegalityPeriods(
    currentObject.legalityPeriods,
    nextObject.legalityPeriods
  );
  return compactJsonValue({
    ...currentObject,
    ...nextObject,
    ...(legalityPeriods ? { legalityPeriods } : {})
  });
}

function inferLegacyFoil(finishCode: string | null | undefined) {
  if (!finishCode) {
    return undefined;
  }
  return !['normal', 'nonfoil', 'non-foil', 'standard'].includes(finishCode.trim().toLowerCase());
}

function buildCardCreateData(
  id: string,
  tcgGameId: number,
  input: CardDataPayload,
  identityId?: string
): Prisma.CardUncheckedCreateInput {
  return {
    id,
    tcgGameId,
    identityId,
    externalId: input.externalId,
    baseExternalId: input.baseExternalId,
    printingKey: input.printingKey,
    artworkId: input.artworkId,
    collectorNumber: input.collectorNumber,
    name: input.name,
    setCode: input.setCode,
    setName: input.setName,
    rarity: input.rarity,
    imageUrl: input.imageUrl,
    imageUrlSmall: input.imageUrlSmall,
    tcgSpecific: buildCardSpecificSnapshot(input)
  };
}

function buildCardRefreshData(
  existingSpecific: Prisma.JsonValue | null,
  input: CardDataPayload,
  identityId?: string
): Prisma.CardUpdateInput {
  return {
    externalId: input.externalId,
    baseExternalId: input.baseExternalId,
    printingKey: input.printingKey,
    artworkId: input.artworkId,
    collectorNumber: input.collectorNumber,
    name: input.name,
    setCode: input.setCode,
    setName: input.setName,
    rarity: input.rarity,
    imageUrl: input.imageUrl,
    imageUrlSmall: input.imageUrlSmall,
    tcgSpecific: mergeCardSpecificSnapshot(existingSpecific, input),
    identity: identityId ? { connect: { id: identityId } } : undefined
  };
}

async function upsertCardIdentity(
  tx: Prisma.TransactionClient,
  tcgGameId: number,
  input: CardDataPayload
) {
  const baseExternalId = input.baseExternalId?.trim();
  if (!baseExternalId) {
    return undefined;
  }

  const tcgSpecific = buildCardIdentitySpecificSnapshot(input);
  let identity = await tx.cardIdentity.upsert({
    where: {
      tcgGameId_externalId: {
        tcgGameId,
        externalId: baseExternalId
      }
    },
    create: {
      tcgGameId,
      externalId: baseExternalId,
      name: input.name,
      tcgSpecific
    },
    update: {
      name: input.name
    }
  });
  if (tcgSpecific) {
    identity = await tx.cardIdentity.update({
      where: { id: identity.id },
      data: {
        tcgSpecific: compactJsonValue({
          ...asJsonObject(identity.tcgSpecific),
          ...asJsonObject(tcgSpecific)
        })
      }
    });
  }
  return identity.id;
}

export async function ensureCardForCollection(
  tx: Prisma.TransactionClient,
  cardId: string,
  input?: CardDataPayload
) {
  const existing = await tx.card.findUnique({ where: { id: cardId } });
  if (existing) {
    if (!input) {
      return existing;
    }
    const identityId = await upsertCardIdentity(tx, existing.tcgGameId, input);
    return tx.card.update({
      where: { id: cardId },
      data: buildCardRefreshData(existing.tcgSpecific, input, identityId)
    });
  }

  if (!input) {
    throw new Error('Card not found and no card data provided');
  }

  const tcgGame = await tx.tcgGame.findFirst({
    where: { code: input.tcg }
  });
  if (!tcgGame) {
    throw new Error(`TCG game '${input.tcg}' not found`);
  }

  const identityId = await upsertCardIdentity(tx, tcgGame.id, input);
  return tx.card.create({
    data: buildCardCreateData(cardId, tcgGame.id, input, identityId)
  });
}

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
    isFoil: collection.isFoil || undefined,
    finishCode: collection.finishCode ?? undefined,
    finishLabel: collection.finishLabel ?? undefined,
    edition: collection.edition ?? undefined,
    stamp: collection.stamp ?? undefined,
    isSealedPromo: collection.isSealedPromo || undefined,
    isOversized: collection.isOversized || undefined,
    isPeelOff: collection.isPeelOff || undefined,
    isSigned: collection.isSigned || undefined,
    isAltered: collection.isAltered || undefined,
    gradingCompany: collection.gradingCompany ?? undefined,
    gradingScore: collection.gradingScore ?? undefined,
    certNumber: collection.certNumber ?? undefined,
    storageLocation: collection.storageLocation ?? undefined,
    imageUrls: collection.imageUrls?.length ? collection.imageUrls : undefined,
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
      const metadata = asJsonObject(card.tcgSpecific);
      grouped.set(key, {
        id: copyPayload.id,
        cardId: card.id,
        externalId: card.externalId ?? undefined,
        baseExternalId: card.baseExternalId ?? undefined,
        printingKey: card.printingKey ?? undefined,
        artworkId: card.artworkId ?? undefined,
        printingKind: metadata.printingKind as string | undefined,
        sanctionedPlayLegal: metadata.sanctionedPlayLegal as boolean | undefined,
        originalPrintingKey: metadata.originalPrintingKey as string | undefined,
        tcg: card.tcgGame.code as TcgCode,
        name: card.name,
        setCode: card.setCode ?? undefined,
        setName: card.setName ?? undefined,
        rarity: card.rarity ?? undefined,
        collectorNumber: card.collectorNumber ?? metadata.collectorNumber as string | undefined,
        releasedAt: metadata.releasedAt as string | undefined,
        imageUrl: card.imageUrl ?? undefined,
        imageUrlSmall: card.imageUrlSmall ?? undefined,
        setSymbolUrl: metadata.setSymbolUrl as string | undefined,
        setLogoUrl: metadata.setLogoUrl as string | undefined,
        regulationMark: metadata.regulationMark as string | undefined,
        languageCode: metadata.language as string | undefined,
        supertype: metadata.supertype as string | undefined,
        formatLegality: metadata.formatLegality as CollectionCard['formatLegality'],
        dexEntries: metadata.dexEntries as CollectionCard['dexEntries'],
        region: metadata.region as string | undefined,
        pokemonPrint: metadata.pokemonPrint as CollectionCard['pokemonPrint'],
        attributes: metadata.attributes as Record<string, unknown> | undefined,
        provenance: metadata.provenance as CollectionCard['provenance'],
        legalityPeriods: metadata.legalityPeriods as CollectionCard['legalityPeriods'],
        evolution: metadata.evolution as CollectionCard['evolution'],
        functionalIdentity: metadata.functionalIdentity as CollectionCard['functionalIdentity'],
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

export async function syncCollectionTags(
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
          isFoil: template.isFoil,
          finishCode: template.finishCode,
          finishLabel: template.finishLabel,
          edition: template.edition,
          stamp: template.stamp,
          isSealedPromo: template.isSealedPromo,
          isOversized: template.isOversized,
          isPeelOff: template.isPeelOff,
          isSigned: template.isSigned,
          isAltered: template.isAltered,
          gradingCompany: template.gradingCompany,
          gradingScore: template.gradingScore,
          certNumber: template.certNumber,
          storageLocation: template.storageLocation,
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
    defaultCondition: binder.defaultCondition ?? undefined,
    containerType: binder.containerType ?? undefined,
    imageUrl: binder.imageUrl ?? undefined,
    associatedTcg: binder.associatedTcg ?? undefined,
    associatedSetCode: binder.associatedSetCode ?? undefined,
    associatedSetName: binder.associatedSetName ?? undefined,
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
    defaultCondition: undefined,
    containerType: undefined,
    imageUrl: undefined,
    associatedTcg: undefined,
    associatedSetCode: undefined,
    associatedSetName: undefined,
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
      colorHex: input.colorHex,
      defaultCondition: input.defaultCondition,
      containerType: input.containerType,
      imageUrl: input.imageUrl,
      associatedTcg: input.associatedTcg,
      associatedSetCode: input.associatedSetCode,
      associatedSetName: input.associatedSetName
    }
  });

  return {
    id: binder.id,
    name: binder.name,
    description: binder.description ?? '',
    colorHex: binder.colorHex,
    defaultCondition: binder.defaultCondition ?? undefined,
    containerType: binder.containerType ?? undefined,
    imageUrl: binder.imageUrl ?? undefined,
    associatedTcg: binder.associatedTcg ?? undefined,
    associatedSetCode: binder.associatedSetCode ?? undefined,
    associatedSetName: binder.associatedSetName ?? undefined,
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
      colorHex: input.colorHex ?? binder.colorHex,
      defaultCondition:
        input.defaultCondition === undefined
          ? binder.defaultCondition
          : sanitizeOptionalText(input.defaultCondition),
      containerType:
        input.containerType === undefined ? binder.containerType : input.containerType,
      imageUrl: input.imageUrl === undefined ? binder.imageUrl : input.imageUrl,
      associatedTcg:
        input.associatedTcg === undefined ? binder.associatedTcg : input.associatedTcg,
      associatedSetCode:
        input.associatedSetCode === undefined
          ? binder.associatedSetCode
          : input.associatedSetCode,
      associatedSetName:
        input.associatedSetName === undefined
          ? binder.associatedSetName
          : input.associatedSetName
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
    defaultCondition: updated.defaultCondition ?? undefined,
    containerType: updated.containerType ?? undefined,
    imageUrl: updated.imageUrl ?? undefined,
    associatedTcg: updated.associatedTcg ?? undefined,
    associatedSetCode: updated.associatedSetCode ?? undefined,
    associatedSetName: updated.associatedSetName ?? undefined,
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

  const cardId = input.cardId;
  const copiesToCreate = Math.max(1, input.quantity ?? 1);
  const serialNumber = sanitizeOptionalText(input.serialNumber) ?? undefined;
  const acquiredAt = parseOptionalDate(input.acquiredAt ?? undefined) ?? undefined;
  const condition = input.condition ?? binder.defaultCondition ?? undefined;

  const createdEntries = await prisma.$transaction(async (tx) => {
    await ensureCardForCollection(tx, cardId, input.cardData);
    const created = [] as PrismaCollection[];
    for (let index = 0; index < copiesToCreate; index += 1) {
      const entry = await tx.collection.create({
        data: {
          userId,
          cardId,
          binderId,
          quantity: 1,
          condition,
          language: input.language,
          notes: input.notes,
          price: input.price,
          acquisitionPrice: input.acquisitionPrice,
          isFoil: input.isFoil ?? inferLegacyFoil(input.finishCode) ?? false,
          finishCode: input.finishCode,
          finishLabel: input.finishLabel,
          edition: input.edition,
          stamp: input.stamp,
          isSealedPromo: input.isSealedPromo ?? false,
          isOversized: input.isOversized ?? false,
          isPeelOff: input.isPeelOff ?? false,
          isSigned: input.isSigned ?? false,
          isAltered: input.isAltered ?? false,
          gradingCompany: input.gradingCompany,
          gradingScore: input.gradingScore,
          certNumber: input.certNumber,
          storageLocation: input.storageLocation,
          serialNumber,
          acquiredAt
        }
      });

      if (input.tags?.length || input.newTags?.length) {
        await syncCollectionTags(tx, userId, entry.id, input.tags, input.newTags);
      }

      created.push(entry);
    }
    const after = await snapshotCollectionEntries(
      tx,
      userId,
      created.map((entry) => entry.id)
    );
    await createCollectionAudit(tx, {
      userId,
      operationKind: copiesToCreate > 1 ? 'bulk' : 'add',
      binderId,
      cardName: input.cardData?.name,
      summary:
        copiesToCreate > 1
          ? `Added ${copiesToCreate} collection copies`
          : `Added ${input.cardData?.name ?? 'a card'} to ${binder.name}`,
      before: [],
      after
    });
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
  const cardId = input.cardId;
  const copiesToCreate = Math.max(1, input.quantity ?? 1);
  const serialNumber = sanitizeOptionalText(input.serialNumber) ?? undefined;
  const acquiredAt = parseOptionalDate(input.acquiredAt ?? undefined) ?? undefined;

  const createdEntries = await prisma.$transaction(async (tx) => {
    await ensureCardForCollection(tx, cardId, input.cardData);
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
          isFoil: input.isFoil ?? inferLegacyFoil(input.finishCode) ?? false,
          finishCode: input.finishCode,
          finishLabel: input.finishLabel,
          edition: input.edition,
          stamp: input.stamp,
          isSealedPromo: input.isSealedPromo ?? false,
          isOversized: input.isOversized ?? false,
          isPeelOff: input.isPeelOff ?? false,
          isSigned: input.isSigned ?? false,
          isAltered: input.isAltered ?? false,
          gradingCompany: input.gradingCompany,
          gradingScore: input.gradingScore,
          certNumber: input.certNumber,
          storageLocation: input.storageLocation,
          serialNumber,
          acquiredAt
        }
      });

      if (input.tags?.length || input.newTags?.length) {
        await syncCollectionTags(tx, userId, entry.id, input.tags, input.newTags);
      }

      created.push(entry);
    }
    const after = await snapshotCollectionEntries(
      tx,
      userId,
      created.map((entry) => entry.id)
    );
    await createCollectionAudit(tx, {
      userId,
      operationKind: copiesToCreate > 1 ? 'bulk' : 'add',
      binderId: null,
      cardName: input.cardData?.name,
      summary:
        copiesToCreate > 1
          ? `Added ${copiesToCreate} collection copies to Unsorted`
          : `Added ${input.cardData?.name ?? 'a card'} to Unsorted`,
      before: [],
      after
    });
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

  await prisma.$transaction(async (tx) => {
    const before = await snapshotCollectionEntries(tx, userId, [collectionId]);
    await tx.collection.delete({
      where: { id: collectionId }
    });
    await createCollectionAudit(tx, {
      userId,
      operationKind: 'remove',
      binderId: resolvedBinderId,
      summary: 'Removed a collection copy',
      before,
      after: []
    });
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
  if (input.isFoil !== undefined) {
    updatePayload.isFoil = input.isFoil;
  } else if (input.finishCode !== undefined) {
    updatePayload.isFoil = input.finishCode
      ? inferLegacyFoil(input.finishCode)
      : false;
  }
  const normalizedFinishCode = sanitizeOptionalText(input.finishCode);
  if (normalizedFinishCode !== undefined) {
    updatePayload.finishCode = normalizedFinishCode;
  }
  const normalizedFinishLabel = sanitizeOptionalText(input.finishLabel);
  if (normalizedFinishLabel !== undefined) {
    updatePayload.finishLabel = normalizedFinishLabel;
  }
  const normalizedEdition = sanitizeOptionalText(input.edition);
  if (normalizedEdition !== undefined) {
    updatePayload.edition = normalizedEdition;
  }
  const normalizedStamp = sanitizeOptionalText(input.stamp);
  if (normalizedStamp !== undefined) {
    updatePayload.stamp = normalizedStamp;
  }
  if (input.isSealedPromo !== undefined) {
    updatePayload.isSealedPromo = input.isSealedPromo;
  }
  if (input.isOversized !== undefined) {
    updatePayload.isOversized = input.isOversized;
  }
  if (input.isPeelOff !== undefined) {
    updatePayload.isPeelOff = input.isPeelOff;
  }
  if (input.isSigned !== undefined) {
    updatePayload.isSigned = input.isSigned;
  }
  if (input.isAltered !== undefined) {
    updatePayload.isAltered = input.isAltered;
  }
  const normalizedGradingCompany = sanitizeOptionalText(input.gradingCompany);
  if (normalizedGradingCompany !== undefined) {
    updatePayload.gradingCompany = normalizedGradingCompany;
  }
  const normalizedGradingScore = sanitizeOptionalText(input.gradingScore);
  if (normalizedGradingScore !== undefined) {
    updatePayload.gradingScore = normalizedGradingScore;
  }
  const normalizedCertNumber = sanitizeOptionalText(input.certNumber);
  if (normalizedCertNumber !== undefined) {
    updatePayload.certNumber = normalizedCertNumber;
  }
  const normalizedStorageLocation = sanitizeOptionalText(input.storageLocation);
  if (normalizedStorageLocation !== undefined) {
    updatePayload.storageLocation = normalizedStorageLocation;
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
    const isGroupMutation =
      input.quantity !== undefined ||
      (hasTargetBinder && resolvedTargetBinderId !== resolvedBinderId);
    const desiredScopeCardId = desiredCardId ?? collection.cardId;
    const beforeRows = isGroupMutation
      ? await tx.collection.findMany({
          where: {
            userId,
            OR: [
              {
                binderId: resolvedBinderId,
                cardId: collection.cardId
              },
              {
                binderId: resolvedTargetBinderId ?? null,
                cardId: desiredScopeCardId
              }
            ]
          },
          select: { id: true }
        })
      : [{ id: collectionId }];
    const before = await snapshotCollectionEntries(
      tx,
      userId,
      beforeRows.map((entry) => entry.id)
    );
    const hasFieldUpdates = Object.keys(updatePayload).length > 0;

    if (wantsCardOverride && desiredCardId) {
      const existingTarget = await tx.card.findUnique({ where: { id: desiredCardId } });
      const payload = input.cardOverride?.cardData;
      if (!existingTarget && !payload) {
        throw new Error('Card data is required when selecting a new print.');
      }
      await ensureCardForCollection(tx, desiredCardId, payload);

      await tx.collection.update({
        where: { id: collectionId },
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

    const afterRows = isGroupMutation
      ? await tx.collection.findMany({
          where: {
            userId,
            OR: [
              {
                binderId: resolvedBinderId,
                cardId: collection.cardId
              },
              {
                binderId: destinationBinderId ?? null,
                cardId: workingCollection.cardId
              }
            ]
          },
          select: { id: true }
        })
      : [{ id: collectionId }];
    const after = await snapshotCollectionEntries(
      tx,
      userId,
      afterRows.map((entry) => entry.id)
    );
    const operationKind =
      hasTargetBinder && resolvedTargetBinderId !== resolvedBinderId
        ? 'move'
        : input.quantity !== undefined
          ? 'bulk'
          : 'update';
    await createCollectionAudit(tx, {
      userId,
      operationKind,
      binderId: destinationBinderId,
      cardName: workingCollection.card.name,
      summary:
        operationKind === 'move'
          ? `Moved ${workingCollection.card.name}`
          : operationKind === 'bulk'
            ? `Updated copies of ${workingCollection.card.name}`
            : `Updated ${workingCollection.card.name}`,
      before,
      after
    });

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

export async function addImageToCollection(
  userId: string,
  collectionId: string,
  imagePublicPath: string
) {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId }
  });

  if (!collection) {
    throw new Error('Collection entry not found');
  }

  const updated = await prisma.collection.update({
    where: { id: collectionId },
    data: {
      imageUrls: {
        push: imagePublicPath
      }
    }
  });

  return updated.imageUrls;
}

export async function removeImageFromCollection(
  userId: string,
  collectionId: string,
  imageIndex: number
) {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId }
  });

  if (!collection) {
    throw new Error('Collection entry not found');
  }

  const urls = [...collection.imageUrls];
  if (imageIndex < 0 || imageIndex >= urls.length) {
    throw new Error('Image index out of range');
  }

  const removedUrl = urls.splice(imageIndex, 1)[0];

  await prisma.collection.update({
    where: { id: collectionId },
    data: { imageUrls: urls }
  });

  return removedUrl;
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
