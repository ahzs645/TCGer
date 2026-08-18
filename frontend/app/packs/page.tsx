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
    <AppShell fullBleed>
      <PackOpening />
    </AppShell>
  );
}
