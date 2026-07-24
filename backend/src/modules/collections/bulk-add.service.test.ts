jest.mock('../../lib/prisma', () => ({
  prisma: {
    binder: { findMany: jest.fn() },
    card: { findMany: jest.fn() },
    $transaction: jest.fn()
  }
}));

jest.mock('./collections.service', () => ({
  UNSORTED_BINDER_ID: '__library__',
  ensureCardForCollection: jest.fn(),
  syncCollectionTags: jest.fn()
}));

jest.mock('./collection-audit.service', () => ({
  createCollectionAudit: jest.fn(),
  snapshotCollectionEntries: jest.fn()
}));

import { bulkAddRequestSchema, type BulkAddRequest } from '@tcg/api-types';
import { prisma } from '../../lib/prisma';
import {
  ensureCardForCollection,
  syncCollectionTags
} from './collections.service';
import {
  buildBulkAddPreview,
  commitBulkAdd
} from './bulk-add.service';

const CARD = {
  name: 'Dark Magician',
  tcg: 'yugioh',
  externalId: 'yugioh:print:v1:46986414:LOB-EN005:ultra:46986414',
  baseExternalId: '46986414',
  printingKey: 'yugioh:print:v1:46986414:LOB-EN005:ultra:46986414',
  artworkId: '46986414',
  setCode: 'LOB-EN005',
  rarity: 'Ultra Rare',
  collectorNumber: '005'
};

describe('Bulk Add validation and atomicity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('merges defaults and per-row overrides into a validation preview', () => {
    const request = bulkAddRequestSchema.parse({
      defaults: {
        binderId: 'binder-1',
        quantity: 2,
        condition: 'NM',
        language: 'EN'
      },
      rows: [
        {
          rowId: 'lob',
          cardId: CARD.externalId,
          cardData: CARD,
          overrides: { condition: 'LP', edition: '1st Edition' }
        }
      ]
    });

    const preview = buildBulkAddPreview(
      request,
      [{ id: 'binder-1', name: 'Main Binder' }]
    );

    expect(preview).toMatchObject({
      valid: true,
      totalRows: 1,
      totalCopies: 2,
      rows: [
        {
          rowId: 'lob',
          binderName: 'Main Binder',
          quantity: 2,
          condition: 'LP',
          language: 'EN',
          edition: '1st Edition'
        }
      ]
    });
  });

  it('rejects duplicate row IDs, missing destinations, and repeated serials', () => {
    const parsed = bulkAddRequestSchema.safeParse({
      defaults: { quantity: 2, serialNumber: 'CERT-1' },
      rows: [
        { rowId: 'duplicate', cardId: CARD.externalId, cardData: CARD },
        { rowId: 'duplicate', cardId: CARD.externalId, cardData: CARD }
      ]
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'Row IDs must be unique',
          'Serialized copies must be staged as individual rows',
          'A destination binder is required'
        ])
      );
    }
  });

  it('does not commit earlier copies when a later row throws', async () => {
    const request: BulkAddRequest = bulkAddRequestSchema.parse({
      defaults: { binderId: 'binder-1' },
      rows: [
        { rowId: 'first', cardId: CARD.externalId, cardData: CARD },
        {
          rowId: 'second',
          cardId: 'second-print',
          cardData: {
            ...CARD,
            externalId: 'second-print',
            printingKey: 'yugioh:second-print'
          },
          overrides: { newTags: [{ label: 'invalid later tag' }] }
        }
      ]
    });
    const committedEntries: string[] = [];
    let sequence = 0;
    const transaction = prisma.$transaction as jest.Mock;
    transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const pendingEntries: string[] = [];
      const tx = {
        binder: {
          findMany: jest.fn().mockResolvedValue([{ id: 'binder-1', name: 'Main Binder' }]),
          updateMany: jest.fn()
        },
        card: {
          findMany: jest.fn().mockResolvedValue([])
        },
        collection: {
          create: jest.fn().mockImplementation(async () => {
            sequence += 1;
            const id = `entry-${sequence}`;
            pendingEntries.push(id);
            return { id };
          })
        }
      };
      try {
        const result = await callback(tx);
        committedEntries.push(...pendingEntries);
        return result;
      } catch (error) {
        throw error;
      }
    });
    (ensureCardForCollection as jest.Mock).mockResolvedValue({});
    (syncCollectionTags as jest.Mock).mockImplementation(
      async (_tx, _userId, entryId: string) => {
        if (entryId === 'entry-2') {
          throw new Error('later row failed');
        }
      }
    );

    await expect(commitBulkAdd('user-1', request)).rejects.toThrow('later row failed');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(committedEntries).toEqual([]);
  });
});
