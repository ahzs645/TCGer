import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Card, TcgCode } from '@tcg/api-types';

interface CatalogManifest {
  games?: Partial<Record<TcgCode, { file?: string }>>;
}

interface CatalogSet {
  code: string;
  name: string;
  serie?: string;
  releasedAt?: string;
  iconUrl?: string;
  logoUrl?: string;
}

interface CatalogCard {
  id: string;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  rarity?: string;
  artist?: string;
  type?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  printingKey?: string;
  printingKind?: string;
  sanctionedPlayLegal?: boolean;
  originalPrintingKey?: string;
  collectionTags?: string[];
  [key: string]: unknown;
}

interface CatalogPack {
  tcg: TcgCode;
  sets: CatalogSet[];
  cards: CatalogCard[];
}

const loadedPacks = new Map<TcgCode, Promise<CatalogPack | undefined>>();

function catalogDirectory(): string {
  return resolve(process.env.CATALOG_DATA_DIR ?? resolve(process.cwd(), '../data/catalog'));
}

async function loadPack(tcg: TcgCode): Promise<CatalogPack | undefined> {
  const existing = loadedPacks.get(tcg);
  if (existing) return existing;
  const loading = (async () => {
    try {
      const directory = catalogDirectory();
      const manifest = JSON.parse(
        await readFile(resolve(directory, 'manifest.json'), 'utf8'),
      ) as CatalogManifest;
      const filename = manifest.games?.[tcg]?.file;
      if (!filename) return undefined;
      return JSON.parse(await readFile(resolve(directory, filename), 'utf8')) as CatalogPack;
    } catch {
      return undefined;
    }
  })();
  loadedPacks.set(tcg, loading);
  return loading;
}

function imageUrls(tcg: TcgCode, card: CatalogCard, set?: CatalogSet) {
  if (card.imageUrl || card.imageUrlSmall) {
    return {
      imageUrl: card.imageUrl ?? card.imageUrlSmall,
      imageUrlSmall: card.imageUrlSmall ?? card.imageUrl,
    };
  }
  if (tcg === 'pokemon' && set?.serie && card.setCode && card.collectorNumber) {
    const root = `https://assets.tcgdex.net/en/${encodeURIComponent(set.serie)}/${encodeURIComponent(card.setCode)}/${encodeURIComponent(card.collectorNumber)}`;
    return { imageUrl: `${root}/high.webp`, imageUrlSmall: `${root}/low.webp` };
  }
  if (tcg === 'magic' && card.id.length > 1) {
    const path = `${card.id[0]}/${card.id[1]}/${card.id}.jpg`;
    return {
      imageUrl: `https://cards.scryfall.io/normal/front/${path}`,
      imageUrlSmall: `https://cards.scryfall.io/small/front/${path}`,
    };
  }
  return {};
}

function mapCard(tcg: TcgCode, card: CatalogCard, set?: CatalogSet): Card {
  const { collectionTags: _collectionTags, ...catalogAttributes } = card;
  return {
    id: card.id,
    tcg,
    name: card.name,
    setCode: card.setCode,
    setName: set?.name,
    rarity: card.rarity,
    artist: card.artist,
    collectorNumber: card.collectorNumber,
    releasedAt: set?.releasedAt,
    setSymbolUrl: set?.iconUrl,
    setLogoUrl: set?.logoUrl,
    supertype: tcg === 'pokemon' ? card.type : undefined,
    printingKey: card.printingKey,
    printingKind: card.printingKind,
    sanctionedPlayLegal: card.sanctionedPlayLegal,
    originalPrintingKey: card.originalPrintingKey,
    attributes: {
      ...catalogAttributes,
      collection_tags: card.collectionTags ?? [],
    },
    ...imageUrls(tcg, card, set),
  };
}

export async function searchCatalogCardsByTag(
  tcg: TcgCode,
  tag: string,
  limit = 2000,
): Promise<Card[]> {
  const pack = await loadPack(tcg);
  if (!pack) return [];
  const normalized = tag.trim().toLowerCase();
  const sets = new Map(pack.sets.map((set) => [set.code, set] as const));
  return pack.cards
    .filter((card) => card.collectionTags?.some((value) => value.toLowerCase() === normalized))
    .slice(0, limit)
    .map((card) => mapCard(tcg, card, card.setCode ? sets.get(card.setCode) : undefined));
}
