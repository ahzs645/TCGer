import { z } from "zod";
import { tcgCodeSchema, type Card, type TcgCode } from "./cards";
import { wishlistRuleTypeSchema } from "./wishlists";

export const guideCategorySchema = z.enum([
  "art-style",
  "artist",
  "species",
  "story",
  "cameo",
  "custom",
]);
export type GuideCategory = z.infer<typeof guideCategorySchema>;

export const collectionGuideRuleTypeSchema = z.union([
  wishlistRuleTypeSchema,
  z.literal("manual"),
]);
export type CollectionGuideRuleType = z.infer<
  typeof collectionGuideRuleTypeSchema
>;

export interface CollectionGuideRule {
  type: CollectionGuideRuleType;
  tcg: TcgCode;
  query?: string;
  setCode?: string;
  setName?: string;
  includeAllPrintings: boolean;
}

export interface CollectionGuideResponse {
  id: string;
  slug: string;
  title: string;
  description: string;
  tcg: TcgCode;
  category: GuideCategory;
  coverImageUrl?: string;
  curatorName: string;
  tags: string[];
  version: number;
  featured: boolean;
  rule: CollectionGuideRule;
  cardCountHint?: number;
  followed: boolean;
  wishlistId?: string;
}

export interface FollowCollectionGuideResponse {
  guide: CollectionGuideResponse;
  wishlistId: string;
  created: boolean;
}

export interface CollectionGuideItemResponse {
  id: string;
  guideId: string;
  tcg: TcgCode;
  externalId: string;
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  artist?: string;
  variant?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  groupKey?: string;
  groupLabel?: string;
  groupOrder?: number;
  position: number;
  note?: string;
  provenanceUrl?: string;
}

export interface GuideCardMembership {
  guideId: string;
  slug: string;
  title: string;
  category: GuideCategory;
  tags: string[];
  groupKey?: string;
  groupLabel?: string;
  groupOrder?: number;
  position?: number;
}

export interface GuideCardSearchResult {
  card: Card;
  owned: boolean;
  ownedQuantity: number;
  matchedGuides: GuideCardMembership[];
}

export interface GuideCardSearchResponse {
  results: GuideCardSearchResult[];
  total: number;
  failedGuideSlugs: string[];
}

export const guideCardSearchQuerySchema = z.object({
  query: z.string().trim().optional().default(""),
  tcg: tcgCodeSchema.optional(),
  guide: z.string().trim().min(1).optional(),
  category: guideCategorySchema.optional(),
  ownership: z.enum(["all", "owned", "missing"]).optional().default("all"),
  set: z.string().trim().min(1).optional(),
  artist: z.string().trim().min(1).optional(),
  rarity: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(500),
});
export type GuideCardSearchQuery = z.infer<
  typeof guideCardSearchQuerySchema
>;

export const followCollectionGuideSchema = z.object({
  wishlistName: z.string().trim().min(1).optional(),
});
export type FollowCollectionGuideInput = z.infer<
  typeof followCollectionGuideSchema
>;
