import { z } from 'zod';

// ---------------------------------------------------------------------------
// Price Alerts
// ---------------------------------------------------------------------------

export const createPriceAlertSchema = z.object({
  externalId: z.string().min(1),
  tcg: z.string().min(1),
  cardName: z.string().min(1),
  imageUrl: z.string().optional(),
  targetPrice: z.number().positive(),
  direction: z.enum(['below', 'above'])
});
export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;

export const updatePriceAlertSchema = z.object({
  targetPrice: z.number().positive().optional(),
  direction: z.enum(['below', 'above']).optional(),
  isActive: z.boolean().optional()
});
export type UpdatePriceAlertInput = z.infer<typeof updatePriceAlertSchema>;

// ---------------------------------------------------------------------------
// Transactions / Finance
// ---------------------------------------------------------------------------

export const createTransactionSchema = z.object({
  type: z.enum(['purchase', 'sale', 'trade']),
  cardId: z.string().optional(),
  externalId: z.string().optional(),
  tcg: z.string().optional(),
  cardName: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  amount: z.number(),
  currency: z.string().default('USD'),
  platform: z.string().optional(),
  notes: z.string().optional(),
  date: z.string().datetime().optional()
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

// ---------------------------------------------------------------------------
// Shop Connections
// ---------------------------------------------------------------------------

export const createShopConnectionSchema = z.object({
  platform: z.enum(['tcgplayer', 'cardmarket']),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  sellerId: z.string().optional()
});
export type CreateShopConnectionInput = z.infer<typeof createShopConnectionSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface PriceAlertResponse {
  id: string;
  externalId: string;
  tcg: string;
  cardName: string;
  imageUrl?: string;
  targetPrice: number;
  direction: string;
  isActive: boolean;
  lastTriggered?: string;
  createdAt: string;
}

export interface TransactionResponse {
  id: string;
  type: string;
  cardName?: string;
  tcg?: string;
  quantity: number;
  amount: number;
  currency: string;
  platform?: string;
  notes?: string;
  date: string;
}

export interface FinanceSummary {
  totalSpent: number;
  totalEarned: number;
  profitLoss: number;
  transactionCount: number;
}

export interface ShopConnectionResponse {
  id: string;
  platform: string;
  sellerId?: string;
  enabled: boolean;
  lastSync?: string;
}

export interface PriceResult {
  source: string;
  price: number;
  currency: string;
  foilPrice?: number;
  url?: string;
  updatedAt: string;
}

export interface PriceAnalyticsMovers {
  gainers: Array<{ externalId: string; tcg: string; name: string; priceChange: number; percentChange: number; currentPrice: number }>;
  losers: Array<{ externalId: string; tcg: string; name: string; priceChange: number; percentChange: number; currentPrice: number }>;
}
