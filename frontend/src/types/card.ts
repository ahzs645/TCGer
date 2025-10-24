export type TcgCode = 'yugioh' | 'magic' | 'pokemon';

export interface Card {
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

export interface CollectionCard extends Card {
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  priceHistory?: number[];
  binderId?: string;
  binderName?: string;
}

export interface SearchCardsResponse {
  cards: Card[];
}
