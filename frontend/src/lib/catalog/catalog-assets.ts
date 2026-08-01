const PRODUCTION_ASSET_ORIGIN = "https://assets.tcger.ahmadjalil.com";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function configuredRoot(
  value: string | undefined,
  productionPath: string,
): string {
  if (value?.trim()) return trimTrailingSlash(value.trim());
  if (process.env.NODE_ENV === "production") {
    return `${PRODUCTION_ASSET_ORIGIN}/${productionPath}`;
  }
  return "/catalog";
}

export const CATALOG_ROOT = configuredRoot(
  process.env.NEXT_PUBLIC_CATALOG_BASE_URL,
  "catalogs",
);

export function catalogAssetUrl(filename: string): string {
  return `${CATALOG_ROOT}/${encodeURIComponent(filename)}`;
}
