import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { SetBrowser } from "@/components/sets/set-browser";

export const metadata: Metadata = {
  title: "Set Explorer",
};

export default function SetsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Set Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Follow the sets you’ve started and find your next checklist.
          </p>
        </div>
        <SetBrowser />
      </div>
    </AppShell>
  );
}
