'use client';

import { AppShell } from '@/components/layout/app-shell';
import { MockCollectionView } from '@/components/collections/mock/mock-collection-view';
import { Badge } from '@/components/ui/badge';

export default function CollectionsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-heading font-semibold">Collection sandbox</h1>
            <Badge variant="outline">Beta</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Per-copy inventory manager powered by your live binder data.</p>
        </div>
        <MockCollectionView />
      </div>
    </AppShell>
  );
}
