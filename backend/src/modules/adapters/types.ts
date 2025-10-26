export type TcgCode = 'yugioh' | 'magic' | 'pokemon';

export interface CardDTO {
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

export interface PokemonPrintMetadata {
  tcgdexId?: string;
  tcgdexImage?: string;
  variants?: PokemonVariantFlags;
  finishes?: PokemonFinishType[];
  category?: string;
  regulationMark?: string;
  language?: string;
}

export type PokemonFinishType = 'normal' | 'reverse' | 'holo' | 'firstEdition';

export interface PokemonVariantFlags {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
}

export interface PokemonFunctionalAttackDTO {
  name: string;
  cost?: string[];
  text?: string;
  damage?: string;
  convertedEnergyCost?: number;
}

export interface PokemonFunctionalAbilityDTO {
  name: string;
  text?: string;
  type?: string;
}

export interface PokemonFunctionalGroupDTO {
  functionalKey: string;
  name: string;
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  regulationMark?: string;
  category?: string;
  normalizedRules?: string | null;
  attacks?: PokemonFunctionalAttackDTO[];
  abilities?: PokemonFunctionalAbilityDTO[];
  rules?: string[] | null;
}

export type CardPrintsResult = SimpleCardPrintsResult | PokemonFunctionalCardPrintsResult;

export interface SimpleCardPrintsResult {
  mode: 'simple';
  prints: CardDTO[];
  total: number;
}

export interface PokemonFunctionalCardPrintsResult extends SimpleCardPrintsResult {
  mode: 'pokemon-functional';
  functionalGroup: PokemonFunctionalGroupDTO;
}

export interface TcgAdapter {
  readonly game: TcgCode;
  searchCards(query: string): Promise<CardDTO[]>;
  fetchCardById(externalId: string): Promise<CardDTO | null>;
  fetchCardPrints?(externalId: string): Promise<CardPrintsResult>;
}
