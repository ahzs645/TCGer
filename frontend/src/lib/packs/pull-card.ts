import type { CardDataPayload } from "@tcg/api-types";
import type { PackOpeningPull } from "@tcg/pack-core/experience";

/**
 * Projects a pack pull onto the card payload the collection and wishlist
 * endpoints expect, so a pull can be saved without a catalog round trip.
 */
export function pullCardData(pull: PackOpeningPull): CardDataPayload {
  return {
    externalId: pull.cardId,
    name: pull.name,
    tcg: pull.tcg as CardDataPayload["tcg"],
    setCode: pull.setCode,
    setName: pull.setName,
    rarity: pull.rarity,
    collectorNumber: pull.collectorNumber,
    imageUrl: pull.imageUrl,
    imageUrlSmall: pull.imageUrlSmall,
  };
}
