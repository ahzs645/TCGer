"use client";

import { useEffect, useMemo, useState } from "react";
import {
  gamePackageDefinition,
  matchesGamePackageFilters,
  type GameFilterSelection,
  type GamePackageCatalogCard,
} from "@tcg/api-types";
import { Download, Loader2, Puzzle, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  checkGamePackageUpdate,
  gamePackageCards,
  installGamePackage,
  listInstalledGamePackages,
  removeGamePackage,
  updateGamePackage,
  type GamePackageUpdateCheck,
  type InstalledGamePackage,
} from "@/lib/game-packages/game-package-client";

export function InstallGamePackagePanel() {
  const [url, setUrl] = useState("");
  const [packages, setPackages] = useState<InstalledGamePackage[]>([]);
  const [cards, setCards] = useState<Record<string, GamePackageCatalogCard[]>>(
    {},
  );
  const [selections, setSelections] = useState<
    Record<string, Record<string, GameFilterSelection>>
  >({});
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<
    Record<string, GamePackageUpdateCheck | undefined>
  >({});
  const [error, setError] = useState<string>();

  const reload = async () => setPackages(await listInstalledGamePackages());
  useEffect(() => {
    let active = true;
    void listInstalledGamePackages()
      .then((value) => {
        if (active) setPackages(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const install = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await installGamePackage(url);
      setUrl("");
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The game package could not be installed",
      );
    } finally {
      setBusy(false);
    }
  };

  const checkUpdates = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const checks = await Promise.all(
        packages.map(
          async (installed) =>
            [installed.id, await checkGamePackageUpdate(installed)] as const,
        ),
      );
      setUpdates(Object.fromEntries(checks));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Updates could not be checked",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Puzzle className="h-4 w-4" />
          Install from URL
        </h3>
        <p className="text-sm text-muted-foreground">
          Install another publisher&apos;s HTTPS GamePackageManifest. Official
          TCGer packages are available in the Game Store.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-label="Game package URL"
        />
        <Button onClick={() => void install()} disabled={busy || !url.trim()}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Install
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="space-y-3">
        {packages.map((installed) => (
          <CommunityLibrary
            key={installed.id}
            installed={installed}
            cards={cards[installed.id]}
            selections={selections[installed.id] ?? {}}
            onSelections={(next) =>
              setSelections((current) => ({ ...current, [installed.id]: next }))
            }
            onBrowse={async () => {
              const loaded = await gamePackageCards(installed.id);
              setCards((current) => ({ ...current, [installed.id]: loaded }));
            }}
            update={updates[installed.id]}
            onUpdate={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await updateGamePackage(installed);
                setUpdates((current) => ({
                  ...current,
                  [installed.id]: undefined,
                }));
                await reload();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "The package could not be updated",
                );
              } finally {
                setBusy(false);
              }
            }}
            onRemove={async () => {
              await removeGamePackage(installed.id);
              setCards((current) => {
                const next = { ...current };
                delete next[installed.id];
                return next;
              });
              await reload();
            }}
          />
        ))}
        {!packages.length && (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No community libraries installed.
          </p>
        )}
        {packages.length > 0 && (
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => void checkUpdates()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Check for library updates
          </Button>
        )}
      </div>
    </section>
  );
}

function CommunityLibrary({
  installed,
  cards,
  selections,
  onSelections,
  onBrowse,
  update,
  onUpdate,
  onRemove,
}: {
  installed: InstalledGamePackage;
  cards?: GamePackageCatalogCard[];
  selections: Record<string, GameFilterSelection>;
  onSelections: (value: Record<string, GameFilterSelection>) => void;
  onBrowse: () => Promise<void>;
  update?: GamePackageUpdateCheck;
  onUpdate: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const definition = gamePackageDefinition(installed.manifest);
  const filters = definition.search.facets;
  const interfaces = definition.interfaces;
  const interfaceLabels: Record<string, string> = {
    search: "search",
    collection: "collections",
    sets: "sets",
    wishlists: "wishlists",
    decks: "decks",
    pricing: "pricing",
    sealedProducts: "sealed products",
    scanner: "scanner",
    packOpening: "pack opening",
  };
  const enabledInterfaces = interfaces
    ? Object.entries(interfaces)
        .filter(([name, enabled]) => name !== "features" && enabled === true)
        .map(([name]) => interfaceLabels[name] ?? name)
    : [];
  const enabledFeatures =
    interfaces?.features?.map((feature) => feature.id) ?? [];
  const declaredSupport = [...enabledInterfaces, ...enabledFeatures];
  const filtered = useMemo(
    () =>
      cards
        ?.filter((card) => matchesGamePackageFilters(card, filters, selections))
        .slice(0, 100),
    [cards, filters, selections],
  );
  return (
    <div className="rounded-lg border bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{definition.label}</p>
          <p className="text-xs text-muted-foreground">
            {installed.manifest.catalog.cardCount.toLocaleString()} cards · v
            {installed.manifest.packageVersion} ·{" "}
            {installed.manifest.publisher.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {installed.trust?.status === "verified"
              ? `Verified key ${installed.trust.fingerprint?.slice(0, 12)}`
              : "Unsigned publisher"}
          </p>
          {declaredSupport.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Declared support: {declaredSupport.join(", ")}
            </p>
          )}
          {update && (
            <p className="mt-1 text-xs text-primary">
              Update v{update.manifest.packageVersion}
              {update.manifest.update?.releaseNotes
                ? ` · ${update.manifest.update.releaseNotes}`
                : ""}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {update && (
            <Button size="sm" onClick={() => void onUpdate()}>
              Update
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void onBrowse()}>
            {cards ? "Reload" : "Browse"}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove ${installed.manifest.game.name}`}
            onClick={() => void onRemove()}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {cards && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {filters.map((filter) => (
              <label key={filter.id} className="text-xs font-medium">
                {filter.label}
                {filter.type === "select" ? (
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                    value={String(selections[filter.id] ?? "")}
                    onChange={(event) =>
                      onSelections({
                        ...selections,
                        [filter.id]: event.target.value,
                      })
                    }
                  >
                    <option value="">All</option>
                    {(filter.options ?? []).map((option) => (
                      <option
                        key={String(option.value)}
                        value={String(option.value)}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : filter.type === "multiSelect" ? (
                  <select
                    multiple
                    className="mt-1 min-h-20 w-full rounded-md border bg-background px-2 py-1"
                    value={
                      Array.isArray(selections[filter.id])
                        ? (selections[filter.id] as string[])
                        : []
                    }
                    onChange={(event) =>
                      onSelections({
                        ...selections,
                        [filter.id]: Array.from(
                          event.target.selectedOptions,
                          (option) => option.value,
                        ),
                      })
                    }
                  >
                    {(filter.options ?? []).map((option) => (
                      <option
                        key={String(option.value)}
                        value={String(option.value)}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : filter.type === "boolean" ? (
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                    value={
                      selections[filter.id] === undefined
                        ? ""
                        : String(selections[filter.id])
                    }
                    onChange={(event) =>
                      onSelections({
                        ...selections,
                        [filter.id]:
                          event.target.value === ""
                            ? ""
                            : event.target.value === "true",
                      })
                    }
                  >
                    <option value="">All</option>
                    <option value="true">{filter.trueLabel ?? "Yes"}</option>
                    <option value="false">{filter.falseLabel ?? "No"}</option>
                  </select>
                ) : filter.type === "numberRange" ? (
                  <div className="mt-1 flex gap-2">
                    <Input
                      type="number"
                      min={filter.min}
                      max={filter.max}
                      placeholder="Min"
                      onChange={(event) =>
                        onSelections({
                          ...selections,
                          [filter.id]: {
                            ...(typeof selections[filter.id] === "object"
                              ? (selections[filter.id] as {
                                  min?: number;
                                  max?: number;
                                })
                              : {}),
                            min: event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          },
                        })
                      }
                    />
                    <Input
                      type="number"
                      min={filter.min}
                      max={filter.max}
                      placeholder="Max"
                      onChange={(event) =>
                        onSelections({
                          ...selections,
                          [filter.id]: {
                            ...(typeof selections[filter.id] === "object"
                              ? (selections[filter.id] as {
                                  min?: number;
                                  max?: number;
                                })
                              : {}),
                            max: event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          },
                        })
                      }
                    />
                  </div>
                ) : (
                  <Input
                    className="mt-1"
                    maxLength={filter.maxLength}
                    value={String(selections[filter.id] ?? "")}
                    onChange={(event) =>
                      onSelections({
                        ...selections,
                        [filter.id]: event.target.value,
                      })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {filtered?.length ?? 0}
            {(filtered?.length ?? 0) === 100 ? "+" : ""} matching cards
          </p>
          <div className="max-h-52 divide-y overflow-auto rounded border">
            {filtered?.map((card) => (
              <div key={card.id} className="p-2 text-xs">
                <span className="font-medium">{card.name}</span>
                {card.setCode ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {card.setCode}
                    {card.collectorNumber ? ` ${card.collectorNumber}` : ""}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
