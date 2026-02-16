// Re-export shared API types (canonical source: @tcg/api-types)
export type {
  TcgCode,
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

import type { TcgCode, Card, CardPrintsResponse } from '@tcg/api-types';

// Backend-only: adapter interface (not part of the API contract)
export interface TcgAdapter {
  readonly game: TcgCode;
  searchCards(query: string): Promise<Card[]>;
  fetchCardById(externalId: string): Promise<Card | null>;
  fetchCardPrints?(externalId: string): Promise<CardPrintsResponse>;
}
