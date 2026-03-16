import { prisma } from '../../lib/prisma';
import type { CreateSealedInventoryInput, UpdateSealedInventoryInput } from '@tcg/api-types';

// ---------------------------------------------------------------------------
// Sealed Products Catalog
// ---------------------------------------------------------------------------

export async function getSealedProducts(tcg?: string) {
  return prisma.sealedProduct.findMany({
    where: tcg ? { tcg } : undefined,
    orderBy: { releaseDate: 'desc' }
  });
}

export async function getSealedProduct(productId: string) {
  return prisma.sealedProduct.findUnique({ where: { id: productId } });
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
  return items.map(i => ({
    id: i.id,
    product: {
      id: i.product.id,
      tcg: i.product.tcg,
      name: i.product.name,
      productType: i.product.productType,
      setCode: i.product.setCode,
      cardsPerPack: i.product.cardsPerPack,
      packsPerBox: i.product.packsPerBox,
      releaseDate: i.product.releaseDate?.toISOString(),
      imageUrl: i.product.imageUrl,
      msrp: i.product.msrp ? parseFloat(i.product.msrp.toString()) : undefined,
      upc: i.product.upc
    },
    quantity: i.quantity,
    purchasePrice: i.purchasePrice ? parseFloat(i.purchasePrice.toString()) : undefined,
    purchaseDate: i.purchaseDate?.toISOString(),
    notes: i.notes,
    createdAt: i.createdAt.toISOString()
  }));
}

export async function addSealedInventory(userId: string, input: CreateSealedInventoryInput) {
  return prisma.sealedInventory.create({
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
}

export async function updateSealedInventory(userId: string, itemId: string, input: UpdateSealedInventoryInput) {
  const existing = await prisma.sealedInventory.findFirst({ where: { id: itemId, userId } });
  if (!existing) {
    const error = new Error('Sealed inventory item not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return prisma.sealedInventory.update({
    where: { id: itemId },
    data: {
      ...(input.quantity !== undefined && { quantity: input.quantity }),
      ...(input.purchasePrice !== undefined && { purchasePrice: input.purchasePrice }),
      ...(input.purchaseDate !== undefined && { purchaseDate: new Date(input.purchaseDate) }),
      ...(input.notes !== undefined && { notes: input.notes })
    },
    include: { product: true }
  });
}

export async function deleteSealedInventory(userId: string, itemId: string) {
  const existing = await prisma.sealedInventory.findFirst({ where: { id: itemId, userId } });
  if (!existing) {
    const error = new Error('Sealed inventory item not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.sealedInventory.delete({ where: { id: itemId } });
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
