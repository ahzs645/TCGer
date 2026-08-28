"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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

import {
  parseSavedOpenings,
  persistOpening,
  recordPackOpened,
  removeOpening,
  savedOpeningsServerSnapshot,
  savedOpeningsSnapshot,
  subscribeToPackHistory,
} from "@/lib/packs/opening-history";
import { useOfflinePacks } from "@/lib/packs/use-offline-packs";

const CONFIGURED_ASSET_BASE =
  process.env.NEXT_PUBLIC_PACK_ASSET_BASE_URL?.replace(/\/+$/, "") ?? "";

interface InspectTarget {
  pulls: PackOpeningPull[];
  index: number;
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
  const [remoteAssetsUsable, setRemoteAssetsUsable] = useState(true);
  const [rendererReady, setRendererReady] = useState(false);
  const [interfaceState, setInterfaceState] =
    useState<PackOpeningNativeState | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [reviewSession, setReviewSession] =
    useState<PackOpeningPullSession | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const offlinePacks = useOfflinePacks();
  const downloadOfflinePackSet = offlinePacks.download;
  const savedOpeningsRaw = useSyncExternalStore(
    subscribeToPackHistory,
    savedOpeningsSnapshot,
    savedOpeningsServerSnapshot,
  );
  const savedOpenings = useMemo(
    () => parseSavedOpenings(savedOpeningsRaw),
    [savedOpeningsRaw],
  );
  const resultPulls = useMemo(
    () => interfaceState?.session?.packs.flat() ?? [],
    [interfaceState?.session],
  );

  const fallBackToBundledAssets = useCallback(() => {
    setRemoteAssetsUsable(false);
    setRendererReady(false);
    setInterfaceState(null);
    setAssetBase("");
  }, []);

  const handleEvent = useCallback(
    (event: PackOpeningEvent) => {
      if (event.type === "error") {
        if (assetBase) {
          fallBackToBundledAssets();
        }
        return;
      }
      if (event.type === "ready") {
        setRendererReady(true);
        return;
      }
      if (event.type === "nativeState") {
        setInterfaceState(event.state);
        // The dashboard's first-run spotlight retires once a pack has actually
        // been opened — not merely once the opener has been visited, and not
        // only when the pulls are saved, since saving is optional.
        if (event.state.phase !== "select") recordPackOpened();
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
    [assetBase, fallBackToBundledAssets],
  );

  const sendCommand = useCallback((command: PackOpeningNativeCommand) => {
    window.dispatchEvent(
      new CustomEvent<PackOpeningNativeCommand>("tcger-pack-command", {
        detail: command,
      }),
    );
  }, []);

  const downloadPackSet = useCallback(
    (setID: string, poolID: string) => {
      const pool = interfaceState?.cardPools.find(
        (candidate) => candidate.id === poolID,
      );
      if (pool) void downloadOfflinePackSet(setID, pool.cards);
    },
    [downloadOfflinePackSet, interfaceState?.cardPools],
  );

  // Production normally uses projected wrapper assets from R2. Offline packs
  // deliberately cache the bundled mesh/manifest and generate their wrapper
  // sheets locally, so switch to that deterministic asset source before an
  // opening begins. This also avoids a partially HTTP-cached remote manifest
  // selecting a cover image that was never part of the offline download.
  useEffect(() => {
    if (
      offlinePacks.isOnline ||
      !assetBase ||
      (interfaceState !== null && interfaceState.phase !== "select")
    ) {
      return;
    }
    fallBackToBundledAssets();
  }, [
    assetBase,
    fallBackToBundledAssets,
    interfaceState,
    offlinePacks.isOnline,
  ]);

  // `navigator.onLine` only means that the browser has a network route. Bound
  // the remote renderer warm-up so weak Wi-Fi/cellular cannot hide downloaded
  // packs indefinitely; the bundled runtime then opens durable local sets.
  useEffect(() => {
    if (!assetBase || rendererReady) return;
    const timeout = window.setTimeout(fallBackToBundledAssets, 3_000);
    return () => window.clearTimeout(timeout);
  }, [assetBase, fallBackToBundledAssets, rendererReady]);

  // Renderer readiness may have come from the browser HTTP cache, so verify
  // the remote manifest separately before treating non-downloaded sets as
  // available. The bundled placeholder manifest never grants online access.
  useEffect(() => {
    if (!assetBase) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3_000);
    void fetch(`${assetBase}/pack/manifest.json`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Remote pack manifest unavailable");
        setRemoteAssetsUsable(true);
      })
      .catch(fallBackToBundledAssets)
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [assetBase, fallBackToBundledAssets]);

  const onlinePackAccess = offlinePacks.isOnline && remoteAssetsUsable;
  const canOpenOfflinePack = offlinePacks.canOpen;
  const canOpenPack = useCallback(
    (setID: string) => canOpenOfflinePack(setID, onlinePackAccess),
    [canOpenOfflinePack, onlinePackAccess],
  );

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
        offlinePacks={{
          isOnline: onlinePackAccess,
          statusFor: offlinePacks.statusFor,
          isDownloaded: offlinePacks.isDownloaded,
          canOpen: canOpenPack,
          download: downloadPackSet,
          remove: (setID) => void offlinePacks.remove(setID),
        }}
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
