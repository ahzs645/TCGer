'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { checkSetupRequired } from '@/lib/api/auth';
import { getSettings } from '@/lib/api/settings';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { LoginDialog } from '@/components/auth/login-dialog';
import { SignupDialog } from '@/components/auth/signup-dialog';

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setSetupRequired = useAuthStore((state) => state.setSetupRequired);
  const [loading, setLoading] = useState(true);
  const [shouldBlock, setShouldBlock] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    // Demo pages bypass all auth/setup checks
    if (pathname?.startsWith('/demo')) {
      setLoading(false);
      setShouldBlock(false);
      setNeedsAuth(false);
      return;
    }

    const checkAccess = async () => {
      try {
        // First check if setup is required
        const { setupRequired: required } = await checkSetupRequired();
        if (typeof setSetupRequired === 'function') {
          setSetupRequired(required);
        } else {
          console.warn('Auth store missing setSetupRequired; skipping setup flag update');
        }

        // If setup is required and we're not on the setup page, redirect
        if (required && pathname !== '/setup') {
          router.push('/setup');
          setShouldBlock(true);
          setLoading(false);
          return;
        }

        // If setup is not required and we're on the setup page, redirect to dashboard
        if (!required && pathname === '/setup') {
          router.push('/');
          setShouldBlock(true);
          setLoading(false);
          return;
        }

        // If on setup page, allow access
        if (pathname === '/setup') {
          setShouldBlock(false);
          setNeedsAuth(false);
          setLoading(false);
          return;
        }

        // Now check app settings for authentication requirements
        const settings = await getSettings();

        // Check if the current route requires authentication
        const isDashboard = pathname === '/';
        const isCollections = pathname.startsWith('/collections');
        const isCards = pathname.startsWith('/cards');

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
        console.error('Failed to check access:', error);
        setShouldBlock(false);
        setNeedsAuth(false);
      } finally {
        setLoading(false);
      }
    };

    checkAccess();
  }, [pathname, router, setSetupRequired, isAuthenticated]);

  // Always render the same structure
  if (loading || shouldBlock) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <AuthRequiredScreen />
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
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-4">
          <Image
            src="/logo.svg"
            alt="TCGer logo"
            width={64}
            height={64}
            className="dark:invert"
          />
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold">Authentication Required</h1>
            <p className="text-sm text-muted-foreground">
              Please sign in to access this page.
            </p>
          </div>
          <Button size="lg" onClick={() => setLoginOpen(true)} className="w-full max-w-xs">
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </Button>
        </div>
      </div>
      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSwitchToSignup={handleSwitchToSignup}
      />
      <SignupDialog
        open={signupOpen}
        onOpenChange={setSignupOpen}
        onSwitchToLogin={handleSwitchToLogin}
      />
    </>
  );
}
