"use client";

import { useEffect, useState } from "react";
import type { ServerFeatures } from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

export type FeatureAvailability = Partial<ServerFeatures>;

const featureKeys = [
  "decks",
  "finance",
  "sealed",
  "analytics",
  "trades",
  "prices",
  "notifications",
  "alerts",
  "shops",
  "automations",
  "shipments",
  "public",
] as const satisfies readonly (keyof ServerFeatures)[];

const failOpenFeatures: FeatureAvailability = {};
let featuresPromise: Promise<FeatureAvailability> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function fetchServerFeatures(): Promise<FeatureAvailability> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error("Failed to load server features");
  }

  const data: unknown = await response.json();
  if (!isRecord(data) || !isRecord(data.features)) {
    return failOpenFeatures;
  }

  const features: FeatureAvailability = {};
  for (const key of featureKeys) {
    const value = data.features[key];
    if (typeof value === "boolean") {
      features[key] = value;
    }
  }
  return features;
}

function getServerFeatures(): Promise<FeatureAvailability> {
  if (!featuresPromise) {
    featuresPromise = fetchServerFeatures().catch(() => failOpenFeatures);
  }
  return featuresPromise;
}

export function useServerFeatures(): FeatureAvailability {
  const [features, setFeatures] =
    useState<FeatureAvailability>(failOpenFeatures);

  useEffect(() => {
    let cancelled = false;
    void getServerFeatures().then((loadedFeatures) => {
      if (!cancelled) {
        setFeatures(loadedFeatures);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return features;
}

export type ServerStatus = "checking" | "online" | "offline";

const OFFLINE_RECHECK_MS = 20_000;

/**
 * Whether the API is answering at all.
 *
 * `useServerFeatures` deliberately fails open — an unreachable server should not
 * hide features. That is right for the nav and wrong for the page body: with the
 * API down the dashboard rendered a perfectly ordinary empty account, so an
 * outage was indistinguishable from a new sign-up. This hook is the signal the
 * shell needs to say so out loud.
 */
export function useServerStatus(): {
  status: ServerStatus;
  retry: () => void;
} {
  const [status, setStatus] = useState<ServerStatus>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    fetch(`${API_BASE_URL}/health`, { signal: controller.signal })
      .then((response) => {
        if (!cancelled) setStatus(response.ok ? "online" : "offline");
      })
      .catch(() => {
        if (!cancelled) setStatus("offline");
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  // Keep retrying quietly while down so the banner clears itself on recovery.
  useEffect(() => {
    if (status !== "offline") return;
    const id = setInterval(() => setAttempt((n) => n + 1), OFFLINE_RECHECK_MS);
    return () => clearInterval(id);
  }, [status]);

  return { status, retry: () => setAttempt((n) => n + 1) };
}

export function isFeatureAvailable(
  features: FeatureAvailability,
  feature: keyof ServerFeatures,
): boolean {
  return features[feature] !== false;
}
