const PRODUCTION_SCAN_INDEX_ROOT =
  "https://assets.tcger.ahmadjalil.com/scan-index";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const SCAN_INDEX_ROOT =
  process.env.NEXT_PUBLIC_SCAN_INDEX_BASE_URL?.trim()
    ? trimTrailingSlash(process.env.NEXT_PUBLIC_SCAN_INDEX_BASE_URL.trim())
    : process.env.NODE_ENV === "production"
      ? PRODUCTION_SCAN_INDEX_ROOT
      : "/scan-index";

/**
 * Resolve one publisher-controlled scan artifact against the configured CDN.
 * Legacy `/scan-index/...` model URLs remain valid when an old local artifact
 * is opened by a production build that now reads its index from R2.
 */
export function scanIndexAssetUrl(
  value: string,
  root: string = SCAN_INDEX_ROOT,
): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const relative = trimmed.replace(/^\/scan-index\//, "").replace(/^\/+/, "");
  const parts = relative.split("/");
  if (
    !relative ||
    parts.some(
      (part) => !part || part === "." || part === ".." || part.includes("\\"),
    )
  ) {
    throw new Error(`Invalid scan-index artifact path: ${value}`);
  }

  return `${trimTrailingSlash(root)}/${parts
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}
