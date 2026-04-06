import type { AuthUser } from "@/stores/auth";

/**
 * Extract AuthUser from a Better Auth user response object.
 * Better Auth returns additional fields alongside standard user fields.
 */
export function toAuthUser(user: Record<string, unknown>): AuthUser {
  return {
    id: user.id as string,
    email: user.email as string,
    username: (user.username as string) ?? null,
    isAdmin: (user.isAdmin as boolean) ?? false,
    showCardNumbers: (user.showCardNumbers as boolean) ?? true,
    showPricing: (user.showPricing as boolean) ?? true,
    enabledYugioh: (user.enabledYugioh as boolean) ?? true,
    enabledMagic: (user.enabledMagic as boolean) ?? true,
    enabledPokemon: (user.enabledPokemon as boolean) ?? true,
  };
}
