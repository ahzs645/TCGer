import { QueryClient } from "@tanstack/react-query";
import { subscribePrivateSession } from "@/lib/private-session";
import { subscribeInventoryChanges } from "@/lib/inventory-events";

/** A cache belongs to one mounted authenticated session, never an application lifetime. */
export function createPrivateQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 60_000 },
    },
  });
  const clear = () => {
    void client.cancelQueries();
    client.clear();
  };
  let stop: (() => void) | undefined;
  return {
    client,
    connect() {
      stop?.();
      const stopSession = subscribePrivateSession(clear);
      const stopInventory = subscribeInventoryChanges(() => {
        void client.invalidateQueries();
      });
      stop = () => {
        stopSession();
        stopInventory();
        clear();
      };
      return () => {
        stop?.();
        stop = undefined;
      };
    },
    dispose() {
      stop?.();
      stop = undefined;
      clear();
    },
  };
}
