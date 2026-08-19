import { useCallback, useSyncExternalStore } from "react";

import type { PackOpeningPullSession } from "@tcg/pack-core/experience";

import {
  PACK_OPENED_STORAGE_KEY,
  PACK_SPOTLIGHT_DISMISSED_KEY,
  SAVED_PACK_OPENINGS_STORAGE_KEY,
} from "@/lib/storage/keys";

/**
 * Everything the browser remembers about pack openings.
 *
 * This lives apart from `src/components/packs/pack-opening.tsx` for one
 * reason: the dashboard needs to know whether a pack has ever been opened, and
 * that component drags in the whole three.js opening scene. Reading the answer
 * from here keeps the renderer out of the dashboard bundle.
 */

/**
 * Dispatched on `window` after this tab writes. The `storage` event only
 * reaches *other* tabs, so a same-tab subscriber needs its own signal. The name
 * is a released one — the opener has been dispatching it since the history
 * dialog shipped.
 */
export const PACK_HISTORY_EVENT = "tcger-saved-pack-openings-changed";

const WATCHED_KEYS: readonly string[] = [
  SAVED_PACK_OPENINGS_STORAGE_KEY,
  PACK_OPENED_STORAGE_KEY,
  PACK_SPOTLIGHT_DISMISSED_KEY,
];

/** Snapshot returned when nothing is stored, or storage is unreachable. */
const EMPTY_SNAPSHOT = "[]";

/**
 * Survives a storage write that was refused (private browsing, quota) so a
 * dismissal at least holds for the rest of the session.
 */
let dismissedInMemory = false;

/** Avoids a localStorage read on every frame of an opening. */
let openedPackRecorded = false;

function notify() {
  window.dispatchEvent(new Event(PACK_HISTORY_EVENT));
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Private browsing and some embedded webviews throw on access rather than
    // exposing an empty store.
    return false;
  }
}

function writeFlag(key: string): boolean {
  try {
    window.localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

/** Subscribe to every pack-history key, in this tab and in others. */
export function subscribeToPackHistory(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // A null key means the whole store was cleared, which affects all of them.
    if (event.key === null || WATCHED_KEYS.includes(event.key)) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(PACK_HISTORY_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PACK_HISTORY_EVENT, onChange);
  };
}

/**
 * Raw saved-openings JSON. Deliberately a string: `useSyncExternalStore`
 * compares snapshots by identity, and a fresh array every read would loop.
 */
export function savedOpeningsSnapshot(): string {
  try {
    return (
      window.localStorage.getItem(SAVED_PACK_OPENINGS_STORAGE_KEY) ??
      EMPTY_SNAPSHOT
    );
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

/** Server-render snapshot for {@link savedOpeningsSnapshot}. */
export function savedOpeningsServerSnapshot(): string {
  return EMPTY_SNAPSHOT;
}

export function parseSavedOpenings(raw: string): PackOpeningPullSession[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Put one opening at the head of the history, replacing any earlier copy of
 * it. Returns false when storage refused the write, which the opener surfaces
 * so the visitor knows the local copy did not stick.
 */
export function persistOpening(session: PackOpeningPullSession): boolean {
  // A damaged prior value parses to an empty list rather than blocking the
  // current opening from saving.
  const sessions = parseSavedOpenings(savedOpeningsSnapshot());
  try {
    window.localStorage.setItem(
      SAVED_PACK_OPENINGS_STORAGE_KEY,
      JSON.stringify([
        session,
        ...sessions.filter((item) => item.id !== session.id),
      ]),
    );
  } catch {
    return false;
  }
  notify();
  return true;
}

export function removeOpening(sessionId: string): void {
  const remaining = parseSavedOpenings(savedOpeningsSnapshot()).filter(
    (session) => session.id !== sessionId,
  );
  try {
    window.localStorage.setItem(
      SAVED_PACK_OPENINGS_STORAGE_KEY,
      JSON.stringify(remaining),
    );
  } catch {
    return;
  }
  notify();
}

/**
 * Record that a pack was actually opened.
 *
 * Idempotent and cheap on purpose — the opener calls it on every state update
 * while a pack is open, so the common path is a boolean check.
 */
export function recordPackOpened(): void {
  if (openedPackRecorded) return;
  if (readFlag(PACK_OPENED_STORAGE_KEY)) {
    openedPackRecorded = true;
    return;
  }
  if (!writeFlag(PACK_OPENED_STORAGE_KEY)) return;
  openedPackRecorded = true;
  notify();
}

/** Retire the dashboard spotlight without opening a pack. */
export function dismissPackSpotlight(): void {
  dismissedInMemory = true;
  writeFlag(PACK_SPOTLIGHT_DISMISSED_KEY);
  notify();
}

type PackSpotlightState = "unknown" | "show" | "hide";

function packSpotlightSnapshot(): PackSpotlightState {
  if (dismissedInMemory) return "hide";
  if (readFlag(PACK_OPENED_STORAGE_KEY)) return "hide";
  if (readFlag(PACK_SPOTLIGHT_DISMISSED_KEY)) return "hide";
  // Openings saved before the milestone key existed still count as evidence
  // that this visitor has been through the opener.
  return parseSavedOpenings(savedOpeningsSnapshot()).length > 0
    ? "hide"
    : "show";
}

function packSpotlightServerSnapshot(): PackSpotlightState {
  return "unknown";
}

/**
 * Whether the dashboard should still be pitching pack opening.
 *
 * `visible` stays false until the first client render resolves it. The server
 * cannot know, and flashing the pitch at someone who has opened dozens of packs
 * only to pull it away a frame later is worse than showing it a frame late to
 * someone who has opened none.
 */
export function usePackOpeningSpotlight(): {
  visible: boolean;
  dismiss: () => void;
} {
  const state = useSyncExternalStore(
    subscribeToPackHistory,
    packSpotlightSnapshot,
    packSpotlightServerSnapshot,
  );
  const dismiss = useCallback(() => {
    dismissPackSpotlight();
  }, []);
  return { visible: state === "show", dismiss };
}
