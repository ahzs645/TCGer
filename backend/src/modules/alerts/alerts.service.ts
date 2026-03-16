import { prisma } from '../../lib/prisma';
import type { CreatePriceAlertInput, UpdatePriceAlertInput } from '@tcg/api-types';

export async function getUserAlerts(userId: string) {
  const alerts = await prisma.priceAlert.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
  return alerts.map(a => ({
    id: a.id,
    externalId: a.externalId,
    tcg: a.tcg,
    cardName: a.cardName,
    imageUrl: a.imageUrl,
    targetPrice: a.targetPrice ? parseFloat(a.targetPrice.toString()) : 0,
    direction: a.direction,
    isActive: a.isActive,
    lastTriggered: a.lastTriggered?.toISOString(),
    createdAt: a.createdAt.toISOString()
  }));
}

export async function createAlert(userId: string, input: CreatePriceAlertInput) {
  const alert = await prisma.priceAlert.create({
    data: {
      userId,
      externalId: input.externalId,
      tcg: input.tcg,
      cardName: input.cardName,
      imageUrl: input.imageUrl,
      targetPrice: input.targetPrice,
      direction: input.direction
    }
  });
  return {
    id: alert.id,
    externalId: alert.externalId,
    tcg: alert.tcg,
    cardName: alert.cardName,
    imageUrl: alert.imageUrl,
    targetPrice: parseFloat(alert.targetPrice.toString()),
    direction: alert.direction,
    isActive: alert.isActive,
    lastTriggered: alert.lastTriggered?.toISOString(),
    createdAt: alert.createdAt.toISOString()
  };
}

export async function updateAlert(userId: string, alertId: string, input: UpdatePriceAlertInput) {
  const existing = await prisma.priceAlert.findFirst({ where: { id: alertId, userId } });
  if (!existing) {
    const error = new Error('Alert not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return prisma.priceAlert.update({
    where: { id: alertId },
    data: {
      ...(input.targetPrice !== undefined && { targetPrice: input.targetPrice }),
      ...(input.direction !== undefined && { direction: input.direction }),
      ...(input.isActive !== undefined && { isActive: input.isActive })
    }
  });
}

export async function deleteAlert(userId: string, alertId: string) {
  const existing = await prisma.priceAlert.findFirst({ where: { id: alertId, userId } });
  if (!existing) {
    const error = new Error('Alert not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.priceAlert.delete({ where: { id: alertId } });
}
