export type AchievementId =
  | "first-card"
  | "copy-collector"
  | "card-curator"
  | "binder-builder"
  | "cross-game"
  | "wishlist-planner"
  | "set-explorer"
  | "set-complete";

export interface AchievementCardInput {
  id?: string;
  cardId?: string;
  externalId?: string;
  baseExternalId?: string;
  name?: string;
  tcg: string;
  quantity?: number;
}

export interface AchievementInputs {
  cards: AchievementCardInput[];
  binderCount?: number;
  wishlistCount?: number;
  setCompletionPercents?: number[];
}

export interface CollectionAchievement {
  id: AchievementId;
  title: string;
  description: string;
  current: number;
  target: number;
  unit: string;
  progressPercent: number;
  unlocked: boolean;
}

interface AchievementDefinition {
  id: AchievementId;
  title: string;
  description: string;
  target: number;
  unit: string;
  current: (metrics: AchievementMetrics) => number;
}

interface AchievementMetrics {
  totalCopies: number;
  uniqueCards: number;
  representedGames: number;
  binderCount: number;
  wishlistCount: number;
  bestSetCompletion: number;
}

const DEFINITIONS: AchievementDefinition[] = [
  {
    id: "first-card",
    title: "First card",
    description: "Add the first card to your collection.",
    target: 1,
    unit: "card",
    current: (metrics) => metrics.totalCopies,
  },
  {
    id: "copy-collector",
    title: "Collector's shelf",
    description: "Build a collection of 50 physical copies.",
    target: 50,
    unit: "copies",
    current: (metrics) => metrics.totalCopies,
  },
  {
    id: "card-curator",
    title: "Card curator",
    description: "Track 25 different cards across your binders.",
    target: 25,
    unit: "unique cards",
    current: (metrics) => metrics.uniqueCards,
  },
  {
    id: "binder-builder",
    title: "Binder builder",
    description: "Organize cards in three binders.",
    target: 3,
    unit: "binders",
    current: (metrics) => metrics.binderCount,
  },
  {
    id: "cross-game",
    title: "Across the table",
    description: "Collect cards from three different games.",
    target: 3,
    unit: "games",
    current: (metrics) => metrics.representedGames,
  },
  {
    id: "wishlist-planner",
    title: "Next chase",
    description: "Create a wishlist with cards you want next.",
    target: 1,
    unit: "wishlists",
    current: (metrics) => metrics.wishlistCount,
  },
  {
    id: "set-explorer",
    title: "Set explorer",
    description: "Reach 25% completion in a tracked set.",
    target: 25,
    unit: "% complete",
    current: (metrics) => metrics.bestSetCompletion,
  },
  {
    id: "set-complete",
    title: "Set complete",
    description: "Finish every tracked card identity in a set.",
    target: 100,
    unit: "% complete",
    current: (metrics) => metrics.bestSetCompletion,
  },
];

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function identityForCard(card: AchievementCardInput): string {
  const identity =
    card.baseExternalId ??
    card.externalId ??
    card.cardId ??
    card.id ??
    card.name ??
    "unknown";
  return `${card.tcg.trim().toLocaleLowerCase()}:${identity.trim().toLocaleLowerCase()}`;
}

export function summarizeAchievementMetrics(
  input: AchievementInputs,
): AchievementMetrics {
  const ownedCards = input.cards.filter(
    (card) => finiteNonNegative(card.quantity) > 0,
  );
  const totalCopies = ownedCards.reduce(
    (total, card) => total + finiteNonNegative(card.quantity),
    0,
  );
  const uniqueCards = new Set(ownedCards.map(identityForCard)).size;
  const representedGames = new Set(
    ownedCards.map((card) => card.tcg.trim().toLocaleLowerCase()),
  ).size;
  const bestSetCompletion = Math.min(
    100,
    Math.max(0, ...(input.setCompletionPercents ?? []).filter(Number.isFinite)),
  );

  return {
    totalCopies,
    uniqueCards,
    representedGames,
    binderCount: finiteNonNegative(input.binderCount),
    wishlistCount: finiteNonNegative(input.wishlistCount),
    bestSetCompletion,
  };
}

export function deriveCollectionAchievements(
  input: AchievementInputs,
): CollectionAchievement[] {
  const metrics = summarizeAchievementMetrics(input);

  return DEFINITIONS.map((definition) => {
    const current = finiteNonNegative(definition.current(metrics));
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      current,
      target: definition.target,
      unit: definition.unit,
      progressPercent: Math.min(
        100,
        Math.round((current / definition.target) * 100),
      ),
      unlocked: current >= definition.target,
    };
  });
}

export function nextCollectionAchievement(
  achievements: CollectionAchievement[],
): CollectionAchievement | undefined {
  return achievements
    .filter((achievement) => !achievement.unlocked)
    .sort(
      (left, right) =>
        right.progressPercent - left.progressPercent ||
        left.target - right.target,
    )[0];
}
