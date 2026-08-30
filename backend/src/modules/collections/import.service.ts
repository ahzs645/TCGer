import type {
  CollectionImportOptions,
  CollectionImportIssue,
  CollectionImportPreview,
  CollectionImportPreviewRow,
  CollectionImportRequest,
  CollectionImportResult,
} from '@tcg/api-types';
import { tcgCodeSchema } from '@tcg/api-types';
import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { createCollectionAudit, snapshotCollectionEntries } from './collection-audit.service';
import { formatCollectionCopyCount } from './collection-copy-summary';
import { parseCollectionImportSource } from './collection-import-parser';

const MAX_ROWS = 2_000;
const MAX_COPIES = 500;
const REQUIRED_HEADERS = ['tcg', 'external_id', 'card_name'] as const;

const HEADER_ALIASES: Record<string, string> = {
  binder: 'binder_name',
  'card name': 'card_name',
  tcg: 'tcg',
  'set code': 'set_code',
  'set name': 'set_name',
  rarity: 'rarity',
  'external id': 'external_id',
  condition: 'condition',
  language: 'language',
  notes: 'notes',
  price: 'price',
  'acquisition price': 'acquisition_price',
  'serial number': 'serial_number',
  foil: 'is_foil',
  'finish code': 'finish_code',
  'finish label': 'finish_label',
  edition: 'edition',
  stamp: 'stamp',
  'sealed promo': 'is_sealed_promo',
  oversized: 'is_oversized',
  'peel-off': 'is_peel_off',
  signed: 'is_signed',
  altered: 'is_altered',
  tags: 'tags',
  'acquired at': 'acquired_at',
  'base external id': 'base_external_id',
  'printing key': 'printing_key',
  'artwork id': 'artwork_id',
  'collector number': 'collector_number',
  quantity: 'quantity',
  binder_name: 'binder_name',
  card_name: 'card_name',
  set_code: 'set_code',
  set_name: 'set_name',
  external_id: 'external_id',
  acquisition_price: 'acquisition_price',
  serial_number: 'serial_number',
  is_foil: 'is_foil',
  finish_code: 'finish_code',
  finish_label: 'finish_label',
  is_sealed_promo: 'is_sealed_promo',
  is_oversized: 'is_oversized',
  is_peel_off: 'is_peel_off',
  is_signed: 'is_signed',
  is_altered: 'is_altered',
  acquired_at: 'acquired_at',
  base_external_id: 'base_external_id',
  printing_key: 'printing_key',
  artwork_id: 'artwork_id',
  collector_number: 'collector_number',
};

export const COLLECTION_IMPORT_TEMPLATE_HEADERS = [
  'tcg',
  'external_id',
  'card_name',
  'base_external_id',
  'printing_key',
  'artwork_id',
  'collector_number',
  'set_code',
  'set_name',
  'rarity',
  'binder_name',
  'quantity',
  'condition',
  'language',
  'notes',
  'price',
  'acquisition_price',
  'serial_number',
  'acquired_at',
  'is_foil',
  'finish_code',
  'finish_label',
  'edition',
  'stamp',
  'is_sealed_promo',
  'is_oversized',
  'is_peel_off',
  'is_signed',
  'is_altered',
  'tags',
] as const;

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (quoted) {
    throw new Error('CSV contains an unterminated quoted field');
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizedHeader(value: string) {
  const key = value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLocaleLowerCase();
  return HEADER_ALIASES[key] ?? key.replace(/\s+/g, '_');
}

function optionalText(value: string | undefined) {
  const result = value?.trim();
  return result ? result : undefined;
}

function parseBoolean(
  value: string | undefined,
  row: number,
  field: string,
  issues: CollectionImportIssue[],
) {
  const normalized = value?.trim().toLocaleLowerCase();
  if (!normalized) return false;
  if (['yes', 'true', '1', 'y'].includes(normalized)) return true;
  if (['no', 'false', '0', 'n'].includes(normalized)) return false;
  issues.push({ row, field, message: 'must be yes/no, true/false, or 1/0' });
  return false;
}

function parseOptionalMoney(
  value: string | undefined,
  row: number,
  field: string,
  issues: CollectionImportIssue[],
) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    issues.push({ row, field, message: 'must be a finite, non-negative number' });
    return undefined;
  }
  return number;
}

export function previewCollectionImport(csv: string): CollectionImportPreview {
  let parsed: string[][];
  try {
    parsed = parseCsv(csv);
  } catch (error) {
    return {
      valid: false,
      rows: [],
      issues: [{ row: 1, message: error instanceof Error ? error.message : 'Invalid CSV' }],
      sourceRows: 0,
      totalCopies: 0,
    };
  }

  if (parsed.length === 0) {
    return {
      valid: false,
      rows: [],
      issues: [{ row: 1, message: 'CSV is empty' }],
      sourceRows: 0,
      totalCopies: 0,
    };
  }

  const headers = parsed[0].map(normalizedHeader);
  const issues: CollectionImportIssue[] = [];
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  for (const header of new Set(duplicates)) {
    issues.push({ row: 1, field: header, message: 'header appears more than once' });
  }
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      issues.push({ row: 1, field: required, message: 'required header is missing' });
    }
  }

  const dataRows = parsed
    .slice(1)
    .filter((values) => values.some((value) => value.trim().length > 0));
  if (dataRows.length > MAX_ROWS) {
    issues.push({ row: MAX_ROWS + 2, message: `CSV is limited to ${MAX_ROWS} data rows` });
  }

  const rows: CollectionImportPreviewRow[] = [];
  for (const [offset, values] of dataRows.slice(0, MAX_ROWS).entries()) {
    const rowNumber = offset + 2;
    if (values.length > headers.length) {
      issues.push({ row: rowNumber, message: 'row contains more columns than the header' });
      continue;
    }

    const source = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    );
    const tcg = source.tcg?.trim().toLocaleLowerCase();
    const externalId = source.external_id?.trim();
    const cardName = source.card_name?.trim();
    const before = issues.length;

    if (!tcgCodeSchema.safeParse(tcg).success) {
      issues.push({
        row: rowNumber,
        field: 'tcg',
        message: 'must be pokemon, magic, yugioh, onepiece, lorcana, or dragonball',
      });
    }
    if (!externalId) {
      issues.push({ row: rowNumber, field: 'external_id', message: 'is required' });
    }
    if (!cardName) {
      issues.push({ row: rowNumber, field: 'card_name', message: 'is required' });
    }

    const quantityText = source.quantity?.trim() || '1';
    const quantity = Number(quantityText);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      issues.push({
        row: rowNumber,
        field: 'quantity',
        message: 'must be a whole number between 1 and 500',
      });
    }

    const price = parseOptionalMoney(source.price, rowNumber, 'price', issues);
    const acquisitionPrice = parseOptionalMoney(
      source.acquisition_price,
      rowNumber,
      'acquisition_price',
      issues,
    );
    const acquiredAt = optionalText(source.acquired_at);
    if (acquiredAt && Number.isNaN(Date.parse(acquiredAt))) {
      issues.push({
        row: rowNumber,
        field: 'acquired_at',
        message: 'must be an ISO date or timestamp',
      });
    }

    const isFoil = parseBoolean(source.is_foil, rowNumber, 'is_foil', issues);
    const isSealedPromo = parseBoolean(
      source.is_sealed_promo,
      rowNumber,
      'is_sealed_promo',
      issues,
    );
    const isOversized = parseBoolean(source.is_oversized, rowNumber, 'is_oversized', issues);
    const isPeelOff = parseBoolean(source.is_peel_off, rowNumber, 'is_peel_off', issues);
    const isSigned = parseBoolean(source.is_signed, rowNumber, 'is_signed', issues);
    const isAltered = parseBoolean(source.is_altered, rowNumber, 'is_altered', issues);

    if (issues.length !== before) continue;
    rows.push({
      row: rowNumber,
      tcg: tcg as CollectionImportPreviewRow['tcg'],
      externalId,
      baseExternalId: optionalText(source.base_external_id),
      printingKey: optionalText(source.printing_key),
      artworkId: optionalText(source.artwork_id),
      cardName,
      collectorNumber: optionalText(source.collector_number),
      setCode: optionalText(source.set_code),
      setName: optionalText(source.set_name),
      rarity: optionalText(source.rarity),
      binderName: optionalText(source.binder_name),
      quantity,
      condition: optionalText(source.condition),
      language: optionalText(source.language),
      notes: optionalText(source.notes),
      price,
      acquisitionPrice,
      serialNumber: optionalText(source.serial_number),
      acquiredAt,
      isFoil,
      finishCode: optionalText(source.finish_code),
      finishLabel: optionalText(source.finish_label),
      edition: optionalText(source.edition),
      stamp: optionalText(source.stamp),
      isSealedPromo,
      isOversized,
      isPeelOff,
      isSigned,
      isAltered,
      tags: (source.tags ?? '')
        .split(';')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
  }

  const mergedRows = new Map<string, CollectionImportPreviewRow>();
  for (const row of rows) {
    const identity = JSON.stringify([
      row.tcg,
      row.externalId,
      row.baseExternalId ?? '',
      row.printingKey ?? '',
      row.artworkId ?? '',
      row.collectorNumber ?? '',
      row.binderName ?? '',
      row.condition ?? '',
      row.language ?? '',
      row.notes ?? '',
      row.price ?? null,
      row.acquisitionPrice ?? null,
      row.serialNumber ?? '',
      row.acquiredAt ?? '',
      row.isFoil,
      row.finishCode ?? '',
      row.finishLabel ?? '',
      row.edition ?? '',
      row.stamp ?? '',
      row.isSealedPromo,
      row.isOversized,
      row.isPeelOff,
      row.isSigned,
      row.isAltered,
      [...row.tags].sort(),
    ]);
    const existing = mergedRows.get(identity);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      mergedRows.set(identity, { ...row, tags: [...row.tags] });
    }
  }
  const plannedRows = Array.from(mergedRows.values());
  const totalCopies = plannedRows.reduce((sum, row) => sum + row.quantity, 0);
  if (totalCopies > MAX_COPIES) {
    issues.push({
      row: 1,
      field: 'quantity',
      message: `import is limited to ${MAX_COPIES} total copies`,
    });
  }

  return {
    valid: issues.length === 0 && plannedRows.length > 0,
    rows: plannedRows,
    issues,
    sourceRows: dataRows.length,
    totalCopies,
  };
}

export function collectionImportTemplate(): string {
  return `${COLLECTION_IMPORT_TEMPLATE_HEADERS.join(',')}\n`;
}

function csvField(value: unknown) {
  if (value === undefined || value === null) return '';
  const text = Array.isArray(value) ? value.join(';') : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizedImportCsv(rows: ReturnType<typeof parseCollectionImportSource>['rows']) {
  const values = rows.map((row) => ({
    tcg: row.tcg,
    external_id: row.externalId ?? `unresolved:${row.sourceRow}`,
    card_name: row.cardName,
    base_external_id: row.baseExternalId,
    printing_key: row.printingKey,
    artwork_id: row.artworkId,
    collector_number: row.collectorNumber,
    set_code: row.setCode,
    set_name: row.setName,
    rarity: row.rarity,
    binder_name: row.binderName,
    quantity: row.quantity,
    condition: row.condition,
    language: row.language,
    notes: row.notes,
    price: row.price,
    acquisition_price: row.acquisitionPrice,
    edition: row.edition,
    is_foil: row.isFoil,
    is_signed: row.isSigned,
    is_altered: row.isAltered,
    tags: row.tags,
  }));
  return [
    COLLECTION_IMPORT_TEMPLATE_HEADERS.join(','),
    ...values.map((row) =>
      COLLECTION_IMPORT_TEMPLATE_HEADERS.map((header) =>
        csvField(row[header as keyof typeof row]),
      ).join(','),
    ),
  ].join('\n');
}

function parseImportRequest(input: CollectionImportRequest) {
  const content = input.content ?? input.csv ?? '';
  const format = input.format ?? (input.csv && !input.content ? 'csv' : 'auto');
  return parseCollectionImportSource({
    content,
    format,
    fileName: input.fileName,
    resolutions: input.resolutions,
  });
}

export async function previewCollectionImportSourceForUser(
  userId: string,
  input: CollectionImportRequest,
): Promise<CollectionImportPreview> {
  const parsed = parseImportRequest(input);
  if (parsed.format === 'csv') {
    return {
      ...(await previewCollectionImportForUser(
        userId,
        input.content ?? input.csv ?? '',
        input.options,
      )),
      format: 'csv',
      failures: [],
      ambiguities: [],
    };
  }

  const preview = await previewCollectionImportForUser(
    userId,
    normalizedImportCsv(parsed.rows),
    input.options,
  );
  const sourceIssues: CollectionImportIssue[] = [
    ...parsed.failures.map((failure) => ({
      row: failure.sourceRow,
      field: failure.field,
      message: `[${failure.code}] ${failure.message}`,
    })),
    ...parsed.ambiguities.map((ambiguity) => ({
      row: ambiguity.sourceRow,
      field: 'external_id',
      message: `[${ambiguity.code}] ${ambiguity.message}`,
    })),
  ];
  const issues = [...preview.issues, ...sourceIssues];
  return {
    ...preview,
    valid: preview.rows.length > 0 && issues.length === 0,
    issues,
    sourceRows: parsed.sourceRows,
    format: parsed.format,
    failures: parsed.failures,
    ambiguities: parsed.ambiguities,
  };
}

export async function previewCollectionImportForUser(
  userId: string,
  csv: string,
  options: CollectionImportOptions = {
    createMissingBinders: false,
  },
): Promise<CollectionImportPreview> {
  const preview = previewCollectionImport(csv);
  if (!preview.rows.length) return preview;

  const binders = await prisma.binder.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const binderNames = new Set(binders.map((binder) => binder.name.toLocaleLowerCase()));
  const binderIds = new Set(binders.map((binder) => binder.id));
  const targetIssues: CollectionImportIssue[] = [];

  if (
    options.defaultBinderId &&
    options.defaultBinderId !== '__library__' &&
    !binderIds.has(options.defaultBinderId)
  ) {
    targetIssues.push({
      row: 1,
      field: 'defaultBinderId',
      message: 'default binder was not found',
    });
  }

  if (!options.createMissingBinders) {
    for (const row of preview.rows) {
      if (
        row.binderName &&
        row.binderName.toLocaleLowerCase() !== 'unsorted' &&
        !binderNames.has(row.binderName.toLocaleLowerCase())
      ) {
        targetIssues.push({
          row: row.row,
          field: 'binder_name',
          message: `binder "${row.binderName}" does not exist`,
        });
      }
    }
  }

  const issues = [...preview.issues, ...targetIssues];
  return { ...preview, valid: issues.length === 0 && preview.rows.length > 0, issues };
}

async function ensureImportTag(tx: Prisma.TransactionClient, userId: string, label: string) {
  return tx.tag.upsert({
    where: { userId_label: { userId, label } },
    update: {},
    create: { userId, label, colorHex: '64748b' },
  });
}

export async function commitCollectionImport(
  userId: string,
  csv: string,
  options: CollectionImportOptions = {
    createMissingBinders: false,
  },
): Promise<CollectionImportResult> {
  const preview = await previewCollectionImportForUser(userId, csv, options);
  if (!preview.valid) {
    return {
      ...preview,
      importedRows: 0,
      importedCopies: 0,
      createdBinders: [],
    };
  }

  const createdBinders: string[] = [];
  await prisma.$transaction(async (tx) => {
    const createdEntryIds: string[] = [];
    const games = await tx.tcgGame.findMany({
      where: { code: { in: Array.from(new Set(preview.rows.map((row) => row.tcg))) } },
    });
    const gamesByCode = new Map(games.map((game) => [game.code, game]));
    for (const row of preview.rows) {
      if (!gamesByCode.has(row.tcg)) {
        throw new Error(`TCG game "${row.tcg}" is not configured`);
      }
    }

    const binders = await tx.binder.findMany({ where: { userId } });
    const bindersByName = new Map(
      binders.map((binder) => [binder.name.toLocaleLowerCase(), binder]),
    );

    for (const row of preview.rows) {
      let binderId: string | null =
        options.defaultBinderId === '__library__' ? null : (options.defaultBinderId ?? null);
      if (row.binderName && row.binderName.toLocaleLowerCase() !== 'unsorted') {
        const key = row.binderName.toLocaleLowerCase();
        let binder = bindersByName.get(key);
        if (!binder && options.createMissingBinders) {
          binder = await tx.binder.create({
            data: { userId, name: row.binderName },
          });
          bindersByName.set(key, binder);
          createdBinders.push(binder.name);
        }
        binderId = binder?.id ?? binderId;
      }

      const game = gamesByCode.get(row.tcg)!;
      const identity = row.baseExternalId
        ? await tx.cardIdentity.upsert({
            where: {
              tcgGameId_externalId: {
                tcgGameId: game.id,
                externalId: row.baseExternalId,
              },
            },
            update: { name: row.cardName },
            create: {
              tcgGameId: game.id,
              externalId: row.baseExternalId,
              name: row.cardName,
            },
          })
        : undefined;
      let card = await tx.card.findUnique({
        where: {
          tcgGameId_externalId: {
            tcgGameId: game.id,
            externalId: row.externalId,
          },
        },
      });
      if (!card) {
        const conflictingId = await tx.card.findUnique({
          where: { id: row.externalId },
          select: { id: true },
        });
        card = await tx.card.create({
          data: {
            id: conflictingId ? `${row.tcg}:${row.externalId}` : row.externalId,
            tcgGameId: game.id,
            identityId: identity?.id,
            externalId: row.externalId,
            baseExternalId: row.baseExternalId,
            printingKey: row.printingKey,
            artworkId: row.artworkId,
            collectorNumber: row.collectorNumber,
            name: row.cardName,
            setCode: row.setCode,
            setName: row.setName,
            rarity: row.rarity,
          },
        });
      } else if (row.baseExternalId || row.printingKey || row.artworkId || row.collectorNumber) {
        card = await tx.card.update({
          where: { id: card.id },
          data: {
            identity: identity ? { connect: { id: identity.id } } : undefined,
            baseExternalId: row.baseExternalId,
            printingKey: row.printingKey,
            artworkId: row.artworkId,
            collectorNumber: row.collectorNumber,
            setCode: row.setCode,
            setName: row.setName,
            rarity: row.rarity,
          },
        });
      }

      const tags = [];
      for (const label of row.tags) {
        tags.push(await ensureImportTag(tx, userId, label));
      }

      for (let copy = 0; copy < row.quantity; copy += 1) {
        const entry = await tx.collection.create({
          data: {
            userId,
            cardId: card.id,
            binderId,
            quantity: 1,
            condition: row.condition,
            language: row.language,
            notes: row.notes,
            price: row.price,
            acquisitionPrice: row.acquisitionPrice,
            serialNumber: row.serialNumber,
            acquiredAt: row.acquiredAt ? new Date(row.acquiredAt) : undefined,
            isFoil: row.isFoil,
            finishCode: row.finishCode,
            finishLabel: row.finishLabel,
            edition: row.edition,
            stamp: row.stamp,
            isSealedPromo: row.isSealedPromo,
            isOversized: row.isOversized,
            isPeelOff: row.isPeelOff,
            isSigned: row.isSigned,
            isAltered: row.isAltered,
          },
        });
        createdEntryIds.push(entry.id);
        if (tags.length) {
          await tx.collectionTag.createMany({
            data: tags.map((tag) => ({
              collectionId: entry.id,
              tagId: tag.id,
            })),
          });
        }
      }
    }
    const after = await snapshotCollectionEntries(tx, userId, createdEntryIds);
    await createCollectionAudit(tx, {
      userId,
      operationKind: 'import',
      summary: `Imported ${formatCollectionCopyCount(createdEntryIds.length)}`,
      before: [],
      after,
      metadata: {
        sourceRows: preview.sourceRows,
        importedRows: preview.rows.length,
        createdBinders,
      },
    });
  });

  return {
    ...preview,
    importedRows: preview.rows.length,
    importedCopies: preview.totalCopies,
    createdBinders,
  };
}

export async function commitCollectionImportSource(
  userId: string,
  input: CollectionImportRequest,
): Promise<CollectionImportResult> {
  const preview = await previewCollectionImportSourceForUser(userId, input);
  if (!preview.valid) {
    return {
      ...preview,
      importedRows: 0,
      importedCopies: 0,
      createdBinders: [],
    };
  }

  const parsed = parseImportRequest(input);
  const csv =
    parsed.format === 'csv' ? (input.content ?? input.csv ?? '') : normalizedImportCsv(parsed.rows);
  const result = await commitCollectionImport(userId, csv, input.options);
  return {
    ...result,
    format: parsed.format,
    failures: parsed.failures,
    ambiguities: parsed.ambiguities,
  };
}
