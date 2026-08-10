import { z } from "zod";
import { tcgCodeSchema, type TcgCode } from "./cards";
import { wishlistRuleTypeSchema, type WishlistRuleType } from "./wishlists";

export const guideCategorySchema = z.enum([
  "art-style",
  "artist",
  "species",
  "story",
  "cameo",
  "custom",
]);
export type GuideCategory = z.infer<typeof guideCategorySchema>;

export interface CollectionGuideRule {
  type: WishlistRuleType;
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

export const followCollectionGuideSchema = z.object({
  wishlistName: z.string().trim().min(1).optional(),
});
export type FollowCollectionGuideInput = z.infer<
  typeof followCollectionGuideSchema
>;
