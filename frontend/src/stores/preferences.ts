import { create } from "zustand";
import { priceSourceSchema, type PriceSource } from "@tcg/api-types";

import type { SupportedGame } from "@/lib/utils";

export type ManageableGame = Exclude<SupportedGame, "all">;

interface ModuleState {
  enabledGames: Record<ManageableGame, boolean>;
  toggleGame: (game: ManageableGame) => void;
  setGameEnabled: (game: ManageableGame, enabled: boolean) => void;
  showCardNumbers: boolean;
  setShowCardNumbers: (show: boolean) => void;
  showPricing: boolean;
  setShowPricing: (show: boolean) => void;
  priceSource: PriceSource;
  hydratePriceSource: () => void;
  setPriceSource: (source: PriceSource) => void;
}

export const PRICE_SOURCE_STORAGE_KEY = "tcger.pricing.source";

const initialState: Record<ManageableGame, boolean> = {
  yugioh: true,
  magic: true,
  pokemon: true,
  onepiece: false,
  lorcana: false,
  dragonball: false,
};

export const useModuleStore = create<ModuleState>((set) => ({
  enabledGames: initialState,
  toggleGame: (game) =>
    set((state) => ({
      enabledGames: {
        ...state.enabledGames,
        [game]: !state.enabledGames[game],
      },
    })),
  setGameEnabled: (game, enabled) =>
    set((state) => ({
      enabledGames: { ...state.enabledGames, [game]: enabled },
    })),
  showCardNumbers: true,
  setShowCardNumbers: (show) => set({ showCardNumbers: show }),
  showPricing: true,
  setShowPricing: (show) => set({ showPricing: show }),
  priceSource: "automatic",
  hydratePriceSource: () => {
    if (typeof window === "undefined") return;
    const parsed = priceSourceSchema.safeParse(
      window.localStorage.getItem(PRICE_SOURCE_STORAGE_KEY),
    );
    set({ priceSource: parsed.success ? parsed.data : "automatic" });
  },
  setPriceSource: (source) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PRICE_SOURCE_STORAGE_KEY, source);
    }
    set({ priceSource: source });
  },
}));

export function getActiveGames(
  enabledGames: Record<ManageableGame, boolean>,
): ManageableGame[] {
  return (Object.entries(enabledGames) as Array<[ManageableGame, boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([game]) => game);
}
