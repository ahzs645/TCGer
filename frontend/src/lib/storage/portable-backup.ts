import {
  normalizePortableBackup,
  updatePreferencesSchema,
  type PortableBackup,
} from "@tcg/api-types";
import {
  commitDemoBackup,
  demoBackupSnapshot,
  useDemoStore,
  type DemoBinder,
  type DemoWishlist,
} from "@/stores/demo-store";
import { toPortableRows } from "./legacy-collection-rows";
import { toWishlistRows, toSealedRows } from "./legacy-portfolio-rows";
import {
  SMART_FOLDER_STORAGE_KEY_PREFIX,
  DEMO_TRANSACTIONS_STORAGE_KEY,
} from "./keys";
import { restoreWebSections } from "./portable-web-sections";
import type { PersistedDemoState } from "./demo-persistence";

export async function exportLocalBackup(): Promise<PortableBackup> {
  const native = await demoBackupSnapshot();
  const state = useDemoStore.getState();
  const now = new Date().toISOString();
  const localSections = { ...native.portableSections };
  if (typeof localStorage !== "undefined") {
    for (const [section, key] of [
      ["smartFolders", `${SMART_FOLDER_STORAGE_KEY_PREFIX}demo-user-001`],
      ["transactions", DEMO_TRANSACTIONS_STORAGE_KEY],
    ]) {
      const raw = localStorage.getItem(key!);
      if (raw && localSections[section!] === undefined)
        localSections[section!] = JSON.parse(raw);
    }
  }
  return normalizePortableBackup({
    format: "com.tcger.portable-backup",
    formatVersion: 2,
    exportedAt: now,
    binders: state.binders.map((binder) => ({
      ...binder,
      colorHex: binder.color.replace(/^#/, ""),
      cards: binder.cards.flatMap((card) => {
        const copies = card.copies?.length
          ? card.copies
          : Array.from({ length: card.quantity }, (_, i) => ({
              id: `${card.id}:${i}`,
              condition: card.condition,
              price: card.price,
            }));
        return copies.map((copy) => ({
          id: copy.id,
          card: {
            ...card.cardData,
            id: card.cardId,
            name: card.name,
            tcg: card.tcg,
            setCode: card.setCode,
            setName: card.setName,
            rarity: card.rarity,
          },
          quantity: 1,
          condition: copy.condition || null,
          price: copy.price,
          acquisitionPrice:
            "acquisitionPrice" in copy ? copy.acquisitionPrice : null,
          details: copy,
        }));
      }),
    })),
    wishlists: state.wishlists.map((list) => ({
      ...list,
      colorHex: list.color.replace(/^#/, ""),
      matchAnyPrinting:
        native.wishlistRows?.wishlists.find((row) => row._id === list.id)
          ?.matchAnyPrinting ?? false,
      cards: list.cards.map((card) => ({
        id: card.id,
        card: {
          ...card.cardData,
          id: card.cardId,
          name: card.name,
          tcg: card.tcg,
          setCode: card.setCode,
          setName: card.setName,
          rarity: card.rarity,
        },
        desiredQuantity: card.desiredQuantity ?? 1,
        notes: card.cardData?.notes,
      })),
    })),
    sealedInventory: state.sealed.map((item) => ({
      id: item.id,
      productId: item.id,
      productName: item.name,
      product: {
        id: item.id,
        name: item.name,
        tcg: item.tcg.toLowerCase(),
        productType: item.type,
        setCode: item.set,
      },
      quantity: item.quantity,
      purchasePrice: item.purchasePrice,
      purchaseDate: item.purchaseDate,
    })),
    sections: {
      ...localSections,
      preferences: state.preferences,
      web: { ...native, portableSections: undefined, settings: undefined },
    },
  });
}
function mergeRows<T extends { _id: string }>(before: T[], after: T[]): T[] {
  return [
    ...new Map([...before, ...after].map((row) => [row._id, row])).values(),
  ];
}
export async function importLocalBackup(input: unknown): Promise<void> {
  const backup = normalizePortableBackup(input);
  const before = await demoBackupSnapshot();
  const now = new Date().toISOString();
  const binders = backup.binders.map((binder) => ({
    ...binder,
    id: binder.id!,
    color: `#${binder.colorHex}`,
    createdAt: now,
    updatedAt: now,
    cards: binder.cards.map((owned, index) => ({
      id: owned.id!,
      cardId: owned.card.id,
      name: owned.card.name,
      tcg: owned.card.tcg,
      setCode: owned.card.setCode ?? "",
      setName: owned.card.setName ?? "",
      rarity: owned.card.rarity ?? "",
      condition: owned.condition ?? "",
      price: owned.price ?? 0,
      quantity: owned.quantity,
      addedAt: now,
      cardData: { ...owned.card, externalId: owned.card.id },
      copies: Array.from({ length: owned.quantity }, (_, i) => ({
        ...owned.details,
        id: i === 0 ? owned.id! : `${owned.id}:${i}`,
        condition: owned.condition,
        price: owned.price,
        acquisitionPrice: owned.acquisitionPrice,
        tags: owned.details.tags ?? [],
      })),
    })),
  })) as unknown as DemoBinder[];
  const lists = backup.wishlists.map((list) => ({
    ...list,
    id: list.id!,
    description: list.description ?? "",
    color: `#${list.colorHex}`,
    createdAt: now,
    rules: list.rules.map((rule, i) => ({
      ...rule,
      id: rule.id ?? `${list.id}:rule:${i}`,
      createdAt: rule.createdAt ?? now,
      updatedAt: now,
    })),
    cards: list.cards.map((item, i) => ({
      id: item.id ?? `${list.id}:${i}`,
      cardId: item.card.id,
      name: item.card.name,
      tcg: item.card.tcg,
      setCode: item.card.setCode ?? "",
      setName: item.card.setName ?? "",
      rarity: item.card.rarity ?? "",
      desiredQuantity: item.desiredQuantity,
      addedAt: now,
      cardData: { ...item.card, externalId: item.card.id, notes: item.notes },
    })),
  })) as unknown as DemoWishlist[];
  const imported = toPortableRows(binders);
  const wanted = toWishlistRows(lists);
  wanted.wishlists = wanted.wishlists.map((row) => ({
    ...row,
    matchAnyPrinting:
      backup.wishlists.find((list) => list.id === row._id)?.matchAnyPrinting ??
      false,
  }));
  const sealed = toSealedRows(
    backup.sealedInventory.map((item) => ({
      id: item.id!,
      name: item.productName,
      tcg: String(item.product?.tcg ?? "pokemon"),
      type: String(item.product?.productType ?? "other"),
      quantity: item.quantity,
      purchasePrice: item.purchasePrice ?? 0,
      currentValue: item.purchasePrice ?? 0,
      purchaseDate: item.purchaseDate ?? now,
      set: String(item.product?.setCode ?? ""),
    })),
  );
  const patch: Partial<PersistedDemoState> = {
    ...restoreWebSections(backup.sections.web, before),
    preferences: {
      ...useDemoStore.getState().preferences,
      ...updatePreferencesSchema.parse(backup.sections.preferences ?? {}),
    },
    initialized: true,
    portableSections: { ...before.portableSections, ...backup.sections },
    collectionRows: {
      binders: mergeRows(
        before.collectionRows?.binders ?? [],
        imported.binders,
      ),
      cards: mergeRows(before.collectionRows?.cards ?? [], imported.cards),
      collectionEntries: mergeRows(
        before.collectionRows?.collectionEntries ?? [],
        imported.collectionEntries,
      ),
    },
    wishlistRows: {
      wishlists: mergeRows(
        before.wishlistRows?.wishlists ?? [],
        wanted.wishlists,
      ),
      wishlistCards: mergeRows(
        before.wishlistRows?.wishlistCards ?? [],
        wanted.wishlistCards,
      ),
      wishlistRules: mergeRows(
        before.wishlistRows?.wishlistRules ?? [],
        wanted.wishlistRules,
      ),
    },
    sealedRows: {
      sealedInventory: mergeRows(
        before.sealedRows?.sealedInventory ?? [],
        sealed.sealedInventory,
      ),
    },
  };
  await commitDemoBackup(patch, true, before);
}
