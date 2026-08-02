const TCGDEX_ASSET_HOST = 'assets.tcgdex.net';
const IMAGE_EXTENSION_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

/**
 * TCGdex returns image asset roots without a file extension. The asset CDN
 * requires callers to choose a supported format, so use WebP unless the URL
 * already names a concrete image file.
 */
export function resolveTcgdexAssetUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (
      url.hostname.toLowerCase() !== TCGDEX_ASSET_HOST ||
      IMAGE_EXTENSION_PATTERN.test(url.pathname)
    ) {
      return trimmed;
    }
    url.pathname = `${url.pathname}.webp`;
    return url.toString();
  } catch {
    return trimmed;
  }
}
