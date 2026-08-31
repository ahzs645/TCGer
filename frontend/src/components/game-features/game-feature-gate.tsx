"use client";

import { Loader2 } from "lucide-react";

import { GameLibraryInstaller } from "@/components/account/game-installation-gate";
import { Card, CardContent } from "@/components/ui/card";

export function GameFeatureGate({
  children,
  featureLabel,
  isLoading,
  supported,
}: {
  children: React.ReactNode;
  featureLabel: string;
  isLoading: boolean;
  supported: boolean;
}) {
  if (supported) return children;
  if (isLoading) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking feature support…
        </CardContent>
      </Card>
    );
  }
  return (
    <GameLibraryInstaller
      title={`${featureLabel} isn’t available`}
      description={`Install or enable a game package that declares support for ${featureLabel}.`}
    />
  );
}
