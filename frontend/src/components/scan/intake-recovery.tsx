"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useServerFeatures } from "@/lib/api/health";
import {
  INTAKE_CHANGED_EVENT,
  loadIntakeDraft,
  submitIntakeDraft,
  type IntakeDraft,
} from "@/lib/intake/durable-intake";

export const QUICK_SCAN_INTAKE_KEY = "quick-scanner-review";
export function useSavedScanIntake() {
  const userId = useAuthStore((state) => state.user?.id);
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  useEffect(() => {
    const update = () => {
      try {
        setDraft(userId ? loadIntakeDraft(QUICK_SCAN_INTAKE_KEY) : null);
      } catch {
        setDraft(null);
      }
    };
    update();
    window.addEventListener(INTAKE_CHANGED_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(INTAKE_CHANGED_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [userId]);
  return draft;
}

/** Recover an unknown commit even before the scanner recognizes another card. */
export function ScanIntakeRecovery() {
  const draft = useSavedScanIntake();
  const token = useAuthStore((state) => state.token);
  const features = useServerFeatures();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!draft || draft.receipt || !token) return null;
  const recover = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (features.atomicIntake !== true)
        throw new Error(
          "An updated Convex server with atomic intake is required to recover this save.",
        );
      await submitIntakeDraft(token, QUICK_SCAN_INTAKE_KEY, draft);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Recovery failed. The saved request is retained.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <section
      className="space-y-2 rounded-lg border p-4 xl:col-span-2"
      aria-label="Pending card save"
    >
      <h2 className="font-semibold">Recover a reviewed card save</h2>
      <p className="text-sm">
        {draft.request.rows
          .map((row) => row.cardData?.name ?? row.cardId)
          .join(", ")}{" "}
        has a saved request awaiting confirmation. Retrying recovers the same
        physical copies.
      </p>
      <Button onClick={() => void recover()} disabled={pending}>
        {pending ? "Recovering…" : "Recover saved card"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
