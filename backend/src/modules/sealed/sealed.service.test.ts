jest.mock('../../lib/prisma', () => ({
  prisma: {
    sealedProduct: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    sealedInventory: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    sealedOpenedCard: {
      findFirst: jest.fn(),
      update: jest.fn()
    },
    sealedOpening: {
      findMany: jest.fn()
    },
    $transaction: jest.fn()
  }
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  addSealedInventory,
  createCustomSealedProduct,
  deleteCustomSealedProduct,
  getSealedProductByBarcode,
  getSealedProducts,
  normalizeSealedProductBarcode,
  updateCustomSealedProduct,
  updateSealedInventory
} from './sealed.service';

const releaseDate = new Date('2026-06-01T00:00:00.000Z');
const purchaseDate = new Date('2026-06-15T00:00:00.000Z');
const createdAt = new Date('2026-06-16T12:00:00.000Z');

const product = {
  id: 'product-1',
  tcg: 'pokemon',
  name: 'Booster Box',
  productType: 'box',
  setCode: 'SET1',
  cardsPerPack: 10,
  packsPerBox: 36,
  releaseDate,
  imageUrl: null,
  msrp: new Prisma.Decimal('149.99'),
  upc: null,
  ownerId: null,
  createdAt,
  updatedAt: createdAt
};

const inventory = {
  id: 'inventory-1',
  userId: 'user-1',
  productId: product.id,
  quantity: 2,
  purchasePrice: new Prisma.Decimal('129.50'),
  purchaseDate,
  notes: null,
  createdAt,
  updatedAt: createdAt,
  product
};

describe('sealed response serialization', () => {
  afterEach(() => jest.clearAllMocks());

  test('normalizes product listing Decimal and date fields', async () => {
    jest.mocked(prisma.sealedProduct.findMany).mockResolvedValue([product]);

    await expect(getSealedProducts('user-1')).resolves.toEqual([
      {
        id: 'product-1',
        tcg: 'pokemon',
        name: 'Booster Box',
        productType: 'box',
        setCode: 'SET1',
        cardsPerPack: 10,
        packsPerBox: 36,
        releaseDate: '2026-06-01T00:00:00.000Z',
        imageUrl: undefined,
        msrp: 149.99,
        upc: undefined,
        isCustom: false
      }
    ]);
  });

  test('normalizes inventory creation and update responses', async () => {
    jest.mocked(prisma.sealedProduct.findFirst).mockResolvedValue(product);
    jest.mocked(prisma.sealedInventory.create).mockResolvedValue(inventory);
    jest.mocked(prisma.sealedInventory.findFirst).mockResolvedValue(inventory);
    jest.mocked(prisma.sealedInventory.update).mockResolvedValue(inventory);

    const input = {
      productId: product.id,
      quantity: 2,
      purchasePrice: 129.5,
      purchaseDate: purchaseDate.toISOString()
    };
    const created = await addSealedInventory('user-1', input);
    const updated = await updateSealedInventory('user-1', inventory.id, {
      purchasePrice: 129.5
    });

    for (const response of [created, updated]) {
      expect(response).toMatchObject({
        id: 'inventory-1',
        purchasePrice: 129.5,
        purchaseDate: '2026-06-15T00:00:00.000Z',
        createdAt: '2026-06-16T12:00:00.000Z',
        product: {
          msrp: 149.99,
          releaseDate: '2026-06-01T00:00:00.000Z'
        }
      });
      expect(typeof response.purchasePrice).toBe('number');
      expect(typeof response.product.msrp).toBe('number');
    }
  });

  test('keeps custom products private and owner-controlled', async () => {
    const customProduct = { ...product, ownerId: 'user-1' };
    jest.mocked(prisma.sealedProduct.create).mockResolvedValue(customProduct);
    jest.mocked(prisma.sealedProduct.findFirst).mockResolvedValue(customProduct);
    jest.mocked(prisma.sealedProduct.update).mockResolvedValue(customProduct);
    jest.mocked(prisma.sealedInventory.count).mockResolvedValue(0);

    const input = {
      tcg: 'pokemon',
      name: 'Private Box',
      productType: 'box'
    };
    await expect(createCustomSealedProduct('user-1', input)).resolves.toMatchObject({
      isCustom: true
    });
    await expect(
      updateCustomSealedProduct('user-1', product.id, input)
    ).resolves.toMatchObject({ isCustom: true });
    await expect(deleteCustomSealedProduct('user-1', product.id)).resolves.toBeUndefined();

    expect(prisma.sealedProduct.findFirst).toHaveBeenCalledWith({
      where: { id: product.id, ownerId: 'user-1' }
    });
    expect(prisma.sealedProduct.delete).toHaveBeenCalledWith({
      where: { id: product.id }
    });
  });

  test('normalizes UPC input and looks up UPC-A/EAN-13 equivalents', async () => {
    jest.mocked(prisma.sealedProduct.findFirst).mockResolvedValue({
      ...product,
      upc: '820650855221'
    });

    expect(normalizeSealedProductBarcode('8206-5085 5221')).toBe('820650855221');
    expect(normalizeSealedProductBarcode('not-a-barcode')).toBeNull();
    await expect(getSealedProductByBarcode('user-1', '820650855221')).resolves.toMatchObject({
      id: product.id,
      upc: '820650855221'
    });
    expect(prisma.sealedProduct.findFirst).toHaveBeenCalledWith({
      where: {
        upc: { in: ['820650855221', '0820650855221'] },
        OR: [{ ownerId: null }, { ownerId: 'user-1' }]
      }
    });
  });
});
