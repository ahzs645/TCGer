import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { PackOpening } from "@/components/packs/pack-opening";

export const metadata: Metadata = {
  title: "Pack Opening · TCGer",
  description:
    "Choose a booster, tear it open in 3D, and reveal your cards one by one.",
};

export default function PackOpeningPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold sm:text-3xl">
            Pack Opening
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose a booster, tear the wrapper, and reveal your pulls one card
            at a time.
          </p>
        </div>
        <PackOpening />
      </div>
    </AppShell>
  );
}
