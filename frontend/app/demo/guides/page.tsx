"use client";

import { CollectionGuidesContent } from "@/components/guides/collection-guides-content";

export default function DemoCollectionGuidesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-heading font-semibold">Collection Guides</h1>
        <p className="text-sm text-muted-foreground">
          Explore reusable collecting themes and turn them into synchronized wishlists.
        </p>
      </div>
      <CollectionGuidesContent />
    </div>
  );
}

