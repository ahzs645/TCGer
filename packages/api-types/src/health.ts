import { z } from 'zod';

export const serverFeaturesSchema = z.object({
  decks: z.boolean(),
  finance: z.boolean(),
  sealed: z.boolean(),
  analytics: z.boolean(),
  trades: z.boolean(),
  prices: z.boolean(),
  notifications: z.boolean(),
  alerts: z.boolean(),
  shops: z.boolean(),
  automations: z.boolean(),
  shipments: z.boolean(),
  public: z.boolean()
});
export type ServerFeatures = z.infer<typeof serverFeaturesSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  env: z.enum(['development', 'test', 'production']),
  mode: z.enum(['hybrid', 'convex']),
  features: serverFeaturesSchema
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
