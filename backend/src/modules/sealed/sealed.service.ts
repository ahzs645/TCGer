import { prisma } from '../../lib/prisma';
import type {
  Prisma,
  SealedOpenedCard,
  SealedOpening,
  SealedProduct
} from '@prisma/client';
import type {
  CreateSealedInventoryInput,
  CreateSealedOpeningInput,
  CustomSealedProductInput,
  RecordOpenedCardSaleInput,
  SealedInventoryResponse,
  SealedOpeningLedger,
  SealedProductResponse,
  UpdateSealedInventoryInput
} from '@tcg/api-types';
import { isUsablePrice } from '../pricing/pricing.service';

type SealedInventoryWithProduct = Prisma.SealedInventoryGetPayload<{
  include: { product: true };
}>;

function serializeSealedProduct(product: SealedProduct): SealedProductResponse {
  return {
    id: product.id,
    tcg: product.tcg,
    name: product.name,
    productType: product.productType,
    setCode: product.setCode ?? undefined,
    cardsPerPack: product.cardsPerPack ?? undefined,
    packsPerBox: product.packsPerBox ?? undefined,
    releaseDate: product.releaseDate?.toISOString(),
    imageUrl: product.imageUrl ?? undefined,
    msrp: product.msrp == null ? undefined : Number(product.msrp),
    upc: product.upc ?? undefined,
    isCustom: product.ownerId !== null
  };
}

function serializeSealedInventory(
  inventory: SealedInventoryWithProduct
): SealedInventoryResponse {
  return {
    id: inventory.id,
    product: serializeSealedProduct(inventory.product),
    quantity: inventory.quantity,
    purchasePrice:
      inventory.purchasePrice == null ? undefined : Number(inventory.purchasePrice),
    purchaseDate: inventory.purchaseDate?.toISOString(),
    notes: inventory.notes ?? undefined,
    createdAt: inventory.createdAt.toISOString()
  };
}

function serializeSealedOpening(opening: SealedOpening) {
  return {
    ...opening,
    openedAt: opening.openedAt.toISOString(),
    createdAt: opening.createdAt.toISOString(),
    updatedAt: opening.updatedAt.toISOString()
  };
}

function serializeSealedOpenedCard(card: SealedOpenedCard) {
  return {
    ...card,
    realizedProceeds:
      card.realizedProceeds == null ? undefined : Number(card.realizedProceeds),
    soldAt: card.soldAt?.toISOString(),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString()
  };
}

// ---------------------------------------------------------------------------
// Sealed Products Catalog
// ---------------------------------------------------------------------------

export async function getSealedProducts(userId: string, tcg?: string) {
  const products = await prisma.sealedProduct.findMany({
    where: {
      OR: [{ ownerId: null }, { ownerId: userId }],
      ...(tcg ? { tcg } : {})
    },
    orderBy: { releaseDate: 'desc' },
    take: 2_000
  });
  return products.map(serializeSealedProduct);
}

export async function getSealedProduct(userId: string, productId: string) {
  const product = await prisma.sealedProduct.findFirst({
    where: { id: productId, OR: [{ ownerId: null }, { ownerId: userId }] }
  });
  return product ? serializeSealedProduct(product) : null;
}

export function normalizeSealedProductBarcode(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[\d\s-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

export async function getSealedProductByBarcode(userId: string, barcode: string) {
  const normalized = normalizeSealedProductBarcode(barcode);
  if (!normalized) return null;

  // UPC-A and EAN-13 may represent the same code with a leading zero.
  const equivalents = new Set([normalized]);
  if (normalized.length === 12) equivalents.add(`0${normalized}`);
  if (normalized.length === 13 && normalized.startsWith('0')) {
    equivalents.add(normalized.slice(1));
  }

  const product = await prisma.sealedProduct.findFirst({
    where: {
      upc: { in: [...equivalents] },
      OR: [{ ownerId: null }, { ownerId: userId }]
    },
  });
  return product ? serializeSealedProduct(product) : null;
}

export async function createCustomSealedProduct(
  userId: string,
  input: CustomSealedProductInput
) {
  const product = await prisma.sealedProduct.create({
    data: {
      ...input,
      ownerId: userId,
      releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined
    }
  });
  return serializeSealedProduct(product);
}

async function requireOwnedCustomProduct(userId: string, productId: string) {
  const product = await prisma.sealedProduct.findFirst({
    where: { id: productId, ownerId: userId }
  });
  if (!product) {
    const error = new Error('Custom sealed product not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return product;
}

export async function updateCustomSealedProduct(
  userId: string,
  productId: string,
  input: CustomSealedProductInput
) {
  await requireOwnedCustomProduct(userId, productId);
  const product = await prisma.sealedProduct.update({
    where: { id: productId },
    data: {
      ...input,
      releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
      setCode: input.setCode ?? null,
      cardsPerPack: input.cardsPerPack ?? null,
      packsPerBox: input.packsPerBox ?? null,
      imageUrl: input.imageUrl ?? null,
      msrp: input.msrp ?? null,
      upc: input.upc ?? null
    }
  });
  return serializeSealedProduct(product);
}

export async function deleteCustomSealedProduct(userId: string, productId: string) {
  await requireOwnedCustomProduct(userId, productId);
  const inventoryCount = await prisma.sealedInventory.count({ where: { productId } });
  if (inventoryCount > 0) {
    const error = new Error(
      'Custom sealed product cannot be deleted while it is in inventory'
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }
  await prisma.sealedProduct.delete({ where: { id: productId } });
}

// ---------------------------------------------------------------------------
// Sealed Inventory
// ---------------------------------------------------------------------------

export async function getUserSealedInventory(userId: string) {
  const items = await prisma.sealedInventory.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { createdAt: 'desc' }
  });
  return items.map(serializeSealedInventory);
}

export async function addSealedInventory(userId: string, input: CreateSealedInventoryInput) {
  const product = await getSealedProduct(userId, input.productId);
  if (!product) {
    const error = new Error('Sealed product not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  const inventory = await prisma.sealedInventory.create({
    data: {
      userId,
      productId: input.productId,
      quantity: input.quantity ?? 1,
      purchasePrice: input.purchasePrice,
      purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
      notes: input.notes
    },
    include: { product: true }
  });
  return serializeSealedInventory(inventory);
}

export async function updateSealedInventory(userId: string, itemId: string, input: UpdateSealedInventoryInput) {
  const existing = await prisma.sealedInventory.findFirst({ where: { id: itemId, userId } });
  if (!existing) {
    const error = new Error('Sealed inventory item not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  const inventory = await prisma.sealedInventory.update({
    where: { id: itemId },
    data: {
      ...(input.quantity !== undefined && { quantity: input.quantity }),
      ...(input.purchasePrice !== undefined && { purchasePrice: input.purchasePrice }),
      ...(input.purchaseDate !== undefined && {
        purchaseDate: input.purchaseDate === null ? null : new Date(input.purchaseDate)
      }),
      ...(input.notes !== undefined && { notes: input.notes })
    },
    include: { product: true }
  });
  return serializeSealedInventory(inventory);
}

export async function deleteSealedInventory(userId: string, itemId: string) {
  const existing = await prisma.sealedInventory.findFirst({
    where: { id: itemId, userId },
    include: { _count: { select: { openings: true } } },
  });
  if (!existing) {
    const error = new Error('Sealed inventory item not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  if (existing._count.openings > 0) {
    const error = new Error(
      'Inventory with opening history cannot be deleted',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }
  await prisma.sealedInventory.delete({ where: { id: itemId } });
}

function collectionLiveValue(collection: {
  quantity: number;
  price: unknown;
  finishCode: string | null;
  card: {
    priceHistory: Array<{ price: unknown; finishCode: string | null }>;
  };
}) {
  const manual = collection.price == null ? undefined : Number(collection.price);
  if (isUsablePrice(manual)) return manual * collection.quantity;
  const matching = collection.card.priceHistory.find(
    (entry) => (entry.finishCode ?? null) === (collection.finishCode ?? null)
  );
  const matchingValue = matching?.price == null ? undefined : Number(matching.price);
  if (isUsablePrice(matchingValue)) return matchingValue * collection.quantity;
  const fallback = collection.card.priceHistory.find((entry) =>
    isUsablePrice(Number(entry.price))
  );
  return fallback?.price == null ? 0 : Number(fallback.price) * collection.quantity;
}

export async function createSealedOpening(
  userId: string,
  inventoryId: string,
  input: CreateSealedOpeningInput
) {
  return prisma.$transaction(async (tx) => {
    const inventory = await tx.sealedInventory.findFirst({
      where: { id: inventoryId, userId }
    });
    if (!inventory) {
      const error = new Error('Sealed inventory item not found') as Error & { status: number };
      error.status = 404;
      throw error;
    }
    if (inventory.quantity < input.openedQuantity) {
      const error = new Error('Opened quantity exceeds sealed inventory') as Error & {
        status: number;
      };
      error.status = 409;
      throw error;
    }

    const uniqueCollectionIds = [...new Set(input.collectionIds)];
    const collections = uniqueCollectionIds.length
      ? await tx.collection.findMany({
          where: { id: { in: uniqueCollectionIds }, userId },
          include: { card: { include: { tcgGame: true } }, sealedOpeningLinks: true }
        })
      : [];
    if (collections.length !== uniqueCollectionIds.length) {
      const error = new Error('One or more collection copies were not found') as Error & {
        status: number;
      };
      error.status = 404;
      throw error;
    }
    if (collections.some((collection) => collection.sealedOpeningLinks.length > 0)) {
      const error = new Error('A collection copy is already linked to an opening') as Error & {
        status: number;
      };
      error.status = 409;
      throw error;
    }

    const opening = await tx.sealedOpening.create({
      data: {
        userId,
        sealedInventoryId: inventoryId,
        openedQuantity: input.openedQuantity,
        openedAt: input.openedAt ? new Date(input.openedAt) : undefined,
        notes: input.notes,
        cards: {
          create: collections.map((collection) => ({
            collectionId: collection.id,
            externalId: collection.card.externalId,
            tcg: collection.card.tcgGame.code,
            cardName: collection.card.name,
            quantity: collection.quantity
          }))
        }
      }
    });
    await tx.sealedInventory.update({
      where: { id: inventoryId },
      data: { quantity: { decrement: input.openedQuantity } }
    });
    return serializeSealedOpening(opening);
  });
}

export async function recordOpenedCardSale(
  userId: string,
  openedCardId: string,
  input: RecordOpenedCardSaleInput
) {
  const card = await prisma.sealedOpenedCard.findFirst({
    where: { id: openedCardId, opening: { userId } }
  });
  if (!card) {
    const error = new Error('Opened card ledger entry not found') as Error & {
      status: number;
    };
    error.status = 404;
    throw error;
  }
  const updatedCard = await prisma.sealedOpenedCard.update({
    where: { id: card.id },
    data: {
      status: 'sold',
      realizedProceeds: input.proceeds,
      soldAt: input.soldAt ? new Date(input.soldAt) : new Date()
    }
  });
  return serializeSealedOpenedCard(updatedCard);
}

export async function getSealedOpeningLedgers(
  userId: string
): Promise<SealedOpeningLedger[]> {
  const openings = await prisma.sealedOpening.findMany({
    where: { userId },
    include: {
      inventory: { include: { product: true } },
      cards: {
        include: {
          collection: {
            include: {
              card: {
                include: {
                  priceHistory: {
                    orderBy: { recordedAt: 'desc' },
                    take: 20
                  }
                }
              }
            }
          }
        }
      }
    },
    orderBy: { openedAt: 'desc' }
  });

  return openings.map((opening) => {
    const invested =
      Number(opening.inventory.purchasePrice ?? 0) * opening.openedQuantity;
    const cards = opening.cards.map((card) => {
      const liveValue =
        card.status === 'active' && card.collection
          ? collectionLiveValue(card.collection)
          : 0;
      return {
        id: card.id,
        collectionId: card.collectionId ?? undefined,
        externalId: card.externalId,
        tcg: card.tcg,
        cardName: card.cardName,
        quantity: card.quantity,
        status: card.status === 'sold' ? ('sold' as const) : ('active' as const),
        liveValue,
        realizedProceeds: Number(card.realizedProceeds ?? 0),
        soldAt: card.soldAt?.toISOString()
      };
    });
    const liveValue = cards.reduce((sum, card) => sum + card.liveValue, 0);
    const realizedProceeds = cards.reduce(
      (sum, card) => sum + card.realizedProceeds,
      0
    );
    return {
      id: opening.id,
      inventoryId: opening.sealedInventoryId,
      productName: opening.inventory.product.name,
      openedQuantity: opening.openedQuantity,
      openedAt: opening.openedAt.toISOString(),
      invested,
      liveValue,
      realizedProceeds,
      profitLoss: liveValue + realizedProceeds - invested,
      activeCopies: cards
        .filter((card) => card.status === 'active')
        .reduce((sum, card) => sum + card.quantity, 0),
      soldCopies: cards
        .filter((card) => card.status === 'sold')
        .reduce((sum, card) => sum + card.quantity, 0),
      cards
    };
  });
}

// ---------------------------------------------------------------------------
// Pack Opening Simulation
// ---------------------------------------------------------------------------

export async function simulatePackOpening(tcg: string, setCode: string) {
  // Get all cards from the set via the adapter (simplified)
  // In production this would use the adapter registry to fetch set cards
  // For now, return a placeholder
  return {
    cards: [],
    setCode,
    setName: setCode,
    message: 'Pack opening simulation — connect to adapter for real card data'
  };
}
