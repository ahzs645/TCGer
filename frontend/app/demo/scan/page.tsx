import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { VideoScanLab } from "@/components/scan/video-scan-lab";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Browser Card Scanner",
};

export default function DemoScanPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-heading font-semibold">
              Browser Card Scanner
            </h1>
            <Badge variant="secondary">On-device</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Test the published Pokémon, Magic: The Gathering, and Yu-Gi-Oh!
            recognition packages without signing in. Your video stays in this
            browser; the scanner downloads its versioned model and index from
            TCGer&apos;s asset CDN and caches them for later runs.
          </p>
        </div>
        <VideoScanLab />
      </div>
    </AppShell>
  );
}
