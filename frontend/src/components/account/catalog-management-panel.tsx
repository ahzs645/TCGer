"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { UserPreferences } from "@tcg/api-types";
import { Download, HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { CardImage } from "@/components/cards/card-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ENABLED_PREFERENCE_KEY, getCardBackImage } from "@/lib/utils";
import { updateUserPreferences } from "@/lib/api/user-preferences";
import {
  type CatalogTcgCode,
  type CatalogInstallStatus,
  useCatalog,
} from "@/lib/catalog/use-catalog";
import {
  areSealedProductsEnabled,
  fetchOfficialGamePackages,
  type OfficialGamePackage,
  SEALED_PRODUCTS_PREFERENCE_EVENT,
  setSealedProductsEnabled,
} from "@/lib/catalog/catalog-client";
import { useAuthStore } from "@/stores/auth";
import { useModuleStore } from "@/stores/preferences";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function actionLabel(status: CatalogInstallStatus): string {
  return status === "update-available" ? "Update" : "Download";
}

interface GameStorePanelProps {
  onInstalled?: (tcg: CatalogTcgCode) => void;
}

export function GameStorePanel({ onInstalled }: GameStorePanelProps = {}) {
  const {
    states,
    manifest: catalogManifest,
    progress,
    errors,
    isLoading,
    install,
    update,
    remove,
    removeSealed,
  } = useCatalog();
  const [removing, setRemoving] = useState<CatalogTcgCode | null>(null);
  const [officialPackages, setOfficialPackages] = useState<
    OfficialGamePackage[]
  >([]);
  const [storeError, setStoreError] = useState<string>();
  const token = useAuthStore((state) => state.token);
  const updateStoredPreferences = useAuthStore(
    (state) => state.updateStoredPreferences,
  );
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const setGameEnabled = useModuleStore((state) => state.setGameEnabled);
  const includeSealedProducts = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener(SEALED_PRODUCTS_PREFERENCE_EVENT, onStoreChange);
      return () =>
        window.removeEventListener(
          SEALED_PRODUCTS_PREFERENCE_EVENT,
          onStoreChange,
        );
    },
    areSealedProductsEnabled,
    () => true,
  );

  useEffect(() => {
    let active = true;
    if (!catalogManifest) {
      setOfficialPackages([]);
      return () => {
        active = false;
      };
    }
    setStoreError(undefined);
    void fetchOfficialGamePackages(catalogManifest)
      .then((packages) => {
        if (active) setOfficialPackages(packages);
      })
      .catch(() => {
        if (active)
          setStoreError("The official package catalog could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [catalogManifest]);

  const handleRemove = async (tcg: CatalogTcgCode) => {
    setRemoving(tcg);
    try {
      await remove(tcg);
    } catch {
      // The hook exposes the user-facing error in the matching row.
    } finally {
      setRemoving(null);
    }
  };

  const activateGame = async (tcg: CatalogTcgCode) => {
    setGameEnabled(tcg, true);
    onInstalled?.(tcg);
    if (token) {
      const preference = {
        [ENABLED_PREFERENCE_KEY[tcg]]: true,
      } as Partial<UserPreferences>;
      try {
        await updateUserPreferences(preference, token);
        updateStoredPreferences(preference);
      } catch {
        // The package and this device's active-game state are already valid;
        // the next preference refresh can retry server persistence.
      }
    }
  };

  const handleInstall = async (tcg: CatalogTcgCode, isUpdate: boolean) => {
    try {
      await (isUpdate
        ? update(tcg, includeSealedProducts)
        : install(tcg, includeSealedProducts));
      await activateGame(tcg);
    } catch {
      // The hook exposes the user-facing error in the matching row.
    }
  };

  const handleSealedPreference = (enabled: boolean) => {
    setSealedProductsEnabled(enabled);
    if (!enabled) void removeSealed();
  };

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="h-4 w-4" />
            Game Store
          </h3>
          <p className="text-sm text-muted-foreground">
            Install official packages published through the catalog manifest.
          </p>
        </div>
        {isLoading && (
          <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
        <div>
          <p className="text-sm font-medium">Sealed products</p>
          <p className="text-xs text-muted-foreground">
            Include searchable boxes, packs, decks, and other sealed products.
          </p>
        </div>
        <Switch
          checked={includeSealedProducts}
          onCheckedChange={handleSealedPreference}
          aria-label="Include sealed-product catalogs"
        />
      </div>

      <div className="grid gap-3">
        {officialPackages.map((officialPackage) => {
          const tcg = officialPackage.tcg;
          const packageManifest = officialPackage.manifest;
          const state = states[tcg];
          const download = progress[tcg];
          const entry = state.manifest;
          const installed = state.installed;
          const isUpdate = state.status === "update-available";
          const isInstalled = Boolean(installed);
          const isGameEnabled = enabledGames[tcg];
          const sealedEntry = entry?.sealedProducts;
          const needsSealedInstall =
            includeSealedProducts &&
            Boolean(sealedEntry) &&
            state.sealedStatus !== "installed";
          const isRemoving = removing === tcg;
          const cardCount = entry?.cardCount ?? installed?.cardCount;
          const bytes =
            entry?.compressedBytes ?? entry?.bytes ?? installed?.bytes;

          return (
            <div key={tcg} className="rounded-lg border bg-background p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <CardImage
                  src={getCardBackImage(tcg)}
                  tcg={tcg}
                  alt={`${packageManifest.game.name} card back`}
                  width={42}
                  height={59}
                  className="h-[59px] w-[42px] shrink-0 rounded object-contain shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {packageManifest.game.name}
                    </p>
                    {isInstalled && (
                      <Badge
                        variant={isUpdate ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {isUpdate
                          ? `Update v${entry?.version}`
                          : `Installed v${installed?.version}`}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {packageManifest.publisher.name} official ·{" "}
                    {cardCount !== undefined
                      ? `${cardCount.toLocaleString()} cards`
                      : "Catalog not published"}
                    {bytes !== undefined ? ` · ${formatBytes(bytes)}` : ""}
                  </p>
                  {includeSealedProducts && sealedEntry && (
                    <p className="text-xs text-muted-foreground">
                      {sealedEntry.productCount.toLocaleString()} sealed
                      products
                      {` · ${formatBytes(sealedEntry.compressedBytes ?? sealedEntry.bytes)} download`}
                      {state.sealedStatus === "installed" ? " · installed" : ""}
                    </p>
                  )}
                  {download && (
                    <div className="mt-2 space-y-1">
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-label={`Downloading ${packageManifest.game.name} catalog`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={download.percent ?? undefined}
                      >
                        <div
                          className={`h-full bg-primary transition-all ${
                            download.percent === null
                              ? "w-1/3 animate-pulse"
                              : ""
                          }`}
                          style={
                            download.percent === null
                              ? undefined
                              : { width: `${download.percent}%` }
                          }
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {download.phase === "saving"
                          ? "Saving for offline use…"
                          : download.percent !== null
                            ? `${download.percent}% downloaded`
                            : `${formatBytes(download.loadedBytes)} downloaded`}
                      </p>
                    </div>
                  )}
                  {errors[tcg] && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors[tcg]}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {isInstalled &&
                    state.status === "installed" &&
                    !needsSealedInstall &&
                    !isGameEnabled && (
                      <Button
                        size="sm"
                        disabled={Boolean(download) || isRemoving}
                        onClick={() => void activateGame(tcg)}
                      >
                        Use Game
                      </Button>
                    )}
                  {(state.status !== "installed" || needsSealedInstall) && (
                    <Button
                      size="sm"
                      variant={isUpdate ? "default" : "outline"}
                      disabled={Boolean(download) || !entry || isRemoving}
                      onClick={() =>
                        void handleInstall(
                          tcg,
                          isUpdate || state.sealedStatus === "update-available",
                        )
                      }
                    >
                      {download ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : isUpdate ? (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      {download
                        ? "Working…"
                        : state.status === "installed" && needsSealedInstall
                          ? state.sealedStatus === "update-available"
                            ? "Update Products"
                            : "Add Products"
                          : actionLabel(state.status)}
                    </Button>
                  )}
                  {isInstalled && isGameEnabled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(download) || isRemoving}
                      onClick={() => void handleRemove(tcg)}
                    >
                      {isRemoving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!isLoading && !officialPackages.length && (
          <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
            {storeError ??
              "No official packages are published in this catalog manifest."}
          </p>
        )}
      </div>
    </section>
  );
}
