import { ScanReviewLab } from "@/components/scan/scan-review-lab";
import { Badge } from "@/components/ui/badge";

// Dev tool: intentionally NOT wrapped in AppShell — the setup/auth guard
// requires the backend, and this page is fully client-side (local video +
// preprocessed results JSON, no server in the loop).
export default function ScanReviewPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-heading font-semibold">Scan Review</h1>
          <Badge variant="outline">Dev tool</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Scrub a video with preprocessed pipeline results overlaid — YOLO
          boxes, identifications, gate decisions — and compare the
          identification timeline against a ground-truth fixture to spot
          missed cards. Preprocess with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            npm --prefix backend run scan:video-live-stream
          </code>{" "}
          and load the resulting JSON here.
        </p>
      </div>
      <ScanReviewLab />
    </main>
  );
}
