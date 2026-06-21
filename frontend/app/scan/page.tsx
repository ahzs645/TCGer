import { AppShell } from "@/components/layout/app-shell";
import { CardScanPanel } from "@/components/scan/card-scan-panel";
import { VideoScanLab } from "@/components/scan/video-scan-lab";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ScanPage() {
  return (
    <AppShell data-oid="i0gp:l1">
      <div className="space-y-6" data-oid="0.mgr8_">
        <div className="space-y-2" data-oid="6cc9971">
          <div className="flex items-center gap-2" data-oid="3cd3c:j">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="21-py.b"
            >
              Card Scan
            </h1>
            <Badge variant="outline" data-oid="oz6.a8n">
              Beta
            </Badge>
          </div>
          <p
            className="max-w-3xl text-sm text-muted-foreground"
            data-oid="ce33h2j"
          >
            Switch between still-image scan and local video scan. Video mode
            defaults to a fully on-device model (DINOv2) — no sign-in or server
            needed (Pokémon today).
          </p>
        </div>
        <Tabs defaultValue="video" className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="video">Video Mode</TabsTrigger>
            <TabsTrigger value="image">Image Mode</TabsTrigger>
          </TabsList>

          <TabsContent value="video" className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-heading font-semibold">Video Scan</h2>
                <Badge variant="secondary">Experimental</Badge>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Browser-side scanner for local video files. By default it runs
                the on-device DINOv2 embedding model — fully client-side, no
                sign-in — drawing live track overlays and the current best match
                without sending any frame to the server.
              </p>
            </div>
            <VideoScanLab />
          </TabsContent>

          <TabsContent value="image" className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-heading font-semibold">Image Scan</h2>
                <Badge variant="outline">Classic</Badge>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Upload a card photo and match it against the cached perceptual
                hash index built from the local Magic, Yu-Gi-Oh!, and Pokémon
                card image corpus.
              </p>
            </div>
            <CardScanPanel data-oid="ojjtkru" />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
