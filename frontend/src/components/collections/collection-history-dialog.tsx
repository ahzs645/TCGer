"use client";

import { useEffect, useState } from "react";
import { Clock3, Loader2, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getCollectionMutationHistory,
  undoCollectionMutation,
  type CollectionMutationAuditEntry,
} from "@/lib/api/collections";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";

const KIND_LABELS: Record<
  CollectionMutationAuditEntry["operationKind"],
  string
> = {
  add: "Added",
  update: "Updated",
  remove: "Removed",
  move: "Moved",
  bulk: "Bulk",
  import: "Imported",
  trade_settlement: "Trade settled",
  undo: "Undo",
};

function makeIdempotencyKey(auditId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `undo:${auditId}:${crypto.randomUUID()}`;
  }
  return `undo:${auditId}:${Date.now().toString(36)}`;
}

export function CollectionHistoryDialog({
  offlineSnapshotsOnly = false,
}: {
  offlineSnapshotsOnly?: boolean;
} = {}) {
  const [confirm, confirmDialog] = useConfirm();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CollectionMutationAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const { token, user } = useAuthStore();
  const requestToken =
    token ?? (offlineSnapshotsOnly ? "demo-token-static" : null);
  const fetchCollections = useCollectionsStore(
    (state) => state.fetchCollections,
  );

  const loadHistory = async () => {
    if (!requestToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getCollectionMutationHistory(requestToken, user);
      setEntries(result.entries);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load collection history",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, user]);

  const handleUndo = async (entry: CollectionMutationAuditEntry) => {
    if (!requestToken || !entry.canUndo) return;
    const confirmed = await confirm({
      title: "Undo this change?",
      description: `“${entry.summary}” will be reverted, but only if those copies have not changed since.`,
      confirmLabel: "Undo change",
    });
    if (!confirmed) return;

    setUndoingId(entry.id);
    setError(null);
    try {
      await undoCollectionMutation(
        requestToken,
        entry.id,
        makeIdempotencyKey(entry.id),
        user,
      );
      await fetchCollections(requestToken);
      await loadHistory();
    } catch (undoError) {
      setError(
        undoError instanceof Error
          ? undoError.message
          : "Failed to undo collection mutation",
      );
    } finally {
      setUndoingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Clock3 className="mr-2 h-4 w-4" />
            History
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Collection history</DialogTitle>
            <DialogDescription>
              {offlineSnapshotsOnly
                ? "The offline demo keeps the 25 most recent local changes. Only the latest change can be safely undone."
                : "Immutable per-copy changes. Undo remains available only while the affected copies match the recorded result."}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <ScrollArea className="h-[min(60vh,520px)] pr-4">
            {loading && entries.length === 0 ? (
              <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history…
              </div>
            ) : entries.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                Collection mutations will appear here.
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-4",
                      entry.operationKind === "undo" && "bg-muted/40",
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            entry.operationKind === "undo"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {KIND_LABELS[entry.operationKind]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {entry.affectedCopies}{" "}
                          {entry.affectedCopies === 1 ? "copy" : "copies"}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{entry.summary}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(entry.createdAt))}
                      </p>
                    </div>
                    {entry.canUndo && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={undoingId !== null}
                        onClick={() => void handleUndo(entry)}
                      >
                        {undoingId === entry.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        )}
                        Undo
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </>
  );
}
