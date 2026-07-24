"use client";

import { useState } from "react";
import { Download, HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { CardImage } from "@/components/cards/card-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GAME_LABELS, getCardBackImage } from "@/lib/utils";
import {
  CATALOG_GAMES,
  type CatalogTcgCode,
  type CatalogInstallStatus,
  useCatalog,
} from "@/lib/catalog/use-catalog";

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

export function CatalogManagementPanel() {
  const { states, progress, errors, isLoading, install, update, remove } =
    useCatalog();
  const [removing, setRemoving] = useState<CatalogTcgCode | null>(null);

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

  const handleInstall = async (tcg: CatalogTcgCode, isUpdate: boolean) => {
    try {
      await (isUpdate ? update(tcg) : install(tcg));
    } catch {
      // The hook exposes the user-facing error in the matching row.
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="h-4 w-4" />
            Card Catalogs
          </h3>
          <p className="text-sm text-muted-foreground">
            Download searchable card data for offline demo and PWA use.
          </p>
        </div>
        {isLoading && (
          <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="grid gap-3">
        {CATALOG_GAMES.map((tcg) => {
          const state = states[tcg];
          const download = progress[tcg];
          const entry = state.manifest;
          const installed = state.installed;
          const isUpdate = state.status === "update-available";
          const isInstalled = Boolean(installed);
          const isRemoving = removing === tcg;
          const cardCount = entry?.cardCount ?? installed?.cardCount;
          const bytes = entry?.bytes ?? installed?.bytes;

          return (
            <div key={tcg} className="rounded-lg border bg-background p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <CardImage
                  src={getCardBackImage(tcg)}
                  tcg={tcg}
                  alt={`${GAME_LABELS[tcg]} card back`}
                  width={42}
                  height={59}
                  className="h-[59px] w-[42px] shrink-0 rounded object-contain shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{GAME_LABELS[tcg]}</p>
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
                    {cardCount !== undefined
                      ? `${cardCount.toLocaleString()} cards`
                      : "Catalog not published"}
                    {bytes !== undefined ? ` · ${formatBytes(bytes)}` : ""}
                  </p>
                  {download && (
                    <div className="mt-2 space-y-1">
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-label={`Downloading ${GAME_LABELS[tcg]} catalog`}
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
                  {state.status !== "installed" && (
                    <Button
                      size="sm"
                      variant={isUpdate ? "default" : "outline"}
                      disabled={Boolean(download) || !entry || isRemoving}
                      onClick={() => void handleInstall(tcg, isUpdate)}
                    >
                      {download ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : isUpdate ? (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      {download ? "Working…" : actionLabel(state.status)}
                    </Button>
                  )}
                  {isInstalled && (
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
      </div>
    </section>
  );
}
