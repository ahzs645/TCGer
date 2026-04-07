"use client";

import React from "react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";

import { authClient, useSession } from "@/lib/auth-client";
import { toAuthUser } from "@/lib/auth-helpers";
import { ensureDemoInterceptor, isDemoMode } from "@/lib/demo-mode";
import {
  getSingleUserAuthUser,
  isSingleUserModeEnabled,
  SINGLE_USER_TOKEN,
} from "@/lib/single-user-mode";
import { resolvePublicConvexOrigin } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

function AuthSessionSync() {
  ensureDemoInterceptor();

  const { data: session, isPending } = useSession();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const singleUserMode = isSingleUserModeEnabled();

  React.useEffect(() => {
    const onDemoRoute =
      typeof window !== "undefined" &&
      (window.location.pathname === "/demo" ||
        window.location.pathname.startsWith("/demo/"));

    if (onDemoRoute || isDemoMode()) {
      return;
    }

    if (singleUserMode) {
      setAuth(getSingleUserAuthUser(), SINGLE_USER_TOKEN);
      return;
    }

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
  }, [clearAuth, isAuthenticated, isPending, session, setAuth, singleUserMode]);

  return null;
}

export function ConvexClientProvider({
  children,
  initialToken,
}: {
  children: React.ReactNode;
  initialToken?: string | null;
}) {
  ensureDemoInterceptor();
  const [convexClient] = React.useState(
    () => new ConvexReactClient(resolvePublicConvexOrigin()),
  );

  return (
    <ConvexBetterAuthProvider
      client={convexClient}
      authClient={authClient}
      initialToken={initialToken}
      data-oid="40dpbt1"
    >
      <AuthSessionSync data-oid="l8vquw2" />
      {children}
    </ConvexBetterAuthProvider>
  );
}
