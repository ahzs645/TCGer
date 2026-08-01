import {
  WISHLIST_CARD_BATCH_SIZE,
  type AddWishlistCardInput,
  type Card,
  type TcgCode,
  type WishlistRuleResponse,
} from "@tcg/api-types";

import { getSetCards, searchAllCards } from "@/lib/api/cards";
import { addCardsToWishlist, updateWishlistRule } from "@/lib/api/wishlists";

/**
 * Rule expansion runs on the client so it behaves the same against the Prisma
 * backend, the Convex backend, and the demo adapter: the server only stores
 * rules, the client turns them into cards.
 */

/** Snapshot of a provider card in the shape the wishlist API accepts. */
export function toWishlistCardInput(card: Card): AddWishlistCardInput {
  return {
    externalId: card.id,
    baseExternalId: card.baseExternalId,
    printingKey: card.printingKey,
    artworkId: card.artworkId,
    tcg: card.tcg,
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    imageUrlSmall: card.imageUrlSmall,
    setSymbolUrl: card.setSymbolUrl,
    setLogoUrl: card.setLogoUrl,
    collectorNumber: card.collectorNumber,
    releasedAt: card.releasedAt,
    regulationMark: card.regulationMark,
    language: card.language,
    supertype: card.supertype,
    formatLegality: card.formatLegality,
    dexEntries: card.dexEntries,
    region: card.region,
    pokemonPrint: card.pokemonPrint,
    attributes: card.attributes,
    provenance: card.provenance,
    legalityPeriods: card.legalityPeriods,
    evolution: card.evolution,
    functionalIdentity: card.functionalIdentity,
  };
}

export interface WishlistRuleQuery {
  type: "name" | "set";
  tcg?: TcgCode;
  query?: string;
  setCode?: string;
  includeAllPrintings?: boolean;
}

/** Resolves a rule into the cards it currently matches. */
export async function expandWishlistRule(
  token: string,
  rule: WishlistRuleQuery,
): Promise<Card[]> {
  if (rule.type === "set") {
    if (!rule.tcg || !rule.setCode) return [];
    return getSetCards(token, rule.tcg, rule.setCode);
  }
  if (!rule.query) return [];
  return searchAllCards(token, {
    query: rule.query,
    tcg: rule.tcg,
    unique: rule.includeAllPrintings === false ? "cards" : "prints",
  });
}

/**
 * Adds cards in batches the API will accept. Returns how many cards were sent;
 * the wishlist upserts, so re-adding an existing card is a no-op server-side.
 */
export async function addCardsInChunks(
  token: string,
  wishlistId: string,
  cards: Card[],
  onProgress?: (sent: number, total: number) => void,
): Promise<number> {
  let sent = 0;
  for (let index = 0; index < cards.length; index += WISHLIST_CARD_BATCH_SIZE) {
    const chunk = cards.slice(index, index + WISHLIST_CARD_BATCH_SIZE);
    await addCardsToWishlist(token, wishlistId, {
      cards: chunk.map(toWishlistCardInput),
    });
    sent += chunk.length;
    onProgress?.(sent, cards.length);
  }
  return sent;
}

export interface RuleSyncResult {
  ruleId: string;
  matched: number;
  error?: string;
}

export interface WishlistSyncResult {
  results: RuleSyncResult[];
  /** Cards the wishlist gained across every rule. */
  addedCards: number;
  errors: string[];
}

/**
 * Re-expands a wishlist's rules and merges the results back in. Cards that no
 * longer match are left alone — syncing only ever adds, so manual additions
 * and hand-curated entries survive.
 */
export async function syncWishlistRules(
  token: string,
  wishlist: { id: string; cards: Array<{ externalId: string; tcg: string }> },
  rules: WishlistRuleResponse[],
  options?: {
    /** Skip rules with autoSync off (the "Sync all" button). */
    autoOnly?: boolean;
    onProgress?: (message: string) => void;
  },
): Promise<WishlistSyncResult> {
  const applicable = options?.autoOnly
    ? rules.filter((rule) => rule.autoSync)
    : rules;
  const existing = new Set(
    wishlist.cards.map((card) => `${card.tcg}:${card.externalId}`),
  );

  const results: RuleSyncResult[] = [];
  const errors: string[] = [];
  let addedCards = 0;

  for (const rule of applicable) {
    try {
      options?.onProgress?.(
        rule.type === "set"
          ? `Loading ${rule.setName ?? rule.setCode}…`
          : `Searching for "${rule.query}"…`,
      );
      const matches = await expandWishlistRule(token, rule);
      const fresh = matches.filter(
        (card) => !existing.has(`${card.tcg}:${card.id}`),
      );

      if (fresh.length) {
        await addCardsInChunks(token, wishlist.id, fresh, (sent, total) =>
          options?.onProgress?.(`Adding ${sent} of ${total} cards…`),
        );
        fresh.forEach((card) => existing.add(`${card.tcg}:${card.id}`));
        addedCards += fresh.length;
      }

      results.push({ ruleId: rule.id, matched: matches.length });
      await updateWishlistRule(token, wishlist.id, rule.id, {
        lastSyncedAt: new Date().toISOString(),
        lastMatchCount: matches.length,
      }).catch(() => {
        // A failed bookkeeping write should not fail the sync itself.
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync rule";
      results.push({ ruleId: rule.id, matched: 0, error: message });
      errors.push(message);
    }
  }

  return { results, addedCards, errors };
}
