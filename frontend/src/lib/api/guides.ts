import type {
  CollectionGuideItemResponse,
  CollectionGuideResponse,
  FollowCollectionGuideInput,
  FollowCollectionGuideResponse,
  GuideCardSearchQuery,
  GuideCardSearchResponse,
} from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || fallback);
  }
  return response.json() as Promise<T>;
}

export async function getCollectionGuides(
  token: string,
): Promise<CollectionGuideResponse[]> {
  const response = await fetch(`${API_BASE_URL}/guides`, {
    headers: headers(token),
    credentials: "include",
  });
  return readJson(response, "Failed to load collection guides");
}

export async function followCollectionGuide(
  token: string,
  slug: string,
  input: FollowCollectionGuideInput = {},
): Promise<FollowCollectionGuideResponse> {
  const response = await fetch(
    `${API_BASE_URL}/guides/${encodeURIComponent(slug)}/follow`,
    {
      method: "POST",
      headers: headers(token),
      credentials: "include",
      body: JSON.stringify(input),
    },
  );
  return readJson(response, "Failed to follow collection guide");
}

export async function getCollectionGuideItems(
  token: string,
  slug: string,
): Promise<CollectionGuideItemResponse[]> {
  const response = await fetch(
    `${API_BASE_URL}/guides/${encodeURIComponent(slug)}/items`,
    {
      headers: headers(token),
      credentials: "include",
    },
  );
  return readJson(response, "Failed to load collection guide cards");
}

export async function searchCollectionGuideCards(
  token: string,
  query: Partial<GuideCardSearchQuery> = {},
): Promise<GuideCardSearchResponse> {
  const params = new URLSearchParams();
  if (query.query) params.set("query", query.query);
  if (query.tcg) params.set("tcg", query.tcg);
  if (query.guide) params.set("guide", query.guide);
  if (query.category) params.set("category", query.category);
  if (query.ownership && query.ownership !== "all") {
    params.set("ownership", query.ownership);
  }
  if (query.set) params.set("set", query.set);
  if (query.artist) params.set("artist", query.artist);
  if (query.rarity) params.set("rarity", query.rarity);
  if (query.limit) params.set("limit", String(query.limit));
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/guides/cards${suffix}`, {
    headers: headers(token),
    credentials: "include",
  });
  return readJson(response, "Failed to search collection guide cards");
}
