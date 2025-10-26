import { create } from 'zustand';
import * as collectionsApi from '@/lib/api/collections';

export type { Collection, CollectionCard } from '@/lib/api/collections';

export interface CollectionsState {
  collections: collectionsApi.Collection[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchCollections: (token: string) => Promise<void>;
  addCollection: (token: string, input: { name: string; description?: string }) => Promise<string>;
  removeCollection: (token: string, id: string) => Promise<void>;
  updateCollection: (token: string, id: string, input: { name?: string; description?: string; colorHex?: string }) => Promise<void>;
  addCardToBinder: (
    token: string,
    binderId: string,
    input: collectionsApi.AddCardToCollectionInput
  ) => Promise<void>;
  updateCollectionCard: (
    token: string,
    binderId: string,
    cardId: string,
    input: collectionsApi.UpdateCollectionCardInput
  ) => Promise<void>;
  removeCollectionCard: (token: string, binderId: string, cardId: string) => Promise<void>;
}

export const useCollectionsStore = create<CollectionsState>()((set, get) => ({
  collections: [],
  isLoading: false,
  error: null,
  hasFetched: false,

  fetchCollections: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      const collections = await collectionsApi.getCollections(token);
      set({ collections, isLoading: false, hasFetched: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch collections',
        isLoading: false,
        hasFetched: true
      });
    }
  },

  addCollection: async (token: string, input: { name: string; description?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const newCollection = await collectionsApi.createCollection(token, input);
      set((state) => ({
        collections: [...state.collections, newCollection],
        isLoading: false,
        hasFetched: true
      }));
      return newCollection.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create collection',
        isLoading: false,
        hasFetched: true
      });
      throw error;
    }
  },

  removeCollection: async (token: string, id: string) => {
    set({ isLoading: true, error: null });
    try {
      await collectionsApi.deleteCollection(token, id);
      set((state) => ({
        collections: state.collections.filter((c) => c.id !== id),
        isLoading: false,
        hasFetched: true
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete collection',
        isLoading: false,
        hasFetched: true
      });
      throw error;
    }
  },

  updateCollection: async (token: string, id: string, input: { name?: string; description?: string; colorHex?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await collectionsApi.updateCollection(token, id, input);
      set((state) => ({
        collections: state.collections.map((c) => (c.id === id ? updated : c)),
        isLoading: false,
        hasFetched: true
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update collection',
        isLoading: false,
        hasFetched: true
      });
      throw error;
    }
  },

  addCardToBinder: async (token: string, binderId: string, input: collectionsApi.AddCardToCollectionInput) => {
    try {
      await collectionsApi.addCardToCollection(token, binderId, input);
      await get().fetchCollections(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add card to collection';
      set({ error: message, isLoading: false, hasFetched: true });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  updateCollectionCard: async (token: string, binderId: string, cardId: string, input: collectionsApi.UpdateCollectionCardInput) => {
    try {
      await collectionsApi.updateCollectionCard(token, binderId, cardId, input);
      await get().fetchCollections(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update card in collection';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  }
  ,

  removeCollectionCard: async (token: string, binderId: string, cardId: string) => {
    try {
      await collectionsApi.removeCardFromCollection(token, binderId, cardId);
      await get().fetchCollections(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove card from collection';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  }
}));
