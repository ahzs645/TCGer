import { create } from 'zustand';
import * as collectionsApi from '@/lib/api/collections';

export type { Collection, CollectionCard } from '@/lib/api/collections';

export interface CollectionsState {
  collections: collectionsApi.Collection[];
  isLoading: boolean;
  error: string | null;
  fetchCollections: (token: string) => Promise<void>;
  addCollection: (token: string, input: { name: string; description?: string }) => Promise<string>;
  removeCollection: (token: string, id: string) => Promise<void>;
  updateCollection: (token: string, id: string, input: { name?: string; description?: string }) => Promise<void>;
}

export const useCollectionsStore = create<CollectionsState>()((set, get) => ({
  collections: [],
  isLoading: false,
  error: null,

  fetchCollections: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      const collections = await collectionsApi.getCollections(token);
      set({ collections, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch collections',
        isLoading: false
      });
    }
  },

  addCollection: async (token: string, input: { name: string; description?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const newCollection = await collectionsApi.createCollection(token, input);
      set((state) => ({
        collections: [...state.collections, newCollection],
        isLoading: false
      }));
      return newCollection.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create collection',
        isLoading: false
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
        isLoading: false
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete collection',
        isLoading: false
      });
      throw error;
    }
  },

  updateCollection: async (token: string, id: string, input: { name?: string; description?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await collectionsApi.updateCollection(token, id, input);
      set((state) => ({
        collections: state.collections.map((c) => (c.id === id ? updated : c)),
        isLoading: false
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update collection',
        isLoading: false
      });
      throw error;
    }
  }
}));
