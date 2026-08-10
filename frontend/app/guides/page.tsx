"use client";

import { CollectionGuidesContent } from "@/components/guides/collection-guides-content";
import { AppShell } from "@/components/layout/app-shell";

export default function CollectionGuidesPage() {
  return (
    <AppShell>
      <div className="space-y-2">
        <h1 className="text-3xl font-heading font-semibold">Collection Guides</h1>
        <p className="text-sm text-muted-foreground">
          Follow curated collecting ideas, compare them with your library, and turn missing cards into a live wishlist.
        </p>
      </div>
      <CollectionGuidesContent />
    </AppShell>
  );
}

