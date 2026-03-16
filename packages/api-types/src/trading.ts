import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const tradeCardSchema = z.object({
  externalId: z.string().min(1),
  tcg: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  imageUrl: z.string().optional(),
  estimatedValue: z.number().optional()
});

export const createTradeSchema = z.object({
  receiverId: z.string().uuid(),
  message: z.string().optional(),
  senderCards: z.array(tradeCardSchema).min(1),
  receiverCards: z.array(tradeCardSchema).optional()
});
export type CreateTradeInput = z.infer<typeof createTradeSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface TradeCardResponse {
  id: string;
  side: string;
  externalId: string;
  tcg: string;
  name: string;
  quantity: number;
  imageUrl?: string;
  estimatedValue?: number;
}

export interface TradeResponse {
  id: string;
  senderId: string;
  receiverId: string;
  status: string;
  message?: string;
  cards: TradeCardResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface TradeMatchResponse {
  userId: string;
  username?: string;
  theyHave: Array<{ externalId: string; tcg: string; name: string }>;
  youHave: Array<{ externalId: string; tcg: string; name: string }>;
  matchScore: number;
}
