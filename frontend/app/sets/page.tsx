import { AppShell } from "@/components/layout/app-shell";
import { SetBrowser } from "@/components/sets/set-browser";

export default function SetsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Set Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Browse every enabled game, track completion, and open a set checklist.
          </p>
        </div>
        <SetBrowser />
      </div>
    </AppShell>
  );
}
