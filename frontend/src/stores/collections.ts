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
import * as collectionsApi from "@/lib/api/collections";

export type { Collection, CollectionCard } from "@/lib/api/collections";

export interface CollectionsState {
  collections: collectionsApi.Collection[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  clearError: () => void;
  fetchCollections: (token: string) => Promise<void>;
  addCollection: (
    token: string,
    input: { name: string; description?: string },
  ) => Promise<string>;
  removeCollection: (token: string, id: string) => Promise<void>;
  updateCollection: (
    token: string,
    id: string,
    input: collectionsApi.UpdateCollectionInput,
  ) => Promise<void>;
  addCardToBinder: (
    token: string,
    binderId: string,
    input: collectionsApi.AddCardToCollectionInput,
  ) => Promise<void>;
  updateCollectionCard: (
    token: string,
    binderId: string,
    cardId: string,
    input: collectionsApi.UpdateCollectionCardInput,
  ) => Promise<void>;
  removeCollectionCard: (
    token: string,
    binderId: string,
    cardId: string,
  ) => Promise<void>;
}

let latestFetch = 0;

export const useCollectionsStore = create<CollectionsState>()(
  (publish, get) => ({
    collections: [],
    isLoading: false,
    error: null,
    hasFetched: false,

    clearError: () => publish({ error: null }),

    fetchCollections: async (token: string) => {
      const request = ++latestFetch;
      const revision = inventoryRevision();
      const session = capturePrivateSession(token);
      session.assertCurrent();
      const set = sessionSetter(publish, session);
      set({ isLoading: true, error: null });
      try {
        const collections = await collectionsApi.getCollections(
          token,
          session.user,
        );
        if (!session.current() || request !== latestFetch) return;
        if (revision !== inventoryRevision()) {
          set({ isLoading: false, hasFetched: false });
          return;
        }
        set({ collections, isLoading: false, hasFetched: true });
      } catch (error) {
        if (!session.current() || request !== latestFetch) return;
        if (revision !== inventoryRevision()) {
          set({ isLoading: false, hasFetched: false });
          return;
        }
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch collections",
          isLoading: false,
          hasFetched: true,
        });
      }
    },

    addCollection: async (
      token: string,
      input: { name: string; description?: string },
    ) => {
      const session = capturePrivateSession(token);
      session.assertCurrent();
      const set = sessionSetter(publish, session);
      set({ isLoading: true, error: null });
      try {
        const newCollection = await collectionsApi.createCollection(
          token,
          input,
          session.user,
        );
        set((state) => ({
          collections: [...state.collections, newCollection],
          isLoading: false,
          hasFetched: true,
        }));
        return newCollection.id;
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to create collection",
          isLoading: false,
          hasFetched: true,
        });
        throw error;
      }
    },

    removeCollection: async (token: string, id: string) => {
      const session = capturePrivateSession(token);
      session.assertCurrent();
      const set = sessionSetter(publish, session);
      set({ isLoading: true, error: null });
      try {
        await collectionsApi.deleteCollection(token, id, session.user);
        const collections = await collectionsApi.getCollections(
          token,
          session.user,
        );
        set({
          collections,
          isLoading: false,
          hasFetched: true,
        });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to delete collection",
          isLoading: false,
          hasFetched: true,
        });
        throw error;
      }
    },

    updateCollection: async (
      token: string,
      id: string,
      input: { name?: string; description?: string; colorHex?: string },
    ) => {
      const session = capturePrivateSession(token);
      session.assertCurrent();
      const set = sessionSetter(publish, session);
      set({ isLoading: true, error: null });
      try {
        const updated = await collectionsApi.updateCollection(
          token,
          id,
          input,
          session.user,
        );
        set((state) => ({
          collections: state.collections.map((c) =>
            c.id === id ? updated : c,
          ),
          isLoading: false,
          hasFetched: true,
        }));
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to update collection",
          isLoading: false,
          hasFetched: true,
        });
        throw error;
      }
    },

    addCardToBinder: async (
      token: string,
      binderId: string,
      input: collectionsApi.AddCardToCollectionInput,
    ) => {
      const session = capturePrivateSession(token);
      session.assertCurrent();
      const set = sessionSetter(publish, session);
      try {
        await collectionsApi.addCardToCollection(
          token,
          binderId,
          input,
          session.user,
        );
        session.assertCurrent();
        await get().fetchCollections(token);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to add card to collection";
        set({ error: message, isLoading: false, hasFetched: true });
        throw error instanceof Error ? error : new Error(message);
      }
    },

    updateCollectionCard: async (
      token: string,
      binderId: string,
      cardId: string,
      input: collectionsApi.UpdateCollectionCardInput,
    ) => {
      const session = capturePrivateSession(token);
      session.assertCurrent();
      const set = sessionSetter(publish, session);
      try {
        await collectionsApi.updateCollectionCard(
          token,
          binderId,
          cardId,
          input,
          session.user,
        );
        session.assertCurrent();
        await get().fetchCollections(token);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update card in collection";
        set({ error: message });
        throw error instanceof Error ? error : new Error(message);
      }
    },

    removeCollectionCard: async (
      token: string,
      binderId: string,
      cardId: string,
    ) => {
      const session = capturePrivateSession(token);
      session.assertCurrent();
      const set = sessionSetter(publish, session);
      try {
        await collectionsApi.removeCardFromCollection(
          token,
          binderId,
          cardId,
          session.user,
        );
        session.assertCurrent();
        await get().fetchCollections(token);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to remove card from collection";
        set({ error: message });
        throw error instanceof Error ? error : new Error(message);
      }
    },
  }),
);

subscribePrivateSession(() => {
  useCollectionsStore.setState({
    collections: [],
    isLoading: false,
    error: null,
    hasFetched: false,
  });
});

subscribeInventoryChanges(() => {
  useCollectionsStore.setState({ hasFetched: false });
});
