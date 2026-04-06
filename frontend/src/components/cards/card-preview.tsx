"use client";

import Image from "next/image";
import { useState, useRef, useCallback, useEffect } from "react";
import { ChevronDown, Heart, Loader2, Minus, Plus } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchCardPrintsApi } from "@/lib/api-client";
import { useModuleStore } from "@/stores/preferences";
import { useCollectionsStore } from "@/stores/collections";
import { useAuthStore } from "@/stores/auth";
import {
  useWishlistsStore,
  type WishlistCardResponse,
} from "@/stores/wishlists";
import type {
  Card,
  CardPrintsResponse,
  CollectionCard,
  PokemonFinishType,
  PokemonFunctionalAttack,
  PokemonFunctionalGroup,
} from "@/types/card";
import { normalizeHexColor } from "@/lib/color";
import { getCardBackImage } from "@/lib/utils";
import { SetSymbol } from "./set-symbol";

const PRINT_SUPPORTED_GAMES: Card["tcg"][] = ["magic", "pokemon"];
const GAME_LABELS: Record<Card["tcg"], string> = {
  magic: "Magic: The Gathering",
  pokemon: "Pokémon",
  yugioh: "Yu-Gi-Oh!",
};

interface CardPreviewProps {
  card: Card;
}

export function CardPreview({ card }: CardPreviewProps) {
  const showCardNumbers = useModuleStore((state) => state.showCardNumbers);
  const cardRef = useRef<HTMLDivElement>(null);
  const [throttledPos, setThrottledPos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [optimisticQuantity, setOptimisticQuantity] = useState<number | null>(
    null,
  );
  const { token, isAuthenticated } = useAuthStore();
  const {
    collections,
    addCardToBinder,
    updateCollectionCard,
    removeCollectionCard,
    isLoading: collectionsLoading,
    hasFetched,
  } = useCollectionsStore((state) => ({
    collections: state.collections,
    addCardToBinder: state.addCardToBinder,
    updateCollectionCard: state.updateCollectionCard,
    removeCollectionCard: state.removeCollectionCard,
    isLoading: state.isLoading,
    hasFetched: state.hasFetched,
  }));
  const isSignedIn = isAuthenticated && Boolean(token);
  const [selectedBinderId, setSelectedBinderId] = useState<string>(
    collections[0]?.id ?? "",
  );
  const [status, setStatus] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const supportsPrintSelection = PRINT_SUPPORTED_GAMES.includes(card.tcg);
  const [selectedPrintCard, setSelectedPrintCard] = useState<Card>(card);
  const [printData, setPrintData] = useState<CardPrintsResponse | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [isLoadingPrints, setIsLoadingPrints] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const selectedBinder = collections.find(
    (binder) => binder.id === selectedBinderId,
  );
  const activeCard = supportsPrintSelection ? selectedPrintCard : card;
  const cardBackImage = getCardBackImage(activeCard.tcg);
  const [cardImageSrc, setCardImageSrc] = useState(
    activeCard.imageUrlSmall || activeCard.imageUrl || cardBackImage,
  );
  const existingEntry = selectedBinder?.cards.find(
    (binderCard: CollectionCard) => binderCard.cardId === activeCard.id,
  );
  const serverQuantity = existingEntry?.quantity ?? 0;
  const quantity = optimisticQuantity ?? serverQuantity;
  const showQuantityControls = quantity > 0;
  const printOptions = printData?.prints ?? null;
  const pokemonFunctionalGroup: PokemonFunctionalGroup | null =
    printData?.mode === "pokemon-functional" ? printData.functionalGroup : null;

  const selectedPrintLabel = supportsPrintSelection
    ? `${selectedPrintCard.setName ?? selectedPrintCard.setCode ?? "Select a print"}${
        selectedPrintCard.collectorNumber
          ? ` · #${selectedPrintCard.collectorNumber}`
          : ""
      }`
    : "";
  const currentGameLabel = GAME_LABELS[card.tcg];

  const formatPrintDetails = (print: Card) => {
    const parts: string[] = [];
    if (print.collectorNumber) {
      parts.push(`#${print.collectorNumber}`);
    }
    if (print.rarity) {
      parts.push(print.rarity);
    }
    if (print.regulationMark) {
      parts.push(`Reg ${print.regulationMark}`);
    }
    if (print.releasedAt) {
      const year = new Date(print.releasedAt).getFullYear();
      if (!Number.isNaN(year)) {
        parts.push(String(year));
      }
    }
    return parts.join(" • ");
  };

  const getFinishBadges = (print: Card): PokemonFinishType[] => {
    if (print.pokemonPrint?.finishes?.length) {
      return print.pokemonPrint.finishes;
    }
    const variants = print.pokemonPrint?.variants;
    if (!variants) {
      return [];
    }
    const finishes: PokemonFinishType[] = [];
    if (variants.normal) finishes.push("normal");
    if (variants.reverse) finishes.push("reverse");
    if (variants.holo) finishes.push("holo");
    if (variants.firstEdition) finishes.push("firstEdition");
    return finishes;
  };

  const throttledSetPos = useRef(
    throttle<[{ x: number; y: number }]>(
      (position) => setThrottledPos(position),
      50,
    ),
  );

  const updateMousePos = (e: MouseEvent) => {
    throttledSetPos.current({ x: e.clientX, y: e.clientY });
  };

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    window.addEventListener("mousemove", updateMousePos);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    window.removeEventListener("mousemove", updateMousePos);
  }, []);

  let centeredX = 0;
  let centeredY = 0;

  if (cardRef.current && isHovering) {
    const rect = cardRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    centeredX = throttledPos.x - centerX;
    centeredY = throttledPos.y - centerY;
  }

  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  const rotateY = isHovering ? clamp(centeredX / 4, -10, 10) : 0;
  const rotateX = isHovering ? clamp(-centeredY / 4, -10, 10) : 0;

  const cardStyle = {
    transform: `perspective(1000px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${isHovering ? 1.04 : 1})`,
    transition: "transform 0.3s cubic-bezier(0.17, 0.67, 0.5, 1.03)",
    transformStyle: "preserve-3d" as const,
    opacity: quantity > 0 ? 1 : 0.5,
    width: "100%",
    height: "auto",
  };

  useEffect(() => {
    if (!collections.length) {
      setSelectedBinderId("");
      return;
    }

    if (
      !selectedBinderId ||
      !collections.some((binder) => binder.id === selectedBinderId)
    ) {
      setSelectedBinderId(collections[0].id);
    }
  }, [collections, selectedBinderId]);

  useEffect(() => {
    if (
      optimisticQuantity !== null &&
      existingEntry &&
      existingEntry.quantity === optimisticQuantity
    ) {
      setOptimisticQuantity(null);
    }
  }, [existingEntry, optimisticQuantity]);

  useEffect(() => {
    setSelectedPrintCard(card);
    setPrintData(null);
    setPrintError(null);
    setIsPrintDialogOpen(false);
    setIsLoadingPrints(false);
  }, [card]);

  useEffect(() => {
    setCardImageSrc(
      activeCard.imageUrlSmall ||
        activeCard.imageUrl ||
        getCardBackImage(activeCard.tcg),
    );
  }, [
    activeCard.id,
    activeCard.imageUrlSmall,
    activeCard.imageUrl,
    activeCard.tcg,
  ]);

  useEffect(() => {
    if (!supportsPrintSelection || !isPrintDialogOpen || printOptions) {
      return;
    }

    let cancelled = false;
    setIsLoadingPrints(true);
    setPrintError(null);

    fetchCardPrintsApi({ tcg: card.tcg, cardId: card.id, token })
      .then((data) => {
        if (cancelled) return;
        setPrintData(data);
        const prints = data.prints ?? [];
        if (prints.length) {
          const matching = prints.find(
            (entry: Card) => entry.id === selectedPrintCard.id,
          );
          setSelectedPrintCard(matching ?? prints[0]);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPrintError(
          error instanceof Error ? error.message : "Unable to load prints.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingPrints(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    supportsPrintSelection,
    isPrintDialogOpen,
    printOptions,
    card.tcg,
    card.id,
    selectedPrintCard.id,
  ]);

  const handleCardImageError = useCallback(() => {
    setCardImageSrc((currentSrc: string) => {
      if (
        currentSrc === activeCard.imageUrlSmall &&
        activeCard.imageUrl &&
        activeCard.imageUrl !== currentSrc
      ) {
        return activeCard.imageUrl;
      }
      if (currentSrc === cardBackImage) {
        return currentSrc;
      }
      return cardBackImage;
    });
  }, [activeCard.imageUrl, activeCard.imageUrlSmall, cardBackImage]);

  const handleBinderChange = (binderId: string) => {
    setSelectedBinderId(binderId);
    setOptimisticQuantity(null);
    setStatus("idle");
    setStatusMessage(null);
  };

  const handleOpenPrintDialog = () => {
    if (!printOptions) {
      setIsLoadingPrints(true);
      setPrintError(null);
    }
    setIsPrintDialogOpen(true);
  };

  const handleAddInitialQuantity = async () => {
    if (!isSignedIn || !token) {
      setStatus("error");
      setStatusMessage("Sign in to add cards to a binder.");
      return;
    }

    if (!selectedBinderId) {
      setStatus("error");
      setStatusMessage("Create a binder first.");
      return;
    }

    const cardToPersist = supportsPrintSelection ? selectedPrintCard : card;

    setStatus("pending");
    setStatusMessage(null);
    setOptimisticQuantity(1);

    try {
      await addCardToBinder(token, selectedBinderId, {
        cardId: cardToPersist.id,
        quantity: 1,
        cardData: {
          name: cardToPersist.name,
          tcg: cardToPersist.tcg,
          externalId: cardToPersist.id,
          setCode: cardToPersist.setCode,
          setName: cardToPersist.setName,
          rarity: cardToPersist.rarity,
          imageUrl: cardToPersist.imageUrl,
          imageUrlSmall: cardToPersist.imageUrlSmall,
        },
      });
      setStatus("success");
      setStatusMessage("Card added to binder.");
      setTimeout(() => {
        setStatus("idle");
        setStatusMessage(null);
      }, 2000);
    } catch (error) {
      setStatus("error");
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to add card to binder.",
      );
      setOptimisticQuantity(null);
    }
  };

  const handleQuantityChange = async (nextQuantity: number) => {
    if (!isSignedIn || !token) {
      setStatus("error");
      setStatusMessage("Sign in to manage binder quantities.");
      return;
    }

    if (!selectedBinderId) {
      setStatus("error");
      setStatusMessage("Select a binder first.");
      return;
    }

    const entryId = existingEntry?.id;
    if (!entryId) {
      setStatusMessage("Syncing new entry... please wait.");
      return;
    }

    const safeQuantity = Math.max(0, Math.min(99, nextQuantity));
    setStatus("pending");
    setStatusMessage(null);
    setOptimisticQuantity(safeQuantity);

    try {
      if (safeQuantity === 0) {
        await removeCollectionCard(token, selectedBinderId, entryId);
        setOptimisticQuantity(null);
        setStatus("success");
        setStatusMessage("Card removed from binder.");
      } else {
        await updateCollectionCard(token, selectedBinderId, entryId, {
          quantity: safeQuantity,
        });
        setStatus("success");
        setStatusMessage("Quantity updated.");
      }
      setTimeout(() => {
        setStatus("idle");
        setStatusMessage(null);
      }, 1500);
    } catch (error) {
      setStatus("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to update quantity.",
      );
      setOptimisticQuantity(null);
    }
  };

  const addDisabled =
    !selectedBinderId ||
    status === "pending" ||
    collectionsLoading ||
    !isSignedIn;
  const showEmptyBindersMessage = hasFetched && collections.length === 0;
  const quantityControlsDisabled =
    status === "pending" || collectionsLoading || !isSignedIn;
  const entrySyncing = showQuantityControls && !existingEntry;

  return (
    <>
      {supportsPrintSelection ? (
        <Dialog
          open={isPrintDialogOpen}
          onOpenChange={setIsPrintDialogOpen}
          data-oid="fyekxfm"
        >
          <DialogContent data-oid=".sy9mv:">
            <DialogHeader data-oid="cfxkrx0">
              <DialogTitle data-oid="ab23.z2">Select a print</DialogTitle>
              <DialogDescription data-oid="_e-.bx2">
                Choose the exact {currentGameLabel} printing to add to your
                binder.
              </DialogDescription>
            </DialogHeader>
            {isLoadingPrints ? (
              <div
                className="flex items-center justify-center py-10"
                data-oid="z7nwabj"
              >
                <Loader2
                  className="h-5 w-5 animate-spin text-muted-foreground"
                  data-oid="bdmoag2"
                />
              </div>
            ) : printError ? (
              <div
                className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                data-oid="mahnl3e"
              >
                <p data-oid="q6wi-k_">{printError}</p>
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  data-oid="dqrm1ty"
                >
                  You can continue with the default print.
                </p>
              </div>
            ) : (
              <>
                {pokemonFunctionalGroup ? (
                  <div
                    className="mb-3 space-y-2 rounded-lg border bg-muted/40 p-3 text-xs"
                    data-oid="20xl:rh"
                  >
                    <div
                      className="flex flex-wrap items-center gap-2 text-sm font-semibold"
                      data-oid="n9r-058"
                    >
                      <span data-oid="q-_ld57">
                        {pokemonFunctionalGroup.name}
                      </span>
                      {pokemonFunctionalGroup.hp ? (
                        <span
                          className="text-muted-foreground"
                          data-oid="2d0bq2s"
                        >
                          HP {pokemonFunctionalGroup.hp}
                        </span>
                      ) : null}
                      {pokemonFunctionalGroup.regulationMark ? (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          data-oid="7d0j9y2"
                        >
                          Reg {pokemonFunctionalGroup.regulationMark}
                        </Badge>
                      ) : null}
                    </div>
                    {pokemonFunctionalGroup.attacks?.length ? (
                      <div className="space-y-1" data-oid="k1k5z-d">
                        {pokemonFunctionalGroup.attacks.map(
                          (attack: PokemonFunctionalAttack) => (
                            <div
                              key={`${attack.name}-${attack.damage ?? "na"}`}
                              data-oid="fevuzj6"
                            >
                              <p className="font-medium" data-oid="c1lmv4t">
                                {attack.name}
                              </p>
                              <p
                                className="text-muted-foreground"
                                data-oid="bed4-kt"
                              >
                                {[attack.cost?.join(", "), attack.damage]
                                  .filter(Boolean)
                                  .join(" • ")}
                              </p>
                              {attack.text ? (
                                <p
                                  className="text-muted-foreground"
                                  data-oid="thn9wgz"
                                >
                                  {attack.text}
                                </p>
                              ) : null}
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                    {pokemonFunctionalGroup.rules?.length ? (
                      <p className="text-muted-foreground" data-oid="2a6t:9b">
                        {pokemonFunctionalGroup.rules.join(" ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div
                  className="max-h-80 space-y-2 overflow-y-auto pr-1"
                  data-oid="ni_f3fa"
                >
                  {(printOptions && printOptions.length > 0
                    ? printOptions
                    : [card]
                  ).map((print: Card) => {
                    const isSelected = selectedPrintCard.id === print.id;
                    const finishes = getFinishBadges(print);
                    return (
                      <button
                        type="button"
                        key={print.id}
                        onClick={() => setSelectedPrintCard(print)}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-input hover:bg-muted/60"
                        }`}
                        data-oid="5xf3-pq"
                      >
                        <Image
                          src={print.imageUrlSmall ?? cardBackImage}
                          alt={print.name}
                          width={40}
                          height={56}
                          className="h-14 w-10 flex-shrink-0 rounded-md object-cover"
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src = cardBackImage;
                          }}
                          data-oid="s.dsk0e"
                        />

                        <div className="flex-1" data-oid="niit5gz">
                          <p className="text-sm font-medium" data-oid="_iwlr2s">
                            {print.setName ?? print.setCode ?? "Unknown set"}
                          </p>
                          <p
                            className="text-xs text-muted-foreground"
                            data-oid="lp39v1v"
                          >
                            {formatPrintDetails(print) ||
                              "No additional details"}
                          </p>
                          <div
                            className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground"
                            data-oid="--gfcho"
                          >
                            {print.regulationMark ? (
                              <span data-oid="74.0_i6">
                                Reg {print.regulationMark}
                              </span>
                            ) : null}
                            {print.language ? (
                              <span className="uppercase" data-oid="dbx:7b5">
                                {print.language}
                              </span>
                            ) : null}
                            {print.formatLegality?.standard ? (
                              <span
                                className="text-green-600"
                                data-oid="x:nwkx0"
                              >
                                Standard
                              </span>
                            ) : null}
                            {print.formatLegality?.expanded ? (
                              <span
                                className="text-blue-600"
                                data-oid="2_ogdf2"
                              >
                                Expanded
                              </span>
                            ) : null}
                          </div>
                          {finishes.length ? (
                            <div
                              className="mt-1 flex flex-wrap gap-1"
                              data-oid="7jmmg6u"
                            >
                              {finishes.map((finish) => (
                                <Badge
                                  key={finish}
                                  variant="outline"
                                  className="text-[10px] capitalize"
                                  data-oid="zevfg9f"
                                >
                                  {finish === "firstEdition"
                                    ? "1st Ed"
                                    : finish}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {isSelected ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                            data-oid="pyvklj."
                          >
                            Selected
                          </Badge>
                        ) : null}
                      </button>
                    );
                  })}
                  {!printOptions?.length && (
                    <div
                      className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground"
                      data-oid="kkogihf"
                    >
                      No alternate printings were returned for this card.
                    </div>
                  )}
                </div>
              </>
            )}
            <DialogFooter data-oid="aa6g:mn">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsPrintDialogOpen(false)}
                disabled={isLoadingPrints}
                data-oid="ufwr8_-"
              >
                Close
              </Button>
              <Button
                type="button"
                onClick={() => setIsPrintDialogOpen(false)}
                disabled={isLoadingPrints}
                data-oid="kxtoayb"
              >
                Use This Print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <div
        className="group flex min-w-0 basis-1/5 flex-col items-center rounded-lg px-1 sm:px-2"
        data-oid="t0z94e1"
      >
        <button
          type="button"
          className="cursor-pointer w-full"
          data-oid="fzohwiy"
        >
          <div
            style={{
              flex: "1 0 20%",
              perspective: "1000px",
              transformStyle: "preserve-3d",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: isHovering ? 10 : 0,
            }}
            data-oid="-nyep4p"
          >
            <div
              ref={cardRef}
              style={{ width: "100%", height: "auto" }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              data-oid="7ar0m4q"
            >
              <Image
                draggable={false}
                loading="lazy"
                className="card-test"
                alt={activeCard.name}
                src={cardImageSrc}
                width={320}
                height={448}
                sizes="(max-width: 640px) 45vw, 20vw"
                style={cardStyle}
                onError={handleCardImageError}
                data-oid=":2n91gg"
              />
            </div>
          </div>
        </button>
        <div className="w-full min-w-0 pt-2 space-y-1" data-oid="yqevmj.">
          <p
            className="text-[12px] text-center font-semibold leading-tight break-words"
            data-oid="g3x6v5c"
          >
            {showCardNumbers && (activeCard.setCode || activeCard.id) && (
              <>
                <span className="block md:inline" data-oid="co-4mqw">
                  {activeCard.setCode || activeCard.id}
                </span>
                <span className="hidden md:inline" data-oid="wr_1y10">
                  {" "}
                  –{" "}
                </span>
              </>
            )}
            <span className="block md:inline break-words" data-oid="3_.ohvf">
              {activeCard.name}
            </span>
          </p>
          {activeCard.rarity && (
            <div className="flex justify-center" data-oid="kxwhbmo">
              <Badge
                variant="outline"
                className="text-[10px] h-5"
                data-oid="wkxwror"
              >
                {activeCard.rarity}
              </Badge>
            </div>
          )}
          {activeCard.tcg === "pokemon" && (
            <div
              className="flex flex-wrap justify-center gap-1"
              data-oid="lisiz5t"
            >
              {activeCard.supertype && (
                <Badge
                  variant="secondary"
                  className="text-[10px] h-5"
                  data-oid="9l2x_b8"
                >
                  {activeCard.supertype}
                </Badge>
              )}
              {activeCard.formatLegality?.standard && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-green-500/50 text-green-600"
                  data-oid="92coi9t"
                >
                  Standard
                </Badge>
              )}
              {activeCard.formatLegality?.expanded && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-blue-500/50 text-blue-600"
                  data-oid="dqk8jey"
                >
                  Expanded
                </Badge>
              )}
              {activeCard.dexEntries?.length ? (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5"
                  data-oid="ehjo.x8"
                >
                  #{activeCard.dexEntries[0].number}
                </Badge>
              ) : null}
            </div>
          )}
          {(activeCard.setName || activeCard.setCode) && (
            <div
              className="flex items-center justify-center gap-1 px-1"
              data-oid="758h4w4"
            >
              <SetSymbol
                symbolUrl={activeCard.setSymbolUrl}
                logoUrl={activeCard.setLogoUrl}
                setCode={activeCard.setCode}
                setName={activeCard.setName}
                tcg={activeCard.tcg}
                size="xs"
                data-oid="ljgk:d9"
              />

              <p
                className="text-[10px] text-center text-muted-foreground break-words"
                data-oid="v-suu:m"
              >
                {activeCard.setName}
              </p>
            </div>
          )}
        </div>
        <div className="mt-3 w-full space-y-3 text-xs" data-oid="o_l5hdy">
          {collections.length ? (
            <>
              <div className="space-y-1" data-oid="z7b92u2">
                <p
                  className="text-[11px] font-medium text-muted-foreground"
                  data-oid="ag2-dkm"
                >
                  Binder
                </p>
                <Select
                  value={selectedBinderId || undefined}
                  onValueChange={handleBinderChange}
                  disabled={collectionsLoading || status === "pending"}
                  data-oid="c93mw3p"
                >
                  <SelectTrigger
                    className="h-9 w-full justify-between gap-2 text-left text-xs"
                    data-oid="gkbzbcp"
                  >
                    <SelectValue
                      placeholder="Select a binder"
                      data-oid="w7xzsj7"
                    />
                  </SelectTrigger>
                  <SelectContent data-oid="5-qh.29">
                    {collections.map((binder) => {
                      const accent = normalizeHexColor(binder.colorHex);
                      return (
                        <SelectItem
                          key={binder.id}
                          value={binder.id}
                          data-oid="17:wzjf"
                        >
                          <span
                            className="flex items-center gap-2"
                            data-oid="mnxaz39"
                          >
                            {accent ? (
                              <span
                                className="inline-flex h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: accent }}
                                aria-hidden="true"
                                data-oid="vm9huxt"
                              />
                            ) : null}
                            {binder.name}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              {supportsPrintSelection ? (
                <div className="space-y-1" data-oid="7n93qrf">
                  <p
                    className="text-[11px] font-medium text-muted-foreground"
                    data-oid="zl5i1we"
                  >
                    Print
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full justify-between gap-2 text-left text-xs"
                    onClick={handleOpenPrintDialog}
                    data-oid="iief7p-"
                  >
                    <span className="truncate" data-oid="b48_-8l">
                      {selectedPrintLabel || "Select a print"}
                    </span>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      data-oid="qigxt_."
                    />
                  </Button>
                  {!printOptions && (
                    <p
                      className="text-[10px] text-muted-foreground"
                      data-oid="ctfgw:i"
                    >
                      Choose a print before adding the card.
                    </p>
                  )}
                </div>
              ) : null}
              {!showQuantityControls ? (
                <Button
                  className="w-full gap-2"
                  size="sm"
                  onClick={handleAddInitialQuantity}
                  disabled={!selectedBinderId || addDisabled}
                  data-oid="skebpn5"
                >
                  <Plus className="h-4 w-4" data-oid="fnt0iyg" />
                  <span data-oid="bokw66t">Add to Binder</span>
                </Button>
              ) : (
                <div
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  data-oid="4obfj_y"
                >
                  <div
                    className="flex h-9 w-full max-w-[220px] items-center justify-between gap-1 rounded-lg border px-2 py-1"
                    data-oid="o2vy32d"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleQuantityChange(quantity - 1)}
                      className="h-8 w-8 rounded-full"
                      tabIndex={-1}
                      disabled={quantityControlsDisabled || entrySyncing}
                      data-oid="wlspwyq"
                    >
                      <Minus className="h-4 w-4" data-oid="96w-:10" />
                    </Button>
                    <input
                      readOnly
                      className="w-10 border-none bg-transparent text-center text-sm font-semibold"
                      type="text"
                      value={quantity}
                      data-oid="zuoj2kr"
                    />

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() => handleQuantityChange(quantity + 1)}
                      tabIndex={-1}
                      disabled={
                        quantityControlsDisabled ||
                        entrySyncing ||
                        quantity >= 99
                      }
                      data-oid="qip0fny"
                    >
                      <Plus className="h-4 w-4" data-oid="6qazx6c" />
                    </Button>
                  </div>
                  {entrySyncing ? (
                    <p
                      className="text-[11px] text-muted-foreground"
                      data-oid="5ulmh0:"
                    >
                      Syncing binder entry...
                    </p>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground" data-oid="0ioqp7y">
              {!isSignedIn
                ? "Sign in to add cards to your binders."
                : showEmptyBindersMessage
                  ? "Create a binder from the collection page to start adding cards."
                  : "Loading binders..."}
            </p>
          )}
          {statusMessage ? (
            <p
              className={`text-center ${status === "error" ? "text-destructive" : "text-emerald-600"}`}
              data-oid="rfg1swy"
            >
              {statusMessage}
            </p>
          ) : null}
          {isSignedIn && (
            <WishlistQuickAdd card={activeCard} data-oid="ok00g5k" />
          )}
        </div>
      </div>
    </>
  );
}

function WishlistQuickAdd({ card }: { card: Card }) {
  const token = useAuthStore((state) => state.token);
  const { wishlists, addCardToWishlist, fetchWishlists, hasFetched } =
    useWishlistsStore();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (token && !hasFetched) {
      fetchWishlists(token);
    }
  }, [token, hasFetched, fetchWishlists]);

  if (!wishlists.length) return null;

  const isInAnyWishlist = wishlists.some((w) =>
    w.cards.some(
      (c: WishlistCardResponse) =>
        c.externalId === card.id && c.tcg === card.tcg,
    ),
  );

  const handleAdd = async (wishlistId: string) => {
    if (!token || adding) return;
    setAdding(true);
    try {
      await addCardToWishlist(token, wishlistId, {
        externalId: card.id,
        tcg: card.tcg,
        name: card.name,
        setCode: card.setCode,
        setName: card.setName,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        imageUrlSmall: card.imageUrlSmall,
        setSymbolUrl: card.setSymbolUrl,
        setLogoUrl: card.setLogoUrl,
        collectorNumber: card.collectorNumber,
      });
    } catch {
      // Error handled in store
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="pt-1 border-t border-dashed" data-oid="kbdzx_r">
      <Select onValueChange={handleAdd} disabled={adding} data-oid="cys9tfd">
        <SelectTrigger className="h-8 w-full text-xs gap-1" data-oid="ht555ld">
          <Heart
            className={`h-3 w-3 ${isInAnyWishlist ? "fill-current text-red-500" : ""}`}
            data-oid="59z8i95"
          />
          <SelectValue placeholder="Add to wishlist..." data-oid="m-jayzy" />
        </SelectTrigger>
        <SelectContent data-oid="svn306-">
          {wishlists.map((w) => {
            const alreadyIn = w.cards.some(
              (c: WishlistCardResponse) =>
                c.externalId === card.id && c.tcg === card.tcg,
            );
            return (
              <SelectItem
                key={w.id}
                value={w.id}
                disabled={alreadyIn}
                data-oid="xqur-o_"
              >
                {w.name} {alreadyIn ? "(added)" : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

function throttle<T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number,
): (...args: T) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: T): void => {
    const now = performance.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall < delay) {
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          lastCall = performance.now();
          timeoutId = null;
          fn(...args);
        }, delay - timeSinceLastCall);
      }
      return;
    }

    lastCall = now;
    fn(...args);
  };
}
