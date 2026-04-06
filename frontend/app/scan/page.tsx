import { AppShell } from "@/components/layout/app-shell";
import { CardScanPanel } from "@/components/scan/card-scan-panel";
import { Badge } from "@/components/ui/badge";

export default function ScanPage() {
  return (
    <AppShell data-oid="i0gp:l1">
      <div className="space-y-6" data-oid="0.mgr8_">
        <div className="space-y-2" data-oid="6cc9971">
          <div className="flex items-center gap-2" data-oid="3cd3c:j">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="21-py.b"
            >
              Card Scan
            </h1>
            <Badge variant="outline" data-oid="oz6.a8n">
              Beta
            </Badge>
          </div>
          <p
            className="max-w-3xl text-sm text-muted-foreground"
            data-oid="ce33h2j"
          >
            Upload a card photo and match it against the cached perceptual hash
            index built from the local Magic, Yu-Gi-Oh!, and Pokémon card image
            corpus.
          </p>
        </div>
        <CardScanPanel data-oid="ojjtkru" />
      </div>
    </AppShell>
  );
}
