'use client';

import { AppShell } from '@/components/layout/app-shell';
import { WishlistContent } from '@/components/wishlists/wishlist-content';

export default function WishlistsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-heading font-semibold">Wishlists</h1>
          <p className="text-sm text-muted-foreground">
            Track cards you want to collect and see how complete each wishlist is compared to your collection.
          </p>
        </div>
        <WishlistContent />
      </div>
    </AppShell>
  );
}
