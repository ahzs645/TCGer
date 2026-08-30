import { z } from "zod";

// ---------------------------------------------------------------------------
// Tracked collection pricing
// ---------------------------------------------------------------------------

export const justTcgIdentifiersSchema = z.object({
  cardId: z.string().trim().min(1).max(240).optional(),
  variantId: z.string().trim().min(1).max(240).optional(),
  tcgplayerId: z.string().trim().min(1).max(80).optional(),
  mtgjsonId: z.string().trim().min(1).max(240).optional(),
  scryfallId: z.string().trim().min(1).max(240).optional(),
  tcgplayerSkuId: z.string().trim().min(1).max(80).optional(),
});

export const justTcgLookupHintSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  setCode: z.string().trim().min(1).max(120).optional(),
  setName: z.string().trim().min(1).max(240).optional(),
  collectorNumber: z.string().trim().min(1).max(120).optional(),
});

export const trackedPriceItemSchema = z.object({
  tcg: z.string().trim().min(1).max(40),
  externalId: z.string().trim().min(1).max(240),
  finishCode: z.string().trim().min(1).max(80).optional(),
  condition: z.string().trim().min(1).max(80).optional(),
  language: z.string().trim().min(1).max(80).optional(),
  identifiers: justTcgIdentifiersSchema.optional(),
  lookupHint: justTcgLookupHintSchema.optional(),
});
export type TrackedPriceItem = z.infer<typeof trackedPriceItemSchema>;

export const priceSourceSchema = z.enum([
  "automatic",
  "justtcg",
  "tcgcsv",
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

export const priceOriginalQuoteSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  source: z.string().min(1),
  asOf: z.string().datetime().optional(),
});
export const priceFxProvenanceSchema = z.object({
  fromCurrency: z.string().regex(/^[A-Za-z]{3}$/),
  toCurrency: z.string().regex(/^[A-Za-z]{3}$/),
  rate: z.number().positive(),
  source: z.string().min(1),
  asOf: z.string().datetime(),
});
export const priceMatchProvenanceSchema = z.object({
  method: z.enum(["exact-id", "exact-set-number", "exact-name", "fuzzy"]),
  confidence: z.number().min(0).max(1),
  ambiguous: z.boolean().optional(),
  providerProductId: z.string().optional(),
  providerGroupId: z.string().optional(),
});
export const priceResultProvenanceSchema = z.object({
  provider: z.string().min(1),
  retrievedAt: z.string().datetime(),
  originalQuotes: z.array(priceOriginalQuoteSchema),
  fx: priceFxProvenanceSchema.optional(),
  match: priceMatchProvenanceSchema.optional(),
});
export type PriceResultProvenance = z.infer<typeof priceResultProvenanceSchema>;

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
  provenance?: PriceResultProvenance;
}

export const psaCertLookupInputSchema = z.object({
  certNumber: z
    .string()
    .trim()
    .regex(/^\d{6,12}$/),
  force: z.boolean().optional(),
});
export type PsaCertLookupInput = z.infer<typeof psaCertLookupInputSchema>;
export const psaCertLookupResponseSchema = z.object({
  certNumber: z.string(),
  grader: z.literal("PSA").default("PSA"),
  grade: z.number().optional(),
  gradeLabel: z.string().optional(),
  labelType: z.string().optional(),
  year: z.string().optional(),
  brand: z.string().optional(),
  subject: z.string().optional(),
  searchableName: z.string().optional(),
  cardNumber: z.string().optional(),
  variety: z.string().optional(),
  category: z.string().optional(),
  population: z.number().int().nonnegative().optional(),
  populationHigher: z.number().int().nonnegative().optional(),
  specId: z.string().optional(),
  cardId: z.string().optional(),
  providerResponseHash: z.string(),
  retrievedAt: z.string().datetime(),
  refreshAfter: z.string().datetime(),
  cached: z.boolean(),
});
export type PsaCertLookupResponse = z.infer<typeof psaCertLookupResponseSchema>;

export const gradedPriceEstimateInputSchema = z.object({
  game: z.string().min(1),
  name: z.string().min(1),
  setName: z.string().optional(),
  collectorNumber: z.string().optional(),
  grader: z.string().min(1),
  grade: z.number().nonnegative(),
  tcgPlayerId: z.string().optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
});
export type GradedPriceEstimateInput = z.infer<
  typeof gradedPriceEstimateInputSchema
>;
export const gradedPriceEstimateResponseSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string(),
  basis: z.string(),
  count: z.number().int().nonnegative().optional(),
  source: z.string(),
  retrievedAt: z.string().datetime(),
  userTriggered: z.boolean(),
  provenance: priceResultProvenanceSchema.optional(),
});
export type GradedPriceEstimateResponse = z.infer<
  typeof gradedPriceEstimateResponseSchema
>;

export interface TrackedPricesResponse {
  prices: TrackedPriceResult[];
  refreshedAt: string;
  refreshAfter: string;
  health: PricingHealthSummary;
}

export type PricingHealthStatus = "healthy" | "degraded" | "unsafe";

export interface PricingHealthSummary {
  status: PricingHealthStatus;
  total: number;
  priced: number;
  fresh: number;
  stale: number;
  missing: number;
  failed: number;
  lowConfidence: number;
  coverage: number;
  freshnessHours: number;
  message: string;
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
  finishCode: z.string().trim().min(1).optional(),
  targetPrice: z.number().positive(),
  direction: z.enum(["below", "above"]),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
  cooldownHours: z.number().int().min(1).max(24 * 30).optional(),
});
export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;

export const updatePriceAlertSchema = z.object({
  targetPrice: z.number().positive().optional(),
  direction: z.enum(["below", "above"]).optional(),
  isActive: z.boolean().optional(),
  cooldownHours: z.number().int().min(1).max(24 * 30).optional(),
});
export type UpdatePriceAlertInput = z.infer<typeof updatePriceAlertSchema>;

// ---------------------------------------------------------------------------
// Transactions / Finance
// ---------------------------------------------------------------------------

export const transactionTypeSchema = z.enum(["purchase", "sale", "trade"]);

export const createTransactionSchema = z.object({
  type: transactionTypeSchema,
  collectionEntryId: z.string().optional(),
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
  sourceUrl: z.string().url().optional(),
  costBasis: z.number().nonnegative().optional(),
  fees: z.number().nonnegative().optional(),
  shippingCost: z.number().nonnegative().optional(),
  acquiredAt: z.string().datetime().optional(),
  notes: z.string().optional(),
  date: z.string().datetime().optional(),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = z.object({
  collectionEntryId: z.string().nullable().optional(),
  cardId: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  tcg: z.string().nullable().optional(),
  cardName: z.string().nullable().optional(),
  quantity: z.number().int().positive().optional(),
  amount: z.number().positive().optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  platform: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  date: z.string().datetime().optional(),
});
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const acquisitionCostSplitSchema = z.object({
  totalCents: z.number().int().positive(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  mode: z.enum(["equal", "weighted"]),
  lines: z
    .array(
      z.object({
        collectionEntryId: z.string(),
        weight: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(500),
  notes: z.string().optional(),
});
export type AcquisitionCostSplitInput = z.infer<
  typeof acquisitionCostSplitSchema
>;
export interface AcquisitionCostSplitResult {
  allocationGroupId: string;
  totalCents: number;
  currency: string;
  auditId: string;
  allocations: Array<{
    collectionEntryId: string;
    allocatedCents: number;
    acquisitionPrice: number;
    transactionId: string;
  }>;
}

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
  finishCode?: string;
  targetPrice: number;
  direction: string;
  currency: string;
  cooldownHours: number;
  isActive: boolean;
  lastTriggered?: string;
  lastTriggeredPrice?: number;
  lastObservedPrice?: number;
  lastObservedAt?: string;
  state: "unknown" | "matched" | "unmatched";
  cooldownUntil?: string;
  createdAt: string;
}

export interface TransactionResponse {
  id: string;
  type: z.infer<typeof transactionTypeSchema>;
  collectionEntryId?: string;
  cardId?: string;
  externalId?: string;
  cardName?: string;
  tcg?: string;
  quantity: number;
  amount: number;
  currency: string;
  platform?: string;
  sourceUrl?: string;
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
  basePrice?: number;
  foilPrice?: number;
  etchedPrice?: number;
  reverseHoloPrice?: number;
  finishCode?: string;
  url?: string;
  updatedAt: string;
  provenance?: PriceResultProvenance;
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
