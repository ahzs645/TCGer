import type { ServerFeatures } from "@tcg/api-types";

export type FeatureAvailability = Partial<ServerFeatures>;
export type ServerStatus = "checking" | "online" | "offline";
// Record makes adding a server flag a compile-time obligation here.
const featureKeys: Record<keyof ServerFeatures, true> = {
  decks: true,
  finance: true,
  sealed: true,
  analytics: true,
  trades: true,
  prices: true,
  notifications: true,
  alerts: true,
  shops: true,
  automations: true,
  shipments: true,
  public: true,
  onlineCodes: true,
};

export function parseServerFeatures(data: unknown): FeatureAvailability {
  if (!data || typeof data !== "object" || !("features" in data)) return {};
  const values = data.features;
  if (!values || typeof values !== "object") return {};
  const result: FeatureAvailability = {};
  for (const key of Object.keys(featureKeys) as (keyof ServerFeatures)[]) {
    const value = (values as Record<string, unknown>)[key];
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

export function createServerFeatureCache(load: () => Promise<unknown>) {
  let pending: Promise<FeatureAvailability> | null = null;
  let snapshot: FeatureAvailability | null = null;
  let generation = 0;
  const listeners = new Set<(features: FeatureAvailability) => void>();
  let status: ServerStatus = "checking";
  const statusListeners = new Set<(status: ServerStatus) => void>();
  function publishStatus(nextStatus: ServerStatus) {
    status = nextStatus;
    for (const listener of statusListeners) listener(status);
  }
  function get(): Promise<FeatureAvailability> {
    if (snapshot) return Promise.resolve(snapshot);
    if (pending) return pending;
    const revision = generation;
    const task = load()
      .then(parseServerFeatures)
      .then((features) => {
        if (revision === generation) {
          snapshot = features;
          for (const listener of listeners) listener(features);
          publishStatus("online");
        }
        return features;
      })
      .catch(() => {
        if (revision === generation) publishStatus("offline");
        return {};
      })
      .finally(() => {
        if (revision === generation) pending = null;
      });
    pending = task;
    return task;
  }
  function refresh() {
    generation++;
    snapshot = null;
    pending = null;
    return get();
  }
  return {
    get,
    refresh,
    // Status and feature consumers share one request, including Strict Mode
    // remounts. A new status check still probes a previously healthy server.
    check() {
      return pending ?? refresh();
    },
    subscribe(listener: (features: FeatureAvailability) => void) {
      listeners.add(listener);
      if (snapshot) listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeStatus(listener: (status: ServerStatus) => void) {
      statusListeners.add(listener);
      listener(status);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };
}
