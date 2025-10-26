export type TcgCode = 'yugioh' | 'magic' | 'pokemon';

export interface Card {
  id: string;
  tcg: TcgCode;
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  collectorNumber?: string;
  releasedAt?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  setSymbolUrl?: string;
  regulationMark?: string;
  language?: string;
  pokemonPrint?: PokemonPrintMetadata;
  attributes?: Record<string, unknown>;
}

export type PokemonFinishType = 'normal' | 'reverse' | 'holo' | 'firstEdition';

export interface PokemonVariantFlags {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
}

export interface PokemonPrintMetadata {
  tcgdexId?: string;
  tcgdexImage?: string;
  variants?: PokemonVariantFlags;
  finishes?: PokemonFinishType[];
  category?: string;
  regulationMark?: string;
  language?: string;
}

export interface PokemonFunctionalAttack {
  name: string;
  cost?: string[];
  text?: string | null;
  damage?: string | null;
  convertedEnergyCost?: number;
}

export interface PokemonFunctionalAbility {
  name: string;
  text?: string | null;
  type?: string;
}

export interface PokemonFunctionalGroup {
  functionalKey: string;
  name: string;
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  regulationMark?: string;
  category?: string;
  normalizedRules?: string | null;
  attacks?: PokemonFunctionalAttack[];
  abilities?: PokemonFunctionalAbility[];
  rules?: string[] | null;
}

export type CardPrintsResponse =
  | {
      mode: 'simple';
      prints: Card[];
      total: number;
    }
  | {
      mode: 'pokemon-functional';
      prints: Card[];
      total: number;
      functionalGroup: PokemonFunctionalGroup;
    };

export type { CollectionCardCopy, CollectionCard } from '@/lib/api/collections';

export interface SearchCardsResponse {
  cards: Card[];
}
