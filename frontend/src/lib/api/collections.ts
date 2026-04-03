import type {
  CollectionTag,
  CollectionCardCopy,
  CollectionCard,
  Binder,
  CreateBinderInput,
  UpdateBinderInput,
  AddCardInput,
  UpdateCardInput,
  CollectionTagResponse,
  CreateTagInput
} from '@tcg/api-types';
import { API_BASE_URL } from './base-url';
import { resolvePublicConvexSiteOrigin } from '@/lib/utils';

export interface CollectionsViewerContext {
  id: string;
  email: string;
  username?: string | null;
}

// Re-export shared types with frontend naming convention
export type { CollectionTag, CollectionCardCopy, CollectionCard, CollectionTagResponse, CreateTagInput } from '@tcg/api-types';

// Frontend uses "Collection" terminology; backend uses "Binder"
export type Collection = Binder;
export type CreateCollectionInput = CreateBinderInput;
export type UpdateCollectionInput = UpdateBinderInput;
export type AddCardToCollectionInput = AddCardInput;
export type UpdateCollectionCardInput = UpdateCardInput;

export const LIBRARY_COLLECTION_ID = '__library__';
export const COLLECTIONS_BACKEND = process.env.NEXT_PUBLIC_COLLECTIONS_BACKEND ?? 'rest';
export const isConvexCollectionsBackend = COLLECTIONS_BACKEND === 'convex';

const CONVEX_COLLECTIONS_ORIGIN =
  process.env.NEXT_PUBLIC_CONVEX_COLLECTIONS_ORIGIN?.replace(/\/+$/, '') ??
  (typeof window !== 'undefined' ? resolvePublicConvexSiteOrigin() : '');

function getCollectionsBaseUrl() {
  if (!isConvexCollectionsBackend) {
    return API_BASE_URL;
  }
  if (!CONVEX_COLLECTIONS_ORIGIN) {
    throw new Error('NEXT_PUBLIC_CONVEX_COLLECTIONS_ORIGIN must be set when using the Convex collections backend');
  }
  return CONVEX_COLLECTIONS_ORIGIN;
}

function buildHeaders(
  token: string,
  viewer?: CollectionsViewerContext | null,
  includeJson = true
): HeadersInit {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`
  };

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  if (isConvexCollectionsBackend) {
    if (!viewer?.id) {
      throw new Error('Authenticated viewer context is required for the Convex collections bridge');
    }
    headers['X-TCGER-User-Id'] = viewer.id;
    if (viewer.email) {
      headers['X-TCGER-User-Email'] = viewer.email;
    }
    if (viewer.username) {
      headers['X-TCGER-Username'] = viewer.username;
    }
  }

  return headers;
}

export async function getCollections(token: string, viewer?: CollectionsViewerContext | null): Promise<Collection[]> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections`, {
    headers: buildHeaders(token, viewer)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch collections');
  }

  return response.json();
}

export async function createCollection(
  token: string,
  data: CreateCollectionInput,
  viewer?: CollectionsViewerContext | null
): Promise<Collection> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections`, {
    method: 'POST',
    headers: buildHeaders(token, viewer),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to create collection');
  }

  return response.json();
}

export async function updateCollection(
  token: string,
  collectionId: string,
  data: UpdateCollectionInput,
  viewer?: CollectionsViewerContext | null
): Promise<Collection> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections/${collectionId}`, {
    method: 'PATCH',
    headers: buildHeaders(token, viewer),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update collection');
  }

  return response.json();
}

export async function deleteCollection(
  token: string,
  collectionId: string,
  viewer?: CollectionsViewerContext | null
): Promise<void> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections/${collectionId}`, {
    method: 'DELETE',
    headers: buildHeaders(token, viewer, false)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to delete collection');
  }
}

export async function addCardToCollection(
  token: string,
  collectionId: string,
  data: AddCardToCollectionInput,
  viewer?: CollectionsViewerContext | null
): Promise<void> {
  if (collectionId === LIBRARY_COLLECTION_ID) {
    const response = await fetch(`${getCollectionsBaseUrl()}/collections/cards`, {
      method: 'POST',
      headers: buildHeaders(token, viewer),
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to add card to collection');
    }
    await response.json().catch(() => null);
    return;
  }

  const response = await fetch(`${getCollectionsBaseUrl()}/collections/${collectionId}/cards`, {
    method: 'POST',
    headers: buildHeaders(token, viewer),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to add card to collection');
  }
  await response.json().catch(() => null);
}

export async function removeCardFromCollection(
  token: string,
  collectionId: string,
  cardId: string,
  viewer?: CollectionsViewerContext | null
): Promise<void> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/${collectionId}/cards/${cardId}`,
    {
      method: 'DELETE',
      headers: buildHeaders(token, viewer, false)
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to remove card from collection');
  }
}

export async function updateCollectionCard(
  token: string,
  binderId: string,
  cardId: string,
  data: UpdateCollectionCardInput,
  viewer?: CollectionsViewerContext | null
): Promise<CollectionCard> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections/${binderId}/cards/${cardId}`, {
    method: 'PATCH',
    headers: buildHeaders(token, viewer),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update card in collection');
  }

  return response.json();
}

export async function getTags(token: string, viewer?: CollectionsViewerContext | null): Promise<CollectionTagResponse[]> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections/tags`, {
    headers: buildHeaders(token, viewer)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch tags');
  }

  return response.json();
}

export async function createTag(
  token: string,
  data: CreateTagInput,
  viewer?: CollectionsViewerContext | null
): Promise<CollectionTagResponse> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections/tags`, {
    method: 'POST',
    headers: buildHeaders(token, viewer),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to create tag');
  }

  return response.json();
}
