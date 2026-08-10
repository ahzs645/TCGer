"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Card as CardType, CollectionGuideResponse } from "@tcg/api-types";
import {
  Check,
  ChevronLeft,
  Heart,
  Loader2,
  Palette,
  Search,
  Sparkles,
} from "lucide-react";

import { CardImage } from "@/components/cards/card-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getCollectionGuides, followCollectionGuide } from "@/lib/api/guides";
import { expandWishlistRule } from "@/lib/wishlists/sync";
import { useAuthStore } from "@/stores/auth";
import { useWishlistsStore } from "@/stores/wishlists";

type OwnershipFilter = "all" | "owned" | "missing";

export function CollectionGuidesContent() {
  const { token, isAuthenticated } = useAuthStore();
  const { wishlists, fetchWishlists, hasFetched, syncWishlist } =
    useWishlistsStore();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [guideSearch, setGuideSearch] = useState("");
  const [cardSearch, setCardSearch] = useState("");
  const [setFilter, setSetFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] =
    useState<OwnershipFilter>("all");
  const [followStatus, setFollowStatus] = useState<string | null>(null);
  const [isFollowing, setFollowing] = useState(false);

  const guidesQuery = useQuery({
    queryKey: ["collection-guides"],
    queryFn: () => getCollectionGuides(token!),
    enabled: Boolean(token && isAuthenticated),
  });

  useEffect(() => {
    if (token && isAuthenticated && !hasFetched) {
      void fetchWishlists(token);
    }
  }, [fetchWishlists, hasFetched, isAuthenticated, token]);

  useEffect(() => {
    if (!selectedSlug && guidesQuery.data?.length) {
      setSelectedSlug(guidesQuery.data[0]!.slug);
    }
  }, [guidesQuery.data, selectedSlug]);

  const guides = useMemo(() => {
    const query = guideSearch.trim().toLocaleLowerCase();
    if (!query) return guidesQuery.data ?? [];
    return (guidesQuery.data ?? []).filter((guide) =>
      [guide.title, guide.description, guide.curatorName, ...guide.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [guideSearch, guidesQuery.data]);

  const selectedGuide =
    guidesQuery.data?.find((guide) => guide.slug === selectedSlug) ?? null;

  const cardsQuery = useQuery({
    queryKey: ["collection-guide-cards", selectedGuide?.slug, selectedGuide?.version],
    queryFn: () => expandWishlistRule(token!, selectedGuide!.rule),
    enabled: Boolean(token && selectedGuide),
    staleTime: 10 * 60_000,
  });

  const followedWishlist = selectedGuide?.wishlistId
    ? wishlists.find((wishlist) => wishlist.id === selectedGuide.wishlistId)
    : undefined;
  const wishlistCards = useMemo(
    () =>
      new Map(
        (followedWishlist?.cards ?? []).map((card) => [
          `${card.tcg}:${card.externalId}`,
          card,
        ]),
      ),
    [followedWishlist?.cards],
  );

  const setCodes = useMemo(
    () =>
      [...new Set((cardsQuery.data ?? []).map((card) => card.setCode).filter(Boolean))]
        .sort() as string[],
    [cardsQuery.data],
  );

  const filteredCards = useMemo(() => {
    const query = cardSearch.trim().toLocaleLowerCase();
    return (cardsQuery.data ?? []).filter((card) => {
      if (
        query &&
        ![card.name, card.setName, card.setCode, card.collectorNumber]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      ) {
        return false;
      }
      if (setFilter !== "all" && card.setCode !== setFilter) return false;
      if (ownershipFilter !== "all" && followedWishlist) {
        const owned =
          wishlistCards.get(`${card.tcg}:${card.id}`)?.owned === true;
        if (ownershipFilter === "owned" && !owned) return false;
        if (ownershipFilter === "missing" && owned) return false;
      }
      return true;
    });
  }, [cardSearch, cardsQuery.data, followedWishlist, ownershipFilter, setFilter, wishlistCards]);

  async function handleFollow() {
    if (!token || !selectedGuide) return;
    setFollowing(true);
    setFollowStatus("Creating your guide wishlist…");
    try {
      const followed = await followCollectionGuide(token, selectedGuide.slug);
      await fetchWishlists(token);
      setFollowStatus("Finding every matching card…");
      const result = await syncWishlist(token, followed.wishlistId, {
        onProgress: setFollowStatus,
      });
      await fetchWishlists(token);
      await guidesQuery.refetch();
      setFollowStatus(
        result.errors.length
          ? `Guide followed; ${result.errors.length} sync step failed.`
          : `Guide followed with ${result.addedCards} cards added to your wishlist.`,
      );
    } catch (error) {
      setFollowStatus(
        error instanceof Error ? error.message : "Failed to follow guide.",
      );
    } finally {
      setFollowing(false);
    }
  }

  if (!isAuthenticated || !token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to explore collection guides</CardTitle>
          <CardDescription>
            Guides compare against your collection and create synchronized wishlists.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (guidesQuery.isLoading) {
    return <GuideSkeleton />;
  }

  if (guidesQuery.isError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Couldn&apos;t load collection guides</CardTitle>
          <CardDescription>
            {guidesQuery.error instanceof Error
              ? guidesQuery.error.message
              : "The guide service is unavailable."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => guidesQuery.refetch()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={selectedGuide ? "hidden lg:block" : "block"}>
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={guideSearch}
            onChange={(event) => setGuideSearch(event.target.value)}
            placeholder="Search themes, artists, Pokémon…"
          />
        </div>
        <div className="space-y-3">
          {guides.map((guide) => (
            <GuideListCard
              key={guide.id}
              guide={guide}
              selected={guide.slug === selectedSlug}
              onSelect={() => {
                setSelectedSlug(guide.slug);
                setFollowStatus(null);
                setCardSearch("");
                setSetFilter("all");
                setOwnershipFilter("all");
              }}
            />
          ))}
        </div>
      </aside>

      {selectedGuide ? (
        <section className="min-w-0 space-y-5">
          <Button
            variant="ghost"
            className="lg:hidden"
            onClick={() => setSelectedSlug(null)}
          >
            <ChevronLeft className="mr-2 h-4 w-4" /> All guides
          </Button>

          <GuideHero
            guide={selectedGuide}
            cardCount={cardsQuery.data?.length}
            wishlist={followedWishlist}
            isFollowing={isFollowing}
            onFollow={handleFollow}
          />

          {followStatus && (
            <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
              {followStatus}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_160px]">
            <Input
              value={cardSearch}
              onChange={(event) => setCardSearch(event.target.value)}
              placeholder="Filter cards…"
            />
            <Select value={setFilter} onValueChange={setSetFilter}>
              <SelectTrigger><SelectValue placeholder="All sets" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sets</SelectItem>
                {setCodes.map((code) => (
                  <SelectItem key={code} value={code}>{code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={ownershipFilter}
              onValueChange={(value) => setOwnershipFilter(value as OwnershipFilter)}
              disabled={!followedWishlist}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cards</SelectItem>
                <SelectItem value="owned">Owned</SelectItem>
                <SelectItem value="missing">Missing</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {cardsQuery.isLoading ? (
            <CardGridSkeleton />
          ) : cardsQuery.isError ? (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle>Couldn&apos;t resolve this guide</CardTitle>
                <CardDescription>
                  {cardsQuery.error instanceof Error
                    ? cardsQuery.error.message
                    : "Card search failed."}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {filteredCards.map((card) => (
                <GuideCard
                  key={`${card.tcg}:${card.id}`}
                  card={card}
                  owned={wishlistCards.get(`${card.tcg}:${card.id}`)?.owned === true}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="hidden items-center justify-center rounded-xl border border-dashed p-12 text-muted-foreground lg:flex">
          Select a guide to see its cards.
        </div>
      )}
    </div>
  );
}

function GuideListCard({
  guide,
  selected,
  onSelect,
}: {
  guide: CollectionGuideResponse;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected ? "border-primary bg-primary/10" : "bg-card hover:border-primary/50"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <Palette className="h-5 w-5 text-primary" />
        {guide.followed && <Badge variant="secondary">Following</Badge>}
      </div>
      <div className="font-heading font-semibold">{guide.title}</div>
      <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
        {guide.description}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {guide.cardCountHint ? `About ${guide.cardCountHint} cards` : guide.category}
      </div>
    </button>
  );
}

function GuideHero({
  guide,
  cardCount,
  wishlist,
  isFollowing,
  onFollow,
}: {
  guide: CollectionGuideResponse;
  cardCount?: number;
  wishlist?: { completionPercent: number; ownedCards: number; totalCards: number };
  isFollowing: boolean;
  onFollow: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid md:grid-cols-[220px_1fr]">
        <div className="relative min-h-56 bg-gradient-to-br from-orange-200 to-amber-50 dark:from-orange-950 dark:to-amber-950">
          <CardImage
            src={guide.coverImageUrl}
            alt={guide.title}
            tcg={guide.tcg}
            fill
            sizes="220px"
            className="object-contain p-5"
          />
        </div>
        <div className="p-6">
          <div className="mb-3 flex flex-wrap gap-2">
            {guide.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
          <h2 className="text-3xl font-heading font-semibold">{guide.title}</h2>
          <p className="mt-3 max-w-3xl text-muted-foreground">{guide.description}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <span>{cardCount ?? guide.cardCountHint ?? "—"} matching cards</span>
            <span className="text-muted-foreground">Curated by {guide.curatorName}</span>
          </div>
          {wishlist ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Badge className="gap-1"><Check className="h-3.5 w-3.5" /> Following</Badge>
              <span className="text-sm">
                {wishlist.ownedCards}/{wishlist.totalCards} owned · {wishlist.completionPercent}%
              </span>
              <Button asChild variant="outline" size="sm">
                <Link href="/wishlists"><Heart className="mr-2 h-4 w-4" /> Open wishlist</Link>
              </Button>
            </div>
          ) : (
            <Button className="mt-6" onClick={onFollow} disabled={isFollowing}>
              {isFollowing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Follow and add missing cards
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function GuideCard({ card, owned }: { card: CardType; owned: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[2.5/3.5] bg-muted">
        <CardImage
          src={card.imageUrlSmall ?? card.imageUrl}
          fallbackSrc={card.imageUrl}
          alt={card.name}
          tcg={card.tcg}
          fill
          sizes="(max-width: 640px) 50vw, 220px"
          className="object-contain"
        />
        {owned && (
          <Badge className="absolute right-2 top-2 gap-1">
            <Check className="h-3 w-3" /> Owned
          </Badge>
        )}
      </div>
      <CardContent className="p-3">
        <div className="truncate text-sm font-medium" title={card.name}>{card.name}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {[card.setCode, card.collectorNumber].filter(Boolean).join(" · ") || card.artist}
        </div>
      </CardContent>
    </Card>
  );
}

function GuideSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3">{[0, 1, 2].map((id) => <Skeleton key={id} className="h-32" />)}</div>
      <Skeleton className="h-[520px]" />
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} className="aspect-[2.5/3.8]" />
      ))}
    </div>
  );
}
