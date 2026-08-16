"use client";

import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { CollectionView } from "@/components/collections/sandbox/collection-view";
import { CollectionExportMenu } from "@/components/collections/collection-export-menu";
import { CollectionImportDialog } from "@/components/collections/collection-import-dialog";
import { CollectionHistoryDialog } from "@/components/collections/collection-history-dialog";

export default function CollectionsPage() {
  return (
    <AppShell data-oid="mqbsvj2">
      <div className="space-y-6" data-oid="x.zo_0u">
        <div className="space-y-2" data-oid="zw9eniv">
          <div className="flex flex-wrap items-center gap-2" data-oid="2lpw7:1">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="af_:qar"
            >
              Collections
            </h1>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <CollectionExportMenu />
              <CollectionHistoryDialog offlineSnapshotsOnly />
              <CollectionImportDialog offlineCsvOnly />
            </div>
          </div>
          <p className="text-sm text-muted-foreground" data-oid="njr3h1:">
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
          <CollectionView data-oid="58pyumo" />
        </Suspense>
      </div>
    </AppShell>
  );
}
