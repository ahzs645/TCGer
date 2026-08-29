"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bolt,
  ChevronDown,
  CheckCircle2,
  Download,
  GalleryVerticalEnd,
  History,
  ImagePlus,
  Layers3,
  MoreHorizontal,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Share2,
  Sparkles,
  Trophy,
  Trash2,
  WifiOff,
} from "lucide-react";

import type {
  PackOpeningNativeCommand,
  PackOpeningNativeCardPool,
  PackOpeningNativeState,
  PackOpeningPull,
  PackOpeningPullSession,
} from "@tcg/pack-core/experience";

import { CardImage } from "@/components/cards/card-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  filterPackSets,
  filterPossiblePulls,
  groupPackOptions,
  possiblePullRarities,
  type PackSetAvailabilityFilter,
  type PackSetGroup,
} from "@/lib/packs/pack-browsing";
import { offlinePackDefinition } from "@/lib/packs/offline-packs";
import type { OfflinePackStatus } from "@/lib/packs/use-offline-packs";

interface PackOpeningShellProps {
  ready: boolean;
  state: PackOpeningNativeState | null;
  savedOpeningsCount: number;
  onOpenHistory: () => void;
  onCommand: (command: PackOpeningNativeCommand) => void;
  onInspect: (index: number) => void;
  offlinePacks: {
    isOnline: boolean;
    statusFor: (setID: string) => OfflinePackStatus;
    isDownloaded: (setID: string) => boolean;
    canOpen: (setID: string) => boolean;
    download: (setID: string, poolID: string) => void;
    remove: (setID: string) => void;
  };
}

const COUNT_OPTIONS = [1, 5, 10] as const;

function tierRank(tier: PackOpeningPull["tier"]): number {
  return { common: 1, uncommon: 2, rare: 3, ultra: 4, chase: 5 }[tier];
}

function selectedPackDisplayLabel(state: PackOpeningNativeState): string {
  const option = state.packOptions.find(
    (candidate) => candidate.id === state.selectedPackID,
  );
  return option
    ? `${option.setLabel} · ${option.variationLabel}`
    : state.selectedPackLabel;
}

function revealInstruction(state: PackOpeningNativeState): string {
  if (!state.packBackwards) {
    return `${state.revealedCount} of ${state.totalCards} cards revealed`;
  }
  return state.currentCardFaceUp ? "Swipe card away" : "Tap to flip";
}

function revealActionLabel(state: PackOpeningNativeState): string {
  if (state.revealedCount >= state.totalCards && state.currentCardFaceUp) {
    return "Finish";
  }
  if (!state.packBackwards) return "Reveal Next";
  return state.currentCardFaceUp ? "Slide Card" : "Flip Card";
}

export function PackOpeningShell({
  ready,
  state,
  savedOpeningsCount,
  onOpenHistory,
  onCommand,
  onInspect,
  offlinePacks,
}: PackOpeningShellProps) {
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const [packSetQuery, setPackSetQuery] = useState("");
  const [packSetAvailability, setPackSetAvailability] =
    useState<PackSetAvailabilityFilter>("all");
  const [possiblePullsPoolID, setPossiblePullsPoolID] = useState<string | null>(
    null,
  );
  const [possiblePullsQuery, setPossiblePullsQuery] = useState("");
  const [possiblePullsRarity, setPossiblePullsRarity] = useState<string | null>(
    null,
  );
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const packSets = useMemo(
    () => groupPackOptions(state?.packOptions ?? []),
    [state?.packOptions],
  );
  const visiblePackSets = useMemo(
    () =>
      filterPackSets(packSets, {
        query: packSetQuery,
        // A previously selected "Not downloaded" filter must not conflict
        // with the offline-only gate after connectivity changes.
        availability: offlinePacks.isOnline ? packSetAvailability : "all",
        isDownloaded: offlinePacks.isDownloaded,
      }),
    [
      offlinePacks.isDownloaded,
      offlinePacks.isOnline,
      packSetAvailability,
      packSetQuery,
      packSets,
    ],
  );
  const showsResults = Boolean(
    state &&
      (state.phase === "summary" || state.phase === "final") &&
      state.session,
  );
  const possiblePullsPool = state?.cardPools?.find(
    (pool) => pool.id === possiblePullsPoolID,
  );

  const uploadArtwork = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      onCommand({
        type: "uploadArtwork",
        dataURL: reader.result,
        label: file.name.replace(/\.[^.]+$/, "") || "Custom Artwork",
      });
      setPackPickerOpen(false);
    };
    reader.readAsDataURL(file);
  };

  const canChooseArtwork = state?.phase === "select";
  const showsMenu = canChooseArtwork || savedOpeningsCount > 0;

  return (
    <>
      {showsResults && state?.session ? (
        <PackResults session={state.session} onInspect={onInspect} />
      ) : null}

      {/* Top bar — mirrors the iOS overlay: identity on the left, the result
          summary once an opening finishes, overflow actions on the right. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-2 p-3 sm:p-4">
        {showsResults && state?.session ? (
          <PackResultSummary session={state.session} />
        ) : (
          <div className="pointer-events-auto flex min-h-10 shrink-0 items-center gap-2 rounded-full border bg-background/85 px-3.5 text-sm font-semibold shadow-lg backdrop-blur-xl">
            <PackageOpen className="h-4 w-4 text-primary" aria-hidden="true" />
            Pack Opening
          </div>
        )}

        {showsMenu ? (
          <div className="pointer-events-auto ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="More pack options"
                  className="h-10 w-10 rounded-full border bg-background/85 shadow-lg backdrop-blur-xl"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canChooseArtwork ? (
                  <DropdownMenuItem
                    onSelect={() => uploadInputRef.current?.click()}
                  >
                    <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Choose pack photo
                  </DropdownMenuItem>
                ) : null}
                {savedOpeningsCount > 0 ? (
                  <DropdownMenuItem onSelect={onOpenHistory}>
                    <History className="mr-2 h-4 w-4" aria-hidden="true" />
                    Saved openings ({savedOpeningsCount})
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {/* Bottom controls — one panel per phase, exactly like the iOS glass
          container that floats over the shared scene. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 sm:p-4">
        {!ready || !state ? (
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/90 px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur-xl">
            <Sparkles className="h-4 w-4 animate-pulse" aria-hidden="true" />
            Preparing packs…
          </div>
        ) : (
          <div className="pointer-events-auto w-full max-w-xl space-y-2">
            {state.warning ? (
              <div
                role="status"
                className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-amber-500/30 bg-background/90 px-4 py-2 text-xs font-medium text-amber-700 shadow-lg backdrop-blur-xl dark:text-amber-300"
              >
                <AlertTriangle
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{state.warning}</span>
              </div>
            ) : null}
            <PhaseControls
              state={state}
              onCommand={onCommand}
              onChoosePack={() => setPackPickerOpen(true)}
              canOpenSelected={offlinePacks.canOpen(
                state.packOptions.find(
                  (option) => option.id === state.selectedPackID,
                )?.setID ?? "",
              )}
            />
          </div>
        )}
      </div>

      <input
        ref={uploadInputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={(event) => {
          uploadArtwork(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <Dialog open={packPickerOpen} onOpenChange={setPackPickerOpen}>
        <DialogContent className="max-h-[85dvh] max-w-xl gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Choose a set and pack</DialogTitle>
            <DialogDescription>
              Search sets, manage offline downloads, and pick a wrapper.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Search sets or packs
              <input
                type="search"
                value={packSetQuery}
                onChange={(event) => setPackSetQuery(event.target.value)}
                placeholder="Set or wrapper name"
                className="min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            {offlinePacks.isOnline ? (
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Download status
                <select
                  aria-label="Filter sets by download status"
                  value={packSetAvailability}
                  onChange={(event) =>
                    setPackSetAvailability(
                      event.target.value as PackSetAvailabilityFilter,
                    )
                  }
                  className="min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="all">All sets</option>
                  <option value="downloaded">Downloaded</option>
                  <option value="notDownloaded">Not downloaded</option>
                </select>
              </label>
            ) : (
              <div className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                <WifiOff className="h-4 w-4" aria-hidden="true" />
                Downloaded packs are available; others are disabled
              </div>
            )}
          </div>
          <div className="-mr-1 max-h-[52dvh] space-y-5 overflow-y-auto pr-1">
            {visiblePackSets.map((packSet) => {
              const canOpen = offlinePacks.canOpen(packSet.id);
              return (
                <section
                  key={packSet.id}
                  className={cn("space-y-2", !canOpen && "opacity-50")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">{packSet.label}</h3>
                      {!canOpen ? (
                        <p className="text-xs text-muted-foreground">
                          Not downloaded · unavailable offline
                        </p>
                      ) : null}
                    </div>
                    <PackDownloadControl
                      packSet={packSet}
                      offlinePacks={offlinePacks}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {packSet.options.length}{" "}
                      {packSet.options.length === 1
                        ? "wrapper variant"
                        : "wrapper variants"}
                    </p>
                    <button
                      type="button"
                      disabled={!canOpen}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-primary transition hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground"
                      onClick={() => {
                        setPackPickerOpen(false);
                        setPossiblePullsQuery("");
                        setPossiblePullsRarity(null);
                        setPossiblePullsPoolID(packSet.packPoolID);
                      }}
                    >
                      <GalleryVerticalEnd
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                      View possible cards
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {packSet.options.map((option) => {
                      const selected = option.id === state?.selectedPackID;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selected}
                          disabled={!canOpen}
                          onClick={() => {
                            onCommand({ type: "selectPack", id: option.id });
                            setPackPickerOpen(false);
                          }}
                          className={cn(
                            "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-muted disabled:cursor-not-allowed",
                            selected &&
                              "border-primary bg-primary/10 ring-1 ring-primary",
                          )}
                        >
                          <GalleryVerticalEnd
                            className={cn(
                              "h-5 w-5 shrink-0 text-muted-foreground",
                              selected && "text-primary",
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {option.variationLabel}
                          </span>
                          {selected ? (
                            <span className="shrink-0 text-xs font-semibold text-primary">
                              Selected
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {visiblePackSets.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">
                {offlinePacks.isOnline ? (
                  <GalleryVerticalEnd
                    className="h-8 w-8 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <WifiOff
                    className="h-8 w-8 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <p className="text-sm font-semibold">No sets found</p>
                <p className="text-xs text-muted-foreground">
                  Try another search or download filter.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPackSetQuery("");
                    setPackSetAvailability("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : null}
          </div>
          <div className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => uploadInputRef.current?.click()}
            >
              <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
              Choose custom pack artwork
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PossiblePullsDialog
        pool={possiblePullsPool}
        query={possiblePullsQuery}
        rarity={possiblePullsRarity}
        onQueryChange={setPossiblePullsQuery}
        onRarityChange={setPossiblePullsRarity}
        onOpenChange={(open) => {
          if (!open) setPossiblePullsPoolID(null);
        }}
      />
    </>
  );
}

function PackDownloadControl({
  packSet,
  offlinePacks,
}: {
  packSet: PackSetGroup;
  offlinePacks: PackOpeningShellProps["offlinePacks"];
}) {
  if (!offlinePackDefinition(packSet.id)) {
    return (
      <span
        className="shrink-0 text-xs font-medium text-muted-foreground"
        title={`${packSet.label} is available while online only`}
      >
        Online only
      </span>
    );
  }
  const status = offlinePacks.statusFor(packSet.id);
  if (status.kind === "downloading") {
    return (
      <span
        className="shrink-0 text-xs font-semibold text-muted-foreground"
        role="status"
        aria-label={`Downloading ${packSet.label}, ${Math.round(status.progress * 100)} percent`}
      >
        {Math.round(status.progress * 100)}%
      </span>
    );
  }
  if (status.kind === "downloaded") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <span className="sr-only">{packSet.label} downloaded</span>
        <button
          type="button"
          className="inline-flex min-h-9 items-center rounded-full px-2 text-muted-foreground transition hover:bg-muted hover:text-destructive"
          aria-label={`Remove ${packSet.label} download`}
          onClick={() => offlinePacks.remove(packSet.id)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }
  const failed = status.kind === "failed";
  return (
    <button
      type="button"
      className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-primary transition hover:bg-muted disabled:text-muted-foreground"
      aria-label={
        failed
          ? `Retry ${packSet.label} offline download. Previous attempt failed: ${status.message}`
          : `Download ${packSet.label} for offline use`
      }
      title={failed ? status.message : undefined}
      disabled={!offlinePacks.isOnline}
      onClick={() => offlinePacks.download(packSet.id, packSet.packPoolID)}
    >
      {failed ? (
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      {failed ? "Retry" : "Download"}
    </button>
  );
}

function PossiblePullsDialog({
  pool,
  query,
  rarity,
  onQueryChange,
  onRarityChange,
  onOpenChange,
}: {
  pool: PackOpeningNativeCardPool | undefined;
  query: string;
  rarity: string | null;
  onQueryChange: (value: string) => void;
  onRarityChange: (value: string | null) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const rarities = useMemo(() => possiblePullRarities(pool), [pool]);
  const cards = useMemo(
    () => filterPossiblePulls(pool, query, rarity),
    [pool, query, rarity],
  );

  return (
    <Dialog open={Boolean(pool)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-3xl gap-4 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{pool?.label ?? "Pack"} possible cards</DialogTitle>
          <DialogDescription>
            Every card currently included in this simulated pack pool. A card
            shown here is possible, but not guaranteed in one pack.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Search {pool?.cards.length.toLocaleString() ?? 0} cards
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Name, rarity, or card number"
              className="min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Rarity
            <select
              aria-label="Filter possible cards by rarity"
              value={rarity ?? ""}
              onChange={(event) => onRarityChange(event.target.value || null)}
              className="min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">All rarities</option>
              {rarities.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="-mr-1 max-h-[62dvh] overflow-y-auto pr-1">
          {cards.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {cards.map((card) => (
                <article key={card.cardId} className="min-w-0 space-y-2">
                  <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-[5%] bg-muted shadow-sm">
                    <CardImage
                      src={card.imageUrlSmall || card.imageUrl}
                      fallbackSrc={card.imageUrl || null}
                      alt={`${card.name} card`}
                      tcg={card.tcg}
                      fill
                      sizes="(max-width: 640px) 45vw, (max-width: 768px) 30vw, 180px"
                      className="object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <p
                      className="truncate text-xs font-semibold"
                      title={card.name}
                    >
                      {card.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      #{card.collectorNumber} · {card.rarity}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              <span>No cards match the current filters.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onQueryChange("");
                  onRarityChange(null);
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Showing {cards.length.toLocaleString()} of{" "}
          {pool?.cards.length.toLocaleString() ?? 0} cards
        </p>
      </DialogContent>
    </Dialog>
  );
}

function PackResultSummary({ session }: { session: PackOpeningPullSession }) {
  const cardCount = session.packs.reduce(
    (total, pack) => total + pack.length,
    0,
  );
  const rarestEvent = (session.packClasses ?? [])
    .filter((packClass) => packClass.id !== "standard")
    .sort(
      (a, b) =>
        ({ standard: 0, "hit-heavy": 1, "rare-pack": 2 })[b.id] -
        { standard: 0, "hit-heavy": 1, "rare-pack": 2 }[a.id],
    )[0];
  return (
    <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-background/85 p-3 shadow-lg backdrop-blur-xl sm:max-w-md">
      <BadgeCheck
        className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{session.packLabel}</p>
        <p className="truncate text-xs text-muted-foreground">
          {session.packs.length} {session.packs.length === 1 ? "pack" : "packs"}{" "}
          · {cardCount} cards
          {rarestEvent ? ` · ${rarestEvent.label}` : ""}
        </p>
      </div>
    </div>
  );
}

function PhaseControls({
  state,
  onCommand,
  onChoosePack,
  canOpenSelected,
}: {
  state: PackOpeningNativeState;
  onCommand: (command: PackOpeningNativeCommand) => void;
  onChoosePack: () => void;
  canOpenSelected: boolean;
}) {
  const panelClass =
    "rounded-2xl border bg-background/88 p-2.5 shadow-xl backdrop-blur-xl supports-[backdrop-filter]:bg-background/78 sm:p-3";

  if (state.phase === "select") {
    return (
      <div className={cn(panelClass, "space-y-2")}>
        {state.packCount === 1 ? (
          <div
            className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
            role="radiogroup"
            aria-label="Opening style"
          >
            <ModeButton
              active={state.openingMode === "normal"}
              icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              label="Open Normally"
              onClick={() =>
                onCommand({ type: "setOpeningMode", mode: "normal" })
              }
            />
            <ModeButton
              active={state.openingMode === "quick"}
              icon={<Bolt className="h-4 w-4" aria-hidden="true" />}
              label="Quick Open"
              onClick={() =>
                onCommand({ type: "setOpeningMode", mode: "quick" })
              }
            />
          </div>
        ) : (
          <div className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-muted px-3 text-sm font-semibold">
            <Layers3 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {state.packCount}-Pack Summary
          </div>
        )}

        <button
          type="button"
          onClick={onChoosePack}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl border bg-background/70 px-3 text-left text-sm font-medium transition hover:bg-muted"
          aria-label={`Choose set and pack, currently ${selectedPackDisplayLabel(state)}`}
        >
          <GalleryVerticalEnd
            className="h-5 w-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">
            {selectedPackDisplayLabel(state)}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </button>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {COUNT_OPTIONS.map((count) => (
            <Button
              key={count}
              type="button"
              size="sm"
              className="shrink-0 px-2.5 sm:px-3"
              variant={state.packCount === count ? "default" : "outline"}
              aria-pressed={state.packCount === count}
              aria-label={`Open ${count} ${count === 1 ? "pack" : "packs"}`}
              onClick={() => onCommand({ type: "setPackCount", count })}
            >
              ×{count}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            className="min-w-0 flex-1 truncate"
            disabled={!canOpenSelected}
            onClick={() => onCommand({ type: "openPack" })}
          >
            {!canOpenSelected
              ? "Download to Open Offline"
              : state.packCount === 1
                ? "Open Pack"
                : `Open ${state.packCount} Packs`}
          </Button>
        </div>
      </div>
    );
  }

  if (state.phase === "tear") {
    return (
      <div className={cn(panelClass, "space-y-2")}>
        <Instruction icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
          {state.packBackwards
            ? "Back facing · swipe across the seal, or open it now"
            : "Swipe across the seal, or open it now"}
        </Instruction>
        <div className="flex flex-wrap justify-center gap-2">
          <BackButton onCommand={onCommand} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCommand({ type: "togglePackOrientation" })}
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            {state.packBackwards ? "Face Front" : "Flip Pack"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onCommand({ type: "advance" })}
          >
            Open Pack
          </Button>
        </div>
        {state.totalPacks > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={() => onCommand({ type: "showAll" })}
          >
            Skip Animations · Keep Grouped Results
          </Button>
        ) : null}
      </div>
    );
  }

  if (state.phase === "opening") {
    return (
      <div className={cn(panelClass, "space-y-2")}>
        <Instruction icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
          {state.totalPacks === 1
            ? "Opening your pack…"
            : `Opening ${state.totalPacks} packs…`}
        </Instruction>
        <div className="flex flex-wrap justify-center gap-2">
          <BackButton onCommand={onCommand} />
          {state.totalPacks > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onCommand({ type: "showAll" })}
            >
              Skip to Results
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (state.phase === "reveal") {
    return (
      <div className={cn(panelClass, "space-y-2")}>
        <Instruction
          icon={<GalleryVerticalEnd className="h-4 w-4" aria-hidden="true" />}
        >
          {revealInstruction(state)}
        </Instruction>
        <div className="flex flex-wrap justify-center gap-2">
          {!state.packBackwards ? <BackButton onCommand={onCommand} /> : null}
          <Button
            type="button"
            size="sm"
            onClick={() => onCommand({ type: "advance" })}
          >
            {revealActionLabel(state)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCommand({ type: "showAll" })}
          >
            {state.totalPacks > 1 ? "Skip to Results" : "Show All"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(panelClass, "flex flex-wrap justify-center gap-2")}>
      {state.canSave ? (
        <Button type="button" onClick={() => onCommand({ type: "savePulls" })}>
          Save Pulls
        </Button>
      ) : null}
      <Button
        type="button"
        variant={state.canSave ? "outline" : "default"}
        onClick={() => onCommand({ type: "backToPacks" })}
      >
        Open More
      </Button>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold transition coarse:min-h-11 sm:text-sm",
        active && "bg-background text-foreground shadow-sm",
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}

function Instruction({
  children,
  icon,
}: {
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-full bg-muted px-4 py-2 text-center text-[13px] font-semibold sm:text-sm">
      <span className="shrink-0">{icon}</span>
      {children}
    </div>
  );
}

function BackButton({
  onCommand,
}: {
  onCommand: (command: PackOpeningNativeCommand) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => onCommand({ type: "backToPacks" })}
    >
      <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
      Packs
    </Button>
  );
}

function PackResults({
  session,
  onInspect,
}: {
  session: PackOpeningPullSession;
  onInspect: (index: number) => void;
}) {
  const pulls = session.packs.flat();
  const bestPullIndex = pulls.reduce(
    (best, pull, index) =>
      best < 0 || tierRank(pull.tier) > tierRank(pulls[best].tier)
        ? index
        : best,
    -1,
  );

  return (
    <div
      className="absolute inset-0 z-20 overflow-y-auto bg-background"
      aria-label={`Pack results for ${session.packLabel}`}
    >
      {/* The top bar carries the opening's summary, so the scroll area only
          starts below it — the same split the iOS results view uses. */}
      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 pb-44 pt-24 sm:px-6 sm:pt-28">
        {session.recap ||
        (session.packClasses ?? []).some(
          (packClass) => packClass.id !== "standard",
        ) ? (
          <OpeningEventRecap session={session} />
        ) : null}
        {session.packs.length > 1 && bestPullIndex >= 0 ? (
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-lg font-bold text-amber-600 dark:text-amber-400">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              Best Pull
            </h3>
            <div className="mx-auto max-w-48">
              <ResultCard
                pull={pulls[bestPullIndex]}
                onInspect={() => onInspect(bestPullIndex)}
                priority
              />
            </div>
          </section>
        ) : null}

        {session.packs.map((pack, packIndex) => {
          const offset = session.packs
            .slice(0, packIndex)
            .reduce((total, entry) => total + entry.length, 0);
          return (
            <section key={packIndex} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold">
                  {session.packs.length === 1
                    ? "Your Pulls"
                    : `Pack ${packIndex + 1}`}
                  {session.packClasses?.[packIndex]?.id !== "standard" &&
                  session.packClasses?.[packIndex]
                    ? ` · ${session.packClasses[packIndex].label}`
                    : ""}
                </h3>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {pack.length} cards
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {pack.map((pull, pullIndex) => (
                  <ResultCard
                    key={`${pull.cardId}-${pullIndex}`}
                    pull={pull}
                    onInspect={() => onInspect(offset + pullIndex)}
                    priority={packIndex === 0 && pullIndex < 2}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function OpeningEventRecap({ session }: { session: PackOpeningPullSession }) {
  const [shareStatus, setShareStatus] = useState("");
  const eventPacks = (session.packClasses ?? []).filter(
    (packClass) => packClass.id !== "standard",
  );
  const rarestEvent = [...eventPacks].sort(
    (a, b) =>
      ({ standard: 0, "hit-heavy": 1, "rare-pack": 2 })[b.id] -
      { standard: 0, "hit-heavy": 1, "rare-pack": 2 }[a.id],
  )[0];
  const recap = session.recap;

  const shareRecap = async () => {
    if (!rarestEvent) return;
    const pulls = session.packs.flat();
    const bestPull = pulls.reduce<PackOpeningPull | undefined>(
      (best, pull) =>
        !best || tierRank(pull.tier) > tierRank(best.tier) ? pull : best,
      undefined,
    );
    const text = [
      `I found a ${rarestEvent.label} opening ${session.packLabel}!`,
      bestPull ? `Best pull: ${bestPull.name} (${bestPull.rarity}).` : "",
      recap
        ? `${recap.progress.totalPacks} packs opened in the TCGer minigame.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Rare pack recap", text });
        setShareStatus("Shared");
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus("Copied");
      }
    } catch {
      setShareStatus("");
    }
  };

  return (
    <section
      className={cn(
        "rounded-3xl border p-4 shadow-sm sm:p-5",
        rarestEvent?.id === "rare-pack"
          ? "border-amber-300/70 bg-gradient-to-br from-amber-100/85 via-background to-fuchsia-100/70 dark:from-amber-950/65 dark:to-fuchsia-950/45"
          : rarestEvent
            ? "border-violet-300/60 bg-gradient-to-br from-violet-100/80 via-background to-sky-100/60 dark:from-violet-950/55 dark:to-sky-950/35"
            : "bg-muted/45",
      )}
      aria-label="Opening minigame recap"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {rarestEvent ? (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                Rare pack event
              </p>
              <h3 className="mt-1 text-2xl font-bold">{rarestEvent.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {eventPacks.length > 1
                  ? `${eventPacks.length} special packs · `
                  : ""}
                {rarestEvent.description}
              </p>
            </>
          ) : (
            <h3 className="text-lg font-bold">Opening progress</h3>
          )}
        </div>
        {rarestEvent ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void shareRecap()}
          >
            <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {shareStatus || "Share"}
          </Button>
        ) : null}
      </div>

      {recap ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <OpeningProgressStat
              label="Packs"
              value={recap.progress.totalPacks}
            />
            <OpeningProgressStat
              label="Set found"
              value={`${recap.progress.uniqueCards}/${recap.progress.possibleCards}`}
            />
            <OpeningProgressStat label="New" value={`+${recap.newCards}`} />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 via-violet-500 to-amber-400"
              style={{ width: `${recap.progress.completionPercentage}%` }}
            />
          </div>
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {recap.progress.completionPercentage}% minigame set complete
          </p>
          {recap.unlockedAchievements.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {recap.unlockedAchievements.map((achievement) => (
                <span
                  key={achievement.id}
                  title={achievement.description}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-amber-300/15 px-3 py-1 text-xs font-bold text-amber-800 dark:text-amber-200"
                >
                  <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                  Achievement · {achievement.title}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function OpeningProgressStat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-background/70 px-2 py-2.5">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
        {label}
      </p>
    </div>
  );
}

function ResultCard({
  pull,
  onInspect,
  priority = false,
}: {
  pull: PackOpeningPull;
  onInspect: () => void;
  priority?: boolean;
}) {
  const tierClass = {
    common: "text-muted-foreground",
    uncommon: "text-emerald-600 dark:text-emerald-300",
    rare: "text-sky-600 dark:text-sky-300",
    ultra: "text-violet-600 dark:text-violet-300",
    chase: "text-amber-600 dark:text-amber-300",
  }[pull.tier];

  return (
    <button
      type="button"
      onClick={onInspect}
      className="group w-full min-w-0 space-y-2 text-center"
      aria-label={`${pull.name}, ${pull.rarity}`}
    >
      <div className="relative aspect-[63/88] overflow-hidden rounded-xl bg-muted shadow-md transition group-hover:-translate-y-0.5 group-hover:shadow-lg">
        <CardImage
          src={pull.imageUrl}
          fallbackSrc={pull.imageUrlSmall}
          tcg={pull.tcg}
          alt=""
          fill
          priority={priority}
          sizes="(max-width: 640px) 44vw, 190px"
          className="object-contain"
        />
      </div>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {pull.name}
        </span>
        <span
          className={cn(
            "block truncate text-[11px] font-semibold uppercase tracking-wide",
            tierClass,
          )}
        >
          {pull.rarity}
        </span>
      </div>
    </button>
  );
}
