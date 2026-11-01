// @tcger-feature {"id":"packOpening.simulationHistory","platform":"web","status":"implemented","modes":["local","demo","server"],"requires":["browser-storage"]}
"use client";

import { Download, ScanLine } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import type {
  PackOpeningPull,
  PackOpeningPullSession,
} from "@tcg/pack-core/experience";
import { CardImage } from "@/components/cards/card-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAppRoute } from "@/lib/app-routes";

interface PackOpeningReviewSheetProps {
  session: PackOpeningPullSession;
  localSaveFailed: boolean;
  onDownload: (session: PackOpeningPullSession) => void;
  onClose: () => void;
}

/** Random simulator pulls are a separate history, never physical inventory. */
export function PackOpeningReviewSheet({
  session,
  localSaveFailed,
  onDownload,
  onClose,
}: PackOpeningReviewSheetProps) {
  const pathname = usePathname();
  const pulls = useMemo(() => session.packs.flat(), [session]);
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { pull: PackOpeningPull; quantity: number }
    >();
    for (const pull of pulls) {
      const key = `${pull.tcg}:${pull.cardId}`;
      const entry = groups.get(key);
      if (entry) entry.quantity += 1;
      else groups.set(key, { pull, quantity: 1 });
    }
    return [...groups.values()];
  }, [pulls]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88dvh] max-w-lg gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {localSaveFailed ? "Simulation results" : "Simulation saved"}
          </DialogTitle>
          <DialogDescription>
            {session.packs.length} simulated{" "}
            {session.packs.length === 1 ? "pack" : "packs"} from{" "}
            {session.packLabel}, with {pulls.length} simulated pulls.
          </DialogDescription>
        </DialogHeader>
        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Simulated pulls</h3>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
            {grouped.map(({ pull, quantity }) => (
              <div
                key={`${pull.tcg}:${pull.cardId}`}
                className="w-20 shrink-0 space-y-1"
              >
                <div className="relative aspect-[63/88] overflow-hidden rounded-lg bg-muted">
                  <CardImage
                    src={pull.imageUrlSmall}
                    fallbackSrc={pull.imageUrl}
                    tcg={pull.tcg}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-contain"
                  />
                </div>
                <p className="truncate text-[11px] font-medium">{pull.name}</p>
                {quantity > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    ×{quantity}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {localSaveFailed
            ? "This browser could not keep the simulation. Download it to preserve your results."
            : "This simulation is kept in this browser’s simulation history."}
        </p>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Record a physical opening</h3>
          <p className="text-sm text-muted-foreground">
            Scan and review the cards you actually opened. The scanner can save
            those copies and link them to your sealed inventory in one
            operation.
          </p>
          <Button asChild variant="outline">
            <Link href={getAppRoute("/scan", pathname)}>
              <ScanLine className="mr-2 h-4 w-4" />
              Scan actual cards
            </Link>
          </Button>
        </section>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onDownload(session)}>
            <Download className="mr-2 h-4 w-4" />
            Download simulation JSON
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
