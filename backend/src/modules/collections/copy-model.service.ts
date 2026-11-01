import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';

export const MAX_NORMALIZATION_COPIES = 500;

function normalizationConflict(message: string) {
  return Object.assign(new Error(message), { status: 409, code: 'COPY_NORMALIZATION_REQUIRED' });
}

function requireLegacyQuantity(quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_NORMALIZATION_COPIES) {
    throw normalizationConflict(`Legacy copy quantity must be between 1 and ${MAX_NORMALIZATION_COPIES} before normalization.`);
  }
}

/** These temporary read addresses select a particular physical copy. Reads do
 * not migrate data. Every mutation resolves them within its transaction. */
export function legacyCopyAddresses(copyId: string, quantity: number): string[] {
  requireLegacyQuantity(quantity);
  return Array.from({ length: quantity }, (_, index) => index === 0 ? copyId : `${copyId}#${index + 1}`);
}

/** Deterministic UUIDv8 lineage keeps old id#ordinal addresses resolvable even
 * after migration, moving the copy, or deleting the original first copy. */
function normalizedCopyId(sourceId: string, ordinal: number) {
  const hash = createHash('sha256').update(`tcger:physical-copy:v1\0${sourceId}\0${ordinal}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${((parseInt(hash[16], 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Expand a legacy quantity row without replacing its first physical-copy ID.
 * Call within the same serializable transaction as the operation using it. */
export async function normalizeLegacyCopy(tx: Prisma.TransactionClient, userId: string, copyId: string): Promise<string[]> {
  const entry = await tx.collection.findFirst({
    where: { id: copyId, userId }, include: { tags: true, sealedOpeningLinks: true },
  });
  if (!entry) throw new Error('Collection entry not found');
  requireLegacyQuantity(entry.quantity);
  if (entry.quantity === 1) return [entry.id];
  if (entry.sealedOpeningLinks.some((link) => link.quantity !== entry.quantity)) {
    throw normalizationConflict('The sealed-opening quantity does not match this legacy row. Review its ledger before normalization.');
  }
  const { id, tags, sealedOpeningLinks, ...scalars } = entry;
  const ids = [id];
  const proceeds = (link: typeof sealedOpeningLinks[number], index: number) => {
    if (link.realizedProceeds === null) return null;
    const cents = Math.round(Number(link.realizedProceeds) * 100);
    return (Math.floor(cents / entry.quantity) + (index < cents % entry.quantity ? 1 : 0)) / 100;
  };
  for (let index = 1; index < entry.quantity; index++) {
    const copy = await tx.collection.create({ data: {
      ...scalars, id: normalizedCopyId(id, index + 1), quantity: 1,
      customAttributes: scalars.customAttributes == null ? undefined : scalars.customAttributes as Prisma.InputJsonValue,
      tags: { create: tags.map(({ tagId }) => ({ tagId })) },
    } });
    ids.push(copy.id);
    for (const link of sealedOpeningLinks) {
      const { id: _linkId, collectionId: _collectionId, ...linkFields } = link;
      await tx.sealedOpenedCard.create({ data: {
        ...linkFields, collectionId: copy.id, quantity: 1, realizedProceeds: proceeds(link, index),
      } });
    }
  }
  await tx.collection.update({ where: { id }, data: { quantity: 1 } });
  for (const link of sealedOpeningLinks) {
    await tx.sealedOpenedCard.update({ where: { id: link.id }, data: { quantity: 1, realizedProceeds: proceeds(link, 0) } });
  }
  return ids;
}

/** Resolve a legacy virtual address before applying copy-level changes. The
 * ownership and optional binder check apply to the resolved copy, too. */
export async function resolvePhysicalCopyId(tx: Prisma.TransactionClient, userId: string, address: string, binderId?: string | null) {
  const match = /^(.*)#([1-9][0-9]*)$/.exec(address);
  const sourceId = match ? match[1] : address;
  const ordinal = match ? Number(match[2]) : 1;
  if (!Number.isSafeInteger(ordinal) || ordinal > MAX_NORMALIZATION_COPIES) throw new Error('Collection entry not found');
  const source = await tx.collection.findFirst({ where: { id: sourceId, userId } });
  if (source && source.quantity !== 1) {
    if (binderId !== undefined && source.binderId !== binderId) throw new Error('Collection entry not found');
    await normalizeLegacyCopy(tx, userId, sourceId);
  }
  const id = ordinal === 1 ? sourceId : normalizedCopyId(sourceId, ordinal);
  const copy = await tx.collection.findFirst({ where: { id, userId, ...(binderId === undefined ? {} : { binderId }) } });
  if (!copy) throw new Error('Collection entry not found');
  return id;
}

/** Preview or commit a bounded batch; no batch may materialize more than 500
 * physical copies. Repeat after each successful commit while remaining > 0. */
export async function normalizeLegacyCopies(userId: string, dryRun = true, limit = 10) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.collection.findMany({ where: { userId, quantity: { not: 1 } }, orderBy: { id: 'asc' }, take: Math.min(100, Math.max(1, limit)) });
    const entries = [] as { entryId: string; quantity: number; entryIds: string[] }[];
    let physicalCopies = 0;
    for (const row of rows) {
      requireLegacyQuantity(row.quantity);
      if (physicalCopies + row.quantity > MAX_NORMALIZATION_COPIES) break;
      entries.push({ entryId: row.id, quantity: row.quantity, entryIds: dryRun ? legacyCopyAddresses(row.id, row.quantity) : await normalizeLegacyCopy(tx, userId, row.id) });
      physicalCopies += row.quantity;
    }
    const remaining = await tx.collection.count({ where: { userId, quantity: { not: 1 } } });
    return {
      dryRun, normalizedRows: entries.length,
      createdCopies: entries.reduce((sum, entry) => sum + entry.quantity - 1, 0),
      entryIds: entries.flatMap(entry => entry.entryIds), remaining: remaining > 0,
    };
  }, { isolationLevel: 'Serializable', timeout: 30_000 });
}
