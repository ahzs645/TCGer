"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackedPriceItem } from "@tcg/api-types";
import { useAuthStore } from "@/stores/auth";
import { useModuleStore } from "@/stores/preferences";
import { useServerFeatures } from "@/lib/api/health";
import {
  ScannerPriceController,
  scannerPriceItems,
  type ScannerPriceSnapshot,
} from "./scanner-pricing";

export function useScannerPrices(items: TrackedPriceItem[]) {
  const token = useAuthStore((state) => state.token);
  const source = useModuleStore((state) => state.priceSource);
  const features = useServerFeatures();
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef(new ScannerPriceController());
  const forceNext = useRef(false);
  const signature = JSON.stringify(scannerPriceItems(items));
  const requestKey = `${source}:${signature}`;
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    error?: string;
    snapshot?: ScannerPriceSnapshot;
  }>({ key: requestKey, loading: false });
  const allowed = Boolean(token) && features.prices !== false;
  useEffect(() => {
    const current = controller.current;
    current.cancel();
    setState({
      key: requestKey,
      loading: enabled && allowed && signature !== "[]",
    });
    if (!enabled || !allowed || !token || signature === "[]") return;
    const force = forceNext.current;
    forceNext.current = false;
    void current
      .refresh(
        token,
        JSON.parse(signature) as TrackedPriceItem[],
        source,
        force,
        (result) => {
          setState(
            result.error
              ? { key: requestKey, loading: false, error: result.error.message }
              : { key: requestKey, loading: false, snapshot: result.value },
          );
        },
      )
      .catch(() => undefined);
    return () => current.cancel();
  }, [enabled, allowed, token, source, signature, requestKey, attempt]);
  const snapshot =
    enabled && allowed && state.key === requestKey ? state.snapshot : undefined;
  useEffect(() => {
    if (!snapshot || !enabled) return;
    const after = Date.parse(snapshot.refreshAfter);
    const delay = Number.isFinite(after)
      ? Math.max(60_000, Math.min(86_400_000, after - Date.now()))
      : 300_000;
    const timer = window.setTimeout(
      () => setAttempt((value) => value + 1),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [snapshot, enabled]);
  const refresh = useCallback(() => {
    forceNext.current = true;
    setEnabled(true);
    setAttempt((value) => value + 1);
  }, []);
  return {
    enabled,
    setEnabled,
    allowed,
    loading: enabled && state.key === requestKey && state.loading,
    error: enabled && state.key === requestKey ? state.error : undefined,
    snapshot,
    refresh,
  };
}
