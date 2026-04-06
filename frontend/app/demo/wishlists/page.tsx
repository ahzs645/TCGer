"use client";

import { AppShell } from "@/components/layout/app-shell";
import { WishlistContent } from "@/components/wishlists/wishlist-content";

export default function WishlistsPage() {
  return (
    <AppShell data-oid="xsx38ta">
      <div className="space-y-6" data-oid="ha3_ai8">
        <div className="space-y-2" data-oid="w97:jew">
          <h1
            className="text-3xl font-heading font-semibold"
            data-oid=":01370h"
          >
            Wishlists
          </h1>
          <p className="text-sm text-muted-foreground" data-oid="uslh6j4">
            Track cards you want to collect and see how complete each wishlist
            is compared to your collection.
          </p>
        </div>
        <WishlistContent data-oid="kecjj3g" />
      </div>
    </AppShell>
  );
}
