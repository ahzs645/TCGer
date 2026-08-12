"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useState } from "react";

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [showDevtools, setShowDevtools] = useState(false);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 1000 * 60,
          },
        },
      }),
  );

  useEffect(() => {
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
