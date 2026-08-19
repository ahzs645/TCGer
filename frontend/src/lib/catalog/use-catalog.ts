"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TcgCode } from "@tcg/api-types";

import {
  type CatalogDownloadProgress,
  type CatalogManifest,
  type CatalogManifestGame,
  type InstalledSealedCatalog,
  downloadCatalog,
  downloadSealedCatalog,
  fetchCatalogManifest,
  getInstalledSealedCatalogs,
  removeCatalog,
  removeAllSealedCatalogs,
  removeSealedCatalog,
} from "./catalog-client";
import { getInstalledCatalogs, type InstalledCatalogPack } from "./catalog-db";
import { isDemoMode } from "@/lib/demo-mode";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { useDemoStore } from "@/stores/demo-store";
import {
  CATALOG_GAMES,
  isCatalogGame,
  type CatalogTcgCode,
} from "./catalog-types";

export { CATALOG_GAMES, isCatalogGame };
export type { CatalogTcgCode };

export const CATALOG_CHANGED_EVENT = "tcger:catalog-changed";
export const CATALOG_PROMPT_EVENT = "tcger:catalog-prompt";

export type CatalogInstallStatus =
  | "not-installed"
  | "installed"
  | "update-available"
  | "unavailable";

export interface CatalogGameState {
  status: CatalogInstallStatus;
  installed?: InstalledCatalogPack;
  manifest?: CatalogManifestGame;
  sealedStatus: CatalogInstallStatus;
  sealedInstalled?: InstalledSealedCatalog;
}

type CatalogGameStates = Record<CatalogTcgCode, CatalogGameState>;
type CatalogProgressState = Partial<
  Record<CatalogTcgCode, CatalogDownloadProgress>
>;
type CatalogErrorState = Partial<Record<CatalogTcgCode, string>>;

const EMPTY_STATES: CatalogGameStates = {
  pokemon: { status: "unavailable", sealedStatus: "unavailable" },
  magic: { status: "unavailable", sealedStatus: "unavailable" },
  yugioh: { status: "unavailable", sealedStatus: "unavailable" },
  onepiece: { status: "unavailable", sealedStatus: "unavailable" },
  lorcana: { status: "unavailable", sealedStatus: "unavailable" },
  dragonball: { status: "unavailable", sealedStatus: "unavailable" },
};

function buildStates(
  manifest: CatalogManifest | null,
  installedPacks: InstalledCatalogPack[],
  installedSealedPacks: InstalledSealedCatalog[],
): CatalogGameStates {
  const installedByGame = new Map(
    installedPacks.map((pack) => [pack.tcg, pack] as const),
  );
  const installedSealedByGame = new Map(
    installedSealedPacks.map((pack) => [pack.tcg, pack] as const),
  );
  const states = { ...EMPTY_STATES };

  for (const tcg of CATALOG_GAMES) {
    const installed = installedByGame.get(tcg);
    const manifestEntry = manifest?.games[tcg];
    const sealedInstalled = installedSealedByGame.get(tcg);
    const sealedManifest = manifestEntry?.sealedProducts;
    const status: CatalogInstallStatus = installed
      ? manifestEntry && manifestEntry.version > installed.version
        ? "update-available"
        : "installed"
      : manifestEntry
        ? "not-installed"
        : "unavailable";
    states[tcg] = {
      status,
      installed,
      manifest: manifestEntry,
      sealedStatus: sealedInstalled
        ? sealedManifest && sealedManifest.version > sealedInstalled.version
          ? "update-available"
          : "installed"
        : sealedManifest
          ? "not-installed"
          : "unavailable",
      sealedInstalled,
    };
  }

  return states;
}

function dispatchCatalogChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
  }
}

function isDemoExperience(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isDemoMode() ||
    window.location.pathname === "/demo" ||
    window.location.pathname.startsWith("/demo/")
  );
}

async function enrichVisibleDemoCollections(
  tcg: CatalogTcgCode,
): Promise<void> {
  if (!isDemoExperience()) return;
  await useDemoStore.getState().enrichCardsFromCatalog(tcg);

  const token = useAuthStore.getState().token;
  const collections = useCollectionsStore.getState();
  if (token && collections.hasFetched) {
    await collections.fetchCollections(token);
  }
}

export function requestCatalogPrompt(tcg: TcgCode): void {
  if (typeof window === "undefined" || !isCatalogGame(tcg)) return;
  window.dispatchEvent(
    new CustomEvent<TcgCode>(CATALOG_PROMPT_EVENT, { detail: tcg }),
  );
}

export function useCatalog() {
  const [states, setStates] = useState<CatalogGameStates>(EMPTY_STATES);
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  const [progress, setProgress] = useState<CatalogProgressState>({});
  const [errors, setErrors] = useState<CatalogErrorState>({});
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const [installedResult, sealedResult, manifestResult] =
      await Promise.allSettled([
        getInstalledCatalogs(),
        getInstalledSealedCatalogs(),
        fetchCatalogManifest(),
      ]);
    const installedPacks =
      installedResult.status === "fulfilled" ? installedResult.value : [];
    const installedSealedPacks =
      sealedResult.status === "fulfilled" ? sealedResult.value : [];
    const nextManifest =
      manifestResult.status === "fulfilled" ? manifestResult.value : null;
    setManifest(nextManifest);
    setStates(buildStates(nextManifest, installedPacks, installedSealedPacks));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener(CATALOG_CHANGED_EVENT, handleChange);
    return () =>
      window.removeEventListener(CATALOG_CHANGED_EVENT, handleChange);
  }, [refresh]);

  const install = useCallback(
    async (tcg: CatalogTcgCode, includeSealedProducts = false) => {
      setErrors((current) => ({ ...current, [tcg]: undefined }));
      setProgress((current) => ({
        ...current,
        [tcg]: {
          phase: "downloading",
          loadedBytes: 0,
          totalBytes:
            (states[tcg].manifest?.bytes ?? 0) +
              (includeSealedProducts
                ? (states[tcg].manifest?.sealedProducts?.bytes ?? 0)
                : 0) || null,
          percent: 0,
        },
      }));
      try {
        if (states[tcg].status !== "installed") {
          await downloadCatalog(tcg, (value) => {
            setProgress((current) => ({ ...current, [tcg]: value }));
          });
          await enrichVisibleDemoCollections(tcg);
        }
        if (
          includeSealedProducts &&
          states[tcg].sealedStatus !== "installed" &&
          states[tcg].manifest?.sealedProducts
        ) {
          await downloadSealedCatalog(tcg, (value) => {
            setProgress((current) => ({ ...current, [tcg]: value }));
          });
        }
        setProgress((current) => ({ ...current, [tcg]: undefined }));
        await refresh();
        dispatchCatalogChanged();
      } catch (error) {
        setProgress((current) => ({ ...current, [tcg]: undefined }));
        setErrors((current) => ({
          ...current,
          [tcg]:
            error instanceof Error
              ? error.message
              : `Unable to download the ${tcg} catalog.`,
        }));
        throw error;
      }
    },
    [refresh, states],
  );

  const remove = useCallback(
    async (tcg: CatalogTcgCode) => {
      setErrors((current) => ({ ...current, [tcg]: undefined }));
      try {
        await removeCatalog(tcg);
        await removeSealedCatalog(tcg);
        await refresh();
        dispatchCatalogChanged();
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [tcg]:
            error instanceof Error
              ? error.message
              : `Unable to remove the ${tcg} catalog.`,
        }));
        throw error;
      }
    },
    [refresh],
  );

  const isBusy = useMemo(
    () => CATALOG_GAMES.some((tcg) => Boolean(progress[tcg])),
    [progress],
  );

  const removeSealed = useCallback(async () => {
    await removeAllSealedCatalogs();
    await refresh();
    dispatchCatalogChanged();
  }, [refresh]);

  return {
    states,
    manifest,
    progress,
    errors,
    isLoading,
    isBusy,
    refresh,
    install,
    update: install,
    remove,
    removeSealed,
  };
}
