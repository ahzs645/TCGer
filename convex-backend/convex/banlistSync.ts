import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import {
  attachExternalIds,
  latestOfficialListUrl,
  normalizeYugiohName,
  parseOfficialTcgBanlist,
  statusValue,
  type BanlistFormat,
  type ParsedBanlistEntry,
} from "./lib/yugiohBanlist";

const OFFICIAL_LANDING = "https://www.yugioh-card.com/en/limited/";
const YGOPRO_CARDINFO = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const IDENTITY_SOURCE = "https://ygoprodeck.com/api-guide/";

type YgoCard = {
  id?: number;
  name?: string;
  banlist_info?: Record<string, string | undefined>;
};

type SyncRow = {
  format: BanlistFormat;
  snapshotId: Id<"banlistSnapshots">;
  entryCount: number;
  effectiveDate?: string;
  unchanged: boolean;
};

const syncRowValidator = v.object({
  format: v.union(v.literal("tcg"), v.literal("traditional"), v.literal("ocg"), v.literal("goat")),
  snapshotId: v.id("banlistSnapshots"),
  entryCount: v.number(),
  effectiveDate: v.optional(v.string()),
  unchanged: v.boolean(),
});

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "TCGer-banlist-sync/1.0 (+https://github.com/)" },
  });
  if (!response.ok) throw new ConvexError({ code: "UPSTREAM_ERROR", message: `${url} returned ${response.status}` });
  return await response.text();
}

async function ygoBanlist(name: "tcg" | "ocg" | "goat"): Promise<YgoCard[]> {
  const response = await fetch(`${YGOPRO_CARDINFO}?banlist=${name}`, {
    headers: { "User-Agent": "TCGer-banlist-sync/1.0 (+https://github.com/)" },
  });
  if (!response.ok) throw new ConvexError({ code: "UPSTREAM_ERROR", message: `YGOPRODeck ${name} returned ${response.status}` });
  const payload = (await response.json()) as { data?: YgoCard[] };
  return payload.data ?? [];
}

function providerEntries(cards: YgoCard[], key: string): ParsedBanlistEntry[] {
  return cards.flatMap((card) => {
    const status = statusValue(card.banlist_info?.[key] ?? "");
    if (!status || !card.name) return [];
    return [{
      externalId: card.id === undefined ? undefined : String(card.id),
      cardName: card.name,
      normalizedName: normalizeYugiohName(card.name),
      status,
      limit: status === "forbidden" ? 0 as const : status === "limited" ? 1 as const : 2 as const,
    }];
  });
}

function contentHash(entries: ParsedBanlistEntry[]) {
  const value = JSON.stringify([...entries].sort((left, right) =>
    left.normalizedName.localeCompare(right.normalizedName),
  ));
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const syncAll = internalAction({
  args: {},
  returns: v.array(syncRowValidator),
  handler: async (ctx): Promise<SyncRow[]> => {
    const landingHtml = await fetchText(OFFICIAL_LANDING);
    const latest = latestOfficialListUrl(landingHtml, OFFICIAL_LANDING);
    if (!latest) throw new ConvexError({ code: "UPSTREAM_ERROR", message: "Official banlist link was not found" });
    const [officialHtml, tcgCards, ocgCards, goatCards] = await Promise.all([
      fetchText(latest.url),
      ygoBanlist("tcg"),
      ygoBanlist("ocg"),
      ygoBanlist("goat"),
    ]);
    const official = parseOfficialTcgBanlist(officialHtml);
    if (!official.advanced.length || !official.traditional.length) {
      throw new ConvexError({ code: "UPSTREAM_ERROR", message: "Official banlist table could not be parsed" });
    }
    const ids = new Map(
      tcgCards.flatMap((card) => card.name && card.id !== undefined
        ? [[normalizeYugiohName(card.name), String(card.id)] as const]
        : []),
    );
    const sources: Array<{
      format: BanlistFormat;
      name: string;
      effectiveDate?: string;
      sourceUrl: string;
      identitySourceUrl?: string;
      entries: ParsedBanlistEntry[];
    }> = [
      { format: "tcg", name: "TCG Advanced", effectiveDate: latest.date, sourceUrl: latest.url, identitySourceUrl: IDENTITY_SOURCE, entries: attachExternalIds(official.advanced, ids) },
      { format: "traditional", name: "TCG Traditional", effectiveDate: latest.date, sourceUrl: latest.url, identitySourceUrl: IDENTITY_SOURCE, entries: attachExternalIds(official.traditional, ids) },
      { format: "ocg", name: "OCG", sourceUrl: `${YGOPRO_CARDINFO}?banlist=ocg`, identitySourceUrl: IDENTITY_SOURCE, entries: providerEntries(ocgCards, "ban_ocg") },
      { format: "goat", name: "Goat (April 2005)", effectiveDate: "2005-04-01", sourceUrl: `${YGOPRO_CARDINFO}?banlist=goat`, identitySourceUrl: IDENTITY_SOURCE, entries: providerEntries(goatCards, "ban_goat") },
    ];
    const results: SyncRow[] = [];
    for (const source of sources) {
      if (!source.entries.length) continue;
      const result: {
        snapshotId: Id<"banlistSnapshots">;
        entryCount: number;
        unchanged: boolean;
      } = await ctx.runMutation(internal.banlists.upsertSnapshot, {
        ...source,
        contentHash: contentHash(source.entries),
      });
      results.push({ format: source.format, effectiveDate: source.effectiveDate, ...result });
    }
    return results;
  },
});
