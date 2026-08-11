"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { TcgCode } from "@tcg/api-types";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isDemoMode } from "@/lib/demo-mode";
import {
  CATALOG_CHANGED_EVENT,
  CATALOG_PROMPT_EVENT,
  isCatalogGame,
  useCatalog,
} from "@/lib/catalog/use-catalog";
import { catalogPromptDismissedKey as dismissalKey } from "@/lib/storage/keys";
import { GAME_LABELS } from "@/lib/utils";
import { useGameFilterStore } from "@/stores/game-filter";

function formatApproximateSize(bytes?: number): string {
  if (!bytes) return "";
  const megabytes = bytes / (1024 * 1024);
  return ` (~${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB)`;
}

function isDemoExperience(): boolean {
  return (
    isDemoMode() ||
    (typeof window !== "undefined" &&
      (window.location.pathname === "/demo" ||
        window.location.pathname.startsWith("/demo/")))
  );
}

export function CatalogDownloadPrompt() {
  const queryClient = useQueryClient();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { states, progress, errors, install } = useCatalog();
  const [requestedGame, setRequestedGame] = useState<TcgCode | null>(null);

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      if (!isDemoExperience() || !(event instanceof CustomEvent)) return;
      const game: unknown = event.detail;
      if (isCatalogGame(game)) {
        setRequestedGame(game);
      }
    };
    window.addEventListener(CATALOG_PROMPT_EVENT, handlePrompt);
    return () => window.removeEventListener(CATALOG_PROMPT_EVENT, handlePrompt);
  }, []);

  useEffect(() => {
    const handleCatalogChange = () => {
      void queryClient.invalidateQueries({ queryKey: ["cards"] });
      void queryClient.invalidateQueries({ queryKey: ["sets"] });
    };
    window.addEventListener(CATALOG_CHANGED_EVENT, handleCatalogChange);
    return () =>
      window.removeEventListener(CATALOG_CHANGED_EVENT, handleCatalogChange);
  }, [queryClient]);

  useEffect(() => {
    if (
      isDemoExperience() &&
      selectedGame !== "all" &&
      isCatalogGame(selectedGame) &&
      states[selectedGame].status === "not-installed"
    ) {
      setRequestedGame(selectedGame);
    }
  }, [selectedGame, states]);

  const state =
    requestedGame && isCatalogGame(requestedGame)
      ? states[requestedGame]
      : null;
  const dismissed = useMemo(() => {
    if (!requestedGame || !state?.manifest || typeof window === "undefined") {
      return true;
    }
    return (
      localStorage.getItem(
        dismissalKey(requestedGame, state.manifest.version),
      ) === "true"
    );
  }, [requestedGame, state?.manifest]);
  const open =
    Boolean(requestedGame) &&
    Boolean(state?.manifest) &&
    state?.status === "not-installed" &&
    !dismissed;
  const activeProgress =
    requestedGame && isCatalogGame(requestedGame)
      ? progress[requestedGame]
      : undefined;
  const error =
    requestedGame && isCatalogGame(requestedGame)
      ? errors[requestedGame]
      : undefined;

  const dismiss = () => {
    if (requestedGame && state?.manifest) {
      localStorage.setItem(
        dismissalKey(requestedGame, state.manifest.version),
        "true",
      );
    }
    setRequestedGame(null);
  };

  const handleDownload = async () => {
    if (!requestedGame || !isCatalogGame(requestedGame) || !state?.manifest) {
      return;
    }
    try {
      await install(requestedGame);
      localStorage.setItem(
        dismissalKey(requestedGame, state.manifest.version),
        "true",
      );
      setRequestedGame(null);
    } catch {
      // The hook keeps the error visible without dismissing the prompt.
    }
  };

  if (!open) return null;

  return (
    <aside
      className="fixed inset-x-4 bottom-16 z-[60] sm:left-auto sm:right-6 sm:w-[420px] md:bottom-6"
      aria-label="Offline catalog download"
      aria-live="polite"
    >
      <Card className="shadow-xl">
        <CardHeader className="relative pb-4 pr-14">
          <CardTitle className="text-lg">
            Download the {requestedGame ? GAME_LABELS[requestedGame] : ""}{" "}
            catalog{formatApproximateSize(state?.manifest?.bytes)}?
          </CardTitle>
          <CardDescription>
            Search and browse this game without a connection. The catalog stays
            on this device until you remove it.
          </CardDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 h-8 w-8"
            onClick={dismiss}
            disabled={Boolean(activeProgress)}
            aria-label="Dismiss catalog download"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeProgress && (
            <div className="space-y-2">
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Catalog download progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={activeProgress.percent ?? undefined}
              >
                <div
                  className={`h-full bg-primary transition-all ${
                    activeProgress.percent === null ? "w-1/3 animate-pulse" : ""
                  }`}
                  style={
                    activeProgress.percent === null
                      ? undefined
                      : { width: `${activeProgress.percent}%` }
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {activeProgress.phase === "saving"
                  ? "Saving catalog for offline use…"
                  : activeProgress.percent !== null
                    ? `${activeProgress.percent}% downloaded`
                    : "Downloading catalog…"}
              </p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={dismiss}
              disabled={Boolean(activeProgress)}
            >
              Not now
            </Button>
            <Button
              onClick={() => void handleDownload()}
              disabled={Boolean(activeProgress)}
            >
              {activeProgress ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {activeProgress ? "Downloading…" : "Download"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}
