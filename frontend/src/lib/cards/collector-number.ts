const TOKEN_PATTERN = /(\d+|\D+)/g;

export function naturalCollectorNumberParts(
  value: string | null | undefined,
): Array<number | string> {
  const text = String(value ?? "").trim();
  if (!text) return [Number.POSITIVE_INFINITY];

  return (text.match(TOKEN_PATTERN) ?? [text]).map((part) =>
    /^\d+$/.test(part) ? Number(part) : part.toLocaleLowerCase(),
  );
}

export function compareCollectorNumbers(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftParts = naturalCollectorNumberParts(left);
  const rightParts = naturalCollectorNumberParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function normalizeCollectorNumber(
  value: string | null | undefined,
): string {
  const text = String(value ?? "").trim();
  if (/^\d+$/.test(text)) return text.replace(/^0+/, "") || "0";
  return text.toLocaleLowerCase();
}
