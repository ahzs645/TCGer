import { prisma } from '../../lib/prisma';
import type { Prisma } from '@prisma/client';

const collectionExportInclude = {
  binder: {
    select: {
      id: true,
      name: true,
      colorHex: true
    }
  },
  card: {
    include: {
      tcgGame: true
    }
  },
  tags: {
    include: {
      tag: true
    }
  }
} as const;

function asJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function exportCollectionAsJson(userId: string) {
  const collections = await prisma.collection.findMany({
    where: { userId },
    include: collectionExportInclude,
    orderBy: { createdAt: 'asc' }
  });

  return collections.map((entry) => {
    const metadata = asJsonObject(entry.card.tcgSpecific);
    return {
      binderName: entry.binder?.name ?? 'Unsorted',
      quantity: entry.quantity,
      cardName: entry.card.name,
      tcg: entry.card.tcgGame.code,
      setCode: entry.card.setCode,
      setName: entry.card.setName,
      rarity: entry.card.rarity,
      externalId: entry.card.externalId,
      baseExternalId: entry.card.baseExternalId,
      printingKey: entry.card.printingKey,
      artworkId: entry.card.artworkId,
      collectorNumber: entry.card.collectorNumber ?? metadata.collectorNumber ?? null,
      releasedAt: metadata.releasedAt ?? null,
      setSymbolUrl: metadata.setSymbolUrl ?? null,
      setLogoUrl: metadata.setLogoUrl ?? null,
      regulationMark: metadata.regulationMark ?? null,
      printLanguage: metadata.language ?? null,
      supertype: metadata.supertype ?? null,
      formatLegality: metadata.formatLegality ?? null,
      dexEntries: metadata.dexEntries ?? null,
      region: metadata.region ?? null,
      pokemonPrint: metadata.pokemonPrint ?? null,
      attributes: metadata.attributes ?? null,
      provenance: metadata.provenance ?? null,
      legalityPeriods: metadata.legalityPeriods ?? null,
      evolution: metadata.evolution ?? null,
      functionalIdentity: metadata.functionalIdentity ?? null,
      condition: entry.condition,
      language: entry.language,
      notes: entry.notes,
      price: entry.price ? parseFloat(entry.price.toString()) : null,
      acquisitionPrice: entry.acquisitionPrice ? parseFloat(entry.acquisitionPrice.toString()) : null,
      serialNumber: entry.serialNumber,
      isFoil: entry.isFoil,
      finishCode: entry.finishCode,
      finishLabel: entry.finishLabel,
      edition: entry.edition,
      stamp: entry.stamp,
      isSealedPromo: entry.isSealedPromo,
      isOversized: entry.isOversized,
      isPeelOff: entry.isPeelOff,
      isSigned: entry.isSigned,
      isAltered: entry.isAltered,
      gradingCompany: entry.gradingCompany,
      gradingScore: entry.gradingScore,
      certNumber: entry.certNumber,
      storageLocation: entry.storageLocation,
      tags: entry.tags.map((t) => t.tag.label),
      acquiredAt: entry.acquiredAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString()
    };
  });
}

function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeCsvJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return escapeCsvField(String(value));
  }
  return escapeCsvField(JSON.stringify(value));
}

export async function exportCollectionAsCsv(userId: string): Promise<string> {
  const data = await exportCollectionAsJson(userId);

  const headers = [
    'Binder',
    'Quantity',
    'Card Name',
    'TCG',
    'Set Code',
    'Set Name',
    'Rarity',
    'External ID',
    'Base External ID',
    'Printing Key',
    'Artwork ID',
    'Collector Number',
    'Released At',
    'Set Symbol URL',
    'Set Logo URL',
    'Regulation Mark',
    'Print Language',
    'Supertype',
    'Format Legality',
    'Pokédex Entries',
    'Region',
    'Pokémon Print',
    'Attributes',
    'Provenance',
    'Legality Periods',
    'Evolution',
    'Functional Identity',
    'Condition',
    'Language',
    'Notes',
    'Price',
    'Acquisition Price',
    'Serial Number',
    'Foil',
    'Finish Code',
    'Finish Label',
    'Edition',
    'Stamp',
    'Sealed Promo',
    'Oversized',
    'Peel-Off',
    'Signed',
    'Altered',
    'Grading Company',
    'Grading Score',
    'Certificate Number',
    'Storage Location',
    'Tags',
    'Acquired At',
    'Created At'
  ];

  const rows = data.map((entry) =>
    [
      escapeCsvField(entry.binderName),
      String(entry.quantity),
      escapeCsvField(entry.cardName),
      escapeCsvField(entry.tcg),
      escapeCsvField(entry.setCode),
      escapeCsvField(entry.setName),
      escapeCsvField(entry.rarity),
      escapeCsvField(entry.externalId),
      escapeCsvField(entry.baseExternalId),
      escapeCsvField(entry.printingKey),
      escapeCsvField(entry.artworkId),
      escapeCsvJson(entry.collectorNumber),
      escapeCsvJson(entry.releasedAt),
      escapeCsvJson(entry.setSymbolUrl),
      escapeCsvJson(entry.setLogoUrl),
      escapeCsvJson(entry.regulationMark),
      escapeCsvJson(entry.printLanguage),
      escapeCsvJson(entry.supertype),
      escapeCsvJson(entry.formatLegality),
      escapeCsvJson(entry.dexEntries),
      escapeCsvJson(entry.region),
      escapeCsvJson(entry.pokemonPrint),
      escapeCsvJson(entry.attributes),
      escapeCsvJson(entry.provenance),
      escapeCsvJson(entry.legalityPeriods),
      escapeCsvJson(entry.evolution),
      escapeCsvJson(entry.functionalIdentity),
      escapeCsvField(entry.condition),
      escapeCsvField(entry.language),
      escapeCsvField(entry.notes),
      entry.price !== null ? String(entry.price) : '',
      entry.acquisitionPrice !== null ? String(entry.acquisitionPrice) : '',
      escapeCsvField(entry.serialNumber),
      entry.isFoil ? 'Yes' : 'No',
      escapeCsvField(entry.finishCode),
      escapeCsvField(entry.finishLabel),
      escapeCsvField(entry.edition),
      escapeCsvField(entry.stamp),
      entry.isSealedPromo ? 'Yes' : 'No',
      entry.isOversized ? 'Yes' : 'No',
      entry.isPeelOff ? 'Yes' : 'No',
      entry.isSigned ? 'Yes' : 'No',
      entry.isAltered ? 'Yes' : 'No',
      escapeCsvField(entry.gradingCompany),
      escapeCsvField(entry.gradingScore),
      escapeCsvField(entry.certNumber),
      escapeCsvField(entry.storageLocation),
      escapeCsvField(entry.tags.join('; ')),
      escapeCsvField(entry.acquiredAt),
      escapeCsvField(entry.createdAt)
    ].join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

export async function exportCollectionForMarketplace(
  userId: string,
  format: 'manabox' | 'moxfield' | 'tcgplayer' | 'collectr',
) {
  const data = await exportCollectionAsJson(userId);
  const profiles = {
    manabox: {
      headers: ['Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity', 'Quantity', 'Scryfall ID', 'Purchase price', 'Condition', 'Language', 'Binder Name'],
      values: (row: (typeof data)[number]) => [row.cardName, row.setCode, row.setName, row.collectorNumber, row.isFoil ? 'foil' : 'normal', row.rarity, row.quantity, row.tcg === 'magic' ? row.externalId : '', row.acquisitionPrice, row.condition, row.language, row.binderName],
    },
    moxfield: {
      headers: ['Count', 'Name', 'Edition', 'Condition', 'Language', 'Foil', 'Tags', 'Collector Number', 'Purchase Price', 'Scryfall ID'],
      values: (row: (typeof data)[number]) => [row.quantity, row.cardName, row.setCode, row.condition, row.language, row.isFoil ? 'foil' : '', row.tags.join(';'), row.collectorNumber, row.acquisitionPrice, row.tcg === 'magic' ? row.externalId : ''],
    },
    tcgplayer: {
      headers: ['TCGplayer Id', 'Product Line', 'Set Name', 'Product Name', 'Rarity', 'Condition', 'TCG Market Price', 'Total Quantity'],
      values: (row: (typeof data)[number]) => [row.externalId.startsWith('tcgplayer:') ? row.externalId.slice(10) : '', row.tcg, row.setName, row.cardName, row.rarity, row.condition, row.price, row.quantity],
    },
    collectr: {
      headers: ['Card', 'Game', 'Set', 'Set Code', 'Number', 'Rarity', 'Variant', 'Condition', 'Quantity', 'Market Price', 'External ID'],
      values: (row: (typeof data)[number]) => [row.cardName, row.tcg, row.setName, row.setCode, row.collectorNumber, row.rarity, row.finishLabel ?? (row.isFoil ? 'Foil' : 'Normal'), row.condition, row.quantity, row.price, row.externalId],
    },
  } as const;
  const profile = profiles[format];
  return [
    profile.headers.map(escapeCsvJson).join(','),
    ...data.map((row) => profile.values(row).map(escapeCsvJson).join(',')),
  ].join('\n');
}
