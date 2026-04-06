"use client";

import { AppShell } from "@/components/layout/app-shell";
import { CollectionView } from "@/components/collections/sandbox/collection-view";
import { Badge } from "@/components/ui/badge";
import { isConvexCollectionsBackend } from "@/lib/api/collections";

export default function CollectionsPage() {
  return (
    <AppShell data-oid="wa5m388">
      <div className="space-y-6" data-oid="14le6gh">
        <div className="space-y-2" data-oid="fgd97v.">
          <div className="flex items-center gap-2" data-oid="miiae99">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="atyfrma"
            >
              Collection sandbox
            </h1>
            <Badge variant="outline" data-oid="ikiv_ay">
              Beta
            </Badge>
            {isConvexCollectionsBackend && (
              <Badge data-oid="ejjsaov">Convex Native</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground" data-oid="sjfa4qn">
            Per-copy inventory manager powered by your live binder data.
          </p>
        </div>
        <CollectionView data-oid="k5n513i" />
      </div>
    </AppShell>
  );
}
