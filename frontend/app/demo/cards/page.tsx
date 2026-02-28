import { AppShell } from '@/components/layout/app-shell';
import { CardSearchPanel } from '@/components/cards/card-search-panel';

export default function CardSearchPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Card Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Search across Yu-Gi-Oh!, Magic: The Gathering, and Pokémon using the unified adapter layer.
          </p>
        </div>
        <CardSearchPanel />
      </div>
    </AppShell>
  );
}
