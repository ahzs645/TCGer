import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { PackOpening } from "@/components/packs/pack-opening";

export const metadata: Metadata = {
  title: "Pack Opening · TCGer Demo",
};

export default function PackOpeningPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Pack Opening</h1>
          <p className="text-sm text-muted-foreground">
            Open a booster in 3D — browse the carousel, tear the wrapper and
            reveal your pulls one card at a time.
          </p>
        </div>
        <PackOpening />
      </div>
    </AppShell>
  );
}
