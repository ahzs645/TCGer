import type {
  CreateWishlistInput,
  UpdateWishlistInput,
  AddWishlistCardInput,
  WishlistResponse,
  WishlistCardResponse
} from '@tcg/api-types';

export type { WishlistResponse, WishlistCardResponse, CreateWishlistInput, UpdateWishlistInput, AddWishlistCardInput };

import { isDemoMode } from '@/lib/demo-mode';
import * as demo from './demo-adapter';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function getWishlists(token: string): Promise<WishlistResponse[]> {
  if (isDemoMode()) return demo.demoGetWishlists();
  const response = await fetch(`${API_BASE_URL}/wishlists`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch wishlists');
  }

  return response.json();
}

export async function getWishlist(token: string, wishlistId: string): Promise<WishlistResponse> {
  if (isDemoMode()) return demo.demoGetWishlist(wishlistId);
  const response = await fetch(`${API_BASE_URL}/wishlists/${wishlistId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch wishlist');
  }

  return response.json();
}

export async function createWishlist(
  token: string,
  data: CreateWishlistInput
): Promise<WishlistResponse> {
  if (isDemoMode()) return demo.demoCreateWishlist(data);
  const response = await fetch(`${API_BASE_URL}/wishlists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to create wishlist');
  }

  return response.json();
}

export async function updateWishlist(
  token: string,
  wishlistId: string,
  data: UpdateWishlistInput
): Promise<WishlistResponse> {
  if (isDemoMode()) return demo.demoUpdateWishlist(wishlistId, data);
  const response = await fetch(`${API_BASE_URL}/wishlists/${wishlistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update wishlist');
  }

  return response.json();
}

export async function deleteWishlist(
  token: string,
  wishlistId: string
): Promise<void> {
  if (isDemoMode()) return demo.demoDeleteWishlist(wishlistId);
  const response = await fetch(`${API_BASE_URL}/wishlists/${wishlistId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to delete wishlist');
  }
}

export async function addCardToWishlist(
  token: string,
  wishlistId: string,
  data: AddWishlistCardInput
): Promise<WishlistCardResponse> {
  if (isDemoMode()) return demo.demoAddCardToWishlist(wishlistId, data);
  const response = await fetch(`${API_BASE_URL}/wishlists/${wishlistId}/cards`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to add card to wishlist');
  }

  return response.json();
}

export async function removeCardFromWishlist(
  token: string,
  wishlistId: string,
  cardId: string
): Promise<void> {
  if (isDemoMode()) return demo.demoRemoveCardFromWishlist(wishlistId, cardId);
  const response = await fetch(
    `${API_BASE_URL}/wishlists/${wishlistId}/cards/${cardId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to remove card from wishlist');
  }
}
