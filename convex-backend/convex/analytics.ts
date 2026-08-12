import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";

const valueHistoryValidator = v.object({
  history: v.array(v.object({ date: v.string(), value: v.number() })),
  currentValue: v.number(),
  changePercent: v.number(),
  changePeriod: v.string()
});

const valueBreakdownValidator = v.object({
  byTcg: v.array(
    v.object({ tcg: v.string(), value: v.number(), cardCount: v.number() })
  ),
  byBinder: v.array(
    v.object({
      binderId: v.string(),
      binderName: v.string(),
      value: v.number(),
      cardCount: v.number()
    })
  ),
  topCards: v.array(
    v.object({
      externalId: v.string(),
      tcg: v.string(),
      name: v.string(),
      value: v.number(),
      imageUrl: v.optional(v.string())
    })
  )
});

const distributionValidator = v.object({
  dimension: v.string(),
  entries: v.array(
    v.object({ label: v.string(), count: v.number(), percentage: v.number() })
  ),
  total: v.number()
});

const publicCollectionValidator = v.union(
  v.object({
    name: v.string(),
    description: v.optional(v.string()),
    owner: v.string(),
    cardCount: v.number(),
    cards: v.array(
      v.object({
        name: v.string(),
        tcg: v.string(),
        setName: v.optional(v.string()),
        rarity: v.optional(v.string()),
        imageUrl: v.optional(v.string()),
        quantity: v.number(),
        condition: v.optional(v.string())
      })
    )
  }),
  v.null()
);

type AnalyticsRow = {
  entry: Doc<"collectionEntries">;
  card: Doc<"cards">;
  binder: Doc<"binders"> | null;
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function utcDayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function usableStoredPrice(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

async function requireUserBySubject(
  ctx: QueryCtx | MutationCtx,
  subject: string
) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!user) {
    throw new Error("Viewer was not provisioned");
  }
  return user;
}

async function loadAnalyticsRows(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
): Promise<AnalyticsRow[]> {
  const entries = await ctx.db
    .query("collectionEntries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(5_000);
  const cardIds = [...new Set(entries.map((entry) => entry.cardId))];
  const binderIds = [...new Set(entries.map((entry) => entry.binderId))];
  const [cards, binders] = await Promise.all([
    Promise.all(cardIds.map((cardId) => ctx.db.get(cardId))),
    Promise.all(binderIds.map((binderId) => ctx.db.get(binderId)))
  ]);
  const cardsById = new Map(
    cards.filter((card): card is Doc<"cards"> => card !== null).map((card) => [card._id, card])
  );
  const bindersById = new Map(
    binders
      .filter((binder): binder is Doc<"binders"> => binder !== null)
      .map((binder) => [binder._id, binder])
  );

  return entries.flatMap((entry) => {
    const card = cardsById.get(entry.cardId);
    return card
      ? [{ entry, card, binder: bindersById.get(entry.binderId) ?? null }]
      : [];
  });
}

function collectionValue(rows: AnalyticsRow[]) {
  return rows.reduce(
    (sum, { entry }) => sum + usableStoredPrice(entry.price) * entry.quantity,
    0
  );
}

function snapshotValue(rows: AnalyticsRow[]) {
  const byTcg: Record<string, number> = {};
  let totalValue = 0;

  for (const { entry, card } of rows) {
    const value = usableStoredPrice(entry.price) * entry.quantity;
    totalValue += value;
    byTcg[card.tcg] = (byTcg[card.tcg] ?? 0) + value;
  }

  return {
    totalValue: roundCurrency(totalValue),
    byTcg: Object.fromEntries(
      Object.entries(byTcg).map(([tcg, value]) => [tcg, roundCurrency(value)])
    )
  };
}

function recordsEqual(
  left: Record<string, number>,
  right: Record<string, number>
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

async function captureSnapshotForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  day: string
) {
  const value = snapshotValue(await loadAnalyticsRows(ctx, userId));
  const existing = await ctx.db
    .query("collectionValueSnapshots")
    .withIndex("by_user_and_day", (q) =>
      q.eq("userId", userId).eq("day", day)
    )
    .unique();

  if (!existing) {
    return await ctx.db.insert("collectionValueSnapshots", {
      userId,
      day,
      capturedAt: Date.now(),
      ...value
    });
  }

  if (
    existing.totalValue !== value.totalValue ||
    !recordsEqual(existing.byTcg, value.byTcg)
  ) {
    await ctx.db.patch(existing._id, {
      capturedAt: Date.now(),
      ...value
    });
  }
  return existing._id;
}

export const captureCurrentValueSnapshot = internalMutation({
  args: { subject: v.string() },
  returns: v.id("collectionValueSnapshots"),
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    return await captureSnapshotForUser(ctx, user._id, utcDayKey());
  }
});

export const captureDailySnapshotForUser = internalMutation({
  args: { userId: v.id("users"), day: v.string() },
  returns: v.id("collectionValueSnapshots"),
  handler: async (ctx, args) => {
    return await captureSnapshotForUser(ctx, args.userId, args.day);
  }
});

export const scheduleDailySnapshots = internalMutation({
  args: { cursor: v.optional(v.string()), day: v.optional(v.string()) },
  returns: v.object({ scheduled: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args): Promise<{ scheduled: number; isDone: boolean }> => {
    const day = args.day ?? utcDayKey();
    const users = await ctx.db.query("users").order("asc").paginate({
      cursor: args.cursor ?? null,
      numItems: 100
    });

    for (const user of users.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.analytics.captureDailySnapshotForUser,
        { userId: user._id, day }
      );
    }
    if (!users.isDone) {
      await ctx.scheduler.runAfter(0, internal.analytics.scheduleDailySnapshots, {
        cursor: users.continueCursor,
        day
      });
    }

    return { scheduled: users.page.length, isDone: users.isDone };
  }
});

export const getValueHistory = internalQuery({
  args: {
    subject: v.string(),
    periodDays: v.number(),
    tcg: v.optional(v.string())
  },
  returns: valueHistoryValidator,
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const rows = (await loadAnalyticsRows(ctx, user._id)).filter(
      ({ card }) => !args.tcg || card.tcg === args.tcg
    );
    const periodDays = Math.min(365, Math.max(1, Math.trunc(args.periodDays)));
    const today = utcDayKey();
    const firstDay = utcDayKey(Date.now() - periodDays * 24 * 60 * 60 * 1_000);
    const snapshots = await ctx.db
      .query("collectionValueSnapshots")
      .withIndex("by_user_and_day", (q) =>
        q.eq("userId", user._id).gte("day", firstDay)
      )
      .order("asc")
      .collect();
    const currentValue = roundCurrency(collectionValue(rows));
    const historyByDay = new Map(
      snapshots.map((snapshot) => [
        snapshot.day,
        {
          date: snapshot.day,
          value: args.tcg
            ? roundCurrency(snapshot.byTcg[args.tcg] ?? 0)
            : snapshot.totalValue
        }
      ])
    );
    // A stale same-day cron value must never override the live collection value.
    historyByDay.set(today, { date: today, value: currentValue });
    const history = [...historyByDay.values()].sort((left, right) =>
      left.date.localeCompare(right.date)
    );
    const firstValue = history[0]?.value ?? currentValue;
    const changePercent =
      firstValue > 0
        ? Math.round(((currentValue - firstValue) / firstValue) * 10_000) / 100
        : 0;

    return {
      history,
      currentValue,
      changePercent,
      changePeriod: `${periodDays}d`
    };
  }
});

export const getValueBreakdown = internalQuery({
  args: { subject: v.string() },
  returns: valueBreakdownValidator,
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const rows = await loadAnalyticsRows(ctx, user._id);
    const byTcg = new Map<string, { value: number; cardCount: number }>();
    const byBinder = new Map<
      string,
      { binderName: string; value: number; cardCount: number }
    >();
    const topCards = new Map<string, {
      externalId: string;
      tcg: string;
      name: string;
      value: number;
      imageUrl?: string;
    }>();

    for (const { entry, card, binder } of rows) {
      const value = usableStoredPrice(entry.price) * entry.quantity;
      const tcgEntry = byTcg.get(card.tcg) ?? { value: 0, cardCount: 0 };
      tcgEntry.value += value;
      tcgEntry.cardCount += entry.quantity;
      byTcg.set(card.tcg, tcgEntry);

      const binderId = String(entry.binderId);
      const binderEntry = byBinder.get(binderId) ?? {
        binderName: binder?.name ?? "Unsorted",
        value: 0,
        cardCount: 0
      };
      binderEntry.value += value;
      binderEntry.cardCount += entry.quantity;
      byBinder.set(binderId, binderEntry);

      if (value > 0) {
        const cardKey = `${card.tcg}:${card.externalId}`;
        const topCard = topCards.get(cardKey) ?? {
          externalId: card.externalId,
          tcg: card.tcg,
          name: card.name,
          value: 0,
          imageUrl: card.imageUrl
        };
        topCard.value += value;
        topCards.set(cardKey, topCard);
      }
    }

    const sortedTopCards = [...topCards.values()].sort(
      (left, right) => right.value - left.value
    );
    return {
      byTcg: [...byTcg.entries()].map(([tcg, data]) => ({
        tcg,
        value: roundCurrency(data.value),
        cardCount: data.cardCount
      })),
      byBinder: [...byBinder.entries()].map(([binderId, data]) => ({
        binderId,
        binderName: data.binderName,
        value: roundCurrency(data.value),
        cardCount: data.cardCount
      })),
      topCards: sortedTopCards.slice(0, 20)
    };
  }
});

function stringAttribute(card: Doc<"cards">, keys: string[]) {
  for (const key of keys) {
    const value = card.attributes?.[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function colorLabels(card: Doc<"cards">) {
  const colors = card.attributes?.colors;
  if (Array.isArray(colors)) {
    const labels = colors.filter(
      (color): color is string => typeof color === "string" && color.length > 0
    );
    if (labels.length > 0) return labels;
  }
  const types = card.attributes?.types;
  if (Array.isArray(types)) {
    const first = types.find(
      (type): type is string => typeof type === "string" && type.length > 0
    );
    if (first) return [first];
  }
  return [stringAttribute(card, ["pokemonType", "attribute"]) ?? "Unknown"];
}

export const getDistribution = internalQuery({
  args: {
    subject: v.string(),
    dimension: v.string(),
    tcg: v.optional(v.string())
  },
  returns: distributionValidator,
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const rows = (await loadAnalyticsRows(ctx, user._id)).filter(
      ({ card }) => !args.tcg || card.tcg === args.tcg
    );
    const counts = new Map<string, number>();
    let total = 0;

    for (const { entry, card } of rows) {
      const quantity = entry.quantity;
      total += quantity;
      let labels: string[];
      switch (args.dimension) {
        case "rarity":
          labels = [card.rarity ?? "Unknown"];
          break;
        case "color":
          labels = colorLabels(card);
          break;
        case "type":
          labels = [
            stringAttribute(card, ["cardType", "type", "pokemonType", "category"]) ??
              card.pokemonPrint?.category ??
              card.supertype ??
              "Unknown"
          ];
          break;
        case "tcg":
          labels = [card.tcg];
          break;
        default:
          labels = ["Unknown"];
      }
      for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + quantity);
      }
    }

    const entries = [...counts.entries()]
      .map(([label, count]) => ({
        label,
        count,
        percentage: total > 0 ? Math.round((count / total) * 10_000) / 100 : 0
      }))
      .sort((left, right) => right.count - left.count);
    return { dimension: args.dimension, entries, total };
  }
});

export const getPublicCollection = internalQuery({
  args: { shareToken: v.string() },
  returns: publicCollectionValidator,
  handler: async (ctx, args) => {
    const binder = await ctx.db
      .query("binders")
      .withIndex("by_share_token", (q) => q.eq("shareToken", args.shareToken))
      .unique();
    if (!binder || binder.isPublic !== true) return null;

    const [owner, entries] = await Promise.all([
      ctx.db.get(binder.userId),
      ctx.db
        .query("collectionEntries")
        .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
        .take(5_000)
    ]);
    const cards = await Promise.all(entries.map((entry) => ctx.db.get(entry.cardId)));
    const groupedCards = new Map<string, {
      name: string;
      tcg: string;
      setName?: string;
      rarity?: string;
      imageUrl?: string;
      quantity: number;
      condition?: string;
    }>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const card = cards[index];
      if (!card) continue;
      const key = `${card._id}:${entry.condition ?? ""}`;
      const grouped = groupedCards.get(key) ?? {
        name: card.name,
        tcg: card.tcg,
        setName: card.setName,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        quantity: 0,
        condition: entry.condition
      };
      grouped.quantity += entry.quantity;
      groupedCards.set(key, grouped);
    }
    return {
      name: binder.name,
      description: binder.description,
      owner: owner?.username ?? "Anonymous",
      cardCount: entries.reduce((sum, entry) => sum + entry.quantity, 0),
      cards: [...groupedCards.values()]
    };
  }
});
