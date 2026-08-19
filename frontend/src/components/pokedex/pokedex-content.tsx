"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Check,
  Download,
  Grid2X2,
  Loader2,
  Search,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { CardImage } from "@/components/cards/card-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  deriveCatalogImageUrls,
} from "@/lib/catalog/catalog-search";
import {
  getCatalogCards,
  getInstalledCatalog,
  type CatalogCard,
} from "@/lib/catalog/catalog-db";
import { useCatalog } from "@/lib/catalog/use-catalog";
import { DEMO_CARDS, splitDemoPrintingCode } from "@/lib/data/demo-cards";
import {
  buildPokedex,
  filterPokedex,
  POKEDEX_GENERATIONS,
  pokedexProgress,
  type PokedexCardInput,
  type PokedexOwnershipFilter,
  type PokedexPrinting,
  type PokedexSpecies,
} from "@/lib/pokedex/pokedex";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { useDemoStore } from "@/stores/demo-store";
import { formatTotalCopyCount } from "@/lib/copy-labels";

const INITIAL_SPECIES_LIMIT = 120;
const SPECIES_PAGE_SIZE = 120;

function normalizeCatalogCard(
  card: CatalogCard,
  sets: Map<string, NonNullable<Awaited<ReturnType<typeof getInstalledCatalog>>>["sets"][number]>,
): PokedexCardInput {
  const set = card.setCode ? sets.get(card.setCode) : undefined;
  const images = deriveCatalogImageUrls("pokemon", card, set);
  return {
    ...card,
    tcg: "pokemon",
    setName: set?.name,
    releasedAt: set?.releasedAt,
    imageUrl: images.imageUrl,
    imageUrlSmall: images.imageUrlSmall,
  };
}

function demoCatalogCards(): PokedexCardInput[] {
  return DEMO_CARDS.filter((card) => card.tcg === "pokemon").map((card) => {
    const printing = splitDemoPrintingCode(card.setCode);
    return {
      ...card,
      setCode: printing.setCode,
      collectorNumber: printing.collectorNumber,
      type: card.name === "Iono" || card.name.includes("Orders") ? "Trainer" : "Pokemon",
    };
  });
}

function formatNumber(number: number): string {
  return `#${String(number).padStart(4, "0")}`;
}

function progressLabel(owned: number, total: number): string {
  return `${owned.toLocaleString()} of ${total.toLocaleString()} species collected`;
}

export function PokedexContent() {
  const pathname = usePathname();
  const demoMode = pathname === "/demo" || pathname.startsWith("/demo/");
  const { token, isAuthenticated } = useAuthStore(
    useShallow((state) => ({
      token: state.token,
      isAuthenticated: state.isAuthenticated,
    })),
  );
  const {
    collections,
    fetchCollections,
    hasFetched,
    collectionLoading,
    collectionError,
  } = useCollectionsStore(
    useShallow((state) => ({
      collections: state.collections,
      fetchCollections: state.fetchCollections,
      hasFetched: state.hasFetched,
      collectionLoading: state.isLoading,
      collectionError: state.error,
    })),
  );
  const demoBinders = useDemoStore((state) => state.binders);
  const initDemo = useDemoStore((state) => state.init);
  const catalog = useCatalog();
  const pokemonCatalog = catalog.states.pokemon;

  const [catalogCards, setCatalogCards] = useState<PokedexCardInput[]>(() =>
    demoMode ? demoCatalogCards() : [],
  );
  const [catalogReading, setCatalogReading] = useState(false);
  const [catalogReadError, setCatalogReadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState<number | "all">("all");
  const [ownership, setOwnership] =
    useState<PokedexOwnershipFilter>("all");
  const [selectedSpecies, setSelectedSpecies] =
    useState<PokedexSpecies | null>(null);
  const [speciesLimit, setSpeciesLimit] = useState(INITIAL_SPECIES_LIMIT);

  useEffect(() => {
    if (demoMode) initDemo();
  }, [demoMode, initDemo]);

  useEffect(() => {
    if (!demoMode && token && isAuthenticated && !hasFetched) {
      void fetchCollections(token);
    }
  }, [
    demoMode,
    fetchCollections,
    hasFetched,
    isAuthenticated,
    token,
  ]);

  const readCatalog = useCallback(async () => {
    if (pokemonCatalog.status !== "installed" && pokemonCatalog.status !== "update-available") {
      setCatalogCards(demoMode ? demoCatalogCards() : []);
      setCatalogReadError(null);
      return;
    }

    setCatalogReading(true);
    setCatalogReadError(null);
    try {
      const [cards, installed] = await Promise.all([
        getCatalogCards("pokemon"),
        getInstalledCatalog("pokemon"),
      ]);
      if (!installed || !cards.length) {
        throw new Error("The installed Pokémon catalog could not be read.");
      }
      const sets = new Map(installed.sets.map((set) => [set.code, set]));
      setCatalogCards(cards.map((card) => normalizeCatalogCard(card, sets)));
    } catch (error) {
      setCatalogCards(demoMode ? demoCatalogCards() : []);
      setCatalogReadError(
        error instanceof Error
          ? error.message
          : "The Pokémon catalog could not be read.",
      );
    } finally {
      setCatalogReading(false);
    }
  }, [demoMode, pokemonCatalog.status]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void readCatalog(), 0);
    return () => window.clearTimeout(timeout);
  }, [readCatalog]);

  const collectionCards = useMemo<PokedexCardInput[]>(() => {
    if (demoMode) {
      return demoBinders.flatMap((binder) =>
        binder.cards
          .filter((card) => card.tcg === "pokemon")
          .map((card) => ({
            ...card.cardData,
            id: card.id,
            cardId: card.cardId,
            name: card.name,
            tcg: card.tcg,
            setCode: card.cardData?.setCode ?? card.setCode,
            setName: card.cardData?.setName ?? card.setName,
            collectorNumber: card.cardData?.collectorNumber,
            rarity: card.cardData?.rarity ?? card.rarity,
            imageUrl: card.cardData?.imageUrl,
            imageUrlSmall: card.cardData?.imageUrlSmall,
            dexEntries: card.cardData?.dexEntries,
            quantity: card.quantity,
            copies: card.copies,
          })),
      );
    }
    return collections
      .flatMap((collection) => collection.cards)
      .filter((card) => card.tcg === "pokemon");
  }, [collections, demoBinders, demoMode]);

  const species = useMemo(
    () => buildPokedex(catalogCards, collectionCards),
    [catalogCards, collectionCards],
  );
  const nationalProgress = useMemo(() => pokedexProgress(species), [species]);
  const generationSpecies = useMemo(
    () =>
      generation === "all"
        ? species
        : species.filter((entry) => entry.generation === generation),
    [generation, species],
  );
  const currentProgress = useMemo(
    () => pokedexProgress(generationSpecies),
    [generationSpecies],
  );
  const visibleSpecies = useMemo(
    () => filterPokedex(species, { generation, ownership, query }),
    [generation, ownership, query, species],
  );
  const renderedSpecies = visibleSpecies.slice(0, speciesLimit);
  const remainingSpecies = Math.max(
    0,
    visibleSpecies.length - renderedSpecies.length,
  );

  const resetSpeciesLimit = () => setSpeciesLimit(INITIAL_SPECIES_LIMIT);

  const loading = catalog.isLoading || catalogReading;
  const installProgress = catalog.progress.pokemon;
  const installError = catalog.errors.pokemon;
  const catalogInstalled =
    pokemonCatalog.status === "installed" ||
    pokemonCatalog.status === "update-available";
  const canInstall =
    pokemonCatalog.status === "not-installed" ||
    pokemonCatalog.status === "update-available";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-primary" aria-hidden="true" />
            <h1 className="font-heading text-3xl font-semibold">Pokédex</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Turn every Pokémon card in your collection into National Pokédex
            progress, then explore all known printings for each species.
          </p>
        </div>
        {canInstall ? (
          <Button
            onClick={() => void catalog.install("pokemon")}
            disabled={Boolean(installProgress)}
          >
            {installProgress ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {pokemonCatalog.status === "update-available"
              ? "Update catalog"
              : "Download printings"}
          </Button>
        ) : null}
      </div>

      <section aria-labelledby="pokedex-progress-heading">
        <Card className="overflow-hidden">
          <CardHeader className="gap-5 bg-gradient-to-br from-primary/10 via-background to-emerald-500/10 md:flex-row md:items-center md:justify-between md:space-y-0">
            <div className="space-y-1">
              <CardTitle id="pokedex-progress-heading" asChild>
                <h2>National progress</h2>
              </CardTitle>
              <CardDescription>
                {progressLabel(nationalProgress.owned, nationalProgress.total)}
              </CardDescription>
            </div>
            <div className="flex items-baseline gap-2" aria-hidden="true">
              <span className="font-heading text-4xl font-semibold tabular-nums">
                {nationalProgress.percent.toFixed(1)}%
              </span>
              <span className="text-sm text-muted-foreground">complete</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div
              className="h-3 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="National Pokédex completion"
              aria-valuemin={0}
              aria-valuemax={nationalProgress.total}
              aria-valuenow={nationalProgress.owned}
              aria-valuetext={progressLabel(
                nationalProgress.owned,
                nationalProgress.total,
              )}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${nationalProgress.percent}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span>
                <strong className="tabular-nums">{currentProgress.owned}</strong>{" "}
                owned in {generation === "all" ? "all generations" : `Generation ${generation}`}
              </span>
              <span className="text-muted-foreground">
                {collectionCards.reduce(
                  (total, card) => total + (card.quantity ?? card.copies?.length ?? 1),
                  0,
                )}{" "}
                Pokémon cards tracked
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {catalogReadError || collectionError || installError ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span>
            {catalogReadError ?? collectionError ?? installError} Your saved
            collection has not been changed.
          </span>
          <Button variant="outline" size="sm" onClick={() => void readCatalog()}>
            Try again
          </Button>
        </div>
      ) : null}

      {!catalogInstalled && !loading ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Printing catalog not downloaded</p>
          <p className="mt-1 text-muted-foreground">
            Species progress still uses your collection. Download the Pokémon
            catalog to browse every printing and see card artwork.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Explore species</h2>
          </CardTitle>
          <CardDescription>
            Search by species name or National Pokédex number, then refine by
            region and collection status.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_220px_auto] lg:items-end">
            <div className="space-y-2">
              <label htmlFor="pokedex-search" className="text-sm font-medium">
                Search species
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="pokedex-search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    resetSpeciesLimit();
                  }}
                  placeholder="Pikachu or #0025"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label id="pokedex-generation-label" className="text-sm font-medium">
                Generation
              </label>
              <Select
                value={String(generation)}
                onValueChange={(value) => {
                  setGeneration(value === "all" ? "all" : Number(value));
                  resetSpeciesLimit();
                }}
              >
                <SelectTrigger aria-labelledby="pokedex-generation-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All generations</SelectItem>
                  {POKEDEX_GENERATIONS.map((entry) => (
                    <SelectItem key={entry.id} value={String(entry.id)}>
                      Gen {entry.id} · {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <span id="pokedex-status-label" className="block text-sm font-medium">
                Status
              </span>
              <ToggleGroup
                type="single"
                value={ownership}
                onValueChange={(value) => {
                  if (!value) return;
                  setOwnership(value as PokedexOwnershipFilter);
                  resetSpeciesLimit();
                }}
                aria-labelledby="pokedex-status-label"
                className="justify-start"
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="owned">Owned</ToggleGroupItem>
                <ToggleGroupItem value="missing">Missing</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {visibleSpecies.length.toLocaleString()} of{" "}
            {generationSpecies.length.toLocaleString()} species.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <PokedexGridSkeleton />
      ) : visibleSpecies.length ? (
        <div
          className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
          aria-label="Pokédex species"
        >
          {renderedSpecies.map((entry) => (
            <SpeciesTile
              key={entry.number}
              species={entry}
              onSelect={() => setSelectedSpecies(entry)}
            />
          ))}
          {remainingSpecies > 0 ? (
            <div className="col-span-full flex flex-col items-center gap-2 py-5 text-center">
              <p className="text-sm text-muted-foreground">
                Showing {renderedSpecies.length.toLocaleString()} of{" "}
                {visibleSpecies.length.toLocaleString()} matching species.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setSpeciesLimit((limit) => limit + SPECIES_PAGE_SIZE)
                }
              >
                Load {Math.min(SPECIES_PAGE_SIZE, remainingSpecies)} more
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <Card>
          <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
            <Grid2X2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">No species match these filters</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try another generation, switch collection status, or clear the
                search.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setGeneration("all");
                setOwnership("all");
                resetSpeciesLimit();
              }}
            >
              Clear filters
            </Button>
          </CardContent>
        </Card>
      )}

      <SpeciesDialog
        species={selectedSpecies}
        open={Boolean(selectedSpecies)}
        catalogInstalled={catalogInstalled}
        onOpenChange={(open) => !open && setSelectedSpecies(null)}
      />
      {collectionLoading && !demoMode ? (
        <span className="sr-only" role="status">
          Updating collection progress…
        </span>
      ) : null}
      {!demoMode && (!isAuthenticated || !token) ? (
        <p className="text-center text-xs text-muted-foreground">
          Sign in to compare the Pokédex with your saved collection.
        </p>
      ) : null}
    </div>
  );
}

function SpeciesTile({
  species,
  onSelect,
}: {
  species: PokedexSpecies;
  onSelect: () => void;
}) {
  const representative = species.printings[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        species.owned && "border-emerald-500/40",
      )}
      aria-label={`${species.name}, ${formatNumber(species.number)}, ${
        species.owned ? "owned" : "missing"
      }`}
    >
      <div className="relative aspect-[5/4] overflow-hidden bg-gradient-to-br from-muted to-muted/40">
        {representative ? (
          <CardImage
            src={representative.imageUrlSmall ?? representative.imageUrl}
            fallbackSrc={representative.imageUrl}
            alt={`${representative.name} card artwork`}
            tcg="pokemon"
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 17vw"
            className={cn(
              "object-contain p-3 transition-transform group-hover:scale-[1.03]",
              !species.owned && "grayscale-[35%] opacity-80",
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-heading text-3xl font-semibold text-muted-foreground/35">
              {String(species.number).padStart(3, "0")}
            </span>
          </div>
        )}
        <Badge
          variant={species.owned ? "default" : "secondary"}
          className="absolute right-2 top-2 gap-1 shadow-sm"
        >
          {species.owned ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
          {species.owned ? "Owned" : "Missing"}
        </Badge>
      </div>
      <div className="space-y-0.5 p-2 sm:space-y-1 sm:p-3">
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground sm:text-xs">
          {formatNumber(species.number)}
        </span>
        <p className="line-clamp-2 font-heading text-sm font-semibold leading-tight sm:text-base">
          {species.name}
        </p>
        <p className="line-clamp-2 text-[11px] text-muted-foreground sm:text-xs">
          {species.printings.length
            ? `${species.ownedPrintings}/${species.printings.length} printings owned`
            : "Printings unavailable"}
        </p>
      </div>
    </button>
  );
}

function SpeciesDialog({
  species,
  open,
  catalogInstalled,
  onOpenChange,
}: {
  species: PokedexSpecies | null;
  open: boolean;
  catalogInstalled: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!species) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {formatNumber(species.number)}
            </span>
            {species.owned ? <Badge className="gap-1"><Check className="h-3 w-3" />Owned</Badge> : <Badge variant="secondary">Missing</Badge>}
          </div>
          <DialogTitle className="font-heading text-2xl">{species.name}</DialogTitle>
          <DialogDescription>
            {species.printings.length
              ? `${species.ownedPrintings} of ${species.printings.length} card printings owned · ${formatTotalCopyCount(species.ownedQuantity)}`
              : "No printings are available in the local catalog yet."}
          </DialogDescription>
        </DialogHeader>
        {species.printings.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {species.printings.map((printing) => (
              <PrintingCard key={printing.id} printing={printing} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {catalogInstalled
              ? "This catalog does not list a card printing for this species."
              : "Download the Pokémon catalog from the Pokédex page to browse printings."}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PrintingCard({ printing }: { printing: PokedexPrinting }) {
  return (
    <article className="overflow-hidden rounded-lg border bg-card">
      <div className="relative aspect-[63/88] bg-muted">
        <CardImage
          src={printing.imageUrlSmall ?? printing.imageUrl}
          fallbackSrc={printing.imageUrl}
          alt={`${printing.name} card artwork`}
          tcg="pokemon"
          fill
          sizes="(max-width: 640px) 50vw, 220px"
          className="object-contain"
        />
        {printing.ownedQuantity ? (
          <Badge className="absolute right-2 top-2 gap-1 shadow-sm">
            <Check className="h-3 w-3" aria-hidden="true" />
            {printing.ownedQuantity} owned
          </Badge>
        ) : null}
      </div>
      <div className="space-y-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium">{printing.name}</h3>
        <p className="truncate text-xs text-muted-foreground">
          {printing.setName ?? printing.setCode ?? "Unknown set"}
          {printing.collectorNumber ? ` · ${printing.collectorNumber}` : ""}
        </p>
        {printing.rarity ? (
          <p className="truncate text-xs text-muted-foreground">{printing.rarity}</p>
        ) : null}
      </div>
    </article>
  );
}

function PokedexGridSkeleton() {
  return (
    <div
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
      role="status"
      aria-label="Loading Pokédex"
    >
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border bg-card p-3">
          <Skeleton className="aspect-[5/4] w-full" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
      <span className="sr-only">Loading Pokémon species and printings…</span>
    </div>
  );
}
