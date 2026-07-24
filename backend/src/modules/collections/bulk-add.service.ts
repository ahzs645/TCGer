import type { Prisma } from '@prisma/client';
import type {
  BulkAddCopyFields,
  BulkAddIssue,
  BulkAddPreview,
  BulkAddRequest,
  BulkAddResult,
  CardDataPayload,
  TcgCode
} from '@tcg/api-types';

import { prisma } from '../../lib/prisma';
import {
  ensureCardForCollection,
  syncCollectionTags,
  UNSORTED_BINDER_ID
} from './collections.service';
import {
  createCollectionAudit,
  snapshotCollectionEntries
} from './collection-audit.service';

type ResolvedBulkAddRow = BulkAddCopyFields & {
  rowId: string;
  cardId: string;
  cardData: CardDataPayload;
  binderId: string;
  quantity: number;
};

type BinderTarget = { id: string; name: string };
type ExistingCardIdentity = { id: string; printingKey: string | null };

export class BulkAddValidationError extends Error {
  constructor(readonly issues: BulkAddIssue[]) {
    super(issues[0]?.message ?? 'Bulk Add failed validation');
    this.name = 'BulkAddValidationError';
  }
}

export function resolveBulkAddRows(input: BulkAddRequest): ResolvedBulkAddRow[] {
  const defaults = input.defaults ?? {};
  return input.rows.map((row) => {
    const { binderId: defaultBinderId, quantity: defaultQuantity, ...copyDefaults } = defaults;
    return {
      ...copyDefaults,
      ...(row.overrides ?? {}),
      rowId: row.rowId,
      cardId: row.cardId,
      cardData: row.cardData,
      binderId: row.binderId ?? defaultBinderId ?? '',
      quantity: row.quantity ?? defaultQuantity ?? 1
    };
  });
}

export function buildBulkAddPreview(
  input: BulkAddRequest,
  binders: BinderTarget[],
  existingCards: ExistingCardIdentity[] = []
): BulkAddPreview {
  const rows = resolveBulkAddRows(input);
  const binderById = new Map(binders.map((binder) => [binder.id, binder]));
  const cardById = new Map(existingCards.map((card) => [card.id, card]));
  const issues: BulkAddIssue[] = [];

  for (const row of rows) {
    if (row.binderId !== UNSORTED_BINDER_ID && !binderById.has(row.binderId)) {
      issues.push({
        rowId: row.rowId,
        field: 'binderId',
        message: 'Destination binder was not found'
      });
    }
    if (!isTcgCode(row.cardData.tcg)) {
      issues.push({
        rowId: row.rowId,
        field: 'cardData.tcg',
        message: 'TCG must be yugioh, magic, or pokemon'
      });
    }
    const existing = cardById.get(row.cardId);
    if (
      existing?.printingKey &&
      row.cardData.printingKey &&
      existing.printingKey !== row.cardData.printingKey
    ) {
      issues.push({
        rowId: row.rowId,
        field: 'cardData.printingKey',
        message: 'Printing snapshot does not match the stored card'
      });
    }
  }

  return {
    valid: issues.length === 0,
    rows: rows.map((row) => ({
      rowId: row.rowId,
      valid: !issues.some((issue) => issue.rowId === row.rowId),
      cardId: row.cardId,
      name: row.cardData.name,
      tcg: row.cardData.tcg as TcgCode,
      setCode: row.cardData.setCode,
      rarity: row.cardData.rarity,
      binderId: row.binderId,
      binderName:
        row.binderId === UNSORTED_BINDER_ID
          ? 'Unsorted'
          : binderById.get(row.binderId)?.name,
      quantity: row.quantity,
      condition: row.condition,
      language: row.language,
      finishCode: row.finishCode,
      edition: row.edition
    })),
    issues,
    totalRows: rows.length,
    totalCopies: rows.reduce((total, row) => total + row.quantity, 0)
  };
}

export async function previewBulkAdd(
  userId: string,
  input: BulkAddRequest
): Promise<BulkAddPreview> {
  const rows = resolveBulkAddRows(input);
  const binderIds = uniqueBinderIds(rows);
  const cardIds = [...new Set(rows.map((row) => row.cardId))];
  const [binders, cards] = await Promise.all([
    prisma.binder.findMany({
      where: { userId, id: { in: binderIds } },
      select: { id: true, name: true }
    }),
    prisma.card.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, printingKey: true }
    })
  ]);
  return buildBulkAddPreview(input, binders, cards);
}

export async function commitBulkAdd(
  userId: string,
  input: BulkAddRequest
): Promise<BulkAddResult> {
  const rows = resolveBulkAddRows(input);

  return prisma.$transaction(async (tx) => {
    const binderIds = uniqueBinderIds(rows);
    const cardIds = [...new Set(rows.map((row) => row.cardId))];
    const [binders, cards] = await Promise.all([
      tx.binder.findMany({
        where: { userId, id: { in: binderIds } },
        select: { id: true, name: true }
      }),
      tx.card.findMany({
        where: { id: { in: cardIds } },
        select: { id: true, printingKey: true }
      })
    ]);
    const preview = buildBulkAddPreview(input, binders, cards);
    if (!preview.valid) {
      throw new BulkAddValidationError(preview.issues);
    }

    const entryIds: string[] = [];
    for (const row of rows) {
      await ensureCardForCollection(tx, row.cardId, row.cardData);
      for (let index = 0; index < row.quantity; index += 1) {
        const entry = await tx.collection.create({
          data: buildCollectionCreateInput(userId, row)
        });
        await syncCollectionTags(
          tx,
          userId,
          entry.id,
          row.tags,
          row.newTags
        );
        entryIds.push(entry.id);
      }
    }

    if (binderIds.length) {
      await tx.binder.updateMany({
        where: { userId, id: { in: binderIds } },
        data: { updatedAt: new Date() }
      });
    }

    const after = await snapshotCollectionEntries(tx, userId, entryIds);
    await createCollectionAudit(tx, {
      userId,
      operationKind: 'bulk',
      summary: `Added ${entryIds.length} collection copies`,
      before: [],
      after,
      metadata: {
        stagedRows: rows.length,
        binderIds
      }
    });

    return {
      addedRows: rows.length,
      addedCopies: entryIds.length,
      entryIds
    };
  });
}

function buildCollectionCreateInput(
  userId: string,
  row: ResolvedBulkAddRow
): Prisma.CollectionUncheckedCreateInput {
  return {
    userId,
    cardId: row.cardId,
    binderId: row.binderId === UNSORTED_BINDER_ID ? null : row.binderId,
    quantity: 1,
    condition: row.condition,
    language: row.language,
    notes: row.notes,
    price: row.price,
    acquisitionPrice: row.acquisitionPrice,
    serialNumber: row.serialNumber,
    acquiredAt: row.acquiredAt ? new Date(row.acquiredAt) : undefined,
    isFoil: row.isFoil ?? inferFoil(row.finishCode) ?? false,
    finishCode: row.finishCode,
    finishLabel: row.finishLabel,
    edition: row.edition,
    stamp: row.stamp,
    isSealedPromo: row.isSealedPromo ?? false,
    isOversized: row.isOversized ?? false,
    isPeelOff: row.isPeelOff ?? false,
    isSigned: row.isSigned ?? false,
    isAltered: row.isAltered ?? false
  };
}

function uniqueBinderIds(rows: ResolvedBulkAddRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.binderId)
        .filter((binderId) => binderId && binderId !== UNSORTED_BINDER_ID)
    )
  ];
}

function isTcgCode(value: string): value is TcgCode {
  return value === 'yugioh' || value === 'magic' || value === 'pokemon';
}

function inferFoil(finishCode?: string) {
  if (!finishCode) {
    return undefined;
  }
  return !['normal', 'nonfoil', 'non-foil', 'standard'].includes(
    finishCode.trim().toLowerCase()
  );
}
