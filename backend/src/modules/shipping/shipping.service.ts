import { prisma } from '../../lib/prisma';
import type { CreateShipmentInput } from '@tcg/api-types';

export async function getUserShipments(userId: string) {
  const shipments = await prisma.shipment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
  return shipments.map(s => ({
    id: s.id,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    status: s.status,
    description: s.description,
    relatedTradeId: s.relatedTradeId,
    lastChecked: s.lastChecked?.toISOString(),
    createdAt: s.createdAt.toISOString()
  }));
}

export async function createShipment(userId: string, input: CreateShipmentInput) {
  return prisma.shipment.create({
    data: {
      userId,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      description: input.description,
      relatedTradeId: input.relatedTradeId
    }
  });
}

export async function deleteShipment(userId: string, shipmentId: string) {
  const existing = await prisma.shipment.findFirst({ where: { id: shipmentId, userId } });
  if (!existing) {
    const error = new Error('Shipment not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.shipment.delete({ where: { id: shipmentId } });
}

export async function getShipmentStatus(userId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({ where: { id: shipmentId, userId } });
  if (!shipment) {
    const error = new Error('Shipment not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  // TODO: integrate with carrier APIs (USPS, UPS, FedEx, DHL, La Poste)
  return {
    ...shipment,
    status: shipment.status || 'pending',
    lastChecked: new Date().toISOString()
  };
}
