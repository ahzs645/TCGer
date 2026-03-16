import { prisma } from '../../lib/prisma';
import type { CreateShopConnectionInput } from '@tcg/api-types';

export async function getUserShopConnections(userId: string) {
  const connections = await prisma.shopConnection.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
  return connections.map(c => ({
    id: c.id,
    platform: c.platform,
    sellerId: c.sellerId,
    enabled: c.enabled,
    lastSync: c.lastSync?.toISOString()
  }));
}

export async function createShopConnection(userId: string, input: CreateShopConnectionInput) {
  const conn = await prisma.shopConnection.create({
    data: {
      userId,
      platform: input.platform,
      apiKey: input.apiKey,
      apiSecret: input.apiSecret,
      sellerId: input.sellerId
    }
  });
  return {
    id: conn.id,
    platform: conn.platform,
    sellerId: conn.sellerId,
    enabled: conn.enabled,
    lastSync: conn.lastSync?.toISOString()
  };
}

export async function deleteShopConnection(userId: string, connectionId: string) {
  const conn = await prisma.shopConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) {
    const error = new Error('Shop connection not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.shopConnection.delete({ where: { id: connectionId } });
}

export async function syncShopStock(userId: string, connectionId: string) {
  const conn = await prisma.shopConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) {
    const error = new Error('Shop connection not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }

  // TODO: Implement actual sync with TCGPlayer/CardMarket APIs
  await prisma.shopConnection.update({
    where: { id: connectionId },
    data: { lastSync: new Date() }
  });

  return { synced: true, message: `Stock sync initiated for ${conn.platform}` };
}
