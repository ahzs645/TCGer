"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Minimize2,
  RefreshCw,
  Share2,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PackOpeningPull } from "@tcg/pack-core/experience";

import { CardImage } from "@/components/cards/card-image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pullCardData } from "@/lib/packs/pull-card";
import { cn, getCardBackImage } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { useWishlistsStore } from "@/stores/wishlists";

/** Matches the iOS close-up: past these, a drag navigates or dismisses. */
const SWIPE_NEXT_PX = 72;
const SWIPE_CLOSE_PX = 90;
const MAX_ZOOM = 5;

interface PackCardCloseUpProps {
  pulls: PackOpeningPull[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Full-screen pull inspector. Mirrors the iOS `PackOpeningCardCloseUp`: swipe
 * or arrow between pulls, flip to the card back, pinch/scroll to zoom, drag
 * down to dismiss, and act on the card without leaving the opening.
 */
export function PackCardCloseUp({
  pulls,
  index,
  onIndexChange,
  onClose,
}: PackCardCloseUpProps) {
  const pull = pulls[index];
  const [showingBack, setShowingBack] = useState(false);
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const goTo = useCallback(
    (direction: number) => {
      const next = index + direction;
      if (next < 0 || next >= pulls.length) {
        onClose();
        return;
      }
      onIndexChange(next);
    },
    [index, onClose, onIndexChange, pulls.length],
  );

  // A new card always starts face up, unzoomed and centred.
  useEffect(() => {
    setShowingBack(false);
    setScale(1);
    setDrag({ x: 0, y: 0 });
    setStatus(null);
  }, [index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(-1);
      } else if (event.key === "f" || event.key === "F") {
        setShowingBack((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo]);

  if (!pull) return null;

  const zoomed = scale > 1.02;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
      };
      dragStart.current = null;
    } else if (pointers.current.size === 1 && !zoomed) {
      dragStart.current = { x: event.clientX, y: event.clientY };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const next =
        (pinchStart.current.scale * distance) /
        (pinchStart.current.distance || 1);
      setScale(Math.min(Math.max(next, 1), MAX_ZOOM));
      return;
    }

    if (dragStart.current) {
      setDrag({
        x: event.clientX - dragStart.current.x,
        y: event.clientY - dragStart.current.y,
      });
    }
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (!dragStart.current) return;
    dragStart.current = null;

    const horizontal = Math.abs(drag.x);
    const vertical = Math.abs(drag.y);
    setDrag({ x: 0, y: 0 });
    if (horizontal > SWIPE_NEXT_PX && horizontal > vertical) {
      goTo(drag.x < 0 ? 1 : -1);
    } else if (vertical > SWIPE_CLOSE_PX && vertical > horizontal) {
      onClose();
    }
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">
            {pull.name}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {pull.rarity} from {pull.setName}. Card {index + 1} of{" "}
            {pulls.length}. Use the arrow keys to move between pulls.
          </DialogPrimitive.Description>

          <div className="flex shrink-0 items-start justify-between gap-3 p-3 sm:p-4">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-full bg-background/85 shadow-lg backdrop-blur-xl"
              onClick={onClose}
              aria-label="Return to results"
            >
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            </Button>

            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-semibold">{pull.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {pull.setName} · {pull.collectorNumber} · {pull.rarity}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-full bg-background/85 shadow-lg backdrop-blur-xl"
              onClick={() => setShowingBack((value) => !value)}
              aria-label={showingBack ? "Show card front" : "Flip card"}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-3">
            {/* Tapping the empty space around the card dismisses, matching the
                transparent hit area behind the iOS close-up. */}
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              onClick={onClose}
              aria-label="Close card view"
              tabIndex={-1}
            />

            {pulls.length > 1 ? (
              <>
                <NavButton
                  side="left"
                  disabled={index === 0}
                  onClick={() => goTo(-1)}
                />
                <NavButton
                  side="right"
                  disabled={index === pulls.length - 1}
                  onClick={() => goTo(1)}
                />
              </>
            ) : null}

            {/* Sized off the card's own 63:88 ratio so the flip surface is the
                card, not a letterboxed frame around it. */}
            <div
              className="relative z-10 touch-none select-none"
              style={{
                width: "min(92vw, 24rem, calc(72dvh * 63 / 88))",
                aspectRatio: "63 / 88",
                perspective: "1400px",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onDoubleClick={() => setShowingBack((value) => !value)}
              onWheel={(event) => {
                if (!event.ctrlKey) return;
                setScale((value) =>
                  Math.min(Math.max(value - event.deltaY * 0.01, 1), MAX_ZOOM),
                );
              }}
            >
              <div
                className={cn(
                  "relative mx-auto h-full w-full",
                  !drag.x && !drag.y && "transition-transform duration-200",
                )}
                style={{
                  transform: `translate(${drag.x}px, ${drag.y * 0.18}px) rotate(${drag.x / 28}deg) scale(${scale}) rotateY(${showingBack ? 180 : 0}deg)`,
                  transformStyle: "preserve-3d",
                  opacity: Math.max(0.35, 1 - Math.abs(drag.x) / 360),
                }}
              >
                <CardFace hidden={showingBack}>
                  <CardImage
                    src={pull.imageUrl}
                    fallbackSrc={pull.imageUrlSmall}
                    tcg={pull.tcg}
                    alt={pull.name}
                    fill
                    priority
                    sizes="(max-width: 640px) 90vw, 416px"
                    className="object-contain"
                  />
                </CardFace>
                <CardFace back hidden={!showingBack}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getCardBackImage(pull.tcg)}
                    alt={`Back of ${pull.name}`}
                    className="h-full w-full object-contain"
                  />
                </CardFace>
              </div>
            </div>
          </div>

          <div className="shrink-0 space-y-2 p-3 sm:p-4">
            {status ? (
              <p
                role="status"
                className="mx-auto w-fit max-w-full truncate rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-xl"
              >
                {status}
              </p>
            ) : null}
            {pulls.length > 1 ? (
              <p className="text-center text-xs text-muted-foreground">
                {index + 1} of {pulls.length}
              </p>
            ) : null}
            <CloseUpActions
              pull={pull}
              onStatus={setStatus}
              onClose={onClose}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CardFace({
  back = false,
  children,
  hidden,
}: {
  back?: boolean;
  children: React.ReactNode;
  hidden: boolean;
}) {
  return (
    <div
      aria-hidden={hidden}
      className="absolute inset-0 overflow-hidden rounded-2xl shadow-2xl"
      style={{
        backfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : undefined,
      }}
    >
      {children}
    </div>
  );
}

function NavButton({
  disabled,
  onClick,
  side,
}: {
  disabled: boolean;
  onClick: () => void;
  side: "left" | "right";
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={side === "left" ? "Previous card" : "Next card"}
      className={cn(
        "absolute top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 rounded-full bg-background/85 shadow-lg backdrop-blur-xl sm:flex",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

function CloseUpActions({
  onClose,
  onStatus,
  pull,
}: {
  onClose: () => void;
  onStatus: (message: string | null) => void;
  pull: PackOpeningPull;
}) {
  const token = useAuthStore((state) => state.token);
  const { collections, fetchCollections, addCollection, addCardToBinder } =
    useCollectionsStore();
  const { wishlists, hasFetched, fetchWishlists, addCardToWishlist } =
    useWishlistsStore();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token && !hasFetched) fetchWishlists(token);
  }, [fetchWishlists, hasFetched, token]);

  const addToFavorites = async () => {
    if (!token) {
      onStatus("Sign in before adding favorites.");
      return;
    }
    if (busy) return;
    setBusy(true);
    onStatus(null);
    try {
      let favorites = collections.find(
        (collection) => collection.name.toLowerCase() === "favorites",
      );
      if (!favorites) {
        await addCollection(token, {
          name: "Favorites",
          description: "Favorite cards",
        });
        await fetchCollections(token);
        favorites = useCollectionsStore
          .getState()
          .collections.find(
            (collection) => collection.name.toLowerCase() === "favorites",
          );
      }
      if (!favorites) throw new Error("Favorites collection is unavailable.");
      await addCardToBinder(token, favorites.id, {
        cardId: pull.cardId,
        quantity: 1,
        notes: "Favorited from Pack Opening",
        cardData: pullCardData(pull),
      });
      onStatus(`Added ${pull.name} to Favorites.`);
    } catch (error) {
      onStatus(
        error instanceof Error ? error.message : "Could not add to Favorites.",
      );
    } finally {
      setBusy(false);
    }
  };

  const addToWishlist = async (wishlistId: string) => {
    if (!token || busy) return;
    setBusy(true);
    onStatus(null);
    try {
      await addCardToWishlist(token, wishlistId, {
        externalId: pull.cardId,
        tcg: pull.tcg as never,
        name: pull.name,
        setCode: pull.setCode,
        setName: pull.setName,
        rarity: pull.rarity,
        imageUrl: pull.imageUrl,
        imageUrlSmall: pull.imageUrlSmall,
        collectorNumber: pull.collectorNumber,
      });
      onStatus(`Added ${pull.name} to your wishlist.`);
    } catch (error) {
      onStatus(
        error instanceof Error ? error.message : "Could not add to wishlist.",
      );
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const text = `${pull.name} — ${pull.setName} #${pull.collectorNumber}`;
    const shareData = { text, title: pull.name, url: pull.imageUrl };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(
        pull.imageUrl ? `${text}\n${pull.imageUrl}` : text,
      );
      onStatus("Card details copied to the clipboard.");
    } catch {
      // A dismissed share sheet is not a failure worth reporting.
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={addToFavorites}
      >
        <Star className="h-4 w-4 sm:mr-2" aria-hidden="true" />
        <span className="hidden sm:inline">Favorite</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !token || wishlists.length === 0}
          >
            <Heart className="h-4 w-4 sm:mr-2" aria-hidden="true" />
            <span className="hidden sm:inline">Wishlist</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          {wishlists.map((wishlist) => (
            <DropdownMenuItem
              key={wishlist.id}
              onSelect={() => addToWishlist(wishlist.id)}
            >
              {wishlist.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button type="button" variant="outline" size="sm" onClick={share}>
        <Share2 className="h-4 w-4 sm:mr-2" aria-hidden="true" />
        <span className="hidden sm:inline">Share</span>
      </Button>

      <Button type="button" size="sm" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
