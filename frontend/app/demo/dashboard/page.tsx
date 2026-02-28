'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isDemoMode } from '@/lib/demo-mode';

/**
 * Legacy demo dashboard route — redirects to the main app (which now handles
 * demo mode transparently) or back to the demo login page.
 */
export default function DemoDashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (isDemoMode()) {
      router.replace('/');
    } else {
      router.replace('/demo');
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
