import { AppShell } from "@/components/layout/app-shell";
import { CardSearchPanel } from "@/components/cards/card-search-panel";

export default function CardSearchPage() {
  return (
    <AppShell data-oid="wvisx6q">
      <div className="space-y-4" data-oid="73kxa8j">
        <div data-oid="3h1l_m-">
          <h1
            className="text-3xl font-heading font-semibold"
            data-oid="hv55db."
          >
            Card Explorer
          </h1>
          <p className="text-sm text-muted-foreground" data-oid="lu5rkzz">
            Search across Yu-Gi-Oh!, Magic: The Gathering, and Pokémon using the
            unified adapter layer.
          </p>
        </div>
        <CardSearchPanel data-oid="-cpcv:d" />
      </div>
    </AppShell>
  );
}
