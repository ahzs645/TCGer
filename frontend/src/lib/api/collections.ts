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

// Re-export shared types with frontend naming convention
export type { CollectionTag, CollectionCardCopy, CollectionCard, CollectionTagResponse, CreateTagInput } from '@tcg/api-types';

// Frontend uses "Collection" terminology; backend uses "Binder"
export type Collection = Binder;
export type CreateCollectionInput = CreateBinderInput;
export type UpdateCollectionInput = UpdateBinderInput;
export type AddCardToCollectionInput = AddCardInput;
export type UpdateCollectionCardInput = UpdateCardInput;

import { isDemoMode } from '@/lib/demo-mode';
import * as demo from './demo-adapter';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export const LIBRARY_COLLECTION_ID = '__library__';

export async function getCollections(token: string): Promise<Collection[]> {
  if (isDemoMode()) return demo.demoGetCollections();
  const response = await fetch(`${API_BASE_URL}/collections`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch collections');
  }

  return response.json();
}

export async function createCollection(
  token: string,
  data: CreateCollectionInput
): Promise<Collection> {
  if (isDemoMode()) return demo.demoCreateCollection(data);
  const response = await fetch(`${API_BASE_URL}/collections`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
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
  data: UpdateCollectionInput
): Promise<Collection> {
  if (isDemoMode()) return demo.demoUpdateCollection(collectionId, data);
  const response = await fetch(`${API_BASE_URL}/collections/${collectionId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
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
  collectionId: string
): Promise<void> {
  if (isDemoMode()) return demo.demoDeleteCollection(collectionId);
  const response = await fetch(`${API_BASE_URL}/collections/${collectionId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to delete collection');
  }
}

export async function addCardToCollection(
  token: string,
  collectionId: string,
  data: AddCardToCollectionInput
): Promise<void> {
  if (isDemoMode()) return demo.demoAddCardToCollection(collectionId, data);
  if (collectionId === LIBRARY_COLLECTION_ID) {
    const response = await fetch(`${API_BASE_URL}/collections/cards`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to add card to collection');
    }
    await response.json().catch(() => null);
    return;
  }

  const response = await fetch(`${API_BASE_URL}/collections/${collectionId}/cards`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
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
  cardId: string
): Promise<void> {
  if (isDemoMode()) return demo.demoRemoveCardFromCollection(collectionId, cardId);
  const response = await fetch(
    `${API_BASE_URL}/collections/${collectionId}/cards/${cardId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
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
  data: UpdateCollectionCardInput
): Promise<CollectionCard> {
  if (isDemoMode()) return demo.demoUpdateCollectionCard(binderId, cardId, data);
  const response = await fetch(`${API_BASE_URL}/collections/${binderId}/cards/${cardId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update card in collection');
  }

  return response.json();
}

export async function getTags(token: string): Promise<CollectionTagResponse[]> {
  if (isDemoMode()) return demo.demoGetTags();
  const response = await fetch(`${API_BASE_URL}/collections/tags`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch tags');
  }

  return response.json();
}

export async function createTag(token: string, data: CreateTagInput): Promise<CollectionTagResponse> {
  if (isDemoMode()) return demo.demoCreateTag(data);
  const response = await fetch(`${API_BASE_URL}/collections/tags`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to create tag');
  }

  return response.json();
}
