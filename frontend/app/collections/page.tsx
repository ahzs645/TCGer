"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Archive } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { CollectionView } from "@/components/collections/sandbox/collection-view";
import { CollectionImportDialog } from "@/components/collections/collection-import-dialog";
import { CollectionHistoryDialog } from "@/components/collections/collection-history-dialog";
import { BulkAddDialog } from "@/components/collections/bulk-add-dialog";
import { CollectionExportMenu } from "@/components/collections/collection-export-menu";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export default function CollectionsPage() {
  return (
    <AppShell data-oid="wa5m388">
      <div className="space-y-6" data-oid="14le6gh">
        <PageHeader
          title="Collections"
          description="Manage every card and individual copy across your binders."
          actions={
            <>
              <Button asChild variant="outline" size="sm">
                <Link href="/collections/organize">
                  <Archive className="mr-2 h-4 w-4" />
                  Organize
                </Link>
              </Button>
              <CollectionExportMenu />
              <BulkAddDialog />
              <CollectionHistoryDialog />
              <CollectionImportDialog />
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
          <CollectionView data-oid="k5n513i" />
        </Suspense>
      </div>
    </AppShell>
  );
}
