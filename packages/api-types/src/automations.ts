import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createAutomationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  trigger: z.enum(['price_change', 'new_card_added', 'schedule']),
  action: z.enum(['notify', 'move_to_binder', 'add_tag', 'export']),
  config: z.record(z.unknown()),
  enabled: z.boolean().optional()
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z.object({
  name: z.string().min(1).optional(),
  trigger: z.enum(['price_change', 'new_card_added', 'schedule']).optional(),
  action: z.enum(['notify', 'move_to_binder', 'add_tag', 'export']).optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional()
});
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface AutomationResponse {
  id: string;
  name: string;
  trigger: string;
  action: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
