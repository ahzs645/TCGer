export type BanlistFormat = "tcg" | "traditional" | "ocg" | "goat";
export type BanlistStatus = "forbidden" | "limited" | "semi-limited";

export type ParsedBanlistEntry = {
  externalId?: string;
  cardName: string;
  normalizedName: string;
  status: BanlistStatus;
  limit: 0 | 1 | 2;
  remarks?: string;
};

const entities: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
};

function decodeHtml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const parsed = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeYugiohName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("en-US");
}

export function statusValue(value: string): BanlistStatus | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "forbidden" || normalized === "banned") return "forbidden";
  if (normalized === "limited") return "limited";
  if (normalized === "semi-limited" || normalized === "semi limited") return "semi-limited";
  return null;
}

function limitFor(status: BanlistStatus): 0 | 1 | 2 {
  if (status === "forbidden") return 0;
  if (status === "limited") return 1;
  return 2;
}

export function parseOfficialTcgBanlist(html: string) {
  const advanced: ParsedBanlistEntry[] = [];
  const traditional: ParsedBanlistEntry[] = [];
  for (const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) =>
      plainText(match[1] ?? ""),
    );
    if (cells.length < 4) continue;
    const cardName = cells[1]?.trim();
    if (!cardName || /^card name$/i.test(cardName)) continue;
    const remarks = cells[4]?.trim() || undefined;
    const advancedStatus = statusValue(cells[2] ?? "");
    const traditionalStatus = statusValue(cells[3] ?? "");
    if (advancedStatus) {
      advanced.push({
        cardName,
        normalizedName: normalizeYugiohName(cardName),
        status: advancedStatus,
        limit: limitFor(advancedStatus),
        remarks,
      });
    }
    if (traditionalStatus) {
      traditional.push({
        cardName,
        normalizedName: normalizeYugiohName(cardName),
        status: traditionalStatus,
        limit: limitFor(traditionalStatus),
        remarks,
      });
    }
  }
  return { advanced, traditional };
}

export function latestOfficialListUrl(html: string, landingUrl: string) {
  const links = [...html.matchAll(/href=["']([^"']*list_(\d{4}-\d{2}-\d{2})[^"']*)["']/gi)]
    .map((match) => ({ url: new URL(match[1]!, landingUrl).toString(), date: match[2]! }))
    .sort((left, right) => right.date.localeCompare(left.date));
  return links[0];
}

export function attachExternalIds(
  entries: ParsedBanlistEntry[],
  idsByNormalizedName: ReadonlyMap<string, string>,
): ParsedBanlistEntry[] {
  return entries.map((entry) => ({
    ...entry,
    externalId: idsByNormalizedName.get(entry.normalizedName),
  }));
}
