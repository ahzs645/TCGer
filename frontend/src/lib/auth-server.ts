import { convexBetterAuthNextJs } from '@convex-dev/better-auth/nextjs';

const convexUrl = process.env.CONVEX_URL_INTERNAL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const convexSiteUrl =
  process.env.CONVEX_SITE_URL_INTERNAL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

export const {
  handler,
  preloadAuthQuery,
  isAuthenticated,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction
} = convexBetterAuthNextJs({
  convexUrl: convexUrl ?? 'http://localhost:3210',
  convexSiteUrl: convexSiteUrl ?? 'http://localhost:3211'
});
