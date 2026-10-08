import type { SearchCardsResponse } from "@tcg/api-types";

/** Array-only workflows must not mistake an incomplete response for a full catalog. */
export function completeSearchCards(response: SearchCardsResponse) {
  if (response.failedProviders?.length) {
    throw new Error(`Card search is incomplete (${response.failedProviders.join(", ")}). Try again or select a single game.`);
  }
  return response.cards;
}
