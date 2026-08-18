import { z } from "zod";

// ---------------------------------------------------------------------------
// Tracked collection pricing
// ---------------------------------------------------------------------------

export const trackedPriceItemSchema = z.object({
  tcg: z.string().trim().min(1).max(40),
  externalId: z.string().trim().min(1).max(240),
  finishCode: z.string().trim().min(1).max(80).optional(),
});
export type TrackedPriceItem = z.infer<typeof trackedPriceItemSchema>;

export const priceSourceSchema = z.enum([
  "automatic",
  "justtcg",
  "tcgdex-cardmarket",
  "scryfall",
  "lorcast",
  "card-source",
  "pokewallet-cardmarket",
  "pokewallet-tcgplayer",
  "pokewallet-blended",
  "ebay-active",
]);
export type PriceSource = z.infer<typeof priceSourceSchema>;

export const trackedPricesRequestSchema = z.object({
  items: z.array(trackedPriceItemSchema).min(1).max(100),
  force: z.boolean().optional().default(false),
  source: priceSourceSchema.optional().default("automatic"),
});
export type TrackedPricesRequest = z.infer<typeof trackedPricesRequestSchema>;

export interface TrackedPriceResult extends TrackedPriceItem {
  key: string;
  price?: number;
  currency?: string;
  source?: string;
  updatedAt?: string;
  cached: boolean;
  error?: string;
}

export interface TrackedPricesResponse {
  prices: TrackedPriceResult[];
  refreshedAt: string;
  refreshAfter: string;
}

export interface PriceSourceOption {
  id: PriceSource;
  label: string;
  description: string;
  games: string[];
  requiresServer: boolean;
}

export interface PriceSourcesResponse {
  sources: PriceSourceOption[];
  defaultSource: PriceSource;
}

// ---------------------------------------------------------------------------
// Price Alerts
// ---------------------------------------------------------------------------

export const createPriceAlertSchema = z.object({
  externalId: z.string().min(1),
  tcg: z.string().min(1),
  cardName: z.string().min(1),
  imageUrl: z.string().optional(),
  targetPrice: z.number().positive(),
  direction: z.enum(["below", "above"]),
});
export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;

export const updatePriceAlertSchema = z.object({
  targetPrice: z.number().positive().optional(),
  direction: z.enum(["below", "above"]).optional(),
  isActive: z.boolean().optional(),
});
export type UpdatePriceAlertInput = z.infer<typeof updatePriceAlertSchema>;

// ---------------------------------------------------------------------------
// Transactions / Finance
// ---------------------------------------------------------------------------

export const transactionTypeSchema = z.enum(["purchase", "sale", "trade"]);

export const createTransactionSchema = z.object({
  type: transactionTypeSchema,
  cardId: z.string().optional(),
  externalId: z.string().optional(),
  tcg: z.string().optional(),
  cardName: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  amount: z.number().positive(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase())
    .default("USD"),
  platform: z.string().optional(),
  costBasis: z.number().nonnegative().optional(),
  fees: z.number().nonnegative().optional(),
  shippingCost: z.number().nonnegative().optional(),
  acquiredAt: z.string().datetime().optional(),
  notes: z.string().optional(),
  date: z.string().datetime().optional(),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

// ---------------------------------------------------------------------------
// Shop Connections
// ---------------------------------------------------------------------------

export const createShopConnectionSchema = z.object({
  platform: z.enum(["tcgplayer", "cardmarket"]),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  sellerId: z.string().optional(),
});
export type CreateShopConnectionInput = z.infer<
  typeof createShopConnectionSchema
>;

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
  type: z.infer<typeof transactionTypeSchema>;
  cardName?: string;
  tcg?: string;
  quantity: number;
  amount: number;
  currency: string;
  platform?: string;
  costBasis?: number;
  fees?: number;
  shippingCost?: number;
  acquiredAt?: string;
  netProceeds?: number;
  realizedProfit?: number;
  holdingDays?: number;
  notes?: string;
  date: string;
}

export interface FinanceCurrencySummary {
  currency: string;
  totalSpent: number;
  totalEarned: number;
  profitLoss: number;
}

export interface FinanceSummary {
  totalSpent: number;
  totalEarned: number;
  profitLoss: number;
  transactionCount: number;
}

export interface FinanceSummaryByCurrency {
  byCurrency: FinanceCurrencySummary[];
  transactionCount: number;
}

export interface RealizedSaleMetric {
  id: string;
  cardName?: string;
  tcg?: string;
  platform?: string;
  currency: string;
  quantity: number;
  date: string;
  revenue: number;
  costBasis?: number;
  fees: number;
  shippingCost: number;
  netProceeds: number;
  realizedProfit?: number;
  holdingDays?: number;
}

export interface RealizedPerformanceCurrency {
  currency: string;
  revenue: number;
  costBasis: number;
  fees: number;
  shippingCost: number;
  netProceeds: number;
  realizedProfit: number;
  saleCount: number;
  costedSaleCount: number;
  averageHoldingDays?: number;
}

export interface RealizedPerformanceBreakdown {
  key: string;
  currency: string;
  revenue: number;
  realizedProfit: number;
  saleCount: number;
}

export interface RealizedPerformance {
  byCurrency: RealizedPerformanceCurrency[];
  byPlatform: RealizedPerformanceBreakdown[];
  byGame: RealizedPerformanceBreakdown[];
  recentSales: RealizedSaleMetric[];
  bestReturns: RealizedSaleMetric[];
  worstReturns: RealizedSaleMetric[];
  fastestSales: RealizedSaleMetric[];
  inventoryCost: number;
  inventoryMarketValue: number;
  inventoryCurrency: string;
  truncated: boolean;
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
  gainers: Array<{
    externalId: string;
    tcg: string;
    name: string;
    priceChange: number;
    percentChange: number;
    currentPrice: number;
  }>;
  losers: Array<{
    externalId: string;
    tcg: string;
    name: string;
    priceChange: number;
    percentChange: number;
    currentPrice: number;
  }>;
}
