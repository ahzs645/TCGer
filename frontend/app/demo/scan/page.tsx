import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function DemoScanPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-heading font-semibold">Card Scan</h1>
            <Badge variant="outline">Live Only</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            The demo export does not ship the live scan index or upload API.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Scan is disabled in demo mode</CardTitle>
            <CardDescription>
              Use the authenticated app against the live backend to test image uploads, hash matching, and scan candidates.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The production scan flow depends on the server-side hash store and the shared cache services for Magic, Yu-Gi-Oh!, and Pokémon card art.
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
