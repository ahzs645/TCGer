"use client";

import { AppShell } from "@/components/layout/app-shell";
import { CollectionView } from "@/components/collections/sandbox/collection-view";
import { Badge } from "@/components/ui/badge";

export default function CollectionsPage() {
  return (
    <AppShell data-oid="mqbsvj2">
      <div className="space-y-6" data-oid="x.zo_0u">
        <div className="space-y-2" data-oid="zw9eniv">
          <div className="flex items-center gap-2" data-oid="2lpw7:1">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="af_:qar"
            >
              Collection sandbox
            </h1>
            <Badge variant="outline" data-oid="8-js:u6">
              Beta
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground" data-oid="njr3h1:">
            Per-copy inventory manager powered by your live binder data.
          </p>
        </div>
        <CollectionView data-oid="58pyumo" />
      </div>
    </AppShell>
  );
}
