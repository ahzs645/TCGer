"use client";

import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { CollectionView } from "@/components/collections/sandbox/collection-view";
import { CollectionExportMenu } from "@/components/collections/collection-export-menu";
import { CollectionImportDialog } from "@/components/collections/collection-import-dialog";
import { CollectionHistoryDialog } from "@/components/collections/collection-history-dialog";
import { PageHeader } from "@/components/layout/page-header";

export default function CollectionsPage() {
  return (
    <AppShell data-oid="mqbsvj2">
      <div className="space-y-6" data-oid="x.zo_0u">
        <PageHeader
          title="Collections"
          description="Manage every card and individual copy across your binders."
          actions={
            <>
              <CollectionExportMenu />
              <CollectionHistoryDialog offlineSnapshotsOnly />
              <CollectionImportDialog offlineCsvOnly />
            </>
          }
        />
        <Suspense
          fallback={
            <div className="rounded-xl border bg-background p-6 text-sm text-muted-foreground">
              Loading collections...
            </div>
          }
        >
          <CollectionView data-oid="58pyumo" />
        </Suspense>
      </div>
    </AppShell>
  );
}
