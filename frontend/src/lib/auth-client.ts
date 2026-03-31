import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { usernameClient } from 'better-auth/client/plugins';
import { demoAwareFetch } from './demo-mode';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_SITE_URL,
  basePath: '/api/auth',
  fetchOptions: {
    customFetchImpl: demoAwareFetch
  },
  plugins: [convexClient(), usernameClient()]
});

export const {
  signIn,
  signUp,
  signOut,
  useSession
} = authClient;
