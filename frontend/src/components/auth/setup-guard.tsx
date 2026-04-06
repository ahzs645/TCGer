"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { LogIn } from "lucide-react";
import { checkSetupRequired } from "@/lib/api/auth";
import { useSession } from "@/lib/auth-client";
import { getSettings } from "@/lib/api/settings";
import { ensureDemoInterceptor } from "@/lib/demo-mode";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { LoginDialog } from "@/components/auth/login-dialog";
import { SignupDialog } from "@/components/auth/signup-dialog";

export function SetupGuard({ children }: { children: React.ReactNode }) {
  // Re-install demo fetch interceptor if user was already in demo mode
  // (e.g. returning from a page refresh). Must run before any API calls.
  ensureDemoInterceptor();

  const router = useRouter();
  const pathname = usePathname();
  const { isPending: sessionPending } = useSession();
  const { isAuthenticated, token } = useAuthStore((state) => ({
    isAuthenticated: state.isAuthenticated,
    token: state.token,
  }));
  const setSetupRequired = useAuthStore((state) => state.setSetupRequired);
  const [loading, setLoading] = useState(true);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [shouldBlock, setShouldBlock] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  // Wait for zustand to hydrate auth state from localStorage before running
  // access checks. Without this, the first render always sees
  // isAuthenticated=false and briefly flashes the auth screen on reload.
  // Guard with optional chaining so static export (no localStorage) doesn't crash.
  const [hydrated, setHydrated] = useState(
    () => useAuthStore.persist?.hasHydrated?.() ?? false,
  );
  useEffect(() => {
    const unsub = useAuthStore.persist?.onFinishHydration?.(() =>
      setHydrated(true),
    );
    return () => unsub?.();
  }, []);

  useEffect(() => {
    // Demo pages bypass all auth/setup checks
    if (pathname?.startsWith("/demo")) {
      setLoading(false);
      setShouldBlock(false);
      setNeedsAuth(false);
      return;
    }

    // Don't check access until the auth store has hydrated from localStorage.
    // This prevents a flash of the auth screen when a valid session exists.
    if (!hydrated || sessionPending) return;

    // Track whether this effect invocation has been superseded by a newer one.
    // Prevents stale async results from overwriting current state (e.g. an old
    // checkAccess that started before login completing after the post-login one).
    let stale = false;

    // Only show the full-screen spinner on the very first check.
    // Subsequent navigations keep the current page visible while re-checking
    // in the background, preventing the white flash between pages.
    if (!initialCheckDone) {
      setLoading(true);
    }

    const checkAccess = async () => {
      try {
        // First check if setup is required
        const { setupRequired: required } = await checkSetupRequired();
        if (stale) return;

        if (typeof setSetupRequired === "function") {
          setSetupRequired(required);
        } else {
          console.warn(
            "Auth store missing setSetupRequired; skipping setup flag update",
          );
        }

        // If setup is required and we're not on the setup page, redirect
        if (required && pathname !== "/setup") {
          router.push("/setup");
          setShouldBlock(true);
          setLoading(false);
          return;
        }

        // If setup is not required and we're on the setup page, redirect to dashboard
        if (!required && pathname === "/setup") {
          router.push("/");
          setShouldBlock(true);
          setLoading(false);
          return;
        }

        // If on setup page, allow access
        if (pathname === "/setup") {
          setShouldBlock(false);
          setNeedsAuth(false);
          setLoading(false);
          return;
        }

        // Now check app settings for authentication requirements
        const settings = await getSettings(isAuthenticated ? token : null);
        if (stale) return;

        // Check if the current route requires authentication
        const isDashboard = pathname === "/";
        const isCollections = pathname.startsWith("/collections");
        const isCards = pathname.startsWith("/cards");

        let requiresAuth = false;

        if (isDashboard && !settings.publicDashboard) {
          requiresAuth = true;
        } else if (isCollections && !settings.publicCollections) {
          requiresAuth = true;
        } else if (isCards) {
          // Cards/search always requires auth
          requiresAuth = true;
        } else if (settings.requireAuth) {
          // If global requireAuth is true, everything needs auth
          requiresAuth = true;
        }

        if (requiresAuth && !isAuthenticated) {
          setNeedsAuth(true);
          setShouldBlock(false);
        } else {
          setNeedsAuth(false);
          setShouldBlock(false);
        }
      } catch (error) {
        if (stale) return;
        console.error("Failed to check access:", error);
        setShouldBlock(false);
        setNeedsAuth(false);
      } finally {
        if (!stale) {
          setLoading(false);
          setInitialCheckDone(true);
        }
      }
    };

    checkAccess();

    return () => {
      stale = true;
    };
  }, [
    hydrated,
    pathname,
    router,
    sessionPending,
    setSetupRequired,
    isAuthenticated,
    token,
  ]);

  // Demo paths bypass all blocking conditions — they never need a real
  // backend session, and Better Auth's useSession may hang on GitHub Pages
  // where no server exists.
  const isDemo = pathname?.startsWith("/demo");

  // Always render the same structure
  if (loading || shouldBlock || (!isDemo && sessionPending)) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        data-oid="1h6.5jh"
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          data-oid=":::1ve0"
        />
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background p-4"
        data-oid="rr4eiy0"
      >
        <AuthRequiredScreen data-oid="fvycwo6" />
      </div>
    );
  }

  return <>{children}</>;
}

function AuthRequiredScreen() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  const handleSwitchToSignup = () => {
    setLoginOpen(false);
    setSignupOpen(true);
  };

  const handleSwitchToLogin = () => {
    setSignupOpen(false);
    setLoginOpen(true);
  };

  return (
    <>
      <div className="w-full max-w-md space-y-6" data-oid="t0dds_2">
        <div
          className="flex flex-col items-center space-y-4"
          data-oid="z7h13k:"
        >
          <Image
            src="/logo.svg"
            alt="TCGer logo"
            width={64}
            height={64}
            className="dark:invert"
            data-oid="qypb:ae"
          />

          <div className="space-y-2 text-center" data-oid="ivlguny">
            <h1 className="text-2xl font-bold" data-oid="kk:2pi8">
              Authentication Required
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="m_5shwt">
              Please sign in to access this page.
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => setLoginOpen(true)}
            className="w-full max-w-xs"
            data-oid="4ph4m4n"
          >
            <LogIn className="mr-2 h-4 w-4" data-oid="ikhj1ku" />
            Sign In
          </Button>
        </div>
      </div>
      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSwitchToSignup={handleSwitchToSignup}
        data-oid="vr2x09c"
      />

      <SignupDialog
        open={signupOpen}
        onOpenChange={setSignupOpen}
        onSwitchToLogin={handleSwitchToLogin}
        data-oid="b93v_z-"
      />
    </>
  );
}
