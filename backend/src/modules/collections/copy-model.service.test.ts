import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { legacyCopyAddresses, normalizeLegacyCopies, normalizeLegacyCopy, resolvePhysicalCopyId } from './copy-model.service';

jest.mock('../../lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));

type Row = { id: string; userId: string; binderId: string; quantity: number; [key: string]: any };
function database(entries: Row[], links: any[] = []) {
  const rows = new Map(entries.map(row => [row.id, { ...row }]));
  const opened = new Map(links.map(link => [link.id, { ...link }]));
  const tx = {
    collection: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = rows.get(where.id);
        if (!row || row.userId !== where.userId || (where.binderId !== undefined && row.binderId !== where.binderId)) return null;
        return { ...row, tags: row.tags ?? [], sealedOpeningLinks: [...opened.values()].filter(link => link.collectionId === row.id) };
      }),
      findMany: jest.fn(async ({ where, take }: any) => [...rows.values()].filter(row => row.userId === where.userId && row.quantity !== 1).slice(0, take)),
      count: jest.fn(async ({ where }: any) => [...rows.values()].filter(row => row.userId === where.userId && row.quantity !== 1).length),
      create: jest.fn(async ({ data }: any) => {
        if (rows.has(data.id)) throw new Error('Duplicate stable copy ID');
        const row = { ...data, tags: data.tags?.create ?? [] };
        rows.set(row.id, row); return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row;
      }),
    },
    sealedOpenedCard: {
      create: jest.fn(async ({ data }: any) => { const row = { ...data, id: `link-${opened.size}` }; opened.set(row.id, row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...opened.get(where.id), ...data }; opened.set(where.id, row); return row; }),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, rows, opened, calls: tx };
}
const legacy = { id: 'legacy', userId: 'owner', binderId: 'binder', quantity: 3, notes: 'keep', imageUrls: ['/photo.webp'], acquisitionPrice: 9, acquisitionCurrency: 'CAD', customAttributes: { review: 'approved' }, tags: [{ tagId: 'tag' }] };

describe('legacy physical-copy normalization', () => {
  test('preserves metadata and exact total sealed proceeds across three copies', async () => {
    const db = database([legacy], [{ id: 'opened', collectionId: legacy.id, openingId: 'opening', quantity: 3, realizedProceeds: 10, status: 'sold' }]);
    const ids = await normalizeLegacyCopy(db.tx, 'owner', legacy.id);
    expect(ids).toHaveLength(3); expect(ids[0]).toBe(legacy.id);
    expect(new Set(ids).size).toBe(3);
    for (const row of db.rows.values()) expect(row).toMatchObject({ quantity: 1, notes: 'keep', imageUrls: ['/photo.webp'], acquisitionPrice: 9, acquisitionCurrency: 'CAD', customAttributes: { review: 'approved' }, tags: [{ tagId: 'tag' }] });
    expect([...db.opened.values()].map(row => row.realizedProceeds).sort()).toEqual([3.33, 3.33, 3.34]);
    expect([...db.opened.values()].reduce((sum, row) => sum + Math.round(row.realizedProceeds * 100), 0)).toBe(1000);
    expect([...db.opened.values()].every(row => row.quantity === 1)).toBe(true);
  });
  test('an old virtual address remains stable after normalization and deleting the first copy', async () => {
    const db = database([legacy]);
    const second = await resolvePhysicalCopyId(db.tx, 'owner', 'legacy#2', 'binder');
    expect(second).not.toBe('legacy');
    expect(await resolvePhysicalCopyId(db.tx, 'owner', 'legacy#2', 'binder')).toBe(second);
    db.rows.delete('legacy');
    expect(await resolvePhysicalCopyId(db.tx, 'owner', 'legacy#2', 'binder')).toBe(second);
    await expect(resolvePhysicalCopyId(db.tx, 'other', 'legacy#2', 'binder')).rejects.toThrow('Collection entry not found');
    await expect(resolvePhysicalCopyId(db.tx, 'owner', 'legacy#2', 'different-binder')).rejects.toThrow('Collection entry not found');
  });
  test('preview defaults never write and the next batch stays within 500 physical copies', async () => {
    const db = database([{ ...legacy, quantity: 300 }, { ...legacy, id: 'second', quantity: 300 }]);
    (prisma.$transaction as jest.Mock).mockImplementationOnce((run: (tx: Prisma.TransactionClient) => unknown) => run(db.tx));
    const preview = await normalizeLegacyCopies('owner');
    expect(preview).toMatchObject({ dryRun: true, normalizedRows: 1, createdCopies: 299, remaining: true });
    expect(preview.entryIds).toHaveLength(300);
    expect(db.calls.collection.create).not.toHaveBeenCalled();
    expect(db.calls.collection.update).not.toHaveBeenCalled();
  });
  test('invalid quantities and conflicting sealed ledger quantities fail before writes', async () => {
    expect(() => legacyCopyAddresses('row', 501)).toThrow(/between 1 and 500/);
    const db = database([legacy], [{ id: 'opened', collectionId: legacy.id, quantity: 2, realizedProceeds: 10 }]);
    await expect(normalizeLegacyCopy(db.tx, 'owner', legacy.id)).rejects.toThrow(/does not match/);
    expect(db.calls.collection.create).not.toHaveBeenCalled();
    expect(db.calls.collection.update).not.toHaveBeenCalled();
  });
});
