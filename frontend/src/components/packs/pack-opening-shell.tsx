"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bolt,
  ChevronDown,
  GalleryVerticalEnd,
  History,
  ImagePlus,
  Layers3,
  MoreHorizontal,
  PackageOpen,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import type {
  PackOpeningNativeCommand,
  PackOpeningNativePackOption,
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

interface PackOpeningShellProps {
  ready: boolean;
  state: PackOpeningNativeState | null;
  savedOpeningsCount: number;
  onOpenHistory: () => void;
  onCommand: (command: PackOpeningNativeCommand) => void;
  onInspect: (index: number) => void;
}

interface PackSetGroup {
  id: string;
  label: string;
  options: PackOpeningNativePackOption[];
}

const COUNT_OPTIONS = [1, 5, 10] as const;

function groupPackOptions(
  options: PackOpeningNativePackOption[],
): PackSetGroup[] {
  const groups = new Map<string, PackSetGroup>();
  for (const option of options) {
    const group = groups.get(option.setID);
    if (group) {
      group.options.push(option);
    } else {
      groups.set(option.setID, {
        id: option.setID,
        label: option.setLabel,
        options: [option],
      });
    }
  }
  return [...groups.values()];
}

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
}: PackOpeningShellProps) {
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const packSets = useMemo(
    () => groupPackOptions(state?.packOptions ?? []),
    [state?.packOptions],
  );
  const showsResults = Boolean(
    state &&
      (state.phase === "summary" || state.phase === "final") &&
      state.session,
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
              Pick the wrapper variant used for this opening.
            </DialogDescription>
          </DialogHeader>
          <div className="-mr-1 max-h-[52dvh] space-y-5 overflow-y-auto pr-1">
            {packSets.map((packSet) => (
              <section key={packSet.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{packSet.label}</h3>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {packSet.options.length}{" "}
                    {packSet.options.length === 1 ? "variant" : "variants"}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {packSet.options.map((option) => {
                    const selected = option.id === state?.selectedPackID;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          onCommand({ type: "selectPack", id: option.id });
                          setPackPickerOpen(false);
                        }}
                        className={cn(
                          "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-muted",
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
            ))}
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
    </>
  );
}

function PackResultSummary({ session }: { session: PackOpeningPullSession }) {
  const cardCount = session.packs.reduce(
    (total, pack) => total + pack.length,
    0,
  );
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
        </p>
      </div>
    </div>
  );
}

function PhaseControls({
  state,
  onCommand,
  onChoosePack,
}: {
  state: PackOpeningNativeState;
  onCommand: (command: PackOpeningNativeCommand) => void;
  onChoosePack: () => void;
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
            onClick={() => onCommand({ type: "openPack" })}
          >
            {state.packCount === 1
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
        "flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold transition sm:text-sm",
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
      className="group min-w-0 space-y-2 text-center"
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
