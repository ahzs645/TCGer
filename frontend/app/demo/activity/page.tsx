"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Bell,
  Check,
  CheckCircle2,
  CircleUserRound,
  Inbox,
  LibraryBig,
  Newspaper,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DEMO_ACTIVITY_ITEMS,
  DEMO_ACTIVITY_STORAGE_KEY,
  initialDemoActivityReadIds,
  parseDemoActivityReadIds,
  serializeDemoActivityReadIds,
  type DemoActivityCategory,
  type DemoActivityItem,
} from "@/lib/demo-activity";
import { cn } from "@/lib/utils";

type ActivityFilter = "all" | "unread" | DemoActivityCategory;

const filters: Array<{ value: ActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "trade", label: "Trades" },
  { value: "price", label: "Prices" },
  { value: "collection", label: "Collection" },
  { value: "account", label: "Account" },
];

const categoryPresentation: Record<
  DemoActivityCategory,
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

export default function DemoActivityPage() {
  const [readIds, setReadIds] = useState(initialDemoActivityReadIds);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let storedReadIds = initialDemoActivityReadIds();
    try {
      storedReadIds = parseDemoActivityReadIds(
        window.localStorage.getItem(DEMO_ACTIVITY_STORAGE_KEY),
      );
    } catch {
      // Privacy settings can block localStorage; the in-memory inbox still works.
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setReadIds(storedReadIds);
      setStorageHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    try {
      window.localStorage.setItem(
        DEMO_ACTIVITY_STORAGE_KEY,
        serializeDemoActivityReadIds(readIds),
      );
    } catch {
      // Keep read state for this visit if browser storage is unavailable.
    }
  }, [readIds, storageHydrated]);

  const unreadCount = DEMO_ACTIVITY_ITEMS.reduce(
    (count, item) => count + (readIds.has(item.id) ? 0 : 1),
    0,
  );

  const visibleItems = useMemo(
    () =>
      DEMO_ACTIVITY_ITEMS.filter((item) => {
        if (filter === "all") return true;
        if (filter === "unread") return !readIds.has(item.id);
        if (filter === "account") {
          return item.category === "account" || item.category === "news";
        }
        return item.category === filter;
      }),
    [filter, readIds],
  );

  const unreadItems = visibleItems.filter((item) => !readIds.has(item.id));
  const earlierItems = visibleItems.filter((item) => readIds.has(item.id));

  const markRead = (id: string) => {
    setReadIds((current) => new Set(current).add(id));
  };

  const markAllRead = () => {
    setReadIds(new Set(DEMO_ACTIVITY_ITEMS.map((item) => item.id)));
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-heading font-semibold">Activity</h1>
              {unreadCount > 0 && (
                <Badge aria-label={`${unreadCount} unread updates`}>
                  {unreadCount} new
                </Badge>
              )}
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Price alerts, trade requests, collection updates, and account news
              in one place.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="gap-2 self-start"
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Mark all read
          </Button>
        </div>

        <div
          className="flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4"
          role="note"
        >
          <Bell
            className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-sm font-medium">Demo-local activity</p>
            <p className="text-sm text-muted-foreground">
              These sample updates mirror the iOS inbox. Read status is saved
              only in this browser; no server notifications are sent.
            </p>
          </div>
        </div>

        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="Filter activity"
        >
          {filters.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={filter === option.value ? "default" : "outline"}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              {option.value === "unread" && unreadCount > 0
                ? ` (${unreadCount})`
                : ""}
            </Button>
          ))}
        </div>

        {visibleItems.length === 0 ? (
          <Card className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
            <Inbox
              className="h-10 w-10 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h2 className="font-heading text-lg font-semibold">
                You&apos;re all caught up
              </h2>
              <p className="text-sm text-muted-foreground">
                There are no updates in this filter.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilter("all")}
            >
              Show all activity
            </Button>
          </Card>
        ) : (
          <div className="space-y-7" aria-live="polite">
            {unreadItems.length > 0 && (
              <ActivitySection
                title="New"
                items={unreadItems}
                readIds={readIds}
                onMarkRead={markRead}
              />
            )}
            {earlierItems.length > 0 && (
              <ActivitySection
                title="Earlier"
                items={earlierItems}
                readIds={readIds}
                onMarkRead={markRead}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ActivitySection({
  title,
  items,
  readIds,
  onMarkRead,
}: {
  title: string;
  items: readonly DemoActivityItem[];
  readIds: Set<string>;
  onMarkRead: (id: string) => void;
}) {
  return (
    <section aria-labelledby={`activity-${title.toLowerCase()}`}>
      <h2
        id={`activity-${title.toLowerCase()}`}
        className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {title}
      </h2>
      <div className="space-y-3">
        {items.map((item) => (
          <ActivityRow
            key={item.id}
            item={item}
            read={readIds.has(item.id)}
            onMarkRead={() => onMarkRead(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ActivityRow({
  item,
  read,
  onMarkRead,
}: {
  item: DemoActivityItem;
  read: boolean;
  onMarkRead: () => void;
}) {
  const presentation = categoryPresentation[item.category];
  const Icon = presentation.icon;

  return (
    <Card
      role="article"
      className={cn(
        "relative overflow-hidden p-4 transition-colors sm:p-5",
        !read && "border-primary/25 bg-primary/[0.025]",
      )}
    >
      {!read && (
        <span
          className="absolute inset-y-0 left-0 w-1 bg-primary"
          aria-hidden="true"
        />
      )}
      <div className="flex items-start gap-3 sm:gap-4">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11",
            presentation.className,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm",
                    read ? "font-medium" : "font-semibold",
                  )}
                >
                  {item.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
              {!read && (
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">Unread</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{presentation.label}</span>
              <span aria-hidden="true">•</span>
              <time>{item.timeLabel}</time>
              <span className="sr-only">{read ? "Read" : "Unread"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={item.href} onClick={onMarkRead}>
                {item.actionLabel}
              </Link>
            </Button>
            {!read && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                onClick={onMarkRead}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Mark read
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
