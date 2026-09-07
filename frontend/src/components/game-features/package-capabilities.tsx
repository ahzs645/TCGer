"use client";

import { useEffect, useState } from "react";
import {
  cardGameSymbol,
  gameSnapshotQuote,
  openGamePack,
  packageCardPresentation,
  type Card as CardData,
  type GamePackageCatalogCard,
} from "@tcg/api-types";
import { CardPreview } from "@/components/cards/card-preview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  gamePackageCards,
  installedPackageCapabilities,
  installPackageCapability,
  GAME_PACKAGES_CHANGED_EVENT,
  type InstalledGamePackage,
  type InstalledPackageCapability,
  type PackageCapability,
} from "@/lib/game-packages/game-package-client";

export function usePackageCapabilities() {
  const [capabilities, setCapabilities] = useState<
    InstalledPackageCapability[]
  >([]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void installedPackageCapabilities()
        .then((value) => {
          if (active) setCapabilities(value);
        })
        .catch(() => {
          if (active) setCapabilities([]);
        });
    };
    refresh();
    window.addEventListener(GAME_PACKAGES_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(GAME_PACKAGES_CHANGED_EVENT, refresh);
    };
  }, []);
  return capabilities;
}

export function PackageCapabilities({
  installed,
}: {
  installed: InstalledGamePackage;
}) {
  const capabilities = usePackageCapabilities().filter(
    (c) => c.packageId === installed.id,
  );
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<CardData>();
  const [pulls, setPulls] = useState<GamePackageCatalogCard[]>([]);
  const available: {
    kind: PackageCapability;
    label: string;
    bytes: number | undefined;
  }[] = [
    {
      kind: "pricing",
      label: "Price snapshots",
      bytes: installed.manifest.pricing?.asset.bytes,
    },
    {
      kind: "packs",
      label: "Pack opening",
      bytes: installed.manifest.offlinePacks?.manifest.bytes,
    },
    {
      kind: "scanner",
      label: "Scanner",
      bytes: installed.manifest.scanner?.web?.manifest.bytes,
    },
  ];
  async function enable(kind: PackageCapability) {
    setBusy(kind);
    setError(undefined);
    try {
      await installPackageCapability(installed.id, kind);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {available
          .filter((c) => c.bytes !== undefined)
          .map((c) => (
            <Button
              key={c.kind}
              size="sm"
              variant="outline"
              disabled={!!busy || capabilities.some((a) => a.kind === c.kind)}
              onClick={() => void enable(c.kind)}
            >
              {busy === c.kind
                ? "Downloading…"
                : capabilities.some((a) => a.kind === c.kind)
                  ? `${c.label} ready`
                  : `Enable ${c.label.toLowerCase()}`}
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {capabilities
        .flatMap((c) => c.packs?.packs ?? [])
        .map((pack) => (
          <Button
            key={pack.id}
            variant="secondary"
            size="sm"
            onClick={() => {
              void gamePackageCards(installed.id)
                .then((cards) => {
                  const byId = new Map(cards.map((c) => [c.id, c]));
                  setPulls(
                    openGamePack(pack)
                      .map((id) => byId.get(id)!)
                      .filter(Boolean),
                  );
                })
                .catch((cause) => setError(String(cause)));
            }}
          >
            Open {pack.name}
          </Button>
        ))}
      {pulls.length > 0 && (
        <div aria-live="polite" className="flex flex-wrap gap-3">
          {pulls.map((card, index) => (
            <div key={`${index}:${card.id}`} className="w-28 text-xs">
              {card.imageUrl && (
                <img
                  src={card.imageUrl}
                  alt={card.name}
                  className="mb-1 rounded"
                />
              )}
              <p>{card.name}</p>
              <p className="text-muted-foreground">{card.rarity}</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setSelected({
                    ...card,
                    tcg: installed.manifest.game.id,
                    dexEntries: card.dexEntries?.map((e) => ({
                      ...e,
                      name: e.name ?? `#${e.number}`,
                    })),
                  })
                }
              >
                Inspect / save
              </Button>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && <CardPreview card={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GameRarity({
  card,
}: {
  card: Pick<CardData, "rarity" | "attributes">;
}) {
  if (!card.rarity) return null;
  const symbol = cardGameSymbol(card, "rarity", card.rarity);
  return (
    <span className="inline-flex items-center gap-1">
      {symbol && (
        <img src={symbol.imageUrl} alt="" className="h-4 w-4 object-contain" />
      )}
      {symbol?.label ?? card.rarity}
    </span>
  );
}

export function PackagePrice({
  card,
  currency = "USD",
  finishCode,
  condition,
  language,
}: {
  card: CardData;
  currency?: string;
  finishCode?: string;
  condition?: string;
  language?: string;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const capabilities = usePackageCapabilities();
  const source = capabilities.find(
    (c) =>
      c.packageId === packageCardPresentation(card)?.packageId && c.pricing,
  );
  if (!source?.pricing) return null;
  const quote = gameSnapshotQuote(
    source.pricing,
    {
      cardId: card.id,
      printingKey: card.printingKey,
      currency,
      finishCode,
      condition,
      language,
    },
    now,
  );
  if (!quote)
    return (
      <span className="text-xs text-muted-foreground">
        No current price for this variant.
      </span>
    );
  return (
    <span className="text-sm">
      {new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
        quote.amount,
      )}{" "}
      <span className="text-xs text-muted-foreground">
        {quote.source} · {new Date(quote.observedAt).toLocaleDateString()}
      </span>
    </span>
  );
}

/** Types and resources are publisher tokens in `types` or scalar/array attributes. */
export function GameCardSymbols({ card }: { card: CardData & { types?: string[] } }) {
  const tokens = new Set(
    [
      ...(card.types ?? []),
      ...Object.entries(card.attributes ?? {})
        .filter(([key]) => key !== "tcger")
        .flatMap(([, value]) => (Array.isArray(value) ? value : [value])),
    ].filter((value): value is string => typeof value === "string"),
  );
  const symbols = packageCardPresentation(card)?.symbols?.filter(
    (symbol) => symbol.kind !== "rarity" && tokens.has(symbol.id),
  );
  if (!symbols?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {symbols.map((symbol) => (
        <span
          className="inline-flex items-center gap-1 text-xs"
          key={`${symbol.kind}:${symbol.id}`}
        >
          <img
            src={symbol.imageUrl}
            alt=""
            className="h-4 w-4 object-contain"
          />
          {symbol.label}
        </span>
      ))}
    </div>
  );
}
