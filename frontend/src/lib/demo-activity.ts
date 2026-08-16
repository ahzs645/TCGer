export type DemoActivityCategory =
  | "trade"
  | "price"
  | "collection"
  | "news"
  | "account";

export interface DemoActivityItem {
  id: string;
  category: DemoActivityCategory;
  title: string;
  body: string;
  timeLabel: string;
  href: string;
  actionLabel: string;
  initiallyRead?: boolean;
}

/**
 * A stable, demo-local inbox. These entries reference the seeded portfolio so
 * Activity is useful without implying that a demo browser has a live server.
 */
export const DEMO_ACTIVITY_ITEMS: readonly DemoActivityItem[] = [
  {
    id: "trade-modern-mage",
    category: "trade",
    title: "Trade proposal needs a look",
    body: "ModernMage offered Ragavan, Nimble Pilferer for your Solitude.",
    timeLabel: "18 minutes ago",
    href: "/demo/trades",
    actionLabel: "Review trade",
  },
  {
    id: "price-charizard-ex",
    category: "price",
    title: "Charizard ex moved up 8.4%",
    body: "The Paldea Evolved printing in your demo collection is now valued at $85.00.",
    timeLabel: "2 hours ago",
    href: "/demo/prices",
    actionLabel: "View prices",
  },
  {
    id: "collection-import",
    category: "collection",
    title: "Collection import complete",
    body: "12 cards were added to the demo collection and are ready to review.",
    timeLabel: "Yesterday",
    href: "/demo/collections",
    actionLabel: "Open collection",
  },
  {
    id: "account-local-demo",
    category: "account",
    title: "Your local demo profile is ready",
    body: "Changes made in demo mode stay in this browser and are never synced to an account.",
    timeLabel: "Yesterday",
    href: "/demo/dashboard",
    actionLabel: "View dashboard",
  },
  {
    id: "news-crown-zenith",
    category: "news",
    title: "Crown Zenith guide progress updated",
    body: "The connected-art collecting guide now reflects the seeded demo wishlist.",
    timeLabel: "3 days ago",
    href: "/demo/guides",
    actionLabel: "View guides",
    initiallyRead: true,
  },
  {
    id: "price-rayquaza-vmax",
    category: "price",
    title: "Rayquaza VMAX crossed $190",
    body: "Your Evolving Skies alternate art printing is one of the demo collection's top movers.",
    timeLabel: "5 days ago",
    href: "/demo/prices",
    actionLabel: "View prices",
    initiallyRead: true,
  },
  {
    id: "trade-cardmaster-complete",
    category: "trade",
    title: "Trade with CardMaster42 completed",
    body: "Ash Blossom, Nibiru, and Effect Veiler were added to the completed trade history.",
    timeLabel: "1 week ago",
    href: "/demo/trades",
    actionLabel: "View history",
    initiallyRead: true,
  },
];

export const DEMO_ACTIVITY_STORAGE_KEY = "tcger.demo.activity.read.v1";

const activityIds = new Set(DEMO_ACTIVITY_ITEMS.map((item) => item.id));

export function initialDemoActivityReadIds(): Set<string> {
  return new Set(
    DEMO_ACTIVITY_ITEMS.filter((item) => item.initiallyRead).map(
      (item) => item.id,
    ),
  );
}

export function parseDemoActivityReadIds(
  serialized: string | null,
): Set<string> {
  if (serialized === null) return initialDemoActivityReadIds();

  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return initialDemoActivityReadIds();

    return new Set(
      value.filter(
        (id): id is string => typeof id === "string" && activityIds.has(id),
      ),
    );
  } catch {
    return initialDemoActivityReadIds();
  }
}

export function serializeDemoActivityReadIds(ids: Iterable<string>): string {
  return JSON.stringify(
    [...new Set(ids)].filter((id) => activityIds.has(id)).sort(),
  );
}
