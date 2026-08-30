import { tcgCodeSchema, type TcgCode } from "@tcg/api-types";

export type CollectionImportSourceFormat =
  | "csv"
  | "json"
  | "cardmarket-text"
  | "pdf"
  | "manabox-csv"
  | "moxfield-csv"
  | "tcgplayer-csv"
  | "collectr-csv";

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
  tcg: TcgCode;
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
  acquisitionPrice?: number;
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
    tcg: TcgCode;
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
  if (firstLine.includes("manabox id") || firstLine.includes("purchase price currency")) return "manabox-csv";
  if (firstLine.includes("tradelist count") || firstLine.includes("last modified")) return "moxfield-csv";
  if (firstLine.includes("tcgplayer id") || firstLine.includes("tcg market price")) return "tcgplayer-csv";
  if (firstLine.includes("market price") && firstLine.includes("variant")) return "collectr-csv";
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

function parseProfileCsv(content: string) {
  const records: string[][] = [];
  let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ""; }
    else if (character === '\n') { row.push(field); records.push(row); row = []; field = ""; }
    else if (character !== '\r') field += character;
  }
  if (field || row.length) { row.push(field); records.push(row); }
  return records;
}

function profileTcg(format: CollectionImportSourceFormat, source: Record<string, string>): TcgCode | undefined {
  if (format === "manabox-csv" || format === "moxfield-csv") return "magic";
  const game = `${source.tcg ?? ""} ${source.game ?? ""} ${source.product_line ?? ""}`.toLowerCase();
  if (game.includes("magic")) return "magic";
  if (game.includes("pokemon")) return "pokemon";
  if (game.includes("yu-gi-oh") || game.includes("yugioh")) return "yugioh";
  if (game.includes("one piece")) return "onepiece";
  if (game.includes("lorcana")) return "lorcana";
  if (game.includes("dragon ball")) return "dragonball";
  return undefined;
}

function parseMarketplaceCsv(
  content: string,
  format: Extract<CollectionImportSourceFormat, `${string}-csv`>,
  resolutions: Record<number, CollectionImportResolution> = {},
): ParsedCollectionImportSource {
  const parsed = parseProfileCsv(content);
  const normalize = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, "_");
  const headers = (parsed[0] ?? []).map(normalize);
  const values = parsed.slice(1).filter((row) => row.some((field) => field.trim()));
  const rows: NormalizedCollectionImportRow[] = [];
  const failures: CollectionImportFailure[] = [];
  const ambiguities: CollectionImportAmbiguity[] = [];
  const get = (source: Record<string, string>, ...keys: string[]) => keys.map((key) => source[key]?.trim()).find(Boolean);
  values.forEach((fields, offset) => {
    const sourceRow = offset + 2;
    const source = Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ""]));
    const tcg = profileTcg(format, source);
    const cardName = get(source, "card_name", "name", "card", "product_name");
    const quantity = integer(get(source, "quantity", "count", "total_quantity", "add_to_quantity") ?? 1);
    if (!tcg || !cardName || !quantity) {
      failures.push({ sourceRow, code: "INVALID_FIELD", message: "Marketplace row requires a supported game, card name, and positive quantity", original: fields.join(",") });
      return;
    }
    const scryfallId = get(source, "scryfall_id", "scryfallid");
    const tcgplayerId = get(source, "tcgplayer_id", "tcgplayerid", "product_id");
    const foilText = (get(source, "foil", "variant", "printing") ?? "").toLowerCase();
    const normalized = applyResolution({
      sourceRow, tcg, externalId: scryfallId ?? get(source, "external_id") ?? (tcgplayerId ? `tcgplayer:${tcgplayerId}` : undefined), cardName,
      collectorNumber: get(source, "collector_number", "card_number", "number"), setCode: get(source, "set_code", "edition"),
      setName: get(source, "set_name", "set"), rarity: get(source, "rarity"), quantity,
      condition: get(source, "condition"), language: get(source, "language"), binderName: get(source, "binder_name", "binder", "folder"),
      price: money(get(source, "market_price", "tcg_market_price") ?? ""), isFoil: foilText.includes("foil") || foilText === "true" || foilText === "yes",
      acquisitionPrice: money(get(source, "purchase_price", "acquisition_price", "cost") ?? ""),
      isSigned: boolean(get(source, "signed")), isAltered: boolean(get(source, "altered", "alter")),
      tags: get(source, "tags")?.split(";").map((tag) => tag.trim()).filter(Boolean), original: fields.join(","),
    }, resolutions[sourceRow] ?? resolutions[offset + 1]);
    rows.push(normalized);
    if (!normalized.externalId) ambiguities.push({ sourceRow, code: "PRINTING_RESOLUTION_REQUIRED", message: "Select the exact printing before committing this marketplace row", query: { tcg, name: cardName, collectorNumber: normalized.collectorNumber, setCode: normalized.setCode, rarity: normalized.rarity } });
  });
  return { format, rows, failures, ambiguities, sourceRows: values.length };
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
    if (!cardName || !quantity || !tcgCodeSchema.safeParse(tcg).success) {
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
  if (format === "manabox-csv" || format === "moxfield-csv" || format === "tcgplayer-csv" || format === "collectr-csv") {
    return parseMarketplaceCsv(input.content, format, input.resolutions);
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
