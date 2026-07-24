export type CollectionImportSourceFormat =
  | "csv"
  | "json"
  | "cardmarket-text"
  | "pdf";

export interface CollectionImportResolution {
  externalId: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  collectorNumber?: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  cardName?: string;
}

export interface NormalizedCollectionImportRow {
  sourceRow: number;
  tcg: "pokemon" | "magic" | "yugioh";
  externalId?: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  cardName: string;
  collectorNumber?: string;
  setCode?: string;
  setName?: string;
  setPrefix?: string;
  rarity?: string;
  rarityCode?: string;
  quantity: number;
  language?: string;
  condition?: string;
  edition?: string;
  notes?: string;
  price?: number;
  currency?: string;
  binderName?: string;
  isFoil?: boolean;
  isSigned?: boolean;
  isAltered?: boolean;
  tags?: string[];
  original: string;
}

export interface CollectionImportFailure {
  sourceRow: number;
  code:
    | "UNRECOGNIZED_ROW"
    | "INVALID_JSON"
    | "INVALID_FIELD"
    | "UNSUPPORTED_FORMAT"
    | "PDF_TEXT_EXTRACTION_REQUIRED";
  message: string;
  original?: string;
  field?: string;
}

export interface CollectionImportAmbiguity {
  sourceRow: number;
  code: "PRINTING_RESOLUTION_REQUIRED";
  message: string;
  query: {
    tcg: "pokemon" | "magic" | "yugioh";
    name: string;
    collectorNumber?: string;
    setCode?: string;
    rarity?: string;
  };
}

export interface ParsedCollectionImportSource {
  format: CollectionImportSourceFormat;
  rows: NormalizedCollectionImportRow[];
  failures: CollectionImportFailure[];
  ambiguities: CollectionImportAmbiguity[];
  sourceRows: number;
}

export interface ParseCollectionImportSourceInput {
  content: string;
  fileName?: string;
  format?: CollectionImportSourceFormat | "auto";
  resolutions?: Record<number, CollectionImportResolution>;
}

const CONDITION_MAP: Record<string, string> = {
  M: "Mint",
  NM: "Near Mint",
  EX: "Excellent",
  GD: "Good",
  LP: "Light Played",
  PL: "Played",
  PO: "Poor",
};

const RARITY_MAP: Record<string, string> = {
  C: "Common",
  R: "Rare",
  SR: "Super Rare",
  SUR: "Super Rare",
  UR: "Ultra Rare",
  SCR: "Secret Rare",
  SER: "Secret Rare",
  UTR: "Ultimate Rare",
  GR: "Ghost Rare",
  CR: "Collector's Rare",
  PSCR: "Prismatic Secret Rare",
  QSCR: "Quarter Century Secret Rare",
};

const CARDMARKET_LINE =
  /^(\d+)\s+(.+?)\s+([A-Za-z0-9-]+)\s+([A-Z]{2})\s+(M|NM|EX|GD|LP|PL|PO)\s+([A-Z0-9-]+)\s+([A-Z0-9]+)(?:\s+(First Edition|Unlimited))?(?:\s+(.+?))?\s+([\d.,]+)\s+([A-Z]{3})$/i;

const CARDMARKET_IGNORED = [
  "contents",
  "article value",
  "shipping",
  "total",
  "trustee service",
  "unpaid:",
  "paid:",
];

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integer(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function boolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (["true", "yes", "1", "y"].includes(value.trim().toLowerCase())) return true;
  if (["false", "no", "0", "n"].includes(value.trim().toLowerCase())) return false;
  return undefined;
}

function money(value: string): number | undefined {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function detectFormat(content: string, fileName?: string): CollectionImportSourceFormat {
  if (fileName?.toLowerCase().endsWith(".pdf")) return "pdf";
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/yugioh singles:/i.test(content)) return "cardmarket-text";
  const firstLine = content.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  if (
    firstLine.includes(",") &&
    (firstLine.includes("external_id") || firstLine.includes("external id"))
  ) {
    return "csv";
  }
  if (content.split(/\r?\n/).some((line) => CARDMARKET_LINE.test(line.trim()))) {
    return "cardmarket-text";
  }
  return "csv";
}

function applyResolution(
  row: NormalizedCollectionImportRow,
  resolution: CollectionImportResolution | undefined,
) {
  if (!resolution) return row;
  return {
    ...row,
    externalId: resolution.externalId,
    baseExternalId: resolution.baseExternalId,
    printingKey: resolution.printingKey,
    artworkId: resolution.artworkId,
    collectorNumber: resolution.collectorNumber ?? row.collectorNumber,
    setCode: resolution.setCode ?? row.setCode,
    setName: resolution.setName ?? row.setName,
    rarity: resolution.rarity ?? row.rarity,
    cardName: resolution.cardName ?? row.cardName,
  };
}

export function parseCardmarketSinglesText(
  content: string,
  resolutions: Record<number, CollectionImportResolution> = {},
): ParsedCollectionImportSource {
  const rows: NormalizedCollectionImportRow[] = [];
  const failures: CollectionImportFailure[] = [];
  const ambiguities: CollectionImportAmbiguity[] = [];
  const lines = content.split(/\r?\n/);
  const hasSectionHeader = lines.some((line) => /yugioh singles:/i.test(line));
  let inSingles = !hasSectionHeader;

  for (const [index, raw] of lines.entries()) {
    const sourceRow = index + 1;
    const line = raw.trim();
    if (!line) continue;
    if (/yugioh singles:/i.test(line)) {
      inSingles = true;
      continue;
    }
    if (inSingles && hasSectionHeader && line.endsWith(":")) {
      inSingles = false;
      continue;
    }
    if (!inSingles || CARDMARKET_IGNORED.some((token) => line.toLowerCase().includes(token))) {
      continue;
    }

    const match = CARDMARKET_LINE.exec(line);
    if (!match) {
      if (/^\d+\s+/.test(line)) {
        failures.push({
          sourceRow,
          code: "UNRECOGNIZED_ROW",
          message: "Potential Cardmarket singles row did not match the expected columns",
          original: line,
        });
      }
      continue;
    }

    const [
      ,
      quantityText,
      rawName,
      number,
      language,
      conditionCode,
      setPrefix,
      rarityCode,
      edition,
      comment,
      priceText,
      currency,
    ] = match;
    const quantity = integer(quantityText);
    const price = money(priceText);
    if (!quantity || price === undefined) {
      failures.push({
        sourceRow,
        code: "INVALID_FIELD",
        message: "Quantity and price must be positive, machine-readable values",
        original: line,
      });
      continue;
    }

    const cardName = rawName.replace(/\s*\(V\.\d+\s*-\s*[^)]+\)/i, "").trim();
    const collectorNumber = `${setPrefix.toUpperCase()}-${number.toUpperCase()}`;
    const parsed: NormalizedCollectionImportRow = {
      sourceRow,
      tcg: "yugioh",
      cardName,
      collectorNumber,
      setCode: collectorNumber,
      setPrefix: setPrefix.toUpperCase(),
      rarity: RARITY_MAP[rarityCode.toUpperCase()] ?? rarityCode.toUpperCase(),
      rarityCode: rarityCode.toUpperCase(),
      quantity,
      language: language.toUpperCase(),
      condition: CONDITION_MAP[conditionCode.toUpperCase()] ?? conditionCode.toUpperCase(),
      edition,
      notes: optionalString(comment),
      price,
      currency: currency.toUpperCase(),
      original: line,
    };
    const resolved = applyResolution(parsed, resolutions[sourceRow]);
    rows.push(resolved);
    if (!resolved.externalId) {
      ambiguities.push({
        sourceRow,
        code: "PRINTING_RESOLUTION_REQUIRED",
        message: "Select the exact printing/artwork before committing this row",
        query: {
          tcg: parsed.tcg,
          name: cardName,
          collectorNumber,
          setCode: collectorNumber,
          rarity: parsed.rarity,
        },
      });
    }
  }

  return {
    format: "cardmarket-text",
    rows,
    failures,
    ambiguities,
    sourceRows: rows.length + failures.length,
  };
}

function jsonRecords(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of ["rows", "cards", "collection", "items"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [object];
}

export function parseCollectionJson(
  content: string,
  resolutions: Record<number, CollectionImportResolution> = {},
): ParsedCollectionImportSource {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch (error) {
    return {
      format: "json",
      rows: [],
      failures: [{
        sourceRow: 1,
        code: "INVALID_JSON",
        message: error instanceof Error ? error.message : "JSON could not be decoded",
      }],
      ambiguities: [],
      sourceRows: 0,
    };
  }
  const records = jsonRecords(decoded);
  if (!records) {
    return {
      format: "json",
      rows: [],
      failures: [{
        sourceRow: 1,
        code: "INVALID_JSON",
        message: "JSON must contain an object, array, or rows/cards/items array",
      }],
      ambiguities: [],
      sourceRows: 0,
    };
  }

  const rows: NormalizedCollectionImportRow[] = [];
  const failures: CollectionImportFailure[] = [];
  const ambiguities: CollectionImportAmbiguity[] = [];
  records.forEach((record, offset) => {
    const sourceRow = offset + 1;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      failures.push({
        sourceRow,
        code: "INVALID_FIELD",
        message: "JSON row must be an object",
        original: JSON.stringify(record),
      });
      return;
    }
    const source = record as Record<string, unknown>;
    const tcg = optionalString(source.tcg ?? source.game)?.toLowerCase();
    const cardName = optionalString(source.cardName ?? source.card_name ?? source.name);
    const quantity = integer(source.quantity ?? source.qty ?? 1);
    if (!cardName || !quantity || !["pokemon", "magic", "yugioh"].includes(tcg ?? "")) {
      failures.push({
        sourceRow,
        code: "INVALID_FIELD",
        message: "Each JSON row requires a supported tcg/game, card name, and positive quantity",
        original: JSON.stringify(record),
      });
      return;
    }
    const externalId = optionalString(source.externalId ?? source.external_id ?? source.cardId);
    const normalized = applyResolution({
      sourceRow,
      tcg: tcg as NormalizedCollectionImportRow["tcg"],
      externalId,
      baseExternalId: optionalString(source.baseExternalId ?? source.base_external_id),
      printingKey: optionalString(source.printingKey ?? source.printing_key),
      artworkId: optionalString(source.artworkId ?? source.artwork_id),
      cardName,
      collectorNumber: optionalString(source.collectorNumber ?? source.collector_number),
      setCode: optionalString(source.setCode ?? source.set_code),
      setName: optionalString(source.setName ?? source.set_name),
      rarity: optionalString(source.rarity),
      quantity,
      language: optionalString(source.language),
      condition: optionalString(source.condition),
      edition: optionalString(source.edition),
      notes: optionalString(source.notes ?? source.comment),
      price: typeof source.price === "number" ? source.price : optionalString(source.price) ? money(String(source.price)) : undefined,
      currency: optionalString(source.currency),
      binderName: optionalString(source.binderName ?? source.binder_name ?? source.binder),
      isFoil: boolean(source.isFoil ?? source.is_foil),
      isSigned: boolean(source.isSigned ?? source.is_signed),
      isAltered: boolean(source.isAltered ?? source.is_altered),
      tags: Array.isArray(source.tags)
        ? source.tags.map(optionalString).filter((tag): tag is string => Boolean(tag))
        : optionalString(source.tags)?.split(";").map((tag) => tag.trim()).filter(Boolean),
      original: JSON.stringify(record),
    }, resolutions[sourceRow]);
    rows.push(normalized);
    if (!normalized.externalId) {
      ambiguities.push({
        sourceRow,
        code: "PRINTING_RESOLUTION_REQUIRED",
        message: "Select an exact catalog record before committing this row",
        query: {
          tcg: normalized.tcg,
          name: normalized.cardName,
          collectorNumber: normalized.collectorNumber,
          setCode: normalized.setCode,
          rarity: normalized.rarity,
        },
      });
    }
  });
  return { format: "json", rows, failures, ambiguities, sourceRows: records.length };
}

export function parseCollectionImportSource(
  input: ParseCollectionImportSourceInput,
): ParsedCollectionImportSource {
  const format =
    !input.format || input.format === "auto"
      ? detectFormat(input.content, input.fileName)
      : input.format;
  if (format === "json") return parseCollectionJson(input.content, input.resolutions);
  if (format === "cardmarket-text") {
    return parseCardmarketSinglesText(input.content, input.resolutions);
  }
  if (format === "pdf") {
    return {
      format,
      rows: [],
      failures: [{
        sourceRow: 1,
        code: "PDF_TEXT_EXTRACTION_REQUIRED",
        message:
          "PDF binary extraction is not bundled. Extract text with a trusted boundary, then parse it as Cardmarket text.",
      }],
      ambiguities: [],
      sourceRows: 0,
    };
  }
  return {
    format,
    rows: [],
    failures: [],
    ambiguities: [],
    sourceRows: 0,
  };
}
