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
  attributes?: Record<string, unknown>;
}

export type { CollectionCardCopy, CollectionCard } from '@/lib/api/collections';

export interface SearchCardsResponse {
  cards: Card[];
}
