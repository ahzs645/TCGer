import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const updateSettingsSchema = z.object({
  publicDashboard: z.boolean().optional(),
  publicCollections: z.boolean().optional(),
  requireAuth: z.boolean().optional(),
  appName: z.string().optional()
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface AppSettings {
  id: number;
  publicDashboard: boolean;
  publicCollections: boolean;
  requireAuth: boolean;
  appName: string;
  updatedAt: string;
}
