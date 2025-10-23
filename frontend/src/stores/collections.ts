import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { CollectionCard } from '@/types/card';
import { SAMPLE_COLLECTIONS, type SampleCollection } from '@/lib/data/sample-collections';

export interface CollectionsState {
  collections: SampleCollection[];
  addCollection: (input: { name: string; description?: string }) => string;
  removeCollection: (id: string) => void;
  updateCollectionCards: (id: string, cards: CollectionCard[]) => void;
}

const freshCollections = (): SampleCollection[] => {
  return SAMPLE_COLLECTIONS.map((collection) => ({
    ...collection,
    cards: collection.cards.map((card) => ({ ...card }))
  }));
};

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `collection-${Math.random().toString(36).slice(2, 10)}`;
};

export const useCollectionsStore = create<CollectionsState>()(
  persist(
    (set, get) => ({
      collections: freshCollections(),
      addCollection: ({ name, description }) => {
        const id = createId();
        const now = new Date().toISOString();
        set((state) => ({
          collections: [
            ...state.collections,
            {
              id,
              name: name.trim() || 'Untitled Binder',
              description: description?.trim() || 'Custom binder',
              updatedAt: now,
              cards: []
            }
          ]
        }));
        return id;
      },
      removeCollection: (id) => {
        set((state) => ({
          collections: state.collections.filter((collection) => collection.id !== id)
        }));
      },
      updateCollectionCards: (id, cards) => {
        const now = new Date().toISOString();
        set((state) => ({
          collections: state.collections.map((collection) =>
            collection.id === id
              ? {
                  ...collection,
                  cards,
                  updatedAt: now
                }
              : collection
          )
        }));
      }
    }),
    {
      name: 'tcg-collections-store',
      version: 1
    }
  )
);
