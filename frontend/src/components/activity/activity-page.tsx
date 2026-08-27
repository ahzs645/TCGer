"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowLeftRight,
  Bell,
  Check,
  CheckCircle2,
  CircleUserRound,
  Inbox,
  LibraryBig,
  Loader2,
  Newspaper,
  RefreshCw,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { NotificationResponse } from "@tcg/api-types";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/notifications";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

const categoryPresentation: Record<
  string,
  { label: string; icon: LucideIcon; className: string }
> = {
  trade: {
    label: "Trade",
    icon: ArrowLeftRight,
    className: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  price: {
    label: "Price",
    icon: TrendingUp,
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  collection: {
    label: "Collection",
    icon: LibraryBig,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  news: {
    label: "News",
    icon: Newspaper,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  account: {
    label: "Account",
    icon: CircleUserRound,
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
};

const fallbackPresentation = {
  label: "Update",
  icon: Bell,
  className: "bg-primary/10 text-primary",
};

function presentationFor(type: string) {
  const normalized = type.toLocaleLowerCase();
  if (normalized.includes("trade")) return categoryPresentation.trade;
  if (normalized.includes("price") || normalized.includes("market")) {
    return categoryPresentation.price;
  }
  if (
    normalized.includes("collection") ||
    normalized.includes("import") ||
    normalized.includes("scan")
  ) {
    return categoryPresentation.collection;
  }
  if (normalized.includes("news") || normalized.includes("release")) {
    return categoryPresentation.news;
  }
  if (normalized.includes("account") || normalized.includes("security")) {
    return categoryPresentation.account;
  }
  return fallbackPresentation;
}

export function ActivityPage() {
  const token = useAuthStore((state) => state.token);
  const [notifications, setNotifications] = useState<NotificationResponse[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [pendingIDs, setPendingIDs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        setNotifications(await getNotifications(token));
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load activity.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const unread = useMemo(
    () => notifications.filter((notification) => !notification.read),
    [notifications],
  );
  const earlier = useMemo(
    () => notifications.filter((notification) => notification.read),
    [notifications],
  );

  const markRead = async (notification: NotificationResponse) => {
    if (notification.read || pendingIDs.has(notification.id)) return;
    setPendingIDs((current) => new Set(current).add(notification.id));
    setError(null);
    try {
      const updated = await markNotificationRead(token, notification.id);
      setNotifications((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not mark activity read.",
      );
    } finally {
      setPendingIDs((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    setError(null);
    try {
      await markAllNotificationsRead(token);
      setNotifications((current) =>
        current.map((item) => ({ ...item, read: true })),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not mark activity read.",
      );
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-heading font-semibold">Activity</h1>
              {unread.length > 0 ? (
                <Badge aria-label={`${unread.length} unread updates`}>
                  {unread.length} new
                </Badge>
              ) : null}
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Trade requests, price alerts, collection updates, and account news
              in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => void markAll()}
              disabled={unread.length === 0 || markingAll}
            >
              {markingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              Mark all read
            </Button>
          </div>
        </div>

        {error && notifications.length > 0 ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4"
            role="alert"
          >
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                Activity couldn&apos;t update
              </p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void load(true)}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {loading && notifications.length === 0 ? (
          <Card
            className="flex min-h-64 items-center justify-center gap-3 p-8 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Loading activity…
          </Card>
        ) : error && notifications.length === 0 ? (
          <Card className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertCircle
              className="h-10 w-10 text-destructive"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h2 className="font-heading text-lg font-semibold">
                Couldn&apos;t load activity
              </h2>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void load(true)}
            >
              Retry
            </Button>
          </Card>
        ) : notifications.length === 0 ? (
          <Card className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
            <Inbox
              className="h-10 w-10 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h2 className="font-heading text-lg font-semibold">
                No activity yet
              </h2>
              <p className="text-sm text-muted-foreground">
                New trade requests, price alerts, and account updates will
                appear here.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-8">
            {unread.length > 0 ? (
              <ActivitySection
                title="New"
                items={unread}
                pendingIDs={pendingIDs}
                onMarkRead={markRead}
              />
            ) : null}
            {earlier.length > 0 ? (
              <ActivitySection
                title="Earlier"
                items={earlier}
                pendingIDs={pendingIDs}
                onMarkRead={markRead}
              />
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ActivitySection({
  title,
  items,
  pendingIDs,
  onMarkRead,
}: {
  title: string;
  items: NotificationResponse[];
  pendingIDs: Set<string>;
  onMarkRead: (notification: NotificationResponse) => void;
}) {
  return (
    <section
      aria-labelledby={`activity-${title.toLocaleLowerCase()}`}
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={`activity-${title.toLocaleLowerCase()}`}
          className="font-heading text-xl font-semibold"
        >
          {title}
        </h2>
        <span className="text-sm text-muted-foreground">{items.length}</span>
      </div>
      <div className="space-y-3">
        {items.map((notification) => {
          const presentation = presentationFor(notification.type);
          const Icon = presentation.icon;
          const pending = pendingIDs.has(notification.id);
          return (
            <Card
              key={notification.id}
              className={cn(
                "p-4",
                !notification.read && "border-primary/25 bg-primary/[0.025]",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    presentation.className,
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm",
                          notification.read ? "font-medium" : "font-semibold",
                        )}
                      >
                        {notification.title}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {notification.body}
                      </p>
                    </div>
                    {!notification.read ? (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">Unread</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {presentation.label} <span aria-hidden="true">•</span>{" "}
                      <time dateTime={notification.createdAt}>
                        {relativeTime(notification.createdAt)}
                      </time>
                    </p>
                    {!notification.read ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        disabled={pending}
                        onClick={() => onMarkRead(notification)}
                      >
                        {pending ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        )}
                        Mark read
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function relativeTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently"
    : formatDistanceToNow(date, { addSuffix: true });
}
