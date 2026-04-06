import { AppShell } from "@/components/layout/app-shell";
import { CardSearchPanel } from "@/components/cards/card-search-panel";

export default function CardSearchPage() {
  return (
    <AppShell data-oid="qn4dcvc">
      <div className="space-y-4" data-oid="q:pvhfk">
        <div data-oid="sshk-9p">
          <h1
            className="text-3xl font-heading font-semibold"
            data-oid="ee:57_0"
          >
            Card Explorer
          </h1>
          <p className="text-sm text-muted-foreground" data-oid="s4rqc-7">
            Search across Yu-Gi-Oh!, Magic: The Gathering, and Pokémon using the
            unified adapter layer.
          </p>
        </div>
        <CardSearchPanel data-oid="27n9xqn" />
      </div>
    </AppShell>
  );
}
