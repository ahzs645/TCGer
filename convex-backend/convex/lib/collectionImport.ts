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
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  cardName: string;
  collectorNumber?: string;
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
  "base_external_id",
  "printing_key",
  "artwork_id",
  "collector_number",
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

export type CollectionImportSourceOptions = {
  content: string;
  fileName?: string;
  format?:
    | "auto"
    | "csv"
    | "json"
    | "cardmarket-text"
    | "pdf"
    | "manabox-csv"
    | "moxfield-csv"
    | "tcgplayer-csv"
    | "collectr-csv";
  resolutions?: Record<string, {
    externalId: string; baseExternalId?: string; printingKey?: string; artworkId?: string;
    collectorNumber?: string; setCode?: string; setName?: string; rarity?: string; cardName?: string;
  }>;
};

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function detectedFormat(input: CollectionImportSourceOptions) {
  if (input.format && input.format !== "auto") return input.format;
  if (input.fileName?.toLowerCase().endsWith(".pdf")) return "pdf";
  const trimmed = input.content.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  if (/yugioh singles:/i.test(input.content)) return "cardmarket-text";
  const headers = (parseCsv(input.content)[0] ?? []).map(normalizeHeader);
  if (headers.includes("manabox_id") || headers.includes("scryfall_id") && headers.includes("purchase_price_currency")) return "manabox-csv";
  if (headers.includes("tradelist_count") || headers.includes("last_modified") && headers.includes("edition")) return "moxfield-csv";
  if (headers.includes("tcgplayer_id") || headers.includes("product_line") && headers.includes("tcg_market_price")) return "tcgplayer-csv";
  if (headers.includes("market_price") && headers.includes("variant") && (headers.includes("card") || headers.includes("product_name"))) return "collectr-csv";
  return "csv";
}

function normalizedCsv(rows: Array<Record<string, unknown>>) {
  return [collectionImportTemplateHeaders.join(","), ...rows.map(row =>
    collectionImportTemplateHeaders.map(header => csvCell(row[header])).join(",")
  )].join("\n");
}

type MarketplaceFormat = "manabox-csv" | "moxfield-csv" | "tcgplayer-csv" | "collectr-csv";

function first(source: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function profileTcg(format: MarketplaceFormat, source: Record<string, string>): TcgCode | undefined {
  if (format === "manabox-csv" || format === "moxfield-csv") return "magic";
  const value = (first(source, "tcg", "game", "product_line") ?? "").toLocaleLowerCase();
  if (value.includes("magic")) return "magic";
  if (value.includes("pokemon")) return "pokemon";
  if (value.includes("yu-gi-oh") || value.includes("yugioh")) return "yugioh";
  if (value.includes("one piece")) return "onepiece";
  if (value.includes("lorcana")) return "lorcana";
  if (value.includes("dragon ball")) return "dragonball";
  return undefined;
}

function marketplaceRows(
  input: CollectionImportSourceOptions,
  format: MarketplaceFormat,
) {
  let parsed: string[][];
  try {
    parsed = parseCsv(input.content);
  } catch (error) {
    return {
      rows: [] as Array<Record<string, unknown>>,
      issues: [{ row: 1, message: error instanceof Error ? error.message : "Invalid CSV" }],
      sourceRows: 0,
    };
  }
  const headers = (parsed[0] ?? []).map(normalizeHeader);
  const records = parsed.slice(1).filter((values) => values.some((value) => value.trim()));
  const rows: Array<Record<string, unknown>> = [];
  const issues: CollectionImportIssue[] = [];
  records.slice(0, MAX_ROWS).forEach((values, offset) => {
    const sourceRow = offset + 2;
    const source = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const resolution = input.resolutions?.[String(sourceRow)] ?? input.resolutions?.[String(offset + 1)];
    const tcg = profileTcg(format, source);
    const scryfallId = first(source, "scryfall_id", "scryfallid");
    const tcgplayerId = first(source, "tcgplayer_id", "tcgplayerid", "product_id");
    const externalId = resolution?.externalId ?? scryfallId ?? first(source, "external_id") ?? (tcgplayerId ? `tcgplayer:${tcgplayerId}` : undefined);
    const cardName = resolution?.cardName ?? first(source, "card_name", "name", "card", "product_name");
    if (!tcg) issues.push({ row: sourceRow, field: "tcg", message: "The marketplace game could not be identified" });
    if (!cardName) issues.push({ row: sourceRow, field: "card_name", message: "Card name is required" });
    if (!externalId) {
      issues.push({ row: sourceRow, field: "externalId", message: "Exact printing resolution is required for this marketplace row" });
      return;
    }
    if (!tcg || !cardName) return;
    const foil = (first(source, "foil", "is_foil", "variant", "printing") ?? "").toLocaleLowerCase();
    const finishCode = foil.includes("etched") ? "etched" : foil.includes("foil") || ["true", "yes"].includes(foil) ? "foil" : "nonfoil";
    rows.push({
      tcg,
      external_id: externalId,
      base_external_id: resolution?.baseExternalId,
      printing_key: resolution?.printingKey,
      artwork_id: resolution?.artworkId,
      card_name: cardName,
      collector_number: resolution?.collectorNumber ?? first(source, "collector_number", "card_number", "number"),
      set_code: resolution?.setCode ?? first(source, "set_code", "edition"),
      set_name: resolution?.setName ?? first(source, "set_name", "set"),
      rarity: resolution?.rarity ?? first(source, "rarity"),
      binder_name: first(source, "binder_name", "binder", "folder"),
      quantity: first(source, "quantity", "count", "total_quantity", "add_to_quantity") ?? 1,
      condition: first(source, "condition"),
      language: first(source, "language"),
      notes: first(source, "notes", "note", "comments"),
      price: first(source, "market_price", "tcg_market_price"),
      acquisition_price: first(source, "purchase_price", "acquisition_price", "cost"),
      is_foil: finishCode !== "nonfoil",
      finish_code: finishCode,
      finish_label: finishCode === "nonfoil" ? "Nonfoil" : finishCode === "etched" ? "Foil etched" : "Foil",
      edition: first(source, "edition"),
      is_signed: first(source, "signed", "is_signed"),
      is_altered: first(source, "altered", "is_altered", "alter"),
      tags: first(source, "tags"),
    });
  });
  if (records.length > MAX_ROWS) issues.push({ row: MAX_ROWS + 2, message: `CSV is limited to ${MAX_ROWS} data rows` });
  return { rows, issues, sourceRows: records.length };
}

export function previewCollectionImportSource(input: CollectionImportSourceOptions): CollectionImportPreview {
  const format = detectedFormat(input);
  if (format === "csv") return previewCollectionImport(input.content);
  if (format === "pdf") return { valid: false, rows: [], issues: [{ row: 1, message: "PDF text extraction is required before import" }], sourceRows: 0, totalCopies: 0 };
  if (["manabox-csv", "moxfield-csv", "tcgplayer-csv", "collectr-csv"].includes(format)) {
    const marketplace = marketplaceRows(input, format as MarketplaceFormat);
    const preview = previewCollectionImport(normalizedCsv(marketplace.rows));
    return {
      ...preview,
      valid: preview.valid && marketplace.issues.length === 0,
      issues: [...marketplace.issues, ...preview.issues],
      sourceRows: marketplace.sourceRows,
    };
  }
  const rows: Array<Record<string, unknown>> = [];
  const sourceIssues: CollectionImportIssue[] = [];
  if (format === "json") {
    let decoded: unknown;
    try { decoded = JSON.parse(input.content); }
    catch (error) { return { valid: false, rows: [], issues: [{ row: 1, message: error instanceof Error ? error.message : "Invalid JSON" }], sourceRows: 0, totalCopies: 0 }; }
    const root = decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded as Record<string, unknown> : undefined;
    const records = Array.isArray(decoded) ? decoded : (["rows", "cards", "collection", "items"].map(key => root?.[key]).find(Array.isArray) as unknown[] | undefined) ?? (root ? [root] : []);
    records.forEach((record, offset) => {
      const row = offset + 1;
      if (!record || typeof record !== "object" || Array.isArray(record)) { sourceIssues.push({ row, message: "JSON row must be an object" }); return; }
      const source = record as Record<string, unknown>;
      const resolution = input.resolutions?.[String(row)];
      const externalId = resolution?.externalId ?? source.externalId ?? source.external_id ?? source.cardId;
      if (!externalId) { sourceIssues.push({ row, field: "externalId", message: "Exact printing resolution is required" }); return; }
      rows.push({
        tcg: source.tcg ?? source.game, external_id: externalId,
        base_external_id: resolution?.baseExternalId ?? source.baseExternalId ?? source.base_external_id,
        printing_key: resolution?.printingKey ?? source.printingKey ?? source.printing_key,
        artwork_id: resolution?.artworkId ?? source.artworkId ?? source.artwork_id,
        card_name: resolution?.cardName ?? source.cardName ?? source.card_name ?? source.name,
        collector_number: resolution?.collectorNumber ?? source.collectorNumber ?? source.collector_number,
        set_code: resolution?.setCode ?? source.setCode ?? source.set_code,
        set_name: resolution?.setName ?? source.setName ?? source.set_name,
        rarity: resolution?.rarity ?? source.rarity, binder_name: source.binderName ?? source.binder_name ?? source.binder,
        quantity: source.quantity ?? source.qty ?? 1, condition: source.condition, language: source.language,
        notes: source.notes ?? source.comment, price: source.price, acquisition_price: source.acquisitionPrice ?? source.acquisition_price,
        serial_number: source.serialNumber ?? source.serial_number, acquired_at: source.acquiredAt ?? source.acquired_at,
        is_foil: source.isFoil ?? source.is_foil, edition: source.edition, is_signed: source.isSigned ?? source.is_signed,
        is_altered: source.isAltered ?? source.is_altered,
        tags: Array.isArray(source.tags) ? source.tags.join(";") : source.tags,
      });
    });
  } else {
    const pattern = /^(\d+)\s+(.+?)\s+([A-Za-z0-9-]+)\s+([A-Z]{2})\s+(M|NM|EX|GD|LP|PL|PO)\s+([A-Z0-9-]+)\s+([A-Z0-9]+)(?:\s+(First Edition|Unlimited))?(?:\s+(.+?))?\s+([\d.,]+)\s+([A-Z]{3})$/i;
    input.content.split(/\r?\n/).forEach((raw, offset) => {
      const row = offset + 1; const match = pattern.exec(raw.trim());
      if (!match) return;
      const resolution = input.resolutions?.[String(row)];
      if (!resolution?.externalId) { sourceIssues.push({ row, field: "externalId", message: "Exact printing resolution is required" }); return; }
      rows.push({ tcg: "yugioh", external_id: resolution.externalId, base_external_id: resolution.baseExternalId,
        printing_key: resolution.printingKey, artwork_id: resolution.artworkId, card_name: resolution.cardName ?? match[2],
        collector_number: resolution.collectorNumber ?? `${match[6]}-${match[3]}`, set_code: resolution.setCode ?? `${match[6]}-${match[3]}`,
        set_name: resolution.setName, rarity: resolution.rarity ?? match[7], quantity: match[1], language: match[4], condition: match[5],
        edition: match[8], notes: match[9], price: match[10]?.includes(",") ? match[10].replace(/\./g, "").replace(",", ".") : match[10] });
    });
  }
  const preview = previewCollectionImport(normalizedCsv(rows));
  return { ...preview, valid: preview.valid && sourceIssues.length === 0, issues: [...sourceIssues, ...preview.issues], sourceRows: rows.length + sourceIssues.length };
}
