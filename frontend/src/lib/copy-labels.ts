/**
 * Returns the human-facing ordinal for a physical copy.
 *
 * A number is only useful when it distinguishes this copy from another one.
 * `copyIndex` is zero-based to match Array#map.
 */
export function copyOrdinalLabel(copyIndex: number, copyCount: number) {
  return copyCount > 1 ? `#${copyIndex + 1}` : null;
}

export function copyEditAriaLabel({
  cardName,
  condition,
  copyIndex,
  copyCount,
}: {
  cardName: string;
  condition: string;
  copyIndex: number;
  copyCount: number;
}) {
  const ordinal = copyOrdinalLabel(copyIndex, copyCount);
  return `Edit ${cardName} copy${ordinal ? ` ${copyIndex + 1}` : ""}, ${condition}`;
}

export function individualCopiesLabel(copyCount: number) {
  return copyCount === 1 ? "Individual copy" : "Individual copies";
}

export function copyCountNoun(copyCount: number) {
  return copyCount === 1 ? "copy" : "copies";
}

export function formatCopyCount(copyCount: number) {
  return `${copyCount} ${copyCountNoun(copyCount)}`;
}

export function formatTotalCopyCount(copyCount: number) {
  return `${copyCount} total ${copyCountNoun(copyCount)}`;
}
