import type { ImportDeckInput } from '@tcg/api-types';
import { parseTextDeckList } from './text-parser';

export interface ImportedCard {
  name: string;
  quantity: number;
  isSideboard: boolean;
  setCode?: string;
}

export async function parseImportSource(input: ImportDeckInput): Promise<{ cards: ImportedCard[]; name?: string }> {
  switch (input.source) {
    case 'text':
    case 'arena':
      return { cards: parseTextDeckList(input.data), name: input.name };

    case 'moxfield': {
      // Moxfield public API: GET https://api2.moxfield.com/v3/decks/all/<id>
      const deckId = extractIdFromUrl(input.data, 'moxfield.com');
      if (!deckId) return { cards: parseTextDeckList(input.data) };
      try {
        const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${deckId}`);
        if (!res.ok) throw new Error('Moxfield API error');
        const data = await res.json();
        const cards: ImportedCard[] = [];
        for (const [, v] of Object.entries(data.mainboard || {})) {
          const entry = v as any;
          cards.push({ name: entry.card?.name || '', quantity: entry.quantity || 1, isSideboard: false });
        }
        for (const [, v] of Object.entries(data.sideboard || {})) {
          const entry = v as any;
          cards.push({ name: entry.card?.name || '', quantity: entry.quantity || 1, isSideboard: true });
        }
        return { cards, name: data.name };
      } catch {
        return { cards: parseTextDeckList(input.data) };
      }
    }

    case 'archidekt': {
      const deckId = extractIdFromUrl(input.data, 'archidekt.com');
      if (!deckId) return { cards: parseTextDeckList(input.data) };
      try {
        const res = await fetch(`https://archidekt.com/api/decks/${deckId}/`);
        if (!res.ok) throw new Error('Archidekt API error');
        const data = await res.json();
        const cards: ImportedCard[] = (data.cards || []).map((c: any) => ({
          name: c.card?.oracleCard?.name || c.card?.name || '',
          quantity: c.quantity || 1,
          isSideboard: c.categories?.includes('Sideboard') || false
        }));
        return { cards, name: data.name };
      } catch {
        return { cards: parseTextDeckList(input.data) };
      }
    }

    case 'mtggoldfish':
    case 'ygoprodeck':
      // For URL-based sources, fall back to text parsing
      return { cards: parseTextDeckList(input.data), name: input.name };

    default:
      return { cards: parseTextDeckList(input.data) };
  }
}

function extractIdFromUrl(input: string, domain: string): string | null {
  try {
    const url = new URL(input.startsWith('http') ? input : `https://${input}`);
    if (!url.hostname.includes(domain)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}
