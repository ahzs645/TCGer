jest.mock('../../lib/prisma', () => ({
  prisma: {
    collection: { findMany: jest.fn() },
  },
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getCollectionDuplicates } from './analytics.service';

function collectionRow({
  id,
  binderId,
  binderName,
  quantity,
  condition,
  price,
}: {
  id: string;
  binderId: string | null;
  binderName?: string;
  quantity: number;
  condition?: string;
  price: string;
}) {
  return {
    id,
    userId: 'user-1',
    cardId: 'card-1',
    binderId,
    quantity,
    condition: condition ?? null,
    language: null,
    notes: null,
    price: new Prisma.Decimal(price),
    acquisitionPrice: null,
    isFoil: false,
    finishCode: null,
    finishLabel: null,
    edition: null,
    stamp: null,
    isSealedPromo: false,
    isOversized: false,
    isPeelOff: false,
    isSigned: false,
    isAltered: false,
    imageUrls: [],
    customAttributes: null,
    serialNumber: null,
    acquiredAt: null,
    gradingCompany: null,
    gradingScore: null,
    certNumber: null,
    storageLocation: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    binder: binderId ? { id: binderId, name: binderName ?? 'Binder' } : null,
    card: {
      id: 'card-1',
      tcgGameId: 1,
      identityId: null,
      externalId: 'lea-black-lotus',
      baseExternalId: null,
      printingKey: null,
      artworkId: null,
      collectorNumber: '232',
      name: 'Black Lotus',
      setCode: 'LEA',
      setName: 'Limited Edition Alpha',
      rarity: 'Rare',
      imageUrl: null,
      imageUrlSmall: null,
      tcgSpecific: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      tcgGame: {
        id: 1,
        code: 'magic',
        displayName: 'Magic: The Gathering',
        apiEndpoint: null,
        schemaVersion: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
  };
}

describe('duplicate collection analytics', () => {
  afterEach(() => jest.clearAllMocks());

  test('groups an exact printing and values copies beyond the keep count', async () => {
    jest.mocked(prisma.collection.findMany).mockResolvedValue([
      collectionRow({
        id: 'collection-1',
        binderId: 'binder-1',
        binderName: 'Main Binder',
        quantity: 2,
        condition: 'Near Mint',
        price: '10',
      }),
      collectionRow({
        id: 'collection-2',
        binderId: 'binder-2',
        binderName: 'Trade Binder',
        quantity: 2,
        condition: 'Played',
        price: '4',
      }),
    ] as never);

    const result = await getCollectionDuplicates('user-1', 2, 'magic');

    expect(result).toMatchObject({
      keepCount: 2,
      totalPrintings: 1,
      totalExcessCopies: 2,
      totalStoredValue: 28,
      totalExcessStoredValue: 8,
      items: [
        {
          externalId: 'lea-black-lotus',
          quantity: 4,
          excessCopies: 2,
          storedValue: 28,
          excessStoredValue: 8,
          binders: [
            { binderId: 'binder-1', binderName: 'Main Binder', quantity: 2 },
            { binderId: 'binder-2', binderName: 'Trade Binder', quantity: 2 },
          ],
          conditions: [
            { condition: 'Near Mint', quantity: 2 },
            { condition: 'Played', quantity: 2 },
          ],
        },
      ],
    });
    expect(prisma.collection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', card: { tcgGame: { code: 'magic' } } },
        take: 5_001,
      }),
    );
  });
});
