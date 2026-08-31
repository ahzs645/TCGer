"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, PackagePlus, Store } from "lucide-react";

import { GameStorePanel } from "@/components/account/catalog-management-panel";
import { InstallGamePackagePanel } from "@/components/account/community-game-libraries-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  GAME_PACKAGES_CHANGED_EVENT,
  listInstalledGamePackages,
} from "@/lib/game-packages/game-package-client";
import {
  hasEnabledGame,
  needsGameInstallation,
} from "@/lib/game-packages/game-installation-state";
import { useModuleStore } from "@/stores/preferences";

type InstallerPage = "choose" | "store" | "url";

export function GameLibraryInstaller({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const [page, setPage] = useState<InstallerPage>("choose");

  return (
    <Card className="mx-auto max-w-3xl" data-testid="game-library-installer">
      <CardHeader>
        {page !== "choose" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-2 w-fit"
            onClick={() => setPage("choose")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Choose another method
          </Button>
        ) : null}
        <CardTitle>
          {page === "choose"
            ? title
            : page === "store"
              ? "Game Store"
              : "Install from URL"}
        </CardTitle>
        <CardDescription>
          {page === "choose"
            ? description
            : "Once a compatible package is active, TCGer will open the feature automatically."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {page === "choose" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-lg border bg-background p-5 text-left transition-colors hover:bg-muted/40"
              onClick={() => setPage("store")}
            >
              <Store className="mb-3 h-6 w-6 text-primary" />
              <span className="block font-medium">Browse Game Store</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Install an official package published by TCGer.
              </span>
            </button>
            <button
              type="button"
              className="rounded-lg border bg-background p-5 text-left transition-colors hover:bg-muted/40"
              onClick={() => setPage("url")}
            >
              <PackagePlus className="mb-3 h-6 w-6 text-primary" />
              <span className="block font-medium">Install from URL</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Connect a compatible package from another publisher.
              </span>
            </button>
          </div>
        ) : page === "store" ? (
          <GameStorePanel />
        ) : (
          <InstallGamePackagePanel />
        )}
      </CardContent>
    </Card>
  );
}

export function GameInstallationGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const [installedPackageCount, setInstalledPackageCount] = useState<
    number | null
  >(null);

  const refreshPackages = useCallback(() => {
    void listInstalledGamePackages()
      .then((packages) => setInstalledPackageCount(packages.length))
      .catch(() => setInstalledPackageCount(0));
  }, []);

  useEffect(() => {
    refreshPackages();
    window.addEventListener(GAME_PACKAGES_CHANGED_EVENT, refreshPackages);
    return () =>
      window.removeEventListener(GAME_PACKAGES_CHANGED_EVENT, refreshPackages);
  }, [refreshPackages]);

  if (!hasEnabledGame(enabledGames) && installedPackageCount === null) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking installed games…
        </CardContent>
      </Card>
    );
  }

  if (!needsGameInstallation(enabledGames, installedPackageCount ?? 0)) {
    return children;
  }

  return (
    <div data-testid="game-installation-gate">
      <GameLibraryInstaller
        title="Install a game to get started"
        description="TCGer has no active game libraries. Download an official package or connect one from another publisher."
      />
    </div>
  );
}
