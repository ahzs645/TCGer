"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  privateSessionGeneration,
  subscribePrivateSession,
} from "@/lib/private-session";
import { createPrivateQueryClient } from "@/lib/private-query-client";

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const generation = useSyncExternalStore(
    subscribePrivateSession,
    privateSessionGeneration,
    () => 0,
  );
  // A replacement session gets a fresh cache AND a fresh component tree, so an
  // old mutation cannot publish a draft, selection, error or success into it.
  return (
    <SessionQueryProvider key={generation}>{children}</SessionQueryProvider>
  );
}

function SessionQueryProvider({ children }: QueryProviderProps) {
  const [showDevtools, setShowDevtools] = useState(false);
  const [cache] = useState(createPrivateQueryClient);
  const client = cache.client;
  // Register only after commit: Strict Mode may discard a state initializer.
  useLayoutEffect(() => cache.connect(), [cache]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => setShowDevtools(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return (
    <QueryClientProvider client={client} data-oid="cr:39mx">
      {children}
      {showDevtools ? (
        <ReactQueryDevtools initialIsOpen={false} data-oid="0anjj6p" />
      ) : null}
    </QueryClientProvider>
  );
}
