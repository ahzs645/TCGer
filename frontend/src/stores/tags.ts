import {
  capturePrivateSession,
  sessionSetter,
  subscribePrivateSession,
} from "@/lib/private-session";
import { create } from "zustand";
import type {
  CollectionTagResponse,
  CreateTagInput,
} from "@/lib/api/collections";
import { getTags, createTag } from "@/lib/api/collections";
import { subscribeInventoryChanges } from "@/lib/inventory-events";

interface TagState {
  tags: CollectionTagResponse[];
  isLoading: boolean;
  error: string | null;
  revision: number;
  fetchTags: (token: string) => Promise<void>;
  addTag: (
    token: string,
    input: CreateTagInput,
  ) => Promise<CollectionTagResponse>;
}

let readSequence = 0;
export const useTagsStore = create<TagState>((publish, get) => ({
  tags: [],
  isLoading: false,
  error: null,
  revision: 0,
  fetchTags: async (token: string) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    const sequence = ++readSequence;
    const revision = get().revision;
    set({ isLoading: true, error: null });
    try {
      const tags = await getTags(token, session.user);
      if (sequence === readSequence && revision === get().revision)
        set({ tags, isLoading: false });
    } catch (error) {
      if (sequence !== readSequence || revision !== get().revision) return;
      set({
        error: error instanceof Error ? error.message : "Failed to load tags",
        isLoading: false,
      });
    }
  },
  addTag: async (token: string, input: CreateTagInput) => {
    const session = capturePrivateSession(token);
    session.assertCurrent();
    const set = sessionSetter(publish, session);
    try {
      const tag = await createTag(token, input, session.user);
      set((state) => ({
        tags: [...state.tags.filter((item) => item.id !== tag.id), tag],
      }));
      return tag;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create tag";
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
}));

subscribePrivateSession(() => {
  readSequence += 1;
  useTagsStore.setState({
    tags: [],
    isLoading: false,
    error: null,
    revision: 0,
  });
});

subscribeInventoryChanges(() => {
  readSequence += 1;
  useTagsStore.setState((state) => ({
    tags: [],
    isLoading: false,
    revision: state.revision + 1,
  }));
});
