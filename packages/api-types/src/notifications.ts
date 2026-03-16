import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createNotificationChannelSchema = z.object({
  type: z.enum(['email', 'discord', 'telegram']),
  config: z.record(z.unknown()),
  enabled: z.boolean().optional()
});
export type CreateNotificationChannelInput = z.infer<typeof createNotificationChannelSchema>;

export const markNotificationReadSchema = z.object({
  read: z.boolean()
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface NotificationChannelResponse {
  id: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  data?: Record<string, unknown>;
  createdAt: string;
}
