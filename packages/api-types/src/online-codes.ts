import { z } from 'zod';

import { tcgCodeSchema } from './cards';

export const onlineCodeStatusSchema = z.enum([
  'unused',
  'redeemed',
  'invalid',
  'traded'
]);
export type OnlineCodeStatus = z.infer<typeof onlineCodeStatusSchema>;

export const onlineCodeSourceSchema = z.enum(['camera', 'manual', 'import']);
export type OnlineCodeSource = z.infer<typeof onlineCodeSourceSchema>;

export const onlineCodeSchema = z.object({
  id: z.string(),
  tcg: tcgCodeSchema,
  code: z.string(),
  status: onlineCodeStatusSchema,
  source: onlineCodeSourceSchema,
  productName: z.string().optional(),
  notes: z.string().optional(),
  capturedAt: z.string(),
  redeemedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type OnlineCode = z.infer<typeof onlineCodeSchema>;

export const createOnlineCodeInputSchema = z.object({
  code: z.string(),
  capturedAt: z.string().optional()
});
export type CreateOnlineCodeInput = z.infer<typeof createOnlineCodeInputSchema>;

export const createOnlineCodeBatchSchema = z.object({
  tcg: tcgCodeSchema,
  codes: z.array(createOnlineCodeInputSchema),
  source: onlineCodeSourceSchema,
  productName: z.string().optional(),
  notes: z.string().optional()
});
export type CreateOnlineCodeBatch = z.infer<typeof createOnlineCodeBatchSchema>;

export const createOnlineCodeBatchResultSchema = z.object({
  created: z.number(),
  duplicates: z.number(),
  items: z.array(onlineCodeSchema)
});
export type CreateOnlineCodeBatchResult = z.infer<
  typeof createOnlineCodeBatchResultSchema
>;

export const updateOnlineCodeInputSchema = z.object({
  status: onlineCodeStatusSchema.optional(),
  productName: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});
export type UpdateOnlineCodeInput = z.infer<typeof updateOnlineCodeInputSchema>;
