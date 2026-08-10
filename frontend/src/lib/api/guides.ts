import type {
  CollectionGuideResponse,
  FollowCollectionGuideInput,
  FollowCollectionGuideResponse,
} from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
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

