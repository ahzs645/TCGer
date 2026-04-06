import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DemoScanPage() {
  return (
    <AppShell data-oid="uc05jvu">
      <div className="space-y-6" data-oid="s86t7:1">
        <div className="space-y-2" data-oid="q453wp9">
          <div className="flex items-center gap-2" data-oid="asw09cl">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="4.j-daj"
            >
              Card Scan
            </h1>
            <Badge variant="outline" data-oid=":l0e:rw">
              Live Only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground" data-oid="j:jv40n">
            The demo export does not ship the live scan index or upload API.
          </p>
        </div>
        <Card data-oid="vok6bjc">
          <CardHeader data-oid="wi:gifo">
            <CardTitle data-oid="k3nd4l.">
              Scan is disabled in demo mode
            </CardTitle>
            <CardDescription data-oid="tee2oe6">
              Use the authenticated app against the live backend to test image
              uploads, hash matching, and scan candidates.
            </CardDescription>
          </CardHeader>
          <CardContent
            className="text-sm text-muted-foreground"
            data-oid="r7x0wgd"
          >
            The production scan flow depends on the server-side hash store and
            the shared cache services for Magic, Yu-Gi-Oh!, and Pokémon card
            art.
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
