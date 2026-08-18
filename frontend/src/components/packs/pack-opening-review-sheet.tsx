"use client";

import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { SealedInventoryResponse } from "@tcg/api-types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCardToCollection,
  getCollections,
  LIBRARY_COLLECTION_ID,
  type Collection,
} from "@/lib/api/collections";
import { createSealedOpening, getSealedInventory } from "@/lib/api/sealed";
import { pullCardData } from "@/lib/packs/pull-card";
import { useAuthStore } from "@/stores/auth";

const NO_INVENTORY = "__none__";

interface PackOpeningReviewSheetProps {
  session: PackOpeningPullSession;
  /** Set when the browser could not keep a local copy of the opening. */
  localSaveFailed: boolean;
  onDownload: (session: PackOpeningPullSession) => void;
  onClose: () => void;
}

interface PullSummary {
  pull: PackOpeningPull;
  quantity: number;
}

function tierRank(tier: PackOpeningPull["tier"]): number {
  return { common: 1, uncommon: 2, rare: 3, ultra: 4, chase: 5 }[tier];
}

function groupPulls(pulls: PackOpeningPull[]): PullSummary[] {
  const groups = new Map<string, PullSummary>();
  for (const pull of pulls) {
    const entry = groups.get(pull.cardId);
    if (entry) entry.quantity += 1;
    else groups.set(pull.cardId, { pull, quantity: 1 });
  }
  return [...groups.values()].sort((a, b) => {
    const rank = tierRank(b.pull.tier) - tierRank(a.pull.tier);
    return rank !== 0 ? rank : a.pull.name.localeCompare(b.pull.name);
  });
}

function copyIdsIn(collection: Collection | undefined): Set<string> {
  const ids = new Set<string>();
  for (const card of collection?.cards ?? []) {
    for (const copy of card.copies ?? []) ids.add(copy.id);
  }
  return ids;
}

/**
 * Web counterpart of the iOS `PackOpeningReviewSheet`: review the pulls, pick a
 * destination collection, optionally burn a sealed booster from inventory, then
 * add every revealed card as its own copy.
 */
export function PackOpeningReviewSheet({
  session,
  localSaveFailed,
  onDownload,
  onClose,
}: PackOpeningReviewSheetProps) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const pulls = useMemo(() => session.packs.flat(), [session]);
  const grouped = useMemo(() => groupPulls(pulls), [pulls]);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [inventory, setInventory] = useState<SealedInventoryResponse[]>([]);
  const [destinationId, setDestinationId] = useState(LIBRARY_COLLECTION_ID);
  const [inventoryId, setInventoryId] = useState(NO_INVENTORY);
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tcg = pulls[0]?.tcg;
  const setCode = pulls[0]?.setCode;

  const eligibleInventory = useMemo(
    () =>
      inventory
        .filter((item) => {
          const type = item.product.productType.toLowerCase();
          const isBooster = type.includes("booster") && !type.includes("box");
          const matchesGame =
            !tcg || item.product.tcg.toLowerCase() === tcg.toLowerCase();
          const matchesSet =
            !setCode ||
            !item.product.setCode ||
            item.product.setCode.toLowerCase() === setCode.toLowerCase();
          return (
            isBooster &&
            matchesGame &&
            matchesSet &&
            item.quantity >= session.packs.length
          );
        })
        .sort((a, b) => a.product.name.localeCompare(b.product.name)),
    [inventory, session.packs.length, setCode, tcg],
  );

  // Only a real binder exposes the copy identifiers the sealed ledger needs to
  // associate the opened cards, so the library shortcut cannot be linked.
  const canLinkInventory =
    destinationId !== LIBRARY_COLLECTION_ID && eligibleInventory.length > 0;

  useEffect(() => {
    if (!canLinkInventory) setInventoryId(NO_INVENTORY);
  }, [canLinkInventory]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [loadedCollections, loadedInventory] = await Promise.all([
          getCollections(token, user),
          getSealedInventory(token).catch(() => []),
        ]);
        if (cancelled) return;
        setCollections(loadedCollections);
        setInventory(loadedInventory);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load your collections.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const save = async () => {
    if (!token || saving) return;
    setSaving(true);
    setError(null);
    const notes = `Opened from ${session.packLabel} via Pack Opening`;

    try {
      const before = copyIdsIn(
        collections.find((entry) => entry.id === destinationId),
      );

      // Resumes where a partial failure stopped rather than double-adding.
      for (const pull of pulls.slice(savedCount)) {
        await addCardToCollection(
          token,
          destinationId,
          {
            cardId: pull.cardId,
            quantity: 1,
            notes,
            cardData: pullCardData(pull),
          },
          user,
        );
        setSavedCount((count) => count + 1);
      }

      if (inventoryId !== NO_INVENTORY) {
        const refreshed = await getCollections(token, user);
        const after = copyIdsIn(
          refreshed.find((entry) => entry.id === destinationId),
        );
        const collectionIds = [...after].filter((id) => !before.has(id));
        await createSealedOpening(token, inventoryId, {
          openedQuantity: session.packs.length,
          collectionIds,
          openedAt: session.openedAt,
          notes,
        });
      }

      setDone(true);
    } catch (saveError) {
      const prefix = savedCount > 0 ? `${savedCount} cards were saved. ` : "";
      setError(
        prefix +
          (saveError instanceof Error
            ? saveError.message
            : "Saving these pulls failed."),
      );
    } finally {
      setSaving(false);
    }
  };

  const destinationName =
    destinationId === LIBRARY_COLLECTION_ID
      ? "your library"
      : (collections.find((entry) => entry.id === destinationId)?.name ??
        "the selected binder");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88dvh] max-w-lg gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {done ? "Pulls saved" : `Save ${pulls.length} pulls`}
          </DialogTitle>
          <DialogDescription>
            {done
              ? `Added ${savedCount} cards from ${session.packLabel} to ${destinationName}.`
              : `${session.packs.length} ${session.packs.length === 1 ? "pack" : "packs"} from ${session.packLabel}. Every revealed card is added as its own copy.`}
          </DialogDescription>
        </DialogHeader>

        {/* min-w-0: the dialog is a grid, so without it the thumbnail strip
            stretches the column instead of scrolling inside it. */}
        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Review pulls</h3>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
            {grouped.map((entry) => (
              <div key={entry.pull.cardId} className="w-20 shrink-0 space-y-1">
                <div className="relative aspect-[63/88] overflow-hidden rounded-lg bg-muted">
                  <CardImage
                    src={entry.pull.imageUrlSmall}
                    fallbackSrc={entry.pull.imageUrl}
                    tcg={entry.pull.tcg}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-contain"
                  />
                </div>
                <p className="truncate text-[11px] font-medium">
                  {entry.pull.name}
                </p>
                {entry.quantity > 1 ? (
                  <p className="text-[11px] text-muted-foreground">
                    ×{entry.quantity}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {token ? (
          <>
            <section className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">Add to collection</h3>
              <Select
                value={destinationId}
                onValueChange={setDestinationId}
                disabled={loading || saving || savedCount > 0}
              >
                <SelectTrigger aria-label="Destination collection">
                  <SelectValue placeholder="Choose a destination" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={LIBRARY_COLLECTION_ID}>
                    Library (unsorted)
                  </SelectItem>
                  {collections
                    .filter((entry) => entry.id !== LIBRARY_COLLECTION_ID)
                    .map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </section>

            <section className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">
                Physical opening (optional)
              </h3>
              <Select
                value={inventoryId}
                onValueChange={setInventoryId}
                disabled={!canLinkInventory || saving || done}
              >
                <SelectTrigger aria-label="Linked sealed product">
                  <SelectValue placeholder="Don't link inventory" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INVENTORY}>
                    Don&apos;t link inventory
                  </SelectItem>
                  {eligibleInventory.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.product.name} · {item.quantity} owned
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {destinationId === LIBRARY_COLLECTION_ID
                  ? "Choose a binder as the destination to link this opening to a sealed product."
                  : eligibleInventory.length === 0
                    ? "No matching booster-pack inventory has enough quantity for this opening."
                    : `Linking subtracts ${session.packs.length} pack${session.packs.length === 1 ? "" : "s"} from inventory and associates every saved card copy with the ledger.`}
              </p>
            </section>
          </>
        ) : (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            {localSaveFailed
              ? "This browser could not store the opening. Download a copy to keep it, or sign in to save the pulls to a collection."
              : "This opening is kept in this browser only. Sign in to save the pulls into a collection."}
          </p>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onDownload(session)}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download JSON
          </Button>
          {token && !done ? (
            <Button
              type="button"
              onClick={save}
              disabled={loading || saving}
              className="min-w-24"
            >
              {saving ? `Saving ${savedCount}/${pulls.length}…` : "Save"}
            </Button>
          ) : (
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
