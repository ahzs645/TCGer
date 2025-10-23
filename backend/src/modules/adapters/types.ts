export type TcgCode = 'yugioh' | 'magic' | 'pokemon';

export interface CardDTO {
  id: string;
  tcg: TcgCode;
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  setSymbolUrl?: string;
  attributes?: Record<string, unknown>;
}

export interface TcgAdapter {
  readonly game: TcgCode;
  searchCards(query: string): Promise<CardDTO[]>;
  fetchCardById(externalId: string): Promise<CardDTO | null>;
}
