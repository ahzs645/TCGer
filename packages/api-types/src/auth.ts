import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const signupSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  email: z.string().email('Invalid email address').optional()
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  username: z.string(),
  isAdmin: z.boolean(),
  showCardNumbers: z.boolean(),
  showPricing: z.boolean(),
  enabledYugioh: z.boolean(),
  enabledMagic: z.boolean(),
  enabledPokemon: z.boolean()
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  user: authUserSchema,
  token: z.string()
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const setupCheckResponseSchema = z.object({
  setupRequired: z.boolean()
});
export type SetupCheckResponse = z.infer<typeof setupCheckResponseSchema>;
