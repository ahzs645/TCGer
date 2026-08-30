import type {
  CollectionCard,
  YugiohBanlistEntry,
  YugiohBanlistSnapshot,
} from "@tcg/api-types";
import { normalizeYugiohCardName } from "@tcg/api-types";

export interface YugiohBanlistIndex {
  byExternalId: ReadonlyMap<string, YugiohBanlistEntry>;
  byName: ReadonlyMap<string, YugiohBanlistEntry>;
}

export function indexYugiohBanlist(
  snapshot: YugiohBanlistSnapshot | null | undefined,
): YugiohBanlistIndex {
  const byExternalId = new Map<string, YugiohBanlistEntry>();
  const byName = new Map<string, YugiohBanlistEntry>();
  for (const entry of snapshot?.entries ?? []) {
    if (entry.externalId) byExternalId.set(entry.externalId, entry);
    byName.set(entry.normalizedName, entry);
  }
  return { byExternalId, byName };
}

export function banlistEntryForCollectionCard(
  card: CollectionCard,
  index: YugiohBanlistIndex,
): YugiohBanlistEntry | undefined {
  if (card.tcg !== "yugioh") return undefined;
  for (const id of [card.baseExternalId, card.externalId, card.cardId]) {
    if (id && index.byExternalId.has(id)) return index.byExternalId.get(id);
  }
  return index.byName.get(normalizeYugiohCardName(card.name));
}
