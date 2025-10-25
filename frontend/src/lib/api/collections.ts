const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export const LIBRARY_COLLECTION_ID = '__library__';

export interface CollectionCard {
  id: string;
  cardId: string;
  name: string;
  tcg: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  binderId?: string;
  binderName?: string;
  binderColorHex?: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  colorHex?: string;
  cards: CollectionCard[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCollectionInput {
  name: string;
  description?: string;
}

export interface UpdateCollectionInput {
  name?: string;
  description?: string;
}

export interface AddCardToCollectionInput {
  cardId: string;
  quantity?: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  cardData?: {
    name: string;
    tcg: string;
    externalId: string;
    setCode?: string;
    setName?: string;
    rarity?: string;
    imageUrl?: string;
    imageUrlSmall?: string;
  };
}

export interface UpdateCollectionCardInput {
  quantity?: number;
  condition?: string | null;
  language?: string | null;
  notes?: string | null;
  targetBinderId?: string;
}

export async function getCollections(token: string): Promise<Collection[]> {
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
