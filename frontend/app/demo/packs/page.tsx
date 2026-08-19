import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { PackOpening } from "@/components/packs/pack-opening";

export const metadata: Metadata = {
  title: "Pack Opening",
};

export default function PackOpeningPage() {
  return (
    <AppShell fullBleed>
      <PackOpening />
    </AppShell>
  );
}
