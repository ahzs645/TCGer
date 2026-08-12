"use client";

import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { CollectionView } from "@/components/collections/sandbox/collection-view";
import { CollectionImportDialog } from "@/components/collections/collection-import-dialog";
import { CollectionHistoryDialog } from "@/components/collections/collection-history-dialog";
import { BulkAddDialog } from "@/components/collections/bulk-add-dialog";
import { CollectionExportMenu } from "@/components/collections/collection-export-menu";
import { Badge } from "@/components/ui/badge";

export default function CollectionsPage() {
  return (
    <AppShell data-oid="wa5m388">
      <div className="space-y-6" data-oid="14le6gh">
        <div className="space-y-2" data-oid="fgd97v.">
          <div className="flex flex-wrap items-center gap-2" data-oid="miiae99">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="atyfrma"
            >
              Collections
            </h1>
            <div className="ml-auto flex items-center gap-2">
              <CollectionExportMenu />
              <BulkAddDialog />
              <CollectionHistoryDialog />
              <CollectionImportDialog />
            </div>
          </div>
          <p className="text-sm text-muted-foreground" data-oid="sjfa4qn">
            Manage every card and individual copy across your binders.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="rounded-xl border bg-background p-6 text-sm text-muted-foreground">
              Loading collections...
            </div>
          }
        >
          <CollectionView data-oid="k5n513i" />
        </Suspense>
      </div>
    </AppShell>
  );
}
