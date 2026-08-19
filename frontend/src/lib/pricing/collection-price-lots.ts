import type { CollectionCard, CollectionCardCopy } from "@tcg/api-types";

export interface CollectionPriceLot {
  finishCode?: string;
  finishLabel?: string;
  quantity: number;
  storedPrice?: number;
}

function normalizedFinish(copy: CollectionCardCopy): string | undefined {
  const explicit = copy.finishCode?.trim();
  if (explicit) return explicit;
  return copy.isFoil ? "foil" : undefined;
}

function finishLabel(
  code: string | undefined,
  explicit?: string,
): string | undefined {
  const label = explicit?.trim();
  if (label) return label;
  if (!code) return undefined;
  if (
    [
      "normal",
      "regular",
      "nonfoil",
      "non-foil",
      "nonholo",
      "non-holo",
    ].includes(code.toLowerCase())
  ) {
    return "Non-Foil";
  }
  if (code.toLowerCase().includes("etched")) return "Etched Foil";
  if (
    code.toLowerCase().includes("foil") ||
    code.toLowerCase().includes("holo")
  )
    return "Foil";
  return code
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function collectionPriceLots(
  card: CollectionCard,
): CollectionPriceLot[] {
  const lots = new Map<
    string,
    CollectionPriceLot & { pricedTotal: number; pricedCount: number }
  >();

  const append = (
    finishCode: string | undefined,
    label: string | undefined,
    quantity: number,
    price: number | undefined,
  ) => {
    const normalizedCode = finishCode?.trim() || undefined;
    const key = normalizedCode?.toLowerCase() ?? "";
    const existing = lots.get(key) ?? {
      finishCode: normalizedCode,
      finishLabel: finishLabel(normalizedCode, label),
      quantity: 0,
      pricedTotal: 0,
      pricedCount: 0,
    };
    existing.quantity += quantity;
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) {
      existing.pricedTotal += price * quantity;
      existing.pricedCount += quantity;
    }
    lots.set(key, existing);
  };

  for (const copy of card.copies) {
    append(
      normalizedFinish(copy),
      copy.finishLabel,
      1,
      copy.price ?? card.price,
    );
  }

  const unrepresentedQuantity = Math.max(0, card.quantity - card.copies.length);
  if (unrepresentedQuantity > 0 || card.copies.length === 0) {
    append(
      undefined,
      undefined,
      unrepresentedQuantity || card.quantity,
      card.price,
    );
  }

  return Array.from(lots.values()).map(
    ({ pricedTotal, pricedCount, ...lot }) => ({
      ...lot,
      storedPrice: pricedCount > 0 ? pricedTotal / pricedCount : undefined,
    }),
  );
}

export function trackedPriceLookupKey(
  tcg: string,
  externalId: string,
  finishCode?: string,
): string {
  return `${tcg.trim().toLowerCase()}:${externalId.trim().toLowerCase()}:${finishCode?.trim().toLowerCase() ?? ""}`;
}
