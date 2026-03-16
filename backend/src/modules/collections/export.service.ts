import { prisma } from '../../lib/prisma';

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

export async function exportCollectionAsJson(userId: string) {
  const collections = await prisma.collection.findMany({
    where: { userId },
    include: collectionExportInclude,
    orderBy: { createdAt: 'asc' }
  });

  return collections.map((entry) => ({
    binderName: entry.binder?.name ?? 'Unsorted',
    cardName: entry.card.name,
    tcg: entry.card.tcgGame.code,
    setCode: entry.card.setCode,
    setName: entry.card.setName,
    rarity: entry.card.rarity,
    externalId: entry.card.externalId,
    condition: entry.condition,
    language: entry.language,
    notes: entry.notes,
    price: entry.price ? parseFloat(entry.price.toString()) : null,
    acquisitionPrice: entry.acquisitionPrice ? parseFloat(entry.acquisitionPrice.toString()) : null,
    serialNumber: entry.serialNumber,
    isFoil: entry.isFoil,
    isSigned: entry.isSigned,
    isAltered: entry.isAltered,
    tags: entry.tags.map((t) => t.tag.label),
    acquiredAt: entry.acquiredAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString()
  }));
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

export async function exportCollectionAsCsv(userId: string): Promise<string> {
  const data = await exportCollectionAsJson(userId);

  const headers = [
    'Binder',
    'Card Name',
    'TCG',
    'Set Code',
    'Set Name',
    'Rarity',
    'External ID',
    'Condition',
    'Language',
    'Notes',
    'Price',
    'Acquisition Price',
    'Serial Number',
    'Foil',
    'Signed',
    'Altered',
    'Tags',
    'Acquired At',
    'Created At'
  ];

  const rows = data.map((entry) =>
    [
      escapeCsvField(entry.binderName),
      escapeCsvField(entry.cardName),
      escapeCsvField(entry.tcg),
      escapeCsvField(entry.setCode),
      escapeCsvField(entry.setName),
      escapeCsvField(entry.rarity),
      escapeCsvField(entry.externalId),
      escapeCsvField(entry.condition),
      escapeCsvField(entry.language),
      escapeCsvField(entry.notes),
      entry.price !== null ? String(entry.price) : '',
      entry.acquisitionPrice !== null ? String(entry.acquisitionPrice) : '',
      escapeCsvField(entry.serialNumber),
      entry.isFoil ? 'Yes' : 'No',
      entry.isSigned ? 'Yes' : 'No',
      entry.isAltered ? 'Yes' : 'No',
      escapeCsvField(entry.tags.join('; ')),
      escapeCsvField(entry.acquiredAt),
      escapeCsvField(entry.createdAt)
    ].join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
