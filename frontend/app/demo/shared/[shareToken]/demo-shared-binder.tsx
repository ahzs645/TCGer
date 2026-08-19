"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Layers3, LockKeyhole } from "lucide-react";

import { CardImage } from "@/components/cards/card-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GameBadge } from "@/components/cards/game-badge";
import {
  useDemoStore,
  whenDemoStoreHydrated,
  type DemoBinder,
} from "@/stores/demo-store";

type SharedBinderResolution =
  | { status: "public"; binder: DemoBinder }
  | { status: "private" }
  | { status: "not-found" };

export function resolveSharedDemoBinder(
  binders: DemoBinder[],
  shareToken: string,
): SharedBinderResolution {
  const binder = binders.find(
    (candidate) => candidate.shareToken === shareToken,
  );
  if (!binder) return { status: "not-found" };
  if (!binder.isPublic) return { status: "private" };
  return { status: "public", binder };
}

export function DemoSharedBinder({ shareToken }: { shareToken: string }) {
  const binders = useDemoStore((state) => state.binders);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    void whenDemoStoreHydrated().then(() => {
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const resolution = useMemo(
    () => resolveSharedDemoBinder(binders, shareToken),
    [binders, shareToken],
  );

  if (!hydrated) {
    return (
      <SharedPageFrame>
        <Card aria-live="polite">
          <CardContent className="py-16 text-center text-muted-foreground">
            Loading shared binder…
          </CardContent>
        </Card>
      </SharedPageFrame>
    );
  }

  if (resolution.status !== "public") {
    const isPrivate = resolution.status === "private";
    return (
      <SharedPageFrame>
        <Card className="mx-auto max-w-xl">
          <CardHeader className="items-center text-center">
            <LockKeyhole className="mb-2 h-10 w-10 text-muted-foreground" />
            <CardTitle>
              {isPrivate ? "This binder is private" : "Shared binder not found"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center text-muted-foreground">
            <p>
              {isPrivate
                ? "Its owner has turned off public sharing."
                : "This demo share link is invalid or has been replaced."}
            </p>
            <Link
              className="text-primary underline-offset-4 hover:underline"
              href="/demo"
            >
              Return to the demo
            </Link>
          </CardContent>
        </Card>
      </SharedPageFrame>
    );
  }

  const { binder } = resolution;
  const cardCount = binder.cards.reduce(
    (total, card) => total + card.quantity,
    0,
  );

  return (
    <SharedPageFrame>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Shared demo binder</Badge>
          <Badge variant="outline" className="gap-1">
            <Eye className="h-3.5 w-3.5" /> Read only
          </Badge>
        </div>
        <h1 className="font-heading text-4xl font-semibold">{binder.name}</h1>
        {binder.description && (
          <p className="max-w-2xl text-muted-foreground">
            {binder.description}
          </p>
        )}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers3 className="h-4 w-4" />
          {cardCount} {cardCount === 1 ? "card" : "cards"} across{" "}
          {binder.cards.length}{" "}
          {binder.cards.length === 1 ? "printing" : "printings"}
        </p>
      </header>

      {binder.cards.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            This shared binder is empty.
          </CardContent>
        </Card>
      ) : (
        <section
          aria-label="Shared binder cards"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {binder.cards.map((card) => {
            const imageUrl =
              card.cardData?.imageUrlSmall ?? card.cardData?.imageUrl;
            return (
              <Card key={card.id} className="overflow-hidden">
                <div className="relative aspect-[2.5/3.5] bg-muted">
                  <CardImage
                    src={imageUrl}
                    fallbackSrc={card.cardData?.imageUrl}
                    alt={card.name}
                    tcg={card.tcg}
                    fill
                    loading="eager"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                    className="object-contain p-3"
                  />
                </div>
                <CardHeader className="space-y-2">
                  <CardTitle className="text-base">{card.name}</CardTitle>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <GameBadge game={card.tcg} />
                    <span>{card.setName}</span>
                    {card.rarity && <span>{card.rarity}</span>}
                    {card.condition && <span>{card.condition}</span>}
                    <span>×{card.quantity}</span>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </section>
      )}
    </SharedPageFrame>
  );
}

function SharedPageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">{children}</div>
    </main>
  );
}
