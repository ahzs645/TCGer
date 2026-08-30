"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogIn, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  checkinDeck,
  checkoutDeck,
  getActiveDeckCheckout,
  type DeckCheckoutSession,
  type DeckResponse,
} from "@/lib/api/decks";
import { getStorageContainers } from "@/lib/api/collection-operations";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";

export function DeckCheckoutPanel({ deck }: { deck: DeckResponse }) {
  const token = useAuthStore((state) => state.token);
  const collections = useCollectionsStore((state) => state.collections);
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [refileSession, setRefileSession] =
    useState<DeckCheckoutSession | null>(null);
  const checkoutQuery = useQuery({
    queryKey: ["deck-checkout", deck.id],
    queryFn: () => getActiveDeckCheckout(token!, deck.id),
    enabled: !!token,
  });
  const storageQuery = useQuery({
    queryKey: ["storage", "containers"],
    queryFn: () => getStorageContainers(token!),
    enabled: !!token,
  });
  const checkoutMutation = useMutation({
    mutationFn: () => checkoutDeck(token!, deck.id, note),
    onSuccess: async () => {
      setNote("");
      await queryClient.invalidateQueries({
        queryKey: ["deck-checkout", deck.id],
      });
    },
  });
  const checkinMutation = useMutation({
    mutationFn: () => checkinDeck(token!, deck.id),
    onSuccess: async (completed) => {
      setRefileSession(completed);
      await queryClient.invalidateQueries({
        queryKey: ["deck-checkout", deck.id],
      });
    },
  });
  const session = checkoutQuery.data;
  const displayedSession = session ?? refileSession;
  const cardByEntry = useMemo(
    () =>
      new Map(
        collections.flatMap((binder) =>
          binder.cards.flatMap((card) =>
            card.copies.map((copy) => [copy.id, card.name] as const),
          ),
        ),
      ),
    [collections],
  );
  const containers = storageQuery.data ?? [];
  const location = (
    containerId?: string,
    compartmentId?: string,
    slotIndex?: number,
  ) => {
    const container = containers.find((item) => item.id === containerId);
    const compartment = container?.compartments.find(
      (item) => item.id === compartmentId,
    );
    return container && compartment && slotIndex !== undefined
      ? `${container.name} · ${compartment.label} · slot ${slotIndex + 1}`
      : "Unsorted — locate manually";
  };

  return (
    <div className="mt-5 space-y-3 rounded-lg border bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Physical deck checkout</h3>
          <p className="text-xs text-muted-foreground">
            Reserve concrete owned copies so another deck cannot over-allocate
            them.
          </p>
        </div>
        {displayedSession && (
          <Badge>{session ? "Checked out" : "Refiling"}</Badge>
        )}
      </div>
      {checkoutQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Checking availability…</p>
      ) : displayedSession ? (
        <>
          <p className="text-xs text-muted-foreground">
            {session ? "Pull list" : "Refiling list"} · checked out{" "}
            {new Date(displayedSession.checkedOutAt).toLocaleString()}
            {displayedSession.note ? ` · ${displayedSession.note}` : ""}
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {[...displayedSession.allocations]
              .sort((left, right) =>
                location(
                  left.containerId,
                  left.compartmentId,
                  left.slotIndex,
                ).localeCompare(
                  location(
                    right.containerId,
                    right.compartmentId,
                    right.slotIndex,
                  ),
                ),
              )
              .map((allocation) => (
                <div
                  key={allocation.id}
                  className="flex items-start gap-2 rounded-md border bg-background p-2 text-xs"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {cardByEntry.get(allocation.collectionEntryId) ??
                        "Owned card"}{" "}
                      ×{allocation.quantity}
                    </span>
                    <span className="text-muted-foreground">
                      {location(
                        allocation.containerId,
                        allocation.compartmentId,
                        allocation.slotIndex,
                      )}
                    </span>
                  </span>
                </div>
              ))}
          </div>
          {session ? (
            <Button
              className="w-full"
              variant="outline"
              disabled={checkinMutation.isPending}
              onClick={() => checkinMutation.mutate()}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {checkinMutation.isPending
                ? "Checking in…"
                : "Check in and show refile list"}
            </Button>
          ) : (
            <Button className="w-full" onClick={() => setRefileSession(null)}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Refiling complete
            </Button>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Event or borrower (optional)"
          />
          <Button
            className="w-full"
            disabled={checkoutMutation.isPending || deck.cards.length === 0}
            onClick={() => checkoutMutation.mutate()}
          >
            <LogIn className="mr-2 h-4 w-4" />
            {checkoutMutation.isPending
              ? "Reserving copies…"
              : "Checkout and create pull list"}
          </Button>
        </div>
      )}
      {(checkoutMutation.error ||
        checkinMutation.error ||
        checkoutQuery.error) && (
        <p className="text-xs text-destructive" role="alert">
          {
            (
              (checkoutMutation.error ??
                checkinMutation.error ??
                checkoutQuery.error) as Error
            ).message
          }
        </p>
      )}
    </div>
  );
}
