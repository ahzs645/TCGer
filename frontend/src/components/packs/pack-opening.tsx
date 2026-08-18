"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Download, Trash2 } from "lucide-react";

import {
  PackOpening as SharedPackOpening,
  type PackOpeningEvent,
  type PackOpeningNativeCommand,
  type PackOpeningNativeState,
  type PackOpeningPull,
  type PackOpeningPullSession,
} from "@tcg/pack-core/experience";

import { PackCardCloseUp } from "@/components/packs/pack-card-close-up";
import { PackOpeningReviewSheet } from "@/components/packs/pack-opening-review-sheet";
import { PackOpeningShell } from "@/components/packs/pack-opening-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CONFIGURED_ASSET_BASE =
  process.env.NEXT_PUBLIC_PACK_ASSET_BASE_URL?.replace(/\/+$/, "") ?? "";
const SAVED_OPENINGS_KEY = "tcger-saved-pack-openings";
const SAVED_OPENINGS_EVENT = "tcger-saved-pack-openings-changed";

interface InspectTarget {
  pulls: PackOpeningPull[];
  index: number;
}

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
 * Website host for the shared pack-opening scene. The scene and its state
 * machine come from `@tcg/pack-core`; this file supplies the same chrome the
 * iOS app wraps around it — phase controls, results, close-up and save review.
 *
 * Production reads the projected wrapper sheets from R2. A failed remote load
 * remounts against the bundled pack assets so local/offline use still works.
 */
export function PackOpening() {
  const [assetBase, setAssetBase] = useState(CONFIGURED_ASSET_BASE);
  const [rendererReady, setRendererReady] = useState(false);
  const [interfaceState, setInterfaceState] =
    useState<PackOpeningNativeState | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [reviewSession, setReviewSession] =
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
  const resultPulls = useMemo(
    () => interfaceState?.session?.packs.flat() ?? [],
    [interfaceState?.session],
  );

  const handleEvent = useCallback(
    (event: PackOpeningEvent) => {
      if (event.type === "error") {
        if (assetBase) {
          setRendererReady(false);
          setInterfaceState(null);
          setAssetBase("");
        }
        return;
      }
      if (event.type === "ready") {
        setRendererReady(true);
        return;
      }
      if (event.type === "nativeState") {
        setInterfaceState(event.state);
        return;
      }
      if (event.type === "inspectRequested") {
        setInspect({ pulls: [event.pull], index: 0 });
        return;
      }
      if (event.type === "saveRequested") {
        // The local copy keeps the browser-side history working; the review
        // sheet then offers the collection save, like the iOS sheet does.
        setSaveFailed(!persistOpening(event.session));
        setReviewSession(event.session);
      }
    },
    [assetBase],
  );

  const sendCommand = useCallback((command: PackOpeningNativeCommand) => {
    window.dispatchEvent(
      new CustomEvent<PackOpeningNativeCommand>("tcger-pack-command", {
        detail: command,
      }),
    );
  }, []);

  return (
    <div className="relative isolate h-full w-full overflow-hidden">
      <SharedPackOpening
        key={assetBase || "bundled"}
        assetBase={assetBase}
        embedded
        nativeControls
        completionActionLabel="Save pulls"
        onEvent={handleEvent}
      />
      <PackOpeningShell
        ready={rendererReady}
        state={interfaceState}
        savedOpeningsCount={savedOpenings.length}
        onOpenHistory={() => setHistoryOpen(true)}
        onCommand={sendCommand}
        onInspect={(index) => setInspect({ pulls: resultPulls, index })}
      />

      {inspect ? (
        <PackCardCloseUp
          pulls={inspect.pulls}
          index={inspect.index}
          onIndexChange={(index) =>
            setInspect((current) => (current ? { ...current, index } : current))
          }
          onClose={() => setInspect(null)}
        />
      ) : null}

      {reviewSession ? (
        <PackOpeningReviewSheet
          session={reviewSession}
          localSaveFailed={saveFailed}
          onDownload={downloadOpening}
          onClose={() => setReviewSession(null)}
        />
      ) : null}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85dvh] max-w-xl">
          <DialogHeader>
            <DialogTitle>Saved pack openings</DialogTitle>
            <DialogDescription>
              These results are stored only in this browser. Open an entry to
              review its pulls or download a portable copy.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
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
                      setInspect({ pulls: session.packs.flat(), index: 0 });
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
    </div>
  );
}
