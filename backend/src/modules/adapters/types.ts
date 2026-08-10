// Re-export shared API types (canonical source: @tcg/api-types)
export type {
  TcgCode,
  TcgSet,
  Card,
  PokemonPrintMetadata,
  PokemonVariantFlags,
  PokemonFinishType,
  PokemonFunctionalAttack,
  PokemonFunctionalAbility,
  PokemonFunctionalGroup,
  CardPrintsResponse
} from '@tcg/api-types';

// Backend-specific aliases to preserve existing naming convention
export type { Card as CardDTO } from '@tcg/api-types';
export type { PokemonFunctionalAttack as PokemonFunctionalAttackDTO } from '@tcg/api-types';
export type { PokemonFunctionalAbility as PokemonFunctionalAbilityDTO } from '@tcg/api-types';
export type { PokemonFunctionalGroup as PokemonFunctionalGroupDTO } from '@tcg/api-types';
export type { CardPrintsResponse as CardPrintsResult } from '@tcg/api-types';

import type { TcgCode, TcgSet, Card, CardPrintsResponse } from '@tcg/api-types';

/** Options for an exhaustive name lookup (see {@link TcgAdapter.fetchCardsByName}). */
export interface CardNameSearchOptions {
  /** Return every printing rather than one entry per distinct card. */
  includeAllPrintings: boolean;
  /** Hard cap on returned cards; adapters stop paging once they reach it. */
  limit: number;
}

export type CardArtistSearchOptions = CardNameSearchOptions;

// Backend-only: adapter interface (not part of the API contract)
export interface TcgAdapter {
  readonly game: TcgCode;
  /** Preview search: a small, fast page of results for interactive UI. */
  searchCards(query: string): Promise<Card[]>;
  /**
   * Exhaustive name search: every card matching the name, paged to `limit`.
   * Adapters that do not implement it fall back to {@link searchCards}, which
   * only returns a capped preview page.
   */
  fetchCardsByName?(name: string, options: CardNameSearchOptions): Promise<Card[]>;
  /** Exhaustive illustrator/artist lookup for art-first collection guides. */
  fetchCardsByArtist?(artist: string, options: CardArtistSearchOptions): Promise<Card[]>;
  fetchCardById(externalId: string): Promise<Card | null>;
  fetchCardPrints?(externalId: string): Promise<CardPrintsResponse>;
  fetchSets?(): Promise<TcgSet[]>;
  fetchSetCards?(setCode: string): Promise<Card[]>;
}
