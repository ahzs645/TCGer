declare global {
  interface Window {
    __TCGER_SINGLE_USER__?: {
      enabled?: boolean;
      id?: string;
      email?: string;
      username?: string;
    };
  }
}

export const SINGLE_USER_TOKEN = "single-user-token";

function readRuntimeSingleUserConfig() {
  if (typeof window !== "undefined" && window.__TCGER_SINGLE_USER__) {
    return window.__TCGER_SINGLE_USER__;
  }

  return {
    enabled: process.env.NEXT_PUBLIC_SINGLE_USER_MODE === "true",
    id: process.env.NEXT_PUBLIC_SINGLE_USER_ID?.trim() || "single-user",
    email:
      process.env.NEXT_PUBLIC_SINGLE_USER_EMAIL?.trim() || "local@tcger.test",
    username:
      process.env.NEXT_PUBLIC_SINGLE_USER_USERNAME?.trim() || "tcger-local",
  };
}

export function getSingleUserAuthUser() {
  const config = readRuntimeSingleUserConfig();

  return {
    id: config.id?.trim() || "single-user",
    email: config.email?.trim() || "local@tcger.test",
    username: config.username?.trim() || "tcger-local",
    isAdmin: true,
    showCardNumbers: true,
    showPricing: true,
    enabledYugioh: true,
    enabledMagic: true,
    enabledPokemon: true,
  };
}

export function isSingleUserModeEnabled(): boolean {
  return Boolean(readRuntimeSingleUserConfig().enabled);
}
