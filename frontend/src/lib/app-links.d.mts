export const appLinkRedirects: { source: string; destination: string; permanent: boolean }[];
export function appLinkFallback(raw: string): string | null;
export function demoAppLinkFallback(raw: string): string | null;
export function demoReturnTarget(raw: unknown): string;
