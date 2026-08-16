"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Download, History, Trash2 } from "lucide-react";

import {
  PackOpening as SharedPackOpening,
  type PackOpeningEvent,
  type PackOpeningPull,
  type PackOpeningPullSession,
} from "@tcg/pack-core/experience";

import { CardImage } from "@/components/cards/card-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CONFIGURED_ASSET_BASE =
  process.env.NEXT_PUBLIC_PACK_ASSET_BASE_URL?.replace(/\/+$/, "") ?? "";
const SAVED_OPENINGS_KEY = "tcger-saved-pack-openings";
const SAVED_OPENINGS_EVENT = "tcger-saved-pack-openings-changed";

function subscribeToSavedOpenings(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_OPENINGS_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SAVED_OPENINGS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SAVED_OPENINGS_EVENT, onChange);
  };
}

function savedOpeningsSnapshot() {
  return localStorage.getItem(SAVED_OPENINGS_KEY) ?? "[]";
}

function parseSavedOpenings(raw: string): PackOpeningPullSession[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistOpening(session: PackOpeningPullSession): boolean {
  let sessions: PackOpeningPullSession[] = [];
  try {
    const stored = localStorage.getItem(SAVED_OPENINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) sessions = parsed;
    }
  } catch {
    // A damaged prior value should not prevent the current opening from saving.
  }
  try {
    localStorage.setItem(
      SAVED_OPENINGS_KEY,
      JSON.stringify([
        session,
        ...sessions.filter((item) => item.id !== session.id),
      ]),
    );
    window.dispatchEvent(new Event(SAVED_OPENINGS_EVENT));
    return true;
  } catch {
    return false;
  }
}

function removeOpening(sessionId: string) {
  const sessions = parseSavedOpenings(savedOpeningsSnapshot()).filter(
    (session) => session.id !== sessionId,
  );
  localStorage.setItem(SAVED_OPENINGS_KEY, JSON.stringify(sessions));
  window.dispatchEvent(new Event(SAVED_OPENINGS_EVENT));
}

function downloadOpening(session: PackOpeningPullSession) {
  const blob = new Blob([JSON.stringify(session, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${session.packLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "pack"}-${session.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Production reads the projected wrapper sheets from R2. A failed remote load
 * remounts against the bundled pack assets so local/offline use still works.
 */
export function PackOpening() {
  const [assetBase, setAssetBase] = useState(CONFIGURED_ASSET_BASE);
  const [inspectedPull, setInspectedPull] = useState<PackOpeningPull | null>(null);
  const [savedSession, setSavedSession] =
    useState<PackOpeningPullSession | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const savedOpeningsRaw = useSyncExternalStore(
    subscribeToSavedOpenings,
    savedOpeningsSnapshot,
    () => "[]",
  );
  const savedOpenings = useMemo(
    () => parseSavedOpenings(savedOpeningsRaw),
    [savedOpeningsRaw],
  );
  const savedPulls = useMemo(
    () => savedSession?.packs.flat() ?? [],
    [savedSession],
  );
  const handleEvent = useCallback(
    (event: PackOpeningEvent) => {
      if (event.type === "error") {
        if (assetBase) setAssetBase("");
        return;
      }
      if (event.type === "inspectRequested") {
        setInspectedPull(event.pull);
        return;
      }
      if (event.type === "saveRequested") {
        setSaveFailed(!persistOpening(event.session));
        setSavedSession(event.session);
      }
    },
    [assetBase],
  );

  return (
    <>
      {savedOpenings.length ? (
        <div className="mb-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-2 h-4 w-4" aria-hidden="true" />
            Saved openings ({savedOpenings.length})
          </Button>
        </div>
      ) : null}
      <SharedPackOpening
        key={assetBase || "bundled"}
        assetBase={assetBase}
        completionActionLabel="Save pulls"
        onEvent={handleEvent}
      />

      <Dialog
        open={Boolean(inspectedPull)}
        onOpenChange={(open) => !open && setInspectedPull(null)}
      >
        <DialogContent className="max-w-md">
          {inspectedPull ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 pr-8">
                  <Badge variant="secondary">{inspectedPull.rarity}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {inspectedPull.setCode} · {inspectedPull.collectorNumber}
                  </span>
                </div>
                <DialogTitle>{inspectedPull.name}</DialogTitle>
                <DialogDescription>
                  {inspectedPull.setName}
                </DialogDescription>
              </DialogHeader>
              <div className="relative mx-auto aspect-[63/88] w-full max-w-72 overflow-hidden rounded-xl bg-muted">
                <CardImage
                  src={inspectedPull.imageUrl}
                  fallbackSrc={inspectedPull.imageUrlSmall}
                  tcg={inspectedPull.tcg}
                  alt={inspectedPull.name}
                  fill
                  priority
                  sizes="288px"
                  className="object-contain"
                />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Saved pack openings</DialogTitle>
            <DialogDescription>
              These results are stored only in this browser. Open an entry to
              review its pulls or download a portable copy.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {savedOpenings.map((session) => {
              const pullCount = session.packs.reduce(
                (total, pack) => total + pack.length,
                0,
              );
              return (
                <div
                  key={session.id}
                  className="flex items-center gap-2 rounded-lg border p-3"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setHistoryOpen(false);
                      setSaveFailed(false);
                      setSavedSession(session);
                    }}
                  >
                    <span className="block truncate text-sm font-medium">
                      {session.packLabel}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {pullCount} cards ·{" "}
                      {new Date(session.openedAt).toLocaleString()}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Download ${session.packLabel}`}
                    onClick={() => downloadOpening(session)}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${session.packLabel}`}
                    onClick={() => removeOpening(session.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(savedSession)}
        onOpenChange={(open) => !open && setSavedSession(null)}
      >
        <DialogContent className="max-w-lg">
          {savedSession ? (
            <>
              <DialogHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </div>
                <DialogTitle>
                  {saveFailed
                    ? "The browser could not store these pulls"
                    : "Pulls saved to this browser"}
                </DialogTitle>
                <DialogDescription>
                  {saveFailed
                    ? `Download the ${savedPulls.length} cards from ${savedSession.packLabel} to keep a portable copy instead.`
                    : `Saved ${savedPulls.length} cards from ${savedSession.packLabel}. Download a portable copy if you want to keep or share the opening outside this browser.`}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
                {savedPulls.map((pull, index) => (
                  <button
                    type="button"
                    key={`${pull.cardId}-${index}`}
                    onClick={() => {
                      setSavedSession(null);
                      setInspectedPull(pull);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="min-w-0 truncate text-sm font-medium">
                      {pull.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {pull.rarity}
                    </span>
                  </button>
                ))}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => downloadOpening(savedSession)}
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Download JSON
                </Button>
                <Button type="button" onClick={() => setSavedSession(null)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
