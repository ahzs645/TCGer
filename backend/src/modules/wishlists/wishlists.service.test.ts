jest.mock('../../lib/prisma', () => ({
  prisma: {
    wishlist: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn()
    },
    $transaction: jest.fn(),
    wishlistCard: {
      delete: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn()
    },
    collection: {
      aggregate: jest.fn(),
      findMany: jest.fn()
    }
  }
}));

import { prisma } from '../../lib/prisma';
import { getUserWishlist, updateWishlistCard, removeCardFromWishlist, addCardsToWishlist, addCardToWishlist } from './wishlists.service';

const createdAt = new Date('2026-08-13T12:00:00.000Z');
const updatedAt = new Date('2026-08-13T13:00:00.000Z');

function wishlistCard({
  id,
  externalId,
  desiredQuantity,
  baseExternalId
}: {
  id: string;
  externalId: string;
  desiredQuantity: number;
  baseExternalId?: string;
}) {
  return {
    id,
    wishlistId: 'wishlist-1',
    externalId,
    tcg: 'pokemon',
    name: 'Pikachu',
    desiredQuantity,
    setCode: null,
    setName: null,
    rarity: null,
    imageUrl: null,
    imageUrlSmall: null,
    setSymbolUrl: null,
    setLogoUrl: null,
    collectorNumber: null,
    tcgSpecific: baseExternalId ? { baseExternalId } : null,
    notes: null,
    createdAt,
    updatedAt
  };
}

function ownedRow({
  externalId,
  quantity,
  baseExternalId
}: {
  externalId: string;
  quantity: number;
  baseExternalId?: string;
}) {
  return {
    quantity,
    card: {
      externalId,
      baseExternalId: baseExternalId ?? null,
      tcgGame: { code: 'pokemon' }
    }
  };
}

describe('legacy wishlist quantity semantics', () => {
  afterEach(() => jest.clearAllMocks());

  test('calculates copy-based totals and caps owned progress at each goal', async () => {
    const cards = [
      wishlistCard({
        id: 'wanted-pikachu',
        externalId: 'pikachu-holo',
        baseExternalId: 'pikachu',
        desiredQuantity: 4
      }),
      wishlistCard({
        id: 'wanted-raichu',
        externalId: 'raichu-holo',
        baseExternalId: 'raichu',
        desiredQuantity: 2
      })
    ];
    jest.mocked(prisma.wishlist.findFirst).mockResolvedValue({
      id: 'wishlist-1',
      userId: 'user-1',
      name: 'Evolution Goals',
      description: null,
      colorHex: null,
      matchAnyPrinting: true,
      cards,
      rules: [],
      createdAt,
      updatedAt
    } as never);
    jest.mocked(prisma.collection.findMany).mockResolvedValue([
      ownedRow({
        externalId: 'pikachu-promo',
        baseExternalId: 'pikachu',
        quantity: 2
      }),
      ownedRow({
        externalId: 'raichu-promo',
        baseExternalId: 'raichu',
        quantity: 5
      })
    ] as never);

    const result = await getUserWishlist('user-1', 'wishlist-1');

    expect(result).toMatchObject({
      totalCards: 2,
      ownedCards: 2,
      totalDesiredQuantity: 6,
      ownedDesiredQuantity: 4,
      missingQuantity: 2,
      completionPercent: 67
    });
    expect(result.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'wanted-pikachu',
          ownedQuantity: 2,
          desiredQuantity: 4,
          missingQuantity: 2
        }),
        expect.objectContaining({
          id: 'wanted-raichu',
          ownedQuantity: 5,
          desiredQuantity: 2,
          missingQuantity: 0
        })
      ])
    );
    expect(prisma.collection.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: expect.any(Object)
    });
  });

  test('updates an owned card and returns any-printing missing quantity', async () => {
    const existing = wishlistCard({
      id: 'wanted-pikachu',
      externalId: 'pikachu-holo',
      baseExternalId: 'pikachu',
      desiredQuantity: 1
    });
    const updated = { ...existing, desiredQuantity: 3 };
    jest.mocked(prisma.wishlist.findFirst).mockResolvedValue({
      id: 'wishlist-1',
      userId: 'user-1',
      matchAnyPrinting: true
    } as never);
    jest.mocked(prisma.wishlistCard.findFirst).mockResolvedValue(existing as never);
    jest.mocked(prisma.wishlistCard.update).mockResolvedValue(updated as never);
    jest.mocked(prisma.collection.findMany).mockResolvedValue([
      ownedRow({
        externalId: 'pikachu-promo',
        baseExternalId: 'pikachu',
        quantity: 2
      })
    ] as never);

    await expect(
      updateWishlistCard('user-1', 'wishlist-1', 'wanted-pikachu', {
        desiredQuantity: 3
      })
    ).resolves.toMatchObject({
      id: 'wanted-pikachu',
      desiredQuantity: 3,
      owned: true,
      ownedQuantity: 2,
      missingQuantity: 1
    });
    expect(prisma.wishlistCard.findFirst).toHaveBeenCalledWith({
      where: { id: 'wanted-pikachu', wishlistId: 'wishlist-1' }
    });
    expect(prisma.wishlistCard.update).toHaveBeenCalledWith({
      where: { id: 'wanted-pikachu' },
      data: { desiredQuantity: 3, notes: undefined }
    });
  });
});


describe('wishlist sync exclusions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records the exact removed identity and deletes the row in one transaction', async () => {
    jest.mocked(prisma.wishlist.findFirst).mockResolvedValue({ id: 'wishlist-1', userId: 'user-1' } as never);
    jest.mocked(prisma.wishlistCard.findFirst).mockResolvedValue({ id: 'wanted', tcg: 'pokemon', externalId: 'base5-83' } as never);
    await removeCardFromWishlist('user-1', 'wishlist-1', 'wanted');
    expect(prisma.wishlist.update).toHaveBeenCalledWith({
      where: { id: 'wishlist-1' }, data: { excludedCardKeys: { push: 'pokemon:base5-83' } }
    });
    expect(prisma.wishlistCard.delete).toHaveBeenCalledWith({ where: { id: 'wanted' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('manual restoration clears only that card exclusion', async () => {
    const list = { id: 'wishlist-1', excludedCardKeys: ['pokemon:base5-83', 'pokemon:other'] };
    const card = wishlistCard({ id: 'wanted', externalId: 'base5-83', desiredQuantity: 1 });
    jest.mocked(prisma.wishlist.findFirst).mockResolvedValue(list as never);
    jest.mocked(prisma.wishlist.update).mockResolvedValue(list as never);
    jest.mocked(prisma.wishlistCard.findUnique).mockResolvedValue(null);
    jest.mocked(prisma.wishlistCard.upsert).mockResolvedValue(card as never);
    jest.mocked(prisma.collection.aggregate).mockResolvedValue({ _sum: { quantity: 0 } } as never);
    jest.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    await addCardToWishlist('user-1', 'wishlist-1', { tcg: 'pokemon', externalId: 'base5-83', name: 'Dark Raichu' });
    expect(prisma.wishlist.update).toHaveBeenLastCalledWith({
      where: { id: 'wishlist-1' }, data: { excludedCardKeys: ['pokemon:other'] }
    });
    expect(prisma.wishlistCard.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips excluded identities during subsequent batches', async () => {
    jest.mocked(prisma.wishlist.findFirst).mockResolvedValue({
      id: 'wishlist-1', userId: 'user-1', name: 'Darkrai', cards: [], rules: [],
      excludedCardKeys: ['pokemon:base5-83'], createdAt, updatedAt
    } as never);
    jest.mocked(prisma.collection.findMany).mockResolvedValue([]);
    jest.mocked(prisma.wishlist.update).mockResolvedValue({ excludedCardKeys: ['pokemon:base5-83'] } as never);
    jest.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    const result = await addCardsToWishlist('user-1', 'wishlist-1', {
      cards: [{ tcg: 'pokemon', externalId: 'base5-83', name: 'Dark Raichu' }]
    });
    expect(prisma.wishlistCard.upsert).not.toHaveBeenCalled();
    expect(result.cards).toEqual([]);
    expect(result.excludedCardKeys).toEqual(['pokemon:base5-83']);
  });
});
