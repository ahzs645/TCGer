import { AppShell } from '@/components/layout/app-shell';
import { CollectionTable } from '@/components/collections/collection-table';

export default function CollectionsPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Collection</h1>
          <p className="text-sm text-muted-foreground">
            Manage card quantities, view pricing trends, and prepare exports for grading or trading.
          </p>
        </div>
        <CollectionTable />
      </div>
    </AppShell>
  );
}
