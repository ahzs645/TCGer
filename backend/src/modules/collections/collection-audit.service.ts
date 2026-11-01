import type { Prisma } from '@prisma/client';
import type {
  CollectionMutationAuditEntry,
  CollectionMutationKind,
  UndoCollectionMutationResult
} from '@tcg/api-types';

import { prisma } from '../../lib/prisma';

export interface CollectionEntryAuditSnapshot {
  id: string;
  userId: string;
  cardId: string;
  binderId: string | null;
  quantity: number;
  condition: string | null;
  language: string | null;
  notes: string | null;
  price: number | null;
  acquisitionPrice: number | null;
  acquisitionCurrency?: string | null;
  isFoil: boolean;
  finishCode: string | null;
  finishLabel: string | null;
  edition: string | null;
  stamp: string | null;
  isSealedPromo: boolean;
  isOversized: boolean;
  isPeelOff: boolean;
  isSigned: boolean;
  isAltered: boolean;
  imageUrls: string[];
  customAttributes: Prisma.JsonValue | null;
  serialNumber: string | null;
  acquiredAt: string | null;
  gradingCompany: string | null;
  gradingScore: string | null;
  certNumber: string | null;
  storageLocation: string | null;
  tagIds: string[];
  sealedOpeningLinks?: Array<{ id: string; openingId: string; quantity: number; status: string; realizedProceeds: number | null; soldAt: string | null }>;
  linkedPurchases?: Array<{ id: string; amount: number; currency: string; date: string }>;
}

interface CollectionAuditState {
  entries: CollectionEntryAuditSnapshot[];
}

export class CollectionAuditError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST',
    message: string
  ) {
    super(message);
  }
}

function asAuditState(value: Prisma.JsonValue): CollectionAuditState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CollectionAuditError('CONFLICT', 'Audit snapshot is invalid.');
  }
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new CollectionAuditError('CONFLICT', 'Audit snapshot is invalid.');
  }
  return { entries: entries as CollectionEntryAuditSnapshot[] };
}

function stateJson(entries: CollectionEntryAuditSnapshot[]): Prisma.InputJsonValue {
  return {
    entries: [...entries].sort((left, right) => left.id.localeCompare(right.id))
  } as unknown as Prisma.InputJsonValue;
}

function comparableState(entries: CollectionEntryAuditSnapshot[]) {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]));
    }
    return value;
  };
  // Pre-currency audit records legitimately omit the new nullable field. Treat
  // that as unknown currency, while still detecting actual acquisition changes.
  const normalized = entries.map(entry => ({ ...entry, acquisitionCurrency: entry.acquisitionCurrency ?? null,
    sealedOpeningLinks: entry.sealedOpeningLinks ?? [], linkedPurchases: entry.linkedPurchases ?? [] }));
  return JSON.stringify(canonicalize(stateJson(normalized)));
}

export async function snapshotCollectionEntries(
  tx: Prisma.TransactionClient,
  userId: string,
  entryIds: string[]
): Promise<CollectionEntryAuditSnapshot[]> {
  if (!entryIds.length) return [];
  const entries = await tx.collection.findMany({
    where: {
      userId,
      id: { in: Array.from(new Set(entryIds)) }
    },
    include: {
      tags: {
        select: {
          tagId: true
        }
      },
      sealedOpeningLinks: { orderBy: { id: 'asc' } }
    },
    orderBy: {
      id: 'asc'
    }
  });
  const purchases = await tx.transaction.findMany({
    where: { userId, type: 'purchase', collectionEntryId: { in: entryIds } },
    orderBy: { id: 'asc' },
  });

  return entries.map((entry) => ({
    id: entry.id,
    userId: entry.userId,
    cardId: entry.cardId,
    binderId: entry.binderId,
    quantity: entry.quantity,
    condition: entry.condition,
    language: entry.language,
    notes: entry.notes,
    price: entry.price === null ? null : Number(entry.price),
    acquisitionPrice:
      entry.acquisitionPrice === null ? null : Number(entry.acquisitionPrice),
    acquisitionCurrency: entry.acquisitionCurrency ?? null,
    isFoil: entry.isFoil,
    finishCode: entry.finishCode,
    finishLabel: entry.finishLabel,
    edition: entry.edition,
    stamp: entry.stamp,
    isSealedPromo: entry.isSealedPromo,
    isOversized: entry.isOversized,
    isPeelOff: entry.isPeelOff,
    isSigned: entry.isSigned,
    isAltered: entry.isAltered,
    imageUrls: entry.imageUrls,
    customAttributes: entry.customAttributes,
    serialNumber: entry.serialNumber,
    acquiredAt: entry.acquiredAt?.toISOString() ?? null,
    gradingCompany: entry.gradingCompany,
    gradingScore: entry.gradingScore,
    certNumber: entry.certNumber,
    storageLocation: entry.storageLocation,
    tagIds: entry.tags.map((tag) => tag.tagId).sort(),
    sealedOpeningLinks: entry.sealedOpeningLinks.map(link => ({ id: link.id, openingId: link.openingId,
      quantity: link.quantity, status: link.status, realizedProceeds: link.realizedProceeds === null ? null : Number(link.realizedProceeds),
      soldAt: link.soldAt?.toISOString() ?? null })),
    linkedPurchases: purchases.filter(purchase => purchase.collectionEntryId === entry.id).map(purchase => ({
      id: purchase.id, amount: Number(purchase.amount), currency: purchase.currency, date: purchase.date.toISOString(),
    })),
  }));
}

export async function createCollectionAudit(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    actorId?: string;
    operationKind: CollectionMutationKind;
    binderId?: string | null;
    cardName?: string | null;
    summary: string;
    before: CollectionEntryAuditSnapshot[];
    after: CollectionEntryAuditSnapshot[];
    metadata?: Prisma.InputJsonValue;
    sourceAuditId?: string;
    idempotencyKey?: string;
  }
) {
  const affectedIds = new Set([
    ...input.before.map((entry) => entry.id),
    ...input.after.map((entry) => entry.id)
  ]);
  return tx.collectionMutationAudit.create({
    data: {
      userId: input.userId,
      actorId: input.actorId ?? input.userId,
      operationKind: input.operationKind,
      binderId: input.binderId ?? null,
      cardName: input.cardName ?? null,
      affectedCopies: affectedIds.size,
      summary: input.summary,
      beforeState: stateJson(input.before),
      afterState: stateJson(input.after),
      metadata: input.metadata,
      sourceAuditId: input.sourceAuditId,
      idempotencyKey: input.idempotencyKey
    }
  });
}

function mapAudit(
  audit: {
    id: string;
    operationKind: string;
    actorId: string;
    affectedCopies: number;
    binderId: string | null;
    cardName: string | null;
    summary: string;
    sourceAuditId: string | null;
    createdAt: Date;
  },
  canUndo: boolean
): CollectionMutationAuditEntry {
  return {
    id: audit.id,
    operationKind: audit.operationKind as CollectionMutationKind,
    actorId: audit.actorId,
    affectedCopies: audit.affectedCopies,
    binderId: audit.binderId ?? undefined,
    cardName: audit.cardName ?? undefined,
    summary: audit.summary,
    sourceAuditId: audit.sourceAuditId ?? undefined,
    canUndo,
    createdAt: audit.createdAt.toISOString()
  };
}

export async function getCollectionMutationHistory(
  userId: string,
  limit: number
): Promise<{ entries: CollectionMutationAuditEntry[] }> {
  const entries = await prisma.collectionMutationAudit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit))
  });
  const sourceIds = entries.map((entry) => entry.id);
  const undoRows = sourceIds.length
    ? await prisma.collectionMutationAudit.findMany({
        where: {
          userId,
          sourceAuditId: { in: sourceIds }
        },
        select: {
          sourceAuditId: true
        }
      })
    : [];
  const undone = new Set(
    undoRows
      .map((entry) => entry.sourceAuditId)
      .filter((value): value is string => Boolean(value))
  );

  return {
    entries: entries.map((entry) =>
      mapAudit(
        entry,
        !['undo', 'normalization'].includes(entry.operationKind) && !undone.has(entry.id)
      )
    )
  };
}

async function validateRestoreReferences(
  tx: Prisma.TransactionClient,
  userId: string,
  entries: CollectionEntryAuditSnapshot[]
) {
  const cardIds = Array.from(new Set(entries.map((entry) => entry.cardId)));
  const binderIds = Array.from(
    new Set(
      entries
        .map((entry) => entry.binderId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const tagIds = Array.from(new Set(entries.flatMap((entry) => entry.tagIds)));

  const [cardCount, binderCount, tagCount] = await Promise.all([
    tx.card.count({ where: { id: { in: cardIds } } }),
    tx.binder.count({ where: { id: { in: binderIds }, userId } }),
    tx.tag.count({ where: { id: { in: tagIds }, userId } })
  ]);
  if (
    cardCount !== cardIds.length ||
    binderCount !== binderIds.length ||
    tagCount !== tagIds.length
  ) {
    throw new CollectionAuditError(
      'CONFLICT',
      'Undo cannot be applied because a referenced card, binder, or tag no longer exists.'
    );
  }
  for (const entry of entries) {
    const currentPurchases = await tx.transaction.findMany({
      where: { userId, type: 'purchase', collectionEntryId: entry.id }, orderBy: { id: 'asc' },
    });
    const actual = currentPurchases.map(purchase => ({ id: purchase.id, amount: Number(purchase.amount), currency: purchase.currency, date: purchase.date.toISOString() }));
    const expectedPurchases = entry.linkedPurchases ?? [];
    if (actual.length !== expectedPurchases.length || actual.some(purchase => !expectedPurchases.some(expected =>
      expected.id === purchase.id && expected.amount === purchase.amount && expected.currency === purchase.currency && expected.date === purchase.date))) {
      throw new CollectionAuditError('CONFLICT', 'Undo cannot restore acquisition details because the linked purchase ledger changed.');
    }
    for (const expected of entry.sealedOpeningLinks ?? []) {
      const link = await tx.sealedOpenedCard.findFirst({ where: { id: expected.id, opening: { userId } } });
      if (!link || (link.collectionId !== null && link.collectionId !== entry.id) ||
        link.openingId !== expected.openingId || link.quantity !== expected.quantity || link.status !== expected.status ||
        (link.realizedProceeds === null ? null : Number(link.realizedProceeds)) !== expected.realizedProceeds ||
        (link.soldAt?.toISOString() ?? null) !== expected.soldAt) {
        throw new CollectionAuditError('CONFLICT', 'Undo cannot restore a sealed-opening link that was removed, reassigned, or financially changed.');
      }
    }
  }
}

async function restoreSnapshots(
  tx: Prisma.TransactionClient,
  userId: string,
  before: CollectionEntryAuditSnapshot[],
  currentIds: string[]
) {
  await validateRestoreReferences(tx, userId, before);
  if (currentIds.length) {
    await tx.collection.deleteMany({
      where: {
        userId,
        id: { in: currentIds }
      }
    });
  }

  for (const entry of before) {
    await tx.collection.create({
      data: {
        id: entry.id,
        userId,
        cardId: entry.cardId,
        binderId: entry.binderId,
        quantity: entry.quantity,
        condition: entry.condition,
        language: entry.language,
        notes: entry.notes,
        price: entry.price,
        acquisitionPrice: entry.acquisitionPrice,
        acquisitionCurrency: entry.acquisitionCurrency ?? null,
        isFoil: entry.isFoil,
        finishCode: entry.finishCode,
        finishLabel: entry.finishLabel,
        edition: entry.edition,
        stamp: entry.stamp,
        isSealedPromo: entry.isSealedPromo,
        isOversized: entry.isOversized,
        isPeelOff: entry.isPeelOff,
        isSigned: entry.isSigned,
        isAltered: entry.isAltered,
        imageUrls: entry.imageUrls,
        customAttributes: entry.customAttributes ?? undefined,
        serialNumber: entry.serialNumber,
        acquiredAt: entry.acquiredAt ? new Date(entry.acquiredAt) : null,
        gradingCompany: entry.gradingCompany,
        gradingScore: entry.gradingScore,
        certNumber: entry.certNumber,
        storageLocation: entry.storageLocation
      }
    });
    if (entry.tagIds.length) {
      await tx.collectionTag.createMany({
        data: entry.tagIds.map((tagId) => ({
          collectionId: entry.id,
          tagId
        }))
      });
    }
    for (const link of entry.sealedOpeningLinks ?? []) {
      const restored = await tx.sealedOpenedCard.updateMany({
        where: { id: link.id, collectionId: null, opening: { userId } }, data: { collectionId: entry.id },
      });
      if (restored.count !== 1) throw new CollectionAuditError('CONFLICT', 'The sealed-opening link changed during undo.');
    }
  }
}

export async function undoCollectionMutation(
  userId: string,
  auditId: string,
  idempotencyKey: string
): Promise<UndoCollectionMutationResult> {
  return prisma.$transaction(async (tx) => {
    const idempotent = await tx.collectionMutationAudit.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey
        }
      }
    });
    if (idempotent) {
      if (idempotent.sourceAuditId !== auditId) {
        throw new CollectionAuditError(
          'CONFLICT',
          'This idempotency key was already used for another undo.'
        );
      }
      return { audit: mapAudit(idempotent, false) };
    }

    const source = await tx.collectionMutationAudit.findFirst({
      where: {
        id: auditId,
        userId
      }
    });
    if (!source) {
      throw new CollectionAuditError('NOT_FOUND', 'Collection history entry not found.');
    }
    if (['undo', 'normalization'].includes(source.operationKind)) {
      throw new CollectionAuditError('BAD_REQUEST', 'Undo and physical-copy normalization records cannot be undone.');
    }
    const existingUndo = await tx.collectionMutationAudit.findUnique({
      where: { sourceAuditId: source.id }
    });
    if (existingUndo) {
      throw new CollectionAuditError('CONFLICT', 'This mutation has already been undone.');
    }

    const before = asAuditState(source.beforeState).entries;
    const expected = asAuditState(source.afterState).entries;
    const affectedIds = Array.from(
      new Set([
        ...before.map((entry) => entry.id),
        ...expected.map((entry) => entry.id)
      ])
    );
    const current = await snapshotCollectionEntries(tx, userId, affectedIds);
    if (comparableState(current) !== comparableState(expected)) {
      throw new CollectionAuditError(
        'CONFLICT',
        'Undo was not applied because the affected collection copies have changed.'
      );
    }

    await restoreSnapshots(tx, userId, before, affectedIds);
    const undo = await createCollectionAudit(tx, {
      userId,
      operationKind: 'undo',
      binderId: source.binderId,
      cardName: source.cardName,
      summary: `Undid: ${source.summary}`,
      before: current,
      after: before,
      sourceAuditId: source.id,
      idempotencyKey,
      metadata: {
        sourceOperationKind: source.operationKind
      }
    });

    return { audit: mapAudit(undo, false) };
  }, { isolationLevel: 'Serializable' });
}
