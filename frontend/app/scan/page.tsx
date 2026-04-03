import { AppShell } from '@/components/layout/app-shell';
import { CardScanPanel } from '@/components/scan/card-scan-panel';
import { Badge } from '@/components/ui/badge';

export default function ScanPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-heading font-semibold">Card Scan</h1>
            <Badge variant="outline">Beta</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Upload a card photo and match it against the cached perceptual hash index built from the local Magic, Yu-Gi-Oh!, and Pokémon card image corpus.
          </p>
        </div>
        <CardScanPanel />
      </div>
    </AppShell>
  );
}
