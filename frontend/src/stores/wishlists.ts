import { create } from 'zustand';
import * as wishlistsApi from '@/lib/api/wishlists';

export type { WishlistResponse, WishlistCardResponse } from '@/lib/api/wishlists';

export interface WishlistsState {
  wishlists: wishlistsApi.WishlistResponse[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchWishlists: (token: string) => Promise<void>;
  addWishlist: (token: string, input: wishlistsApi.CreateWishlistInput) => Promise<string>;
  updateWishlist: (token: string, id: string, input: wishlistsApi.UpdateWishlistInput) => Promise<void>;
  removeWishlist: (token: string, id: string) => Promise<void>;
  addCardToWishlist: (
    token: string,
    wishlistId: string,
    input: wishlistsApi.AddWishlistCardInput
  ) => Promise<void>;
  removeCardFromWishlist: (token: string, wishlistId: string, cardId: string) => Promise<void>;
}

export const useWishlistsStore = create<WishlistsState>()((set, get) => ({
  wishlists: [],
  isLoading: false,
  error: null,
  hasFetched: false,

  fetchWishlists: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      const wishlists = await wishlistsApi.getWishlists(token);
      set({ wishlists, isLoading: false, hasFetched: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch wishlists',
        isLoading: false,
        hasFetched: true
      });
    }
  },

  addWishlist: async (token: string, input: wishlistsApi.CreateWishlistInput) => {
    set({ isLoading: true, error: null });
    try {
      const newWishlist = await wishlistsApi.createWishlist(token, input);
      set((state) => ({
        wishlists: [...state.wishlists, newWishlist],
        isLoading: false,
        hasFetched: true
      }));
      return newWishlist.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create wishlist',
        isLoading: false,
        hasFetched: true
      });
      throw error;
    }
  },

  updateWishlist: async (token: string, id: string, input: wishlistsApi.UpdateWishlistInput) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await wishlistsApi.updateWishlist(token, id, input);
      set((state) => ({
        wishlists: state.wishlists.map((w) => (w.id === id ? updated : w)),
        isLoading: false,
        hasFetched: true
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update wishlist',
        isLoading: false,
        hasFetched: true
      });
      throw error;
    }
  },

  removeWishlist: async (token: string, id: string) => {
    set({ isLoading: true, error: null });
    try {
      await wishlistsApi.deleteWishlist(token, id);
      set((state) => ({
        wishlists: state.wishlists.filter((w) => w.id !== id),
        isLoading: false,
        hasFetched: true
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete wishlist',
        isLoading: false,
        hasFetched: true
      });
      throw error;
    }
  },

  addCardToWishlist: async (
    token: string,
    wishlistId: string,
    input: wishlistsApi.AddWishlistCardInput
  ) => {
    try {
      await wishlistsApi.addCardToWishlist(token, wishlistId, input);
      await get().fetchWishlists(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add card to wishlist';
      set({ error: message, isLoading: false, hasFetched: true });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  removeCardFromWishlist: async (token: string, wishlistId: string, cardId: string) => {
    try {
      await wishlistsApi.removeCardFromWishlist(token, wishlistId, cardId);
      await get().fetchWishlists(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove card from wishlist';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  }
}));
