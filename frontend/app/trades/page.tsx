"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Repeat2,
  ArrowRight,
  Check,
  Clock,
  X,
  Plus,
  Sparkles,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  acceptTrade,
  createTrade,
  declineTrade,
  deleteTrade,
  getTradeMatches,
  getTrades,
  type TradeMatchResponse,
  type TradeResponse,
} from "@/lib/api/trading";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

type StatusKey = "pending" | "accepted" | "declined";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof Check; color: string; bg: string }
> = {
  accepted: {
    label: "Accepted",
    icon: Check,
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
  },
  declined: {
    label: "Declined",
    icon: X,
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
};

function tcgLabel(tcg: string): string {
  return GAME_LABELS[tcg as SupportedGame] ?? tcg;
}

export default function TradesPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tab, setTab] = useState("all");
  const [matchesOpen, setMatchesOpen] = useState(false);

  const { token, user, isAuthenticated } = useAuthStore();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const tradesQuery = useQuery({
    queryKey: ["trades"],
    queryFn: () => getTrades(token!),
    enabled: mounted && isAuthenticated && !!token,
    staleTime: 1000 * 30,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["trades"] });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptTrade(token!, id),
    onSuccess: invalidate,
  });
  const declineMutation = useMutation({
    mutationFn: (id: string) => declineTrade(token!, id),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => deleteTrade(token!, id),
    onSuccess: invalidate,
  });

  const trades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);

  const filtered = useMemo(
    () => (tab === "all" ? trades : trades.filter((t) => t.status === tab)),
    [trades, tab],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, accepted: 0, declined: 0 };
    for (const t of trades) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [trades]);

  const acceptedTrades = trades.filter((t) => t.status === "accepted");
  const sideValue = (t: TradeResponse, side: string) =>
    t.cards
      .filter((c) => c.side === side)
      .reduce((s, c) => s + (c.estimatedValue ?? 0) * (c.quantity ?? 1), 0);
  const totalGiven = acceptedTrades.reduce(
    (s, t) =>
      s + sideValue(t, t.senderId === userId ? "sender" : "receiver"),
    0,
  );
  const totalReceived = acceptedTrades.reduce(
    (s, t) =>
      s + sideValue(t, t.senderId === userId ? "receiver" : "sender"),
    0,
  );

  const loading = mounted && isAuthenticated && tradesQuery.isLoading;

  const pendingMutationId =
    acceptMutation.variables ??
    declineMutation.variables ??
    cancelMutation.variables;
  const isMutating =
    acceptMutation.isPending ||
    declineMutation.isPending ||
    cancelMutation.isPending;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-heading font-semibold">Trades</h1>
            <p className="text-sm text-muted-foreground">
              Track card trades with other collectors.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setMatchesOpen(true)}
            disabled={!mounted || !isAuthenticated}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Trade
          </Button>
        </div>

        {mounted && !isAuthenticated ? (
          <Card>
            <CardHeader>
              <CardTitle>Sign in required</CardTitle>
              <CardDescription>
                Sign in to view and manage your trades.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : tradesQuery.error ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t load trades</CardTitle>
              <CardDescription>
                {(tradesQuery.error as Error).message}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void tradesQuery.refetch()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : loading ? (
          <TradesSkeleton />
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
              <StatCard title="Total Trades" value={String(trades.length)} />
              <StatCard
                title="Pending"
                value={String(counts.pending ?? 0)}
                accent="text-yellow-500"
              />
              <StatCard title="Value Sent" value={`$${totalGiven.toFixed(2)}`} />
              <StatCard
                title="Value Received"
                value={`$${totalReceived.toFixed(2)}`}
              />
            </div>

            {/* Filter tabs */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="all">All ({trades.length})</TabsTrigger>
                <TabsTrigger value="pending">
                  Pending ({counts.pending ?? 0})
                </TabsTrigger>
                <TabsTrigger value="accepted">
                  Accepted ({counts.accepted ?? 0})
                </TabsTrigger>
                <TabsTrigger value="declined">
                  Declined ({counts.declined ?? 0})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Trade list */}
            {filtered.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
                  <Repeat2 className="h-10 w-10 opacity-40" />
                  <p className="text-sm">
                    {trades.length === 0
                      ? "No trades yet. Start one from a suggested match."
                      : "No trades in this category."}
                  </p>
                  {trades.length === 0 && (
                    <Button size="sm" onClick={() => setMatchesOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      New Trade
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filtered.map((trade) => (
                  <TradeRow
                    key={trade.id}
                    trade={trade}
                    userId={userId}
                    onAccept={() => acceptMutation.mutate(trade.id)}
                    onDecline={() => declineMutation.mutate(trade.id)}
                    onCancel={() => {
                      if (window.confirm("Cancel this trade offer?"))
                        cancelMutation.mutate(trade.id);
                    }}
                    busy={isMutating && pendingMutationId === trade.id}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <MatchesDialog
        open={matchesOpen}
        onOpenChange={setMatchesOpen}
        token={token}
        onCreated={() => {
          invalidate();
          setMatchesOpen(false);
          setTab("pending");
        }}
      />
    </AppShell>
  );
}

function TradeRow({
  trade,
  userId,
  onAccept,
  onDecline,
  onCancel,
  busy,
}: {
  trade: TradeResponse;
  userId?: string;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const iAmSender = trade.senderId === userId;
  const giveSide = iAmSender ? "sender" : "receiver";
  const receiveSide = iAmSender ? "receiver" : "sender";
  const giving = trade.cards.filter((c) => c.side === giveSide);
  const receiving = trade.cards.filter((c) => c.side === receiveSide);
  const sum = (cards: typeof trade.cards) =>
    cards.reduce((s, c) => s + (c.estimatedValue ?? 0) * (c.quantity ?? 1), 0);
  const givingTotal = sum(giving);
  const receivingTotal = sum(receiving);
  const delta = receivingTotal - givingTotal;

  const cfg = STATUS_CONFIG[trade.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const canRespond = trade.status === "pending" && !iAmSender;
  const canCancel = trade.status === "pending" && iAmSender;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Repeat2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">
              {iAmSender ? "Outgoing trade" : "Incoming trade"}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`${cfg.color} ${cfg.bg}`}>
              <StatusIcon className="mr-1 h-3 w-3" />
              {cfg.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(trade.updatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        {trade.message && (
          <CardDescription className="mt-1">{trade.message}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
          <TradeSide label="You give" cards={giving} total={givingTotal} />
          <div className="hidden md:flex items-center justify-center">
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>
          <TradeSide
            label="You receive"
            cards={receiving}
            total={receivingTotal}
          />
        </div>

        {(givingTotal > 0 || receivingTotal > 0) && (
          <p className="mt-3 text-right text-xs">
            <span className="text-muted-foreground">Net: </span>
            <span
              className={
                delta > 0
                  ? "text-green-500"
                  : delta < 0
                    ? "text-red-500"
                    : "text-muted-foreground"
              }
            >
              {delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}
            </span>
          </p>
        )}

        {(canRespond || canCancel) && (
          <div className="mt-4 flex justify-end gap-2">
            {canRespond && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDecline}
                  disabled={busy}
                >
                  <X className="mr-1 h-4 w-4" />
                  Decline
                </Button>
                <Button size="sm" onClick={onAccept} disabled={busy}>
                  <Check className="mr-1 h-4 w-4" />
                  Accept
                </Button>
              </>
            )}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={busy}
                className="text-muted-foreground hover:text-destructive"
              >
                Cancel offer
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TradeSide({
  label,
  cards,
  total,
}: {
  label: string;
  cards: TradeResponse["cards"];
  total: number;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      {cards.length === 0 ? (
        <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">
          Nothing
        </p>
      ) : (
        cards.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded border p-2 text-sm"
          >
            <div>
              <span className="font-medium">{c.name}</span>
              {c.quantity > 1 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ×{c.quantity}
                </span>
              )}
              <span className="ml-2 text-xs text-muted-foreground">
                {tcgLabel(c.tcg)}
              </span>
            </div>
            {c.estimatedValue ? (
              <span className="text-muted-foreground">
                ${c.estimatedValue.toFixed(2)}
              </span>
            ) : null}
          </div>
        ))
      )}
      {total > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Total: ${total.toFixed(2)}
        </p>
      )}
    </div>
  );
}

function MatchesDialog({
  open,
  onOpenChange,
  token,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  onCreated: () => void;
}) {
  const matchesQuery = useQuery({
    queryKey: ["trade-matches"],
    queryFn: () => getTradeMatches(token!),
    enabled: open && !!token,
    staleTime: 1000 * 60,
  });

  const createMutation = useMutation({
    mutationFn: (match: TradeMatchResponse) =>
      createTrade(token!, {
        receiverId: match.userId,
        senderCards: match.youHave.map((c) => ({
          externalId: c.externalId,
          tcg: c.tcg,
          name: c.name,
          quantity: 1,
        })),
        receiverCards: match.theyHave.map((c) => ({
          externalId: c.externalId,
          tcg: c.tcg,
          name: c.name,
          quantity: 1,
        })),
      }),
    onSuccess: onCreated,
  });

  const matches = matchesQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Suggested trades
          </DialogTitle>
          <DialogDescription>
            Collectors who have cards you want and want cards you have. Propose a
            trade to send them an offer.
          </DialogDescription>
        </DialogHeader>

        {matchesQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : matchesQuery.error ? (
          <p className="py-6 text-center text-sm text-destructive">
            {(matchesQuery.error as Error).message}
          </p>
        ) : matches.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No suggested matches right now. Add wishlist cards and tradeable
            copies to find matches.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {matches.map((match) => (
              <div
                key={match.userId}
                className="rounded-lg border p-3 text-sm"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">
                    {match.username ?? "Collector"}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {Math.round(match.matchScore * 100) / 100} match
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="mb-1 font-medium text-muted-foreground">
                      You give
                    </p>
                    <ul className="space-y-0.5">
                      {match.youHave.slice(0, 4).map((c) => (
                        <li key={`${c.tcg}:${c.externalId}`} className="truncate">
                          {c.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-muted-foreground">
                      You receive
                    </p>
                    <ul className="space-y-0.5">
                      {match.theyHave.slice(0, 4).map((c) => (
                        <li key={`${c.tcg}:${c.externalId}`} className="truncate">
                          {c.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => createMutation.mutate(match)}
                    disabled={
                      createMutation.isPending || match.youHave.length === 0
                    }
                  >
                    Propose trade
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {createMutation.error ? (
          <p className="text-sm text-destructive">
            {(createMutation.error as Error).message}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  title,
  value,
  accent,
}: {
  title: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className={`text-xl md:text-3xl font-semibold ${accent ?? ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function TradesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx}>
            <CardHeader className="p-3 md:p-6">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-9 w-72" />
      {Array.from({ length: 2 }).map((_, idx) => (
        <Skeleton key={idx} className="h-40 w-full" />
      ))}
    </div>
  );
}
