import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const updateSettingsSchema = z.object({
  publicDashboard: z.boolean().optional(),
  publicCollections: z.boolean().optional(),
  requireAuth: z.boolean().optional(),
  appName: z.string().optional(),
  scrydexApiKey: z.string().nullable().optional(),
  scrydexTeamId: z.string().nullable().optional(),
  scryfallApiBaseUrl: z.string().nullable().optional(),
  ygoApiBaseUrl: z.string().nullable().optional(),
  scrydexApiBaseUrl: z.string().nullable().optional(),
  tcgdexApiBaseUrl: z.string().nullable().optional(),
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

/** Extended settings visible only to admins (includes API keys) */
export interface AdminAppSettings extends AppSettings {
  scrydexApiKey: string | null;
  scrydexTeamId: string | null;
  scryfallApiBaseUrl: string | null;
  ygoApiBaseUrl: string | null;
  scrydexApiBaseUrl: string | null;
  tcgdexApiBaseUrl: string | null;
}
