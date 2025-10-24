'use client';

import { useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { CollectionTable } from '@/components/collections/collection-table';
import { useAuthStore } from '@/stores/auth';
import { useCollectionsStore } from '@/stores/collections';
import { useRouter } from 'next/navigation';

export default function CollectionsPage() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const { fetchCollections, isLoading } = useCollectionsStore();

  useEffect(() => {
    if (!isAuthenticated || !token) {
      router.push('/setup');
      return;
    }

    // Fetch collections when page loads
    fetchCollections(token);
  }, [isAuthenticated, token, fetchCollections, router]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Collection</h1>
          <p className="text-sm text-muted-foreground">
            Manage card quantities, view pricing trends, and prepare exports for grading or trading.
          </p>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-muted-foreground">Loading collections...</div>
          </div>
        ) : (
          <CollectionTable />
        )}
      </div>
    </AppShell>
  );
}
