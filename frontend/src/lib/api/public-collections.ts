import { API_BASE_URL } from "./base-url";

export interface PublicCollectionCard {
  name: string;
  tcg: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  quantity: number;
  condition?: string;
}

export interface PublicCollection {
  name: string;
  description?: string;
  owner: string;
  cardCount: number;
  cards: PublicCollectionCard[];
}

export async function getPublicCollection(
  shareToken: string,
): Promise<PublicCollection> {
  const response = await fetch(
    `${API_BASE_URL}/public/collections/${encodeURIComponent(shareToken)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "This shared binder is private or no longer exists."
        : "Failed to load shared binder.",
    );
  }
  return response.json();
}
