import { createAuthClient } from 'better-auth/react';
import { usernameClient } from 'better-auth/client/plugins';

const publicApiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export const authClient = createAuthClient({
  baseURL: publicApiBase,
  basePath: '/auth',
  plugins: [usernameClient()]
});

export const {
  signIn,
  signUp,
  signOut,
  useSession
} = authClient;
