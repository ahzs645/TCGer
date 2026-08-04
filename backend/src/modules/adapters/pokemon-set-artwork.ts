import { resolveTcgdexAssetUrl } from './tcgdex-assets';
import { POKEMON_SET_VECTOR_ICON_URLS } from './pokemon-set-vector-icons.generated';

export { POKEMON_SET_VECTOR_ICON_URLS } from './pokemon-set-vector-icons.generated';

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
    iconFallbackUrl: vectorIconUrl && webpSymbolUrl !== vectorIconUrl ? webpSymbolUrl : undefined,
    logoUrl: resolveTcgdexAssetUrl(logo),
  };
}
