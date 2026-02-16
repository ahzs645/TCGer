import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const updatePreferencesSchema = z
  .object({
    showCardNumbers: z.boolean().optional(),
    showPricing: z.boolean().optional(),
    enabledYugioh: z.boolean().optional(),
    enabledMagic: z.boolean().optional(),
    enabledPokemon: z.boolean().optional()
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'At least one preference must be provided' }
  );
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export const updateProfileSchema = z
  .object({
    username: z.string().min(1).max(50).optional(),
    email: z.string().email().optional()
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'At least one field must be provided' }
  );
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  showCardNumbers: boolean;
  showPricing: boolean;
  createdAt: string;
}

export interface UserPreferences {
  showCardNumbers: boolean;
  showPricing: boolean;
  enabledYugioh: boolean;
  enabledMagic: boolean;
  enabledPokemon: boolean;
}
