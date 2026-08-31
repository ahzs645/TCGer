"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  gameDefinitionSupportsFeature,
  gamePackageDefinition,
  gamePackageId,
  type GameDefinition,
  type GamePackageManifest,
} from "@tcg/api-types";

import {
  fetchCatalogManifest,
  fetchOfficialGamePackages,
} from "@/lib/catalog/catalog-client";

import {
  GAME_PACKAGES_CHANGED_EVENT,
  listInstalledGamePackages,
  type InstalledGamePackage,
} from "@/lib/game-packages/game-package-client";
import { type ManageableGame, useModuleStore } from "@/stores/preferences";

export interface ActiveGameFeatureSource {
  id: string;
  gameId: string;
  definition: GameDefinition;
  package?: InstalledGamePackage;
  kind: "built-in" | "installed";
}

export function activeGameFeatureSources(
  enabledGames: Readonly<Record<ManageableGame, boolean>>,
  officialManifests: readonly GamePackageManifest[],
  installedPackages: readonly InstalledGamePackage[],
  featureId: string,
): ActiveGameFeatureSource[] {
  const builtIn = officialManifests.flatMap((manifest) => {
    const gameId = manifest.game.id as ManageableGame;
    const definition = gamePackageDefinition(manifest);
    return enabledGames[gameId] &&
      gameDefinitionSupportsFeature(definition, featureId)
      ? [
          {
            id: gamePackageId(manifest),
            gameId,
            definition,
            kind: "built-in" as const,
          },
        ]
      : [];
  });
  const installed = installedPackages.flatMap((gamePackage) => {
    const definition = gamePackageDefinition(gamePackage.manifest);
    return gameDefinitionSupportsFeature(definition, featureId)
      ? [
          {
            id: gamePackage.id,
            gameId: gamePackage.manifest.game.id,
            definition,
            package: gamePackage,
            kind: "installed" as const,
          },
        ]
      : [];
  });
  return [...builtIn, ...installed];
}

export function useActiveGameFeatures() {
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const [installedPackages, setInstalledPackages] = useState<
    InstalledGamePackage[] | null
  >(null);
  const [officialManifests, setOfficialManifests] = useState<
    GamePackageManifest[] | null
  >(null);

  const refreshPackages = useCallback(() => {
    void listInstalledGamePackages()
      .then(setInstalledPackages)
      .catch(() => setInstalledPackages([]));
  }, []);

  useEffect(() => {
    refreshPackages();
    window.addEventListener(GAME_PACKAGES_CHANGED_EVENT, refreshPackages);
    return () =>
      window.removeEventListener(GAME_PACKAGES_CHANGED_EVENT, refreshPackages);
  }, [refreshPackages]);

  useEffect(() => {
    let active = true;
    void fetchCatalogManifest()
      .then(fetchOfficialGamePackages)
      .then((packages) => {
        if (active) setOfficialManifests(packages.map((item) => item.manifest));
      })
      .catch(() => {
        if (active) setOfficialManifests([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return useMemo(
    () => ({
      isLoading: installedPackages === null || officialManifests === null,
      installedPackages: installedPackages ?? [],
      sourcesFor(featureId: string) {
        return activeGameFeatureSources(
          enabledGames,
          officialManifests ?? [],
          installedPackages ?? [],
          featureId,
        );
      },
    }),
    [enabledGames, installedPackages, officialManifests],
  );
}
