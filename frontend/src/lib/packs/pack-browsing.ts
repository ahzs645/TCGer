import type {
  PackOpeningNativeCardPool,
  PackOpeningNativePackOption,
  PackOpeningPull,
} from "@tcg/pack-core/experience";

export type PackSetAvailabilityFilter = "all" | "downloaded" | "notDownloaded";

export interface PackSetGroup {
  id: string;
  label: string;
  packPoolID: string;
  options: PackOpeningNativePackOption[];
}

export function groupPackOptions(
  options: readonly PackOpeningNativePackOption[],
): PackSetGroup[] {
  const groups = new Map<string, PackSetGroup>();
  for (const option of options) {
    const group = groups.get(option.setID);
    if (group) {
      group.options.push(option);
    } else {
      groups.set(option.setID, {
        id: option.setID,
        label: option.setLabel,
        packPoolID: option.packPoolID,
        options: [option],
      });
    }
  }
  return [...groups.values()];
}

export function filterPackSets(
  groups: readonly PackSetGroup[],
  options: {
    query: string;
    availability: PackSetAvailabilityFilter;
    isDownloaded: (setID: string) => boolean;
    canOpen: (setID: string) => boolean;
  },
): PackSetGroup[] {
  const query = options.query.trim().toLocaleLowerCase();
  return groups.filter((group) => {
    if (!options.canOpen(group.id)) return false;
    const downloaded = options.isDownloaded(group.id);
    if (options.availability === "downloaded" && !downloaded) return false;
    if (options.availability === "notDownloaded" && downloaded) return false;
    if (!query) return true;
    return (
      group.label.toLocaleLowerCase().includes(query) ||
      group.options.some((option) =>
        option.variationLabel.toLocaleLowerCase().includes(query),
      )
    );
  });
}

export function possiblePullRarities(
  pool: PackOpeningNativeCardPool | undefined,
): string[] {
  return [...new Set((pool?.cards ?? []).map((card) => card.rarity))].sort(
    (left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

function tierRank(tier: PackOpeningPull["tier"]): number {
  return { common: 1, uncommon: 2, rare: 3, ultra: 4, chase: 5 }[tier];
}

export function filterPossiblePulls(
  pool: PackOpeningNativeCardPool | undefined,
  query: string,
  rarity: string | null,
): PackOpeningPull[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return [...(pool?.cards ?? [])]
    .filter((card) => {
      const matchesRarity =
        rarity === null ||
        card.rarity.localeCompare(rarity, undefined, {
          sensitivity: "base",
        }) === 0;
      if (!matchesRarity) return false;
      if (!normalizedQuery) return true;
      return [card.name, card.rarity, card.collectorNumber].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    })
    .sort(
      (left, right) =>
        tierRank(right.tier) - tierRank(left.tier) ||
        left.name.localeCompare(right.name),
    );
}
