import { z } from "zod";
import { gameDeckRulesSchema, deckZoneSchema } from "@tcg/api-types";
import type { PersistedDemoState } from "./demo-persistence";
import { LOCAL_USER_ID } from "./legacy-collection-rows";

const text = z.string().optional();
const row = z.object({
  _id: z.string().min(1),
  _creationTime: z.number().finite(),
});
const dated = row.extend({
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
});
const deck = dated.extend({
  userId: z.string(),
  name: z.string(),
  tcg: z.string(),
  description: text,
  format: text,
  rules: gameDeckRulesSchema.optional(),
  colorHex: text,
  isPublic: z.boolean(),
  isComplete: z.boolean().optional(),
});
const deckCard = row.extend({
  deckId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  externalId: text,
  tcg: text,
  zone: deckZoneSchema.optional(),
  cardData: z.record(z.unknown()).optional(),
  isCommander: z.boolean().optional(),
  isSideboard: z.boolean().optional(),
  imageUrl: text,
  imageUrlSmall: text,
  setCode: text,
  setName: text,
  rarity: text,
  cardType: text,
});
const trade = dated.extend({
  userId: z.string(),
  partner: z.string(),
  status: z.enum(["pending", "completed", "declined"]),
  tradedOn: z.string(),
});
const tradeCard = row.extend({
  tradeId: z.string(),
  side: z.enum(["giving", "receiving"]),
  name: z.string(),
  tcg: z.string(),
  quantity: z.number().int().positive(),
  externalId: text,
  imageUrl: text,
  estimatedValue: z.number().finite().nonnegative().optional(),
});
const webSections = z.object({
  deckRows: z
    .object({ decks: z.array(deck), deckCards: z.array(deckCard) })
    .optional(),
  tradeRows: z
    .object({ trades: z.array(trade), tradeCards: z.array(tradeCard) })
    .optional(),
  tags: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        colorHex: z.string(),
        createdAt: z.string().default(() => new Date().toISOString()),
        updatedAt: z.string().default(() => new Date().toISOString()),
      }),
    )
    .optional(),
});
function merge<T extends { _id: string }>(before: T[], after: T[]) {
  return [
    ...new Map([...before, ...after].map((row) => [row._id, row])).values(),
  ];
}
/** Restore supported web-only records without trusting an imported account or credentials. */
export function restoreWebSections(
  input: unknown,
  before: Partial<PersistedDemoState>,
): Partial<PersistedDemoState> {
  const sections = webSections.parse(input ?? {});
  const patch: Partial<PersistedDemoState> = {};
  if (sections.deckRows) {
    const { decks, deckCards } = sections.deckRows;
    if (
      deckCards.some((card) => !decks.some((deck) => deck._id === card.deckId))
    )
      throw new Error("A backup deck card has no parent deck");
    patch.deckRows = {
      decks: merge(
        before.deckRows?.decks ?? [],
        decks.map((deck) => ({ ...deck, userId: LOCAL_USER_ID })),
      ),
      deckCards: merge(before.deckRows?.deckCards ?? [], deckCards),
    };
  }
  if (sections.tradeRows) {
    const { trades, tradeCards } = sections.tradeRows;
    if (
      tradeCards.some(
        (card) => !trades.some((trade) => trade._id === card.tradeId),
      )
    )
      throw new Error("A backup trade card has no parent trade");
    patch.tradeRows = {
      trades: merge(
        before.tradeRows?.trades ?? [],
        trades.map((trade) => ({ ...trade, userId: LOCAL_USER_ID })),
      ),
      tradeCards: merge(before.tradeRows?.tradeCards ?? [], tradeCards),
    };
  }
  if (sections.tags)
    patch.tags = [
      ...new Map(
        [...(before.tags ?? []), ...sections.tags].map((tag) => [tag.id, tag]),
      ).values(),
    ];
  return patch;
}
