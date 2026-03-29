'use client';

import React from 'react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { ConvexReactClient } from 'convex/react';

import { authClient, useSession } from '@/lib/auth-client';
import { toAuthUser } from '@/lib/auth-helpers';
import { useAuthStore } from '@/stores/auth';

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210'
);

function AuthSessionSync() {
  const { data: session, isPending } = useSession();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  React.useEffect(() => {
    if (isPending) {
      return;
    }

    const user = session?.user as Record<string, unknown> | undefined;
    const token = session?.session?.token;

    if (!user || !token) {
      if (isAuthenticated) {
        clearAuth();
      }
      return;
    }

    setAuth(toAuthUser(user), token);
  }, [clearAuth, isAuthenticated, isPending, session, setAuth]);

  return null;
}

export function ConvexClientProvider({
  children,
  initialToken
}: {
  children: React.ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ConvexBetterAuthProvider
      client={convex}
      authClient={authClient}
      initialToken={initialToken}
    >
      <AuthSessionSync />
      {children}
    </ConvexBetterAuthProvider>
  );
}
