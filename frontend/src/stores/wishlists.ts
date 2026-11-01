import {
  inventoryRevision,
  subscribeInventoryChanges,
} from "@/lib/inventory-events";
import {
  capturePrivateSession,
  sessionSetter,
  subscribePrivateSession,
} from "@/lib/private-session";
import { create } from "zustand";
import * as wishlistsApi from "@/lib/api/wishlists";
import {
  syncWishlistRules,
  type WishlistSyncResult,
} from "@/lib/wishlists/sync";

export type {
  WishlistResponse,
  WishlistCardResponse,
  WishlistRuleResponse,
} from "@/lib/api/wishlists";

export interface WishlistsState {
  wishlists: wishlistsApi.WishlistResponse[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  clearError: () => void;
  fetchWishlists: (token: string) => Promise<void>;
  addWishlist: (
    token: string,
    input: wishlistsApi.CreateWishlistInput,
  ) => Promise<string>;
  updateWishlist: (
    token: string,
    id: string,
    input: wishlistsApi.UpdateWishlistInput,
  ) => Promise<void>;
  removeWishlist: (token: string, id: string) => Promise<void>;
  addCardToWishlist: (
    token: string,
    wishlistId: string,
    input: wishlistsApi.AddWishlistCardInput,
  ) => Promise<void>;
  addCardsToWishlist: (
    token: string,
    wishlistId: string,
    input: wishlistsApi.AddWishlistCardsInput,
  ) => Promise<void>;
  updateWishlistCard: (
    token: string,
    wishlistId: string,
    cardId: string,
    input: wishlistsApi.UpdateWishlistCardInput,
  ) => Promise<void>;
  removeCardFromWishlist: (
    token: string,
    wishlistId: string,
    cardId: string,
  ) => Promise<void>;
  addRule: (
    token: string,
    wishlistId: string,
    input: wishlistsApi.CreateWishlistRuleInput,
  ) => Promise<wishlistsApi.WishlistRuleResponse>;
  removeRule: (
    token: string,
    wishlistId: string,
    ruleId: string,
  ) => Promise<void>;
  /** Re-expands the wishlist's rules and merges in anything new. */
  syncWishlist: (
    token: string,
    wishlistId: string,
    options?: { onProgress?: (message: string) => void },
  ) => Promise<WishlistSyncResult>;
}

let latestFetch = 0;

export const useWishlistsStore = create<WishlistsState>()((publish, get) => ({
  wishlists: [],
  isLoading: false,
  error: null,
  hasFetched: false,

  clearError: () => publish({ error: null }),

  fetchWishlists: async (token: string) => {
    const request = ++latestFetch;
    const revision = inventoryRevision();
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    set({ isLoading: true, error: null });
    try {
      const wishlists = await wishlistsApi.getWishlists(token);
      if (!session.current() || request !== latestFetch) return;
      if (revision !== inventoryRevision()) {
        set({ isLoading: false, hasFetched: false });
        return;
      }
      set({ wishlists, isLoading: false, hasFetched: true });
    } catch (error) {
      if (!session.current() || request !== latestFetch) return;
      if (revision !== inventoryRevision()) {
        set({ isLoading: false, hasFetched: false });
        return;
      }
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch wishlists",
        isLoading: false,
        hasFetched: true,
      });
    }
  },

  addWishlist: async (
    token: string,
    input: wishlistsApi.CreateWishlistInput,
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    set({ isLoading: true, error: null });
    try {
      const newWishlist = await wishlistsApi.createWishlist(token, input);
      set((state) => ({
        wishlists: [...state.wishlists, newWishlist],
        isLoading: false,
        hasFetched: true,
      }));
      return newWishlist.id;
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to create wishlist",
        isLoading: false,
        hasFetched: true,
      });
      throw error;
    }
  },

  updateWishlist: async (
    token: string,
    id: string,
    input: wishlistsApi.UpdateWishlistInput,
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    set({ isLoading: true, error: null });
    try {
      const updated = await wishlistsApi.updateWishlist(token, id, input);
      set((state) => ({
        wishlists: state.wishlists.map((w) => (w.id === id ? updated : w)),
        isLoading: false,
        hasFetched: true,
      }));
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to update wishlist",
        isLoading: false,
        hasFetched: true,
      });
      throw error;
    }
  },

  removeWishlist: async (token: string, id: string) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    set({ isLoading: true, error: null });
    try {
      await wishlistsApi.deleteWishlist(token, id);
      set((state) => ({
        wishlists: state.wishlists.filter((w) => w.id !== id),
        isLoading: false,
        hasFetched: true,
      }));
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to delete wishlist",
        isLoading: false,
        hasFetched: true,
      });
      throw error;
    }
  },

  addCardToWishlist: async (
    token: string,
    wishlistId: string,
    input: wishlistsApi.AddWishlistCardInput,
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    try {
      await wishlistsApi.addCardToWishlist(token, wishlistId, input);
      session.assertCurrent();
      await get().fetchWishlists(token);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to add card to wishlist";
      set({ error: message, isLoading: false, hasFetched: true });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  addCardsToWishlist: async (
    token: string,
    wishlistId: string,
    input: wishlistsApi.AddWishlistCardsInput,
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    try {
      const updated = await wishlistsApi.addCardsToWishlist(
        token,
        wishlistId,
        input,
      );
      set((state) => ({
        wishlists: state.wishlists.map((w) =>
          w.id === wishlistId ? updated : w,
        ),
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to add cards to wishlist";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  updateWishlistCard: async (
    token: string,
    wishlistId: string,
    cardId: string,
    input: wishlistsApi.UpdateWishlistCardInput,
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    try {
      await wishlistsApi.updateWishlistCard(token, wishlistId, cardId, input);
      session.assertCurrent();
      await get().fetchWishlists(token);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update wishlist card";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  removeCardFromWishlist: async (
    token: string,
    wishlistId: string,
    cardId: string,
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    try {
      await wishlistsApi.removeCardFromWishlist(token, wishlistId, cardId);
      session.assertCurrent();
      await get().fetchWishlists(token);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to remove card from wishlist";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  addRule: async (
    token: string,
    wishlistId: string,
    input: wishlistsApi.CreateWishlistRuleInput,
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    try {
      const rule = await wishlistsApi.addWishlistRule(token, wishlistId, input);
      session.assertCurrent();
      await get().fetchWishlists(token);
      return rule;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to add wishlist rule";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  removeRule: async (token: string, wishlistId: string, ruleId: string) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    try {
      await wishlistsApi.removeWishlistRule(token, wishlistId, ruleId);
      session.assertCurrent();
      await get().fetchWishlists(token);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to remove wishlist rule";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  syncWishlist: async (
    token: string,
    wishlistId: string,
    options?: { onProgress?: (message: string) => void },
  ) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    const wishlist = get().wishlists.find((entry) => entry.id === wishlistId);
    if (!wishlist) {
      throw new Error("Wishlist not found");
    }

    try {
      const result = await syncWishlistRules(token, wishlist, wishlist.rules, {
        onProgress: (message) => {
          if (session.current()) options?.onProgress?.(message);
        },
      });
      session.assertCurrent();
      await get().fetchWishlists(token);
      if (result.errors.length) {
        set({ error: result.errors[0] });
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync wishlist";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
}));

subscribePrivateSession(() => {
  useWishlistsStore.setState({
    wishlists: [],
    isLoading: false,
    error: null,
    hasFetched: false,
  });
});

subscribeInventoryChanges(() => {
  useWishlistsStore.setState({ hasFetched: false });
});
