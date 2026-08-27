export interface ScannerReferenceWindow {
  id: string;
  startSeconds: number;
  endSeconds: number;
  name: string;
  acceptedNames?: string[];
  expectedExternalIds?: string[];
  tags?: string[];
}

export interface ScannerReferenceFrame {
  timestampSeconds: number;
  bestMatch: {
    externalId: string;
    name: string;
    passedThreshold?: boolean;
  } | null;
}

export function normalizeReferenceName(
  value: string | null | undefined,
): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function referenceWindowMatches(
  window: ScannerReferenceWindow,
  frames: ScannerReferenceFrame[],
  toleranceSeconds = 5,
): boolean {
  const expectedIds = new Set(
    (window.expectedExternalIds ?? []).map((id) => id.trim().toLowerCase()),
  );
  const acceptedNames = new Set(
    [window.name, ...(window.acceptedNames ?? [])].map(normalizeReferenceName),
  );
  return frames.some((frame) => {
    if (
      !frame.bestMatch ||
      frame.bestMatch.passedThreshold === false ||
      frame.timestampSeconds < window.startSeconds - toleranceSeconds ||
      frame.timestampSeconds > window.endSeconds + toleranceSeconds
    ) {
      return false;
    }
    return expectedIds.size > 0
      ? expectedIds.has(frame.bestMatch.externalId.trim().toLowerCase())
      : acceptedNames.has(normalizeReferenceName(frame.bestMatch.name));
  });
}
