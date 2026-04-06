"use client";

import { useQuery } from "@tanstack/react-query";

import { searchCardsApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth";
import type { TcgCode } from "@/types/card";

export function useCardSearch(query: string, tcg?: TcgCode | "all") {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: ["cards", { query, tcg }],
    queryFn: () => searchCardsApi({ query, tcg, token }),
    enabled: query.trim().length > 0 && isAuthenticated,
    staleTime: 1000 * 60 * 5,
  });
}
