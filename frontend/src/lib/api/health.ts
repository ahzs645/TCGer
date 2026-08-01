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

export function isFeatureAvailable(
  features: FeatureAvailability,
  feature: keyof ServerFeatures,
): boolean {
  return features[feature] !== false;
}
