import type { TcgCode } from "./validators";

export type CollectionImportIssue = {
  row: number;
  field?: string;
  message: string;
};

export type CollectionImportRow = {
  row: number;
  tcg: TcgCode;
  externalId: string;
  cardName: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  binderName?: string;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  isFoil: boolean;
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isSealedPromo: boolean;
  isOversized: boolean;
  isPeelOff: boolean;
  isSigned: boolean;
  isAltered: boolean;
  tags: string[];
};

export type CollectionImportPreview = {
  valid: boolean;
  rows: CollectionImportRow[];
  issues: CollectionImportIssue[];
  sourceRows: number;
  totalCopies: number;
};

const MAX_ROWS = 2_000;
const MAX_COPIES = 500;
const REQUIRED_HEADERS = ["tcg", "external_id", "card_name"];

const HEADER_ALIASES: Record<string, string> = {
  binder: "binder_name",
  "card name": "card_name",
  "set code": "set_code",
  "set name": "set_name",
  "external id": "external_id",
  "acquisition price": "acquisition_price",
  "serial number": "serial_number",
  foil: "is_foil",
  "finish code": "finish_code",
  "finish label": "finish_label",
  "sealed promo": "is_sealed_promo",
  oversized: "is_oversized",
  "peel-off": "is_peel_off",
  signed: "is_signed",
  altered: "is_altered",
  "acquired at": "acquired_at",
};

export const collectionImportTemplateHeaders = [
  "tcg",
  "external_id",
  "card_name",
  "set_code",
  "set_name",
  "rarity",
  "binder_name",
  "quantity",
  "condition",
  "language",
  "notes",
  "price",
  "acquisition_price",
  "serial_number",
  "acquired_at",
  "is_foil",
  "finish_code",
  "finish_label",
  "edition",
  "stamp",
  "is_sealed_promo",
  "is_oversized",
  "is_peel_off",
  "is_signed",
  "is_altered",
  "tags",
] as const;

function parseCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string) {
  const key = value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase();
  return HEADER_ALIASES[key] ?? key.replace(/\s+/g, "_");
}

function optionalText(value: string | undefined) {
  return value?.trim() || undefined;
}

function parseBoolean(
  value: string | undefined,
  row: number,
  field: string,
  issues: CollectionImportIssue[],
) {
  const normalized = value?.trim().toLocaleLowerCase();
  if (!normalized) return false;
  if (["yes", "true", "1", "y"].includes(normalized)) return true;
  if (["no", "false", "0", "n"].includes(normalized)) return false;
  issues.push({ row, field, message: "must be yes/no, true/false, or 1/0" });
  return false;
}

function parseMoney(
  value: string | undefined,
  row: number,
  field: string,
  issues: CollectionImportIssue[],
) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    issues.push({
      row,
      field,
      message: "must be a finite, non-negative number",
    });
    return undefined;
  }
  return number;
}

export function collectionImportTemplate() {
  return `${collectionImportTemplateHeaders.join(",")}\n`;
}

export function previewCollectionImport(csv: string): CollectionImportPreview {
  let parsed: string[][];
  try {
    parsed = parseCsv(csv);
  } catch (error) {
    return {
      valid: false,
      rows: [],
      issues: [
        {
          row: 1,
          message: error instanceof Error ? error.message : "Invalid CSV",
        },
      ],
      sourceRows: 0,
      totalCopies: 0,
    };
  }

  if (!parsed.length) {
    return {
      valid: false,
      rows: [],
      issues: [{ row: 1, message: "CSV is empty" }],
      sourceRows: 0,
      totalCopies: 0,
    };
  }

  const headers = parsed[0].map(normalizeHeader);
  const issues: CollectionImportIssue[] = [];
  for (const header of new Set(
    headers.filter((value, index) => headers.indexOf(value) !== index),
  )) {
    issues.push({
      row: 1,
      field: header,
      message: "header appears more than once",
    });
  }
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      issues.push({
        row: 1,
        field: required,
        message: "required header is missing",
      });
    }
  }

  const dataRows = parsed
    .slice(1)
    .filter((values) => values.some((value) => value.trim().length > 0));
  if (dataRows.length > MAX_ROWS) {
    issues.push({
      row: MAX_ROWS + 2,
      message: `CSV is limited to ${MAX_ROWS} data rows`,
    });
  }

  const validRows: CollectionImportRow[] = [];
  for (const [offset, values] of dataRows.slice(0, MAX_ROWS).entries()) {
    const rowNumber = offset + 2;
    if (values.length > headers.length) {
      issues.push({
        row: rowNumber,
        message: "row contains more columns than the header",
      });
      continue;
    }
    const source = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
    const before = issues.length;
    const tcg = source.tcg?.trim().toLocaleLowerCase();
    const externalId = source.external_id?.trim();
    const cardName = source.card_name?.trim();
    if (
      !["pokemon", "magic", "yugioh", "onepiece", "lorcana", "dragonball"].includes(tcg)
    ) {
      issues.push({
        row: rowNumber,
        field: "tcg",
        message: "must be pokemon, magic, yugioh, onepiece, lorcana, or dragonball",
      });
    }
    if (!externalId)
      issues.push({
        row: rowNumber,
        field: "external_id",
        message: "is required",
      });
    if (!cardName)
      issues.push({
        row: rowNumber,
        field: "card_name",
        message: "is required",
      });

    const quantity = Number(source.quantity?.trim() || "1");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      issues.push({
        row: rowNumber,
        field: "quantity",
        message: "must be a whole number between 1 and 500",
      });
    }
    const price = parseMoney(source.price, rowNumber, "price", issues);
    const acquisitionPrice = parseMoney(
      source.acquisition_price,
      rowNumber,
      "acquisition_price",
      issues,
    );
    const acquiredAt = optionalText(source.acquired_at);
    if (acquiredAt && Number.isNaN(Date.parse(acquiredAt))) {
      issues.push({
        row: rowNumber,
        field: "acquired_at",
        message: "must be an ISO date or timestamp",
      });
    }
    const isFoil = parseBoolean(source.is_foil, rowNumber, "is_foil", issues);
    const isSealedPromo = parseBoolean(
      source.is_sealed_promo,
      rowNumber,
      "is_sealed_promo",
      issues,
    );
    const isOversized = parseBoolean(
      source.is_oversized,
      rowNumber,
      "is_oversized",
      issues,
    );
    const isPeelOff = parseBoolean(
      source.is_peel_off,
      rowNumber,
      "is_peel_off",
      issues,
    );
    const isSigned = parseBoolean(
      source.is_signed,
      rowNumber,
      "is_signed",
      issues,
    );
    const isAltered = parseBoolean(
      source.is_altered,
      rowNumber,
      "is_altered",
      issues,
    );
    if (issues.length !== before) continue;

    validRows.push({
      row: rowNumber,
      tcg: tcg as CollectionImportRow["tcg"],
      externalId,
      cardName,
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
      tags: (source.tags ?? "")
        .split(";")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
  }

  const merged = new Map<string, CollectionImportRow>();
  for (const row of validRows) {
    const key = JSON.stringify([
      row.tcg,
      row.externalId,
      row.binderName ?? "",
      row.condition ?? "",
      row.language ?? "",
      row.notes ?? "",
      row.price ?? null,
      row.acquisitionPrice ?? null,
      row.serialNumber ?? "",
      row.acquiredAt ?? "",
      row.isFoil,
      row.finishCode ?? "",
      row.finishLabel ?? "",
      row.edition ?? "",
      row.stamp ?? "",
      row.isSealedPromo,
      row.isOversized,
      row.isPeelOff,
      row.isSigned,
      row.isAltered,
      [...row.tags].sort(),
    ]);
    const existing = merged.get(key);
    if (existing) existing.quantity += row.quantity;
    else merged.set(key, { ...row, tags: [...row.tags] });
  }

  const rows = [...merged.values()];
  const totalCopies = rows.reduce((sum, row) => sum + row.quantity, 0);
  if (totalCopies > MAX_COPIES) {
    issues.push({
      row: 1,
      field: "quantity",
      message: `import is limited to ${MAX_COPIES} total copies`,
    });
  }
  return {
    valid: issues.length === 0 && rows.length > 0,
    rows,
    issues,
    sourceRows: dataRows.length,
    totalCopies,
  };
}
