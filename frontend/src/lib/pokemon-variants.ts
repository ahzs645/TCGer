import type { Card } from "@/types/card";

export interface PokemonFinishOption {
  code: string;
  label: string;
}

export const POKEMON_FINISH_CATALOG: PokemonFinishOption[] = [
  ["normal", "Non-Holo"],
  ["holo", "Holofoil"],
  ["reverse", "Reverse Holofoil"],
  ["cosmos", "Cosmos Holofoil"],
  ["crackedIce", "Cracked Ice Holofoil"],
  ["confetti", "Confetti Holofoil"],
  ["crosshatch", "Crosshatch Holofoil"],
  ["mirror", "Mirror Holofoil"],
  ["waterWeb", "Water Web Holofoil"],
  ["galaxy", "Galaxy Holofoil"],
  ["star", "Star Holofoil"],
  ["stardust", "Stardust Holofoil"],
  ["rainbow", "Rainbow Holofoil"],
  ["shattered", "Shattered Holofoil"],
  ["sunPillar", "Sun Pillar Holofoil"],
  ["line", "Line Holofoil"],
  ["vertical", "Vertical Holofoil"],
  ["dot", "Dot Holofoil"],
  ["pixel", "Pixel Holofoil"],
  ["parallel", "Parallel Holofoil"],
  ["pokeball", "Poké Ball Holofoil"],
  ["masterball", "Master Ball Holofoil"],
  ["etched", "Etched Foil"],
  ["textured", "Textured Holofoil"],
  ["glitter", "Glitter Holofoil"],
].map(([code, label]) => ({ code, label }));

type RichPokemonPrint = NonNullable<Card["pokemonPrint"]> & {
  finishOptions?: PokemonFinishOption[];
};

const KNOWN_FINISH_LABELS: Record<string, string> = {
  normal: "Non-Holo",
  nonholo: "Non-Holo",
  holo: "Holofoil",
  holofoil: "Holofoil",
  reverse: "Reverse Holofoil",
  reverseholo: "Reverse Holofoil",
  firstedition: "1st Edition",
  cosmos: "Cosmos Holofoil",
  crackedice: "Cracked Ice Holofoil",
  confetti: "Confetti Holofoil",
  crosshatch: "Crosshatch Holofoil",
  mirror: "Mirror Holofoil",
  waterweb: "Water Web Holofoil",
  galaxy: "Galaxy Holofoil",
  galaxycosmos: "Galaxy/Cosmos Holofoil",
  star: "Star Holofoil",
  stardust: "Stardust Holofoil",
  rainbow: "Rainbow Holofoil",
  shattered: "Shattered Holofoil",
  sunpillar: "Sun Pillar Holofoil",
  line: "Line Holofoil",
  vertical: "Vertical Holofoil",
  dot: "Dot Holofoil",
  pixel: "Pixel Holofoil",
  parallel: "Parallel Holofoil",
  pokeball: "Poké Ball Holofoil",
  masterball: "Master Ball Holofoil",
  etched: "Etched Foil",
  textured: "Textured Holofoil",
  glitter: "Glitter Holofoil",
  foil: "Foil",
};

const normalizeFinishKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

export function formatFinishLabel(
  code: string,
  suppliedLabel?: string,
): string {
  if (suppliedLabel?.trim()) {
    return suppliedLabel.trim();
  }
  const known = KNOWN_FINISH_LABELS[normalizeFinishKey(code)];
  if (known) {
    return known;
  }
  return code
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getPokemonFinishOptions(
  card: Pick<Card, "pokemonPrint">,
  includeCatalog = false,
): PokemonFinishOption[] {
  const pokemonPrint = card.pokemonPrint as RichPokemonPrint | undefined;
  const options = new Map<string, PokemonFinishOption>();

  for (const option of pokemonPrint?.finishOptions ?? []) {
    if (!option?.code?.trim()) continue;
    const code = option.code.trim();
    options.set(normalizeFinishKey(code), {
      code,
      label: formatFinishLabel(code, option.label),
    });
  }

  for (const finish of pokemonPrint?.finishes ?? []) {
    const code = String(finish).trim();
    if (!code) continue;
    const key = normalizeFinishKey(code);
    if (!options.has(key)) {
      options.set(key, { code, label: formatFinishLabel(code) });
    }
  }

  const variants = pokemonPrint?.variants;
  if (variants) {
    const legacyOptions: Array<[keyof typeof variants, string]> = [
      ["normal", "normal"],
      ["reverse", "reverse"],
      ["holo", "holo"],
    ];
    for (const [flag, code] of legacyOptions) {
      if (!variants[flag]) continue;
      const key = normalizeFinishKey(code);
      if (!options.has(key)) {
        options.set(key, { code, label: formatFinishLabel(code) });
      }
    }
  }

  if (includeCatalog) {
    for (const finish of POKEMON_FINISH_CATALOG) {
      const key = normalizeFinishKey(finish.code);
      if (!options.has(key)) {
        options.set(key, finish);
      }
    }
  }

  return [...options.values()];
}

export function isFoilFinish(code?: string | null): boolean {
  if (!code) return false;
  const key = normalizeFinishKey(code);
  return key !== "normal" && key !== "nonholo" && key !== "firstedition";
}

export function getCopyVariantBadges(copy: {
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isFoil?: boolean;
  isSealedPromo?: boolean;
  isOversized?: boolean;
  isPeelOff?: boolean;
}): string[] {
  const badges: string[] = [];
  if (copy.finishCode || copy.finishLabel) {
    badges.push(
      formatFinishLabel(
        copy.finishCode ?? copy.finishLabel ?? "",
        copy.finishLabel,
      ),
    );
  } else if (copy.isFoil) {
    badges.push("Foil");
  }
  if (copy.edition) badges.push(copy.edition);
  if (copy.stamp) badges.push(`${copy.stamp} stamp`);
  if (copy.isSealedPromo) badges.push("Sealed promo");
  if (copy.isOversized) badges.push("Oversized");
  if (copy.isPeelOff) badges.push("Peel-off");
  return badges;
}
