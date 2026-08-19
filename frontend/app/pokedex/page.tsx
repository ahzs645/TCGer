import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { PokedexContent } from "@/components/pokedex/pokedex-content";

export const metadata: Metadata = {
  title: "Pokédex",
  description: "Track National Pokédex completion through your Pokémon cards.",
};

export default function PokedexPage() {
  return (
    <AppShell>
      <PokedexContent />
    </AppShell>
  );
}
