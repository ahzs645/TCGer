"use client";

import { AppShell } from "@/components/layout/app-shell";
import { WishlistContent } from "@/components/wishlists/wishlist-content";

export default function WishlistsPage() {
  return (
    <AppShell data-oid="0jv3fq0">
      <div className="space-y-6" data-oid="agns95_">
        <div className="space-y-2" data-oid="z28shax">
          <h1
            className="text-3xl font-heading font-semibold"
            data-oid=":kqvxfu"
          >
            Wishlists
          </h1>
          <p className="text-sm text-muted-foreground" data-oid="9gwgznt">
            Track cards you want to collect and see how complete each wishlist
            is compared to your collection.
          </p>
        </div>
        <WishlistContent data-oid="8kmmk5q" />
      </div>
    </AppShell>
  );
}
