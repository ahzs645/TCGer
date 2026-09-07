import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const label = z.string().min(1).max(100);
const count = z.number().int().min(0).max(10000);
const property = z
  .string()
  .regex(
    /^(name|rarity|supertype|baseExternalId|printingKey|attributes\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/,
  );

export const gameFinishSchema = z
  .object({
    code: z.string().min(1).max(80),
    label,
    foil: z.boolean(),
  })
  .strict();
export type GameFinish = z.infer<typeof gameFinishSchema>;
export const gamePrintingsSchema = z
  .object({
    version: z.literal(1),
    selection: z.enum(["printing", "functional"]),
    finishes: z
      .array(gameFinishSchema)
      .max(200)
      .refine(
        (finishes) =>
          new Set(finishes.map((f) => f.code)).size === finishes.length,
        "Finish codes must be unique",
      ),
  })
  .strict();
export const gameSymbolSchema = z
  .object({
    id: z.string().min(1).max(80),
    label,
    kind: z.enum(["rarity", "resource", "type"]),
    imageUrl: z
      .string()
      .url()
      .max(2048)
      .refine((value) => value.startsWith("https://"), "Symbols require HTTPS"),
  })
  .strict();

export const deckEligibilitySchema = z
  .object({
    property,
    values: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .min(1)
      .max(200),
  })
  .strict();
const deckZone = z
  .object({
    id,
    label,
    min: count,
    max: count,
    eligibility: z.array(deckEligibilitySchema).max(16).optional(),
  })
  .strict();
const deckFormat = z
  .object({
    id,
    label,
    zones: z.array(deckZone).min(1).max(16),
    defaultZone: id,
    maxCopies: count.optional(),
    copyIdentity: z.enum(["baseExternalId", "name"]).default("baseExternalId"),
    copyLimitExceptions: z
      .array(
        z
          .object({
            when: deckEligibilitySchema,
            maxCopies: count,
          })
          .strict(),
      )
      .max(32)
      .optional(),
    requireLegality: z.boolean().optional(),
  })
  .strict();
export const gameDeckRulesSchema = z
  .object({
    version: z.literal(1),
    defaultFormat: id,
    formats: z.array(deckFormat).min(1).max(32),
  })
  .strict()
  .superRefine((rules, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(rules.formats.map((f) => f.id)).size !== rules.formats.length)
      issue("Duplicate deck format");
    if (!rules.formats.some((f) => f.id === rules.defaultFormat))
      issue("Default deck format is not declared");
    for (const format of rules.formats) {
      if (new Set(format.zones.map((z) => z.id)).size !== format.zones.length)
        issue("Duplicate deck zone");
      if (!format.zones.some((z) => z.id === format.defaultZone))
        issue("Default deck zone is not declared");
      if (format.zones.some((z) => z.min > z.max))
        issue("Deck zone minimum exceeds maximum");
    }
  });
export type GameDeckRules = z.infer<typeof gameDeckRulesSchema>;
export type GameDeckFormat = GameDeckRules["formats"][number];

export interface DeclarativeDeckCard {
  externalId: string;
  name: string;
  quantity: number;
  zone?: string;
  tcg?: string;
  cardData?: Record<string, unknown>;
}
export interface GameLegalityCard {
  sanctionedPlayLegal?: boolean;
  formatLegality?: Record<string, boolean | undefined>;
  legalityPeriods?: Array<{
    format: string;
    legal: boolean;
    validFrom?: string;
    validTo?: string;
  }>;
}

/** Periods use an inclusive start and exclusive end. A dated format never
 * falls back to an undated value outside its declared effective periods. */
export function gameCardLegality(
  card: GameLegalityCard,
  format: string,
  at = new Date().toISOString(),
): boolean | undefined {
  if (card.sanctionedPlayLegal === false) return false;
  const periods = card.legalityPeriods?.filter((p) => p.format === format);
  if (periods?.length) {
    const time = Date.parse(at);
    if (!Number.isFinite(time)) return undefined;
    const active = periods
      .filter(
        (p) =>
          (!p.validFrom || Date.parse(p.validFrom) <= time) &&
          (!p.validTo || time < Date.parse(p.validTo)),
      )
      .sort(
        (a, b) =>
          Date.parse(b.validFrom ?? "1970-01-01") -
          Date.parse(a.validFrom ?? "1970-01-01"),
      );
    return active[0]?.legal;
  }
  return card.formatLegality?.[format];
}
function field(card: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value &&
        typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      card,
    );
}
function eligible(
  card: Record<string, unknown>,
  rule: z.infer<typeof deckEligibilitySchema>,
): boolean {
  const value = field(card, rule.property);
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) =>
    rule.values.includes(v as string | number | boolean),
  );
}

export function validateGameDeck(
  gameId: string,
  cards: readonly DeclarativeDeckCard[],
  rules: GameDeckRules,
  formatId?: string,
  at?: string,
) {
  const format = rules.formats.find(
    (f) => f.id === (formatId ?? rules.defaultFormat),
  );
  const errors: string[] = [],
    warnings: string[] = [];
  if (!format)
    return {
      valid: false,
      errors: ["This deck format is not supported by the installed rules."],
      warnings,
      status: "unsupported" as const,
    };
  const totals = new Map<string, number>();
  const copies = new Map<
    string,
    { name: string; quantity: number; limit?: number }
  >();
  for (const card of cards) {
    if (!Number.isInteger(card.quantity) || card.quantity <= 0) {
      errors.push(`${card.name}: quantity must be a positive integer.`);
      continue;
    }
    if (card.tcg && card.tcg !== gameId)
      errors.push(`${card.name}: belongs to another game.`);
    const zoneId = card.zone ?? format.defaultZone;
    const zone = format.zones.find((z) => z.id === zoneId);
    if (!zone) errors.push(`${card.name}: unknown zone ${zoneId}.`);
    totals.set(zoneId, (totals.get(zoneId) ?? 0) + card.quantity);
    const data: Record<string, unknown> = { ...card.cardData, name: card.name };
    if (zone?.eligibility?.some((rule) => !eligible(data, rule)))
      errors.push(`${card.name}: is not eligible for ${zone.label}.`);
    const key =
      format.copyIdentity === "name"
        ? card.name.toLocaleLowerCase()
        : String(data.baseExternalId ?? card.externalId);
    const exception = format.copyLimitExceptions?.find((e) =>
      eligible(data, e.when),
    );
    const limit = exception?.maxCopies ?? format.maxCopies;
    const previous = copies.get(key);
    copies.set(key, {
      name: card.name,
      quantity: (previous?.quantity ?? 0) + card.quantity,
      limit:
        previous?.limit !== undefined && limit !== undefined
          ? Math.min(previous.limit, limit)
          : (previous?.limit ?? limit),
    });
    if (format.requireLegality) {
      const legal = gameCardLegality(data as GameLegalityCard, format.id, at);
      if (legal === false)
        errors.push(`${card.name}: is not legal in ${format.label}.`);
      if (legal === undefined)
        warnings.push(`${card.name}: legality in ${format.label} is unknown.`);
    }
  }
  for (const zone of format.zones) {
    const total = totals.get(zone.id) ?? 0;
    if (total < zone.min || total > zone.max)
      errors.push(
        `${zone.label}: requires ${zone.min}–${zone.max} cards; found ${total}.`,
      );
  }
  for (const copy of copies.values())
    if (copy.limit !== undefined && copy.quantity > copy.limit)
      errors.push(`${copy.name}: exceeds the ${copy.limit}-copy limit.`);
  return {
    valid: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    format: format.id,
    status: errors.length
      ? ("invalid" as const)
      : warnings.length
        ? ("unknown" as const)
        : ("valid" as const),
  };
}

export const gamePriceQuoteSchema = z
  .object({
    cardId: z.string().min(1),
    printingKey: z.string().optional(),
    finishCode: z.string().optional(),
    condition: z.string().optional(),
    language: z.string().optional(),
    amount: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    source: label,
    sourceUrl: z.string().url().optional(),
    observedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (q) => Date.parse(q.expiresAt) > Date.parse(q.observedAt),
    "Quote expiry must follow observation",
  );
export const gamePriceSnapshotSchema = z
  .object({
    schema: z.literal("tcger-price-snapshot-v1"),
    gameId: id,
    quotes: z.array(gamePriceQuoteSchema).max(1000000),
  })
  .strict();
export type GamePriceSnapshot = z.infer<typeof gamePriceSnapshotSchema>;
export function gameSnapshotQuote(
  snapshot: GamePriceSnapshot,
  query: {
    cardId: string;
    printingKey?: string;
    finishCode?: string;
    condition?: string;
    language?: string;
    currency: string;
  },
  now = Date.now(),
) {
  return snapshot.quotes
    .filter(
      (q) =>
        q.cardId === query.cardId &&
        q.currency === query.currency &&
        ["printingKey", "finishCode", "condition", "language"].every(
          (key) =>
            q[key as keyof typeof query] === query[key as keyof typeof query],
        ) &&
        Date.parse(q.observedAt) <= now &&
        now < Date.parse(q.expiresAt),
    )
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
}

export const gamePackLibrarySchema = z
  .object({
    schema: z.literal("tcger-pack-library-v1"),
    gameId: id,
    packs: z
      .array(
        z
          .object({
            id,
            name: label,
            setCode: z.string().min(1),
            cardBackUrl: z.string().url().optional(),
            slots: z
              .array(
                z
                  .object({
                    count: z.number().int().min(1).max(100),
                    pool: z
                      .array(
                        z
                          .object({
                            cardId: z.string().min(1),
                            weight: z.number().positive().finite().max(1000000),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(100000),
                    withoutReplacement: z.boolean().optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .superRefine((library, ctx) => {
    if (new Set(library.packs.map((p) => p.id)).size !== library.packs.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pack ids must be unique",
      });
    for (const pack of library.packs)
      for (const slot of pack.slots) {
        if (
          new Set(slot.pool.map((c) => c.cardId)).size !== slot.pool.length ||
          (slot.withoutReplacement && slot.count > slot.pool.length)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Pack slot has duplicate or insufficient cards",
          });
      }
  });
export type GamePackLibrary = z.infer<typeof gamePackLibrarySchema>;
export function openGamePack(
  pack: GamePackLibrary["packs"][number],
  random = Math.random,
): string[] {
  return pack.slots.flatMap((slot) => {
    const pool = [...slot.pool],
      result: string[] = [];
    for (let i = 0; i < slot.count; i++) {
      const roll = random();
      if (!Number.isFinite(roll) || roll < 0 || roll >= 1)
        throw new Error("Random sample must be in [0, 1)");
      let remaining = roll * pool.reduce((sum, c) => sum + c.weight, 0);
      const index = pool.findIndex(
        (c, index) => (remaining -= c.weight) < 0 || index === pool.length - 1,
      );
      if (index < 0) throw new Error("Pack slot is exhausted");
      result.push(pool[index]!.cardId);
      if (slot.withoutReplacement) pool.splice(index, 1);
    }
    return result;
  });
}
