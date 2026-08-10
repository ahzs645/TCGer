import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { PackOpening } from "@/components/packs/pack-opening";

export const metadata: Metadata = {
  title: "Pack Opening Lab · TCGer Demo",
};

export default function PackOpeningLabPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold">
            Pack Opening Lab
          </h1>
          <p className="text-sm text-muted-foreground">
            Dev sandbox for the TCG Pocket–style booster opening. Not linked
            from navigation — direct URL only.
          </p>
        </div>
        <PackOpening />
      </div>
    </AppShell>
  );
}
