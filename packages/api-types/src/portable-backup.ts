import { z } from "zod";
import { tcgCodeSchema } from "./cards";
import { conditionValueSchema } from "./collections";

const optionalText = z.string().nullish();
const price = z.number().finite().nonnegative().nullish();
export const portableCardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    tcg: tcgCodeSchema,
    setCode: optionalText,
    setName: optionalText,
    rarity: optionalText,
    collectorNumber: optionalText,
    imageUrl: optionalText,
  })
  .passthrough();
export const portableCopySchema = z
  .object({
    id: z.string().min(1).optional(),
    card: portableCardSchema,
    quantity: z.number().int().min(1).max(10000),
    condition: conditionValueSchema.nullish(),
    price,
    acquisitionPrice: price,
    details: z
      .object({
        language: optionalText,
        notes: optionalText,
        serialNumber: optionalText,
        acquiredAt: optionalText,
        isFoil: z.boolean().optional(),
        finishCode: optionalText,
        finishLabel: optionalText,
        edition: optionalText,
        stamp: optionalText,
        isSealedPromo: z.boolean().optional(),
        isOversized: z.boolean().optional(),
        isPeelOff: z.boolean().optional(),
        isSigned: z.boolean().optional(),
        isAltered: z.boolean().optional(),
        gradingCompany: optionalText,
        gradingScore: optionalText,
        certNumber: optionalText,
        storageLocation: optionalText,
        imageUrls: z.array(z.string()).optional(),
        tags: z
          .array(
            z.object({
              id: z.string().optional(),
              label: z.string().min(1),
              colorHex: z.string(),
            }),
          )
          .optional(),
      })
      .passthrough()
      .default({}),
  })
  .passthrough();
export const portableBackupSchema = z
  .object({
    format: z
      .literal("com.tcger.portable-backup")
      .default("com.tcger.portable-backup"),
    formatVersion: z.literal(2),
    exportedAt: z.string(),
    binders: z.array(
      z
        .object({
          id: z.string().optional(),
          name: z.string().min(1),
          description: optionalText,
          colorHex: z.string().default("315DA8"),
          defaultCondition: conditionValueSchema.nullish(),
          containerType: optionalText,
          imageUrl: optionalText,
          associatedTcg: optionalText,
          associatedSetCode: optionalText,
          associatedSetName: optionalText,
          cards: z.array(portableCopySchema),
        })
        .passthrough(),
    ),
    wishlists: z
      .array(
        z
          .object({
            id: z.string().optional(),
            name: z.string().min(1),
            description: optionalText,
            colorHex: z.string().default("315DA8"),
            matchAnyPrinting: z.boolean().default(false),
            cards: z.array(
              z.object({
                id: z.string().optional(),
                card: portableCardSchema,
                desiredQuantity: z.number().int().min(1).max(99).default(1),
                notes: optionalText,
              }),
            ),
            rules: z.array(z.record(z.unknown())).default([]),
          })
          .passthrough(),
      )
      .default([]),
    sealedInventory: z
      .array(
        z
          .object({
            id: z.string().optional(),
            productId: z.string(),
            productName: z.string(),
            product: z.record(z.unknown()).optional(),
            quantity: z.number().int().nonnegative(),
            purchasePrice: price,
            purchaseDate: optionalText,
            notes: optionalText,
          })
          .passthrough(),
      )
      .default([]),
    // Preserve sections a platform cannot yet display. Never silently drop them on re-export.
    sections: z.record(z.unknown()).default({}),
  })
  .passthrough();
export type PortableBackup = z.infer<typeof portableBackupSchema>;
export type PortableCopy = z.infer<typeof portableCopySchema>;

/** Deterministic, platform-neutral identifiers for legacy files that had none. */
export function portableId(
  kind: string,
  parent: string,
  index: number,
): string {
  return `portable:${kind}:${encodeURIComponent(parent)}:${index}`;
}
function nativeCard(card: Record<string, any>) {
  return { ...card, id: card.externalId ?? card.cardId ?? card.id };
}
export function normalizePortableBackup(input: unknown): PortableBackup {
  if (!input || typeof input !== "object")
    throw new Error("Invalid backup document");
  let raw = input as Record<string, any>;
  if (raw.format === "com.tcger.local-data-backup") {
    if (raw.schemaVersion !== 1)
      throw new Error("Unsupported iOS backup version");
    const payload = raw.payload;
    if (!payload || !Array.isArray(payload.collections))
      throw new Error("Invalid iOS backup payload");
    raw = {
      format: "com.tcger.portable-backup",
      formatVersion: 2,
      exportedAt: raw.exportedAt,
      binders: payload.collections.map((binder: Record<string, any>) => ({
        ...binder,
        colorHex: binder.colorHex ?? "315DA8",
        cards: binder.cards.flatMap((card: Record<string, any>) => {
          const copies = card.copies?.length
            ? card.copies
            : Array.from({ length: card.quantity }, (_, i) => ({
                ...card,
                id: portableId("copy", card.id, i),
              }));
          return copies.map((copy: Record<string, any>) => ({
            id: copy.id,
            card: nativeCard(card),
            quantity: 1,
            condition: copy.condition,
            price: copy.price,
            acquisitionPrice: copy.acquisitionPrice,
            details: Object.fromEntries(
              Object.entries(copy).filter(([, value]) => value !== null),
            ),
          }));
        }),
      })),
      wishlists: (payload.wishlists ?? []).map((list: Record<string, any>) => ({
        ...list,
        colorHex: list.colorHex ?? "315DA8",
        matchAnyPrinting: list.matchAnyPrinting ?? false,
        rules: list.rules ?? [],
        cards: list.cards.map((card: Record<string, any>) => ({
          id: card.id,
          card: nativeCard(card),
          desiredQuantity: card.desiredQuantity ?? 1,
          notes: card.notes,
        })),
      })),
      sealedInventory: (payload.sealedInventory ?? []).map(
        (item: Record<string, any>) => ({
          ...item,
          productId: item.product.id,
          productName: item.product.name,
        }),
      ),
      sections: {
        ...payload.portableSections,
        ios: {
          payload: { ...payload, portableSections: undefined },
          appPreferences: raw.appPreferences,
          binderPageImages: raw.binderPageImages,
        },
        transactions: payload.transactions ?? [],
        onlineCodes: payload.onlineCodes ?? [],
        binderPages: payload.binderPages ?? [],
        binderPageImages: raw.binderPageImages ?? {},
        preferences: payload.preferences ?? {},
        smartFolders: raw.appPreferences?.smartFolders ?? [],
      },
    };
  } else if (raw.formatVersion === 1 && !raw.format) {
    raw = { ...raw, format: "com.tcger.portable-backup", formatVersion: 2 };
  }
  const backup = portableBackupSchema.parse(raw);
  if (backup.sections.smartFolders !== undefined) {
    const types: Record<string, string> = {
      Game: "tcg",
      "TCG Game": "tcg",
      "Set Code": "setCode",
      "Foil Only": "isFoil",
      Rarity: "rarity",
      Condition: "condition",
      Set: "setCode",
      Foil: "isFoil",
      Tag: "tag",
    };
    backup.sections.smartFolders = z
      .array(
        z.object({
          id: z.string(),
          name: z.string().min(1),
          colorHex: z.string().default("315DA8"),
          matchMode: z.string().default("all"),
          rules: z.array(
            z.object({ id: z.string(), type: z.string(), value: z.string() }),
          ),
        }),
      )
      .parse(backup.sections.smartFolders)
      .map((folder) => ({
        ...folder,
        matchMode: ["Match All", "All Rules"].includes(folder.matchMode)
          ? "all"
          : ["Match Any", "Any Rule"].includes(folder.matchMode)
            ? "any"
            : folder.matchMode,
        rules: folder.rules.map((rule) => ({
          ...rule,
          type: types[rule.type] ?? rule.type,
        })),
      }));
    for (const folder of backup.sections.smartFolders as {
      matchMode: string;
      rules: { type: string }[];
    }[]) {
      if (
        !["all", "any"].includes(folder.matchMode) ||
        folder.rules.some(
          (rule) =>
            ![
              "tcg",
              "rarity",
              "condition",
              "setCode",
              "isFoil",
              "tag",
            ].includes(rule.type),
        )
      )
        throw new Error("Unsupported smart-folder rule");
    }
  }
  const entityIds = new Set<string>();
  const unique = (id: string) => {
    if (entityIds.has(id)) throw new Error(`Duplicate entity ID: ${id}`);
    entityIds.add(id);
  };
  const ids = new Set<string>();
  for (const [binderIndex, binder] of backup.binders.entries()) {
    binder.id ??= portableId("binder", binder.name, binderIndex);
    unique(binder.id);
    for (const [index, copy] of binder.cards.entries()) {
      copy.id ??= portableId("copy", binder.id, index);
      if (ids.has(copy.id)) throw new Error(`Duplicate copy ID: ${copy.id}`);
      ids.add(copy.id);
      if (
        copy.details.acquiredAt &&
        !Number.isFinite(Date.parse(copy.details.acquiredAt))
      )
        throw new Error("Invalid acquisition date");
    }
  }
  backup.wishlists.forEach((list, index) => {
    list.id ??= portableId("wishlist", list.name, index);
    unique(list.id);
  });
  backup.sealedInventory.forEach((item, index) => {
    item.id ??= portableId("sealed", item.productId, index);
    unique(item.id);
  });
  return backup;
}
