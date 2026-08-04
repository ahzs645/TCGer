import { resolveTcgdexAssetUrl } from './tcgdex-assets';

/**
 * Approved vector set-symbol sources, keyed by the TCGdex set id.
 *
 * Keep this list intentionally explicit. Pokémon's public catalog providers
 * currently expose raster symbols, while third-party vector collections have
 * incomplete coverage or unclear/non-commercial redistribution terms.
 */
export const POKEMON_SET_VECTOR_ICON_URLS: Readonly<Record<string, string>> = Object.freeze({});

export interface PokemonSetArtwork {
  iconUrl?: string;
  iconFallbackUrl?: string;
  logoUrl?: string;
}

export function resolvePokemonSetArtwork(
  setId: string,
  symbol?: string,
  logo?: string,
  vectorIconUrls: Readonly<Record<string, string>> = POKEMON_SET_VECTOR_ICON_URLS,
): PokemonSetArtwork {
  const webpSymbolUrl = resolveTcgdexAssetUrl(symbol);
  const vectorIconUrl = vectorIconUrls[setId]?.trim() || undefined;

  return {
    iconUrl: vectorIconUrl ?? webpSymbolUrl,
    iconFallbackUrl:
      vectorIconUrl && webpSymbolUrl && vectorIconUrl !== webpSymbolUrl ? webpSymbolUrl : undefined,
    logoUrl: resolveTcgdexAssetUrl(logo),
  };
}
