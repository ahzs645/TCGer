import { create } from "zustand";
import type {
  CollectionTagResponse,
  CreateTagInput,
} from "@/lib/api/collections";
import { getTags, createTag } from "@/lib/api/collections";
import { useAuthStore } from "@/stores/auth";

interface TagState {
  tags: CollectionTagResponse[];
  isLoading: boolean;
  error: string | null;
  fetchTags: (token: string) => Promise<void>;
  addTag: (
    token: string,
    input: CreateTagInput,
  ) => Promise<CollectionTagResponse>;
}

export const useTagsStore = create<TagState>((set) => ({
  tags: [],
  isLoading: false,
  error: null,
  fetchTags: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      const tags = await getTags(token, useAuthStore.getState().user);
      set({ tags, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load tags",
        isLoading: false,
      });
    }
  },
  addTag: async (token: string, input: CreateTagInput) => {
    try {
      const tag = await createTag(token, input, useAuthStore.getState().user);
      set((state) => ({ tags: [...state.tags, tag] }));
      return tag;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create tag";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
}));
