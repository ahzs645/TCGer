import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createShipmentSchema = z.object({
  carrier: z.enum(['usps', 'ups', 'fedex', 'dhl', 'laposte']),
  trackingNumber: z.string().min(1),
  description: z.string().optional(),
  relatedTradeId: z.string().uuid().optional()
});
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ShipmentResponse {
  id: string;
  carrier: string;
  trackingNumber: string;
  status?: string;
  description?: string;
  relatedTradeId?: string;
  lastChecked?: string;
  createdAt: string;
}
