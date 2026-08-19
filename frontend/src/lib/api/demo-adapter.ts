/**
 * Demo route handler — maps URL path + HTTP method to demo store operations
 * and returns real Response objects, so the API files see no difference.
 */

import {
  useDemoStore,
  whenDemoStoreHydrated,
  type DemoBinder,
  type DemoBinderCard,
  type DemoOwnedCard,
  type DemoWishlist,
  type DemoWishlistCard,
} from "@/stores/demo-store";
import {
  searchDemoCards,
  DEMO_CARDS,
  isSyntheticDemoCardId,
  splitDemoPrintingCode,
  type DemoCard,
  type DemoTcg,
} from "@/lib/data/demo-cards";
import { isCatalogInstalled } from "@/lib/catalog/catalog-client";
import {
  CATALOG_GAMES,
  isCatalogGame,
  type CatalogTcgCode,
} from "@/lib/catalog/use-catalog";
import {
  getCardsInSet as getCatalogCardsInSet,
  getSets as getCatalogSets,
  matchCatalogCards,
  normalizeCatalogText,
  searchCatalog,
  searchCatalogByArtist,
  searchCatalogByCollectionTag,
} from "@/lib/catalog/catalog-search";
import type { TcgCode } from "@/types/card";
import type {
  AddCardInput,
  AddWishlistCardInput,
  Card,
  CollectionGuideItemResponse,
  CollectionGuideResponse,
  CollectionCardCopy,
  CreateWishlistRuleInput,
  TcgSet,
  UpdateCardInput,
  UpdateWishlistRuleInput,
  UserPreferences,
  CreateTransactionInput,
  CreateBinderInput,
  CollectionImportIssue,
  CollectionImportOptions,
  CollectionImportPreview,
  CollectionImportPreviewRow,
  CollectionImportRequest,
  CollectionImportResult,
  CollectionMutationKind,
  TransactionResponse,
  UpdateBinderInput,
} from "@tcg/api-types";
import {
  createBinderSchema,
  createTagSchema,
  createTransactionSchema,
  updateBinderSchema,
  updateSettingsSchema,
  collectionImportRequestSchema,
} from "@tcg/api-types";
import { systemGuideDefinitions } from "@/lib/guides/system-guides.generated";
import { DEMO_TRANSACTIONS_STORAGE_KEY } from "@/lib/storage/keys";
import { formatCopyCount } from "@/lib/copy-labels";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function store() {
  return useDemoStore.getState();
}

function stripHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

function json(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function noContent(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 204 }));
}

function notFound(msg = "Not found"): Promise<Response> {
  return json({ message: msg }, 404);
}

const DEMO_IMPORT_HEADERS = [
  "tcg",
  "external_id",
  "card_name",
  "base_external_id",
  "printing_key",
  "artwork_id",
  "collector_number",
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

const DEMO_IMPORT_HEADER_ALIASES: Record<string, string> = {
  binder: "binder_name",
  "card name": "card_name",
  "external id": "external_id",
  "set code": "set_code",
  "set name": "set_name",
  "collector number": "collector_number",
  "acquisition price": "acquisition_price",
  "serial number": "serial_number",
  foil: "is_foil",
};

const DEMO_IMPORT_TCGS = new Set<TcgCode>([
  "pokemon",
  "magic",
  "yugioh",
  "onepiece",
  "lorcana",
  "dragonball",
]);

function parseDemoCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseDemoBoolean(
  value: string | undefined,
  row: number,
  field: string,
  issues: CollectionImportIssue[],
) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (["yes", "true", "1", "y"].includes(normalized)) return true;
  if (["no", "false", "0", "n"].includes(normalized)) return false;
  issues.push({
    row,
    field,
    message: "must be yes/no, true/false, or 1/0",
  });
  return false;
}

function previewDemoCollectionImport(
  input: CollectionImportRequest,
): CollectionImportPreview {
  const requestedFormat = input.format ?? "auto";
  const content = input.content ?? input.csv ?? "";
  const detectedFormat =
    requestedFormat === "auto"
      ? content.trimStart().startsWith("[") ||
        content.trimStart().startsWith("{")
        ? "json"
        : "csv"
      : requestedFormat;
  if (detectedFormat !== "csv") {
    return {
      valid: false,
      rows: [],
      issues: [
        {
          row: 1,
          field: "format",
          message:
            "The offline demo imports TCGer CSV only; JSON and marketplace text require the connected app.",
        },
      ],
      sourceRows: 0,
      totalCopies: 0,
      format: detectedFormat,
    };
  }

  let parsed: string[][];
  try {
    parsed = parseDemoCsv(content);
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
      format: "csv",
    };
  }
  if (!parsed.length) {
    return {
      valid: false,
      rows: [],
      issues: [{ row: 1, message: "CSV is empty" }],
      sourceRows: 0,
      totalCopies: 0,
      format: "csv",
    };
  }

  const headers = parsed[0].map((header) => {
    const normalized = header
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase();
    return (
      DEMO_IMPORT_HEADER_ALIASES[normalized] ?? normalized.replace(/\s+/g, "_")
    );
  });
  const issues: CollectionImportIssue[] = [];
  for (const required of ["tcg", "external_id", "card_name"]) {
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
    .filter((values) => values.some((value) => value.trim()));
  if (dataRows.length > 2_000) {
    issues.push({ row: 2_002, message: "CSV is limited to 2,000 data rows" });
  }

  const rows: CollectionImportPreviewRow[] = [];
  for (const [offset, values] of dataRows.slice(0, 2_000).entries()) {
    const rowNumber = offset + 2;
    const source = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
    const tcg = source.tcg?.trim().toLowerCase() as TcgCode;
    const externalId = source.external_id?.trim();
    const cardName = source.card_name?.trim();
    const quantity = Number(source.quantity?.trim() || "1");
    const before = issues.length;
    if (!DEMO_IMPORT_TCGS.has(tcg))
      issues.push({
        row: rowNumber,
        field: "tcg",
        message: "is not supported",
      });
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
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500)
      issues.push({
        row: rowNumber,
        field: "quantity",
        message: "must be a whole number between 1 and 500",
      });
    const money = (field: string) => {
      const text = source[field]?.trim();
      if (!text) return undefined;
      const value = Number(text);
      if (!Number.isFinite(value) || value < 0) {
        issues.push({
          row: rowNumber,
          field,
          message: "must be a non-negative number",
        });
        return undefined;
      }
      return value;
    };
    const tags = (source.tags ?? "")
      .split(";")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length) {
      issues.push({
        row: rowNumber,
        field: "tags",
        message: "tag assignment is not available in the offline demo import",
      });
    }
    const acquiredAt = source.acquired_at?.trim() || undefined;
    if (acquiredAt && Number.isNaN(Date.parse(acquiredAt))) {
      issues.push({
        row: rowNumber,
        field: "acquired_at",
        message: "must be an ISO date or timestamp",
      });
    }
    const isFoil = parseDemoBoolean(
      source.is_foil,
      rowNumber,
      "is_foil",
      issues,
    );
    const isSealedPromo = parseDemoBoolean(
      source.is_sealed_promo,
      rowNumber,
      "is_sealed_promo",
      issues,
    );
    const isOversized = parseDemoBoolean(
      source.is_oversized,
      rowNumber,
      "is_oversized",
      issues,
    );
    const isPeelOff = parseDemoBoolean(
      source.is_peel_off,
      rowNumber,
      "is_peel_off",
      issues,
    );
    const isSigned = parseDemoBoolean(
      source.is_signed,
      rowNumber,
      "is_signed",
      issues,
    );
    const isAltered = parseDemoBoolean(
      source.is_altered,
      rowNumber,
      "is_altered",
      issues,
    );
    const price = money("price");
    const acquisitionPrice = money("acquisition_price");
    if (issues.length !== before) continue;
    const optional = (field: string) => source[field]?.trim() || undefined;
    rows.push({
      row: rowNumber,
      tcg,
      externalId,
      baseExternalId: optional("base_external_id"),
      printingKey: optional("printing_key"),
      artworkId: optional("artwork_id"),
      cardName,
      collectorNumber: optional("collector_number"),
      setCode: optional("set_code"),
      setName: optional("set_name"),
      rarity: optional("rarity"),
      binderName: optional("binder_name"),
      quantity,
      condition: optional("condition"),
      language: optional("language"),
      notes: optional("notes"),
      price,
      acquisitionPrice,
      serialNumber: optional("serial_number"),
      acquiredAt,
      isFoil,
      finishCode: optional("finish_code"),
      finishLabel: optional("finish_label"),
      edition: optional("edition"),
      stamp: optional("stamp"),
      isSealedPromo,
      isOversized,
      isPeelOff,
      isSigned,
      isAltered,
      tags,
    });
  }

  const mergedRows = new Map<string, CollectionImportPreviewRow>();
  for (const row of rows) {
    const identity = JSON.stringify([
      row.tcg,
      row.externalId,
      row.cardName,
      row.baseExternalId ?? "",
      row.printingKey ?? "",
      row.artworkId ?? "",
      row.collectorNumber ?? "",
      row.setCode ?? "",
      row.setName ?? "",
      row.rarity ?? "",
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
    ]);
    const existing = mergedRows.get(identity);
    if (existing) existing.quantity += row.quantity;
    else mergedRows.set(identity, { ...row });
  }
  const plannedRows = Array.from(mergedRows.values());
  const totalCopies = plannedRows.reduce((sum, row) => sum + row.quantity, 0);
  if (totalCopies > 500) {
    issues.push({
      row: 1,
      field: "quantity",
      message: "import is limited to 500 total copies",
    });
  }
  const binderNames = new Set(
    store().binders.map((binder) => binder.name.toLowerCase()),
  );
  const binderIds = new Set(store().binders.map((binder) => binder.id));
  const options = input.options ?? { createMissingBinders: false };
  if (options.defaultBinderId && !binderIds.has(options.defaultBinderId)) {
    issues.push({
      row: 1,
      field: "defaultBinderId",
      message: "default binder was not found",
    });
  }
  if (!options.createMissingBinders) {
    for (const row of plannedRows) {
      if (
        row.binderName &&
        row.binderName.toLowerCase() !== "unsorted" &&
        !binderNames.has(row.binderName.toLowerCase())
      ) {
        issues.push({
          row: row.row,
          field: "binder_name",
          message: `binder "${row.binderName}" does not exist`,
        });
      }
    }
  }
  return {
    valid: issues.length === 0 && plannedRows.length > 0,
    rows: plannedRows,
    issues,
    sourceRows: dataRows.length,
    totalCopies,
    format: "csv",
  };
}

const DEMO_USER_ID = "demo-user-001";
const DEMO_TRANSACTIONS: TransactionResponse[] = [
  {
    id: "demo-transaction-purchase",
    type: "purchase",
    cardName: "Charizard ex",
    tcg: "pokemon",
    quantity: 1,
    amount: 28.5,
    currency: "USD",
    platform: "Local card shop",
    notes: "Near Mint collection copy",
    date: "2025-03-18T18:30:00.000Z",
  },
  {
    id: "demo-transaction-sale",
    type: "sale",
    cardName: "Blue-Eyes White Dragon",
    tcg: "yugioh",
    quantity: 1,
    amount: 24,
    currency: "USD",
    platform: "eBay",
    costBasis: 11,
    fees: 3.12,
    shippingCost: 1.35,
    acquiredAt: "2025-01-04T16:00:00.000Z",
    netProceeds: 19.53,
    realizedProfit: 8.53,
    holdingDays: 67,
    notes: "Tracked shipping included",
    date: "2025-03-12T16:00:00.000Z",
  },
  {
    id: "demo-transaction-trade",
    type: "trade",
    cardName: "Modern staples exchange",
    tcg: "magic",
    quantity: 3,
    amount: 42.75,
    currency: "USD",
    platform: "In person",
    notes: "Estimated received value",
    date: "2025-03-05T20:15:00.000Z",
  },
];

function getDemoTransactions(): TransactionResponse[] {
  if (typeof localStorage === "undefined") return DEMO_TRANSACTIONS;
  try {
    const raw = localStorage.getItem(DEMO_TRANSACTIONS_STORAGE_KEY);
    if (raw === null) return DEMO_TRANSACTIONS;
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return DEMO_TRANSACTIONS;
  }
}

function setDemoTransactions(transactions: TransactionResponse[]) {
  localStorage.setItem(
    DEMO_TRANSACTIONS_STORAGE_KEY,
    JSON.stringify(transactions),
  );
}

function demoCollectionCards() {
  return store().binders.flatMap((binder) =>
    binder.cards.map((card) => ({ binder, card })),
  );
}

function demoValueHistory(period: string, tcg?: string) {
  const days = Math.max(7, Math.min(365, Number.parseInt(period, 10) || 30));
  const currentValue = demoCollectionCards()
    .filter(({ card }) => !tcg || card.tcg === tcg)
    .reduce((sum, { card }) => sum + card.price * card.quantity, 0);
  const pointCount = Math.min(13, days + 1);
  const startValue = currentValue * 0.91;
  const history = Array.from({ length: pointCount }, (_, index) => {
    const progress = pointCount === 1 ? 1 : index / (pointCount - 1);
    const date = new Date(Date.UTC(2025, 2, 18));
    date.setUTCDate(date.getUTCDate() - Math.round(days * (1 - progress)));
    return {
      date: date.toISOString(),
      value: Number(
        (startValue + (currentValue - startValue) * progress).toFixed(2),
      ),
    };
  });
  return {
    history,
    currentValue: Number(currentValue.toFixed(2)),
    changePercent: currentValue ? 9.89 : 0,
    changePeriod: period,
  };
}

function demoValueBreakdown() {
  const rows = demoCollectionCards();
  const groupedByTcg = new Map<string, typeof rows>();
  for (const row of rows) {
    groupedByTcg.set(row.card.tcg, [
      ...(groupedByTcg.get(row.card.tcg) ?? []),
      row,
    ]);
  }
  const byTcg = Array.from(groupedByTcg, ([tcg, entries]) => ({
    tcg,
    value: Number(
      entries
        .reduce((sum, { card }) => sum + card.price * card.quantity, 0)
        .toFixed(2),
    ),
    cardCount: entries.reduce((sum, { card }) => sum + card.quantity, 0),
  })).sort((left, right) => right.value - left.value);
  const byBinder = store()
    .binders.map((binder) => ({
      binderId: binder.id,
      binderName: binder.name,
      value: Number(
        binder.cards
          .reduce((sum, card) => sum + card.price * card.quantity, 0)
          .toFixed(2),
      ),
      cardCount: binder.cards.reduce((sum, card) => sum + card.quantity, 0),
    }))
    .sort((left, right) => right.value - left.value);
  const topCards = rows
    .map(({ card }) => ({
      externalId: card.cardData?.externalId ?? card.cardId,
      tcg: card.tcg,
      name: card.name,
      value: Number((card.price * card.quantity).toFixed(2)),
      imageUrl: card.cardData?.imageUrlSmall ?? card.cardData?.imageUrl,
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 10);
  return { byTcg, byBinder, topCards };
}

function demoDistribution(dimension: string, tcg?: string) {
  const labels = demoCollectionCards()
    .filter(({ card }) => !tcg || card.tcg === tcg)
    .flatMap(({ card }) => {
      const label =
        dimension === "rarity"
          ? card.rarity || "Unknown"
          : dimension === "set"
            ? card.setName || card.setCode || "Unknown"
            : card.tcg;
      return Array.from({ length: card.quantity }, () => label);
    });
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return {
    dimension,
    entries: Array.from(counts, ([label, count]) => ({
      label,
      count,
      percentage: labels.length ? (count / labels.length) * 100 : 0,
    })).sort((left, right) => right.count - left.count),
    total: labels.length,
  };
}

function demoPriceMovers(tcg?: string) {
  const unique = new Map(
    demoCollectionCards()
      .filter(({ card }) => !tcg || card.tcg === tcg)
      .map(
        ({ card }) =>
          [
            `${card.tcg}:${card.cardData?.externalId ?? card.cardId}`,
            card,
          ] as const,
      ),
  );
  const movers = Array.from(unique.values()).map((card, index) => {
    const direction = index % 3 === 1 ? -1 : 1;
    const percentChange = direction * (2.4 + (index % 5) * 1.35);
    return {
      externalId: card.cardData?.externalId ?? card.cardId,
      tcg: card.tcg,
      name: card.name,
      priceChange: Number((card.price * (percentChange / 100)).toFixed(2)),
      percentChange: Number(percentChange.toFixed(2)),
      currentPrice: card.price,
    };
  });
  return {
    gainers: movers
      .filter((mover) => mover.percentChange > 0)
      .sort((left, right) => right.percentChange - left.percentChange)
      .slice(0, 10),
    losers: movers
      .filter((mover) => mover.percentChange < 0)
      .sort((left, right) => left.percentChange - right.percentChange)
      .slice(0, 10),
  };
}

function collectionRowsSnapshot() {
  return structuredClone(store().collectionRows);
}

function recordDemoCollectionMutation(input: {
  operationKind: Exclude<CollectionMutationKind, "undo">;
  affectedCopies: number;
  binderId?: string;
  cardName?: string;
  summary: string;
  before: ReturnType<typeof collectionRowsSnapshot>;
}) {
  const after = collectionRowsSnapshot();
  if (JSON.stringify(input.before) === JSON.stringify(after)) return;
  store().recordCollectionMutation({ ...input, after });
}

async function commitDemoCollectionImport(
  preview: CollectionImportPreview,
  options: CollectionImportOptions,
): Promise<CollectionImportResult> {
  const before = collectionRowsSnapshot();
  const createdBinders: string[] = [];
  const bindersByName = new Map(
    store().binders.map((binder) => [binder.name.toLowerCase(), binder.id]),
  );
  let unsortedId = bindersByName.get("unsorted");

  for (const row of preview.rows) {
    let binderId = options.defaultBinderId;
    const requestedName = row.binderName?.trim();
    if (requestedName && requestedName.toLowerCase() !== "unsorted") {
      binderId = bindersByName.get(requestedName.toLowerCase());
      if (!binderId && options.createMissingBinders) {
        binderId = await store().addBinder(requestedName);
        bindersByName.set(requestedName.toLowerCase(), binderId);
        createdBinders.push(requestedName);
      }
    }
    if (!binderId) {
      if (!unsortedId) {
        unsortedId = await store().addBinder("Unsorted", "#64748b");
        bindersByName.set("unsorted", unsortedId);
        createdBinders.push("Unsorted");
      }
      binderId = unsortedId;
    }

    const card: DemoOwnedCard = {
      id: row.externalId,
      tcg: row.tcg,
      name: row.cardName,
      setCode: row.setCode ?? "",
      setName: row.setName ?? "",
      rarity: row.rarity ?? "Unknown",
      price: row.price ?? 0,
    };
    await store().addCardToBinder(binderId, card, row.quantity, {
      cardData: {
        externalId: row.externalId,
        name: row.cardName,
        tcg: row.tcg,
        baseExternalId: row.baseExternalId,
        printingKey: row.printingKey,
        artworkId: row.artworkId,
        collectorNumber: row.collectorNumber,
        setCode: row.setCode,
        setName: row.setName,
        rarity: row.rarity,
      },
      copy: {
        condition: row.condition,
        language: row.language,
        notes: row.notes,
        price: row.price,
        acquisitionPrice: row.acquisitionPrice,
        serialNumber: row.serialNumber,
        acquiredAt: row.acquiredAt,
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
  }

  recordDemoCollectionMutation({
    operationKind: "import",
    affectedCopies: preview.totalCopies,
    summary: `Imported ${formatCopyCount(preview.totalCopies)} into the collection`,
    before,
  });
  return {
    ...preview,
    importedRows: preview.rows.length,
    importedCopies: preview.totalCopies,
    createdBinders,
  };
}

function demoAuthUser() {
  const { profile, getPreferences } = store();
  return {
    id: DEMO_USER_ID,
    email: profile.email,
    username: profile.username,
    isAdmin: true,
    ...getPreferences(),
  };
}

function demoCollectionGuides(): CollectionGuideResponse[] {
  const definitions: Array<
    Omit<CollectionGuideResponse, "followed" | "wishlistId">
  > = systemGuideDefinitions.map((guide) => ({
    id: `demo-guide-${guide.slug}`,
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    tcg: guide.tcg,
    category: guide.category,
    curatorName: guide.curatorName,
    tags: [...guide.tags],
    version: guide.version,
    featured: guide.featured,
    rule: {
      type: guide.ruleType,
      tcg: guide.tcg,
      query: "ruleQuery" in guide ? guide.ruleQuery : undefined,
      includeAllPrintings: guide.includeAllPrintings,
    },
    cardCountHint: "cardCountHint" in guide ? guide.cardCountHint : undefined,
  }));
  return definitions.map((guide) => {
    const wishlist = store().wishlists.find((candidate) =>
      guide.rule.type === "manual"
        ? candidate.name === guide.title
        : (candidate.rules ?? []).some(
            (rule) =>
              rule.type === guide.rule.type &&
              rule.tcg === guide.rule.tcg &&
              rule.query === guide.rule.query &&
              rule.setCode === guide.rule.setCode,
          ),
    );
    return { ...guide, followed: Boolean(wishlist), wishlistId: wishlist?.id };
  });
}

function demoConnectedArtItems(): CollectionGuideItemResponse[] {
  const cards = [
    ["GG26", "Riolu"],
    ["GG27", "Swablu"],
    ["GG28", "Duskull"],
    ["GG29", "Bidoof"],
    ["GG30", "Pikachu"],
    ["GG31", "Turtwig"],
    ["GG32", "Paras"],
    ["GG33", "Poochyena"],
    ["GG34", "Mareep"],
  ] as const;
  return cards.map(([collectorNumber, name], position) => ({
    id: `demo-connected-${collectorNumber}`,
    guideId: "demo-guide-pokemon-crown-zenith-connected-art",
    tcg: "pokemon",
    externalId: `swsh12.5gg-${collectorNumber}`,
    name,
    setCode: "swsh12.5gg",
    setName: "Crown Zenith Galarian Gallery",
    collectorNumber,
    rarity: "Rare",
    artist: "Kouki Saitou",
    imageUrl: `https://images.pokemontcg.io/swsh12pt5gg/${collectorNumber}_hires.png`,
    imageUrlSmall: `https://images.pokemontcg.io/swsh12pt5gg/${collectorNumber}.png`,
    groupKey: "crown-zenith-nine-card-scene",
    groupLabel: "Crown Zenith nine-card scene",
    groupOrder: 0,
    position,
    provenanceUrl:
      "https://bulbapedia.bulbagarden.net/wiki/Bidoof_(Crown_Zenith_111)",
  }));
}

/* ------------------------------------------------------------------ */
/*  Type converters                                                     */
/* ------------------------------------------------------------------ */

function toCollectionCard(
  card: DemoBinderCard,
  binderId: string,
  binderName: string,
  binderColor: string,
) {
  const copies: CollectionCardCopy[] = card.copies?.length
    ? card.copies
    : Array.from({ length: Math.max(1, card.quantity) }, (_, index) => ({
        id: `${card.id}-copy-${index + 1}`,
        condition: card.condition,
        price: card.price,
        tags: [],
      }));
  return {
    ...card.cardData,
    id: card.id,
    cardId: card.cardId,
    externalId: card.cardData?.externalId ?? card.cardId,
    name: card.cardData?.name ?? card.name,
    tcg: card.tcg,
    setCode:
      card.cardData?.setCode ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).setCode
        : card.setCode),
    collectorNumber:
      card.cardData?.collectorNumber ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).collectorNumber
        : undefined),
    setName: card.cardData?.setName ?? card.setName,
    rarity: card.cardData?.rarity ?? card.rarity,
    languageCode: card.cardData?.language,
    quantity: card.quantity,
    condition: card.condition,
    price: card.price,
    acquiredAt: card.addedAt,
    binderId,
    binderName,
    binderColorHex: stripHash(binderColor),
    copies,
  };
}

function toBinder(b: DemoBinder) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    colorHex: stripHash(b.color),
    defaultCondition: b.defaultCondition,
    containerType: b.containerType,
    imageUrl: b.imageUrl,
    associatedTcg: b.associatedTcg,
    associatedSetCode: b.associatedSetCode,
    associatedSetName: b.associatedSetName,
    shareToken: b.shareToken,
    isPublic: b.isPublic,
    cards: b.cards.map((c) => toCollectionCard(c, b.id, b.name, b.color)),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function toWishlistCard(card: DemoWishlistCard) {
  const desiredQuantity =
    card.desiredQuantity ?? card.cardData?.desiredQuantity ?? 1;
  const ownedQuantity = store().getOwnedQuantity(card.cardId);
  const missingQuantity = Math.max(desiredQuantity - ownedQuantity, 0);
  return {
    ...card.cardData,
    id: card.id,
    externalId: card.cardData?.externalId ?? card.cardId,
    tcg: card.tcg,
    name: card.cardData?.name ?? card.name,
    setCode:
      card.cardData?.setCode ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).setCode
        : card.setCode),
    collectorNumber:
      card.cardData?.collectorNumber ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).collectorNumber
        : undefined),
    setName: card.cardData?.setName ?? card.setName,
    rarity: card.cardData?.rarity ?? card.rarity,
    desiredQuantity,
    owned: ownedQuantity > 0,
    ownedQuantity,
    missingQuantity,
    createdAt: card.addedAt,
  };
}

function toWishlist(w: DemoWishlist) {
  const cards = w.cards.map(toWishlistCard);
  const totalCards = cards.length;
  const ownedCards = cards.filter((c) => c.owned).length;
  const totalDesiredQuantity = cards.reduce(
    (total, card) => total + card.desiredQuantity,
    0,
  );
  const ownedDesiredQuantity = cards.reduce(
    (total, card) => total + Math.min(card.ownedQuantity, card.desiredQuantity),
    0,
  );
  const missingQuantity = totalDesiredQuantity - ownedDesiredQuantity;
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    colorHex: stripHash(w.color),
    cards,
    rules: w.rules ?? [],
    totalCards,
    ownedCards,
    totalDesiredQuantity,
    ownedDesiredQuantity,
    missingQuantity,
    completionPercent:
      totalDesiredQuantity > 0
        ? Math.round((ownedDesiredQuantity / totalDesiredQuantity) * 100)
        : 0,
    createdAt: w.createdAt,
    updatedAt: w.createdAt,
  };
}

function demoCardToSearchResult(dc: DemoCard) {
  const { setCode, collectorNumber } = splitDemoPrintingCode(dc.setCode);
  return {
    id: dc.id,
    tcg: dc.tcg,
    name: dc.name,
    setCode,
    setName: dc.setName,
    rarity: dc.rarity,
    collectorNumber,
    attributes: { price: dc.price },
  };
}

const DEMO_TCGS: readonly CatalogTcgCode[] = CATALOG_GAMES;

function isSeededDemoGame(game: CatalogTcgCode): game is DemoTcg {
  return game === "pokemon" || game === "magic" || game === "yugioh";
}

function demoOwnedCards(tcg?: TcgCode): Card[] {
  const cards = new Map<string, Card>();
  for (const binder of store().binders) {
    for (const owned of binder.cards) {
      if (tcg && owned.tcg !== tcg) continue;
      cards.set(owned.cardId, {
        ...owned.cardData,
        id: owned.cardId,
        tcg: owned.tcg,
        name: owned.name,
        setCode: owned.cardData?.setCode ?? owned.setCode,
        setName: owned.cardData?.setName ?? owned.setName,
        rarity: owned.cardData?.rarity ?? owned.rarity,
      });
    }
  }
  return Array.from(cards.values());
}

function mergeOwnedCards(base: Card[], owned: Card[]): Card[] {
  const merged = new Map(base.map((card) => [card.id, card] as const));
  for (const card of owned) merged.set(card.id, card);
  return Array.from(merged.values());
}

function cardMatchesQuery(card: Card, query: string): boolean {
  const needle = normalizeCatalogText(query);
  if (!needle) return false;
  return normalizeCatalogText(
    [
      card.name,
      card.setName,
      card.setCode,
      card.collectorNumber,
      card.rarity,
      card.supertype,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  ).includes(needle);
}

function ownedCardSetCode(card: Card): string {
  const setCode = card.setCode ?? "";
  return setCode.includes("-") ? setCode.replace(/-[^-]+$/, "") : setCode;
}

function demoSetCode(card: DemoCard): string {
  return card.setCode.replace(/-[^-]+$/, "");
}

function demoSets(tcg?: TcgCode): TcgSet[] {
  const sets = new Map<
    string,
    {
      code: string;
      name: string;
      tcg: TcgCode;
      totalCards: number;
    }
  >();

  for (const card of DEMO_CARDS) {
    if (tcg && card.tcg !== tcg) continue;
    const key = `${card.tcg}:${card.setName}`;
    const existing = sets.get(key);
    if (existing) {
      existing.totalCards += 1;
    } else {
      sets.set(key, {
        code: demoSetCode(card),
        name: card.setName,
        tcg: card.tcg,
        totalCards: 1,
      });
    }
  }

  return Array.from(sets.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function demoOwnedSets(tcg?: TcgCode): TcgSet[] {
  const sets = new Map<string, TcgSet>();
  for (const card of demoOwnedCards(tcg)) {
    const code = ownedCardSetCode(card);
    if (!code) continue;
    const key = `${card.tcg}:${normalizeCatalogText(code)}`;
    const existing = sets.get(key);
    sets.set(key, {
      code,
      name: card.setName ?? code,
      tcg: card.tcg,
      totalCards: (existing?.totalCards ?? 0) + 1,
    });
  }
  return Array.from(sets.values());
}

async function demoSearchCards(query: string, tcg?: TcgCode): Promise<Card[]> {
  const games = tcg ? [tcg] : DEMO_TCGS;
  const gameResults = await Promise.all(
    games.map(async (game) => {
      if (!isCatalogGame(game)) return [];
      const installed = await isCatalogInstalled(game);
      if (installed) return searchCatalog(query, game);
      return isSeededDemoGame(game)
        ? searchDemoCards(query, game).map(demoCardToSearchResult)
        : [];
    }),
  );
  const owned = demoOwnedCards(tcg).filter((card) =>
    cardMatchesQuery(card, query),
  );
  return mergeOwnedCards(gameResults.flat(), owned);
}

async function demoCatalogSets(tcg?: TcgCode): Promise<TcgSet[]> {
  const games: readonly CatalogTcgCode[] = tcg
    ? isCatalogGame(tcg)
      ? [tcg]
      : []
    : DEMO_TCGS;
  const results = await Promise.all(
    games.map(async (game) =>
      (await isCatalogInstalled(game)) ? getCatalogSets(game) : demoSets(game),
    ),
  );
  const merged = new Map(
    results
      .flat()
      .map(
        (set) => [`${set.tcg}:${normalizeCatalogText(set.code)}`, set] as const,
      ),
  );
  // Owned-derived sets report the number of cards OWNED as totalCards, which is
  // not the set's size. Letting them overwrite a catalog entry made every set
  // the demo owns cards from report N/N — Modern Horizons 2 showed 6/6 complete
  // in the set list while its detail page correctly said 6/7. So only fill in
  // sets the catalog does not already describe, and when the size is genuinely
  // unknown report 0 so the UI says "Total unavailable" instead of claiming
  // completion.
  for (const set of demoOwnedSets(tcg)) {
    const key = `${set.tcg}:${normalizeCatalogText(set.code)}` as const;
    if (merged.has(key)) continue;
    merged.set(key, { ...set, totalCards: 0 });
  }
  return Array.from(merged.values());
}

async function demoCardsInSet(tcg: TcgCode, setCode: string): Promise<Card[]> {
  const normalizedSetCode = normalizeCatalogText(setCode);
  const base = isCatalogGame(tcg)
    ? (await isCatalogInstalled(tcg))
      ? await getCatalogCardsInSet(tcg, setCode)
      : DEMO_CARDS.filter(
          (card) =>
            card.tcg === tcg &&
            normalizeCatalogText(demoSetCode(card)) === normalizedSetCode,
        ).map(demoCardToSearchResult)
    : [];
  const owned = demoOwnedCards(tcg).filter(
    (card) =>
      normalizeCatalogText(ownedCardSetCode(card)) === normalizedSetCode,
  );
  return mergeOwnedCards(base, owned);
}

/* ------------------------------------------------------------------ */
/*  Router                                                              */
/* ------------------------------------------------------------------ */

/**
 * Main entry point — called by the fetch interceptor in demo-mode.ts.
 * Parses the URL path and method and dispatches to the right handler.
 */
export async function handleDemoRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  // The demo store now hydrates from IndexedDB, which is asynchronous where
  // localStorage was not. Handlers below call init() and read the store in the
  // same tick, so without waiting here the first request after a cold load
  // would answer from a store that is empty only because the read has not
  // landed yet — a returning visitor would see an empty collection flash, and
  // init() could seed over their data. Resolves immediately once hydrated, and
  // never rejects: a storage failure resolves with nothing loaded.
  await whenDemoStoreHydrated();

  // Strip query string for routing, but keep it for parsing params
  const [routePath, queryString] = path.split("?");
  const segments = routePath.replace(/^\//, "").split("/");

  if (segments[0] === "health" && segments.length === 1 && method === "GET") {
    return json({
      status: "ok",
      env: "production",
      mode: "convex",
      features: {
        decks: true,
        finance: true,
        sealed: true,
        analytics: true,
        trades: true,
        prices: true,
        notifications: false,
        alerts: false,
        shops: false,
        automations: false,
        shipments: false,
        public: false,
      },
    });
  }

  // ── Auth ────────────────────────────────────────────────────────
  if (segments[0] === "auth") {
    return handleAuth(method, segments.slice(1), body);
  }

  // ── Collections / Binders ───────────────────────────────────────
  if (segments[0] === "collections") {
    return handleCollections(method, segments.slice(1), body, queryString);
  }

  // ── Wishlists ───────────────────────────────────────────────────
  if (segments[0] === "wishlists") {
    return handleWishlists(method, segments.slice(1), body);
  }

  if (segments[0] === "guides") {
    return handleGuides(method, segments.slice(1), body, queryString);
  }

  // ── Users ───────────────────────────────────────────────────────
  if (segments[0] === "users") {
    return handleUsers(method, segments.slice(1), body);
  }

  // ── Settings ────────────────────────────────────────────────────
  if (segments[0] === "settings") {
    return handleSettings(method, segments.slice(1), body);
  }

  if (segments[0] === "finance") {
    return handleFinance(method, segments.slice(1), body);
  }

  if (segments[0] === "analytics") {
    store().init();
    if (segments[1] === "value" && segments.length === 2 && method === "GET") {
      const params = new URLSearchParams(queryString || "");
      const period = params.get("period") || "30d";
      return json(demoValueHistory(period, params.get("tcg") || undefined));
    }
    if (
      segments[1] === "value" &&
      segments[2] === "breakdown" &&
      method === "GET"
    ) {
      return json(demoValueBreakdown());
    }
    if (segments[1] === "distribution" && method === "GET") {
      const params = new URLSearchParams(queryString || "");
      const dimension = params.get("by") || "tcg";
      return json(demoDistribution(dimension, params.get("tcg") || undefined));
    }
    return notFound();
  }

  if (
    segments[0] === "prices" &&
    segments[1] === "analytics" &&
    segments[2] === "movers" &&
    method === "GET"
  ) {
    store().init();
    const tcg = new URLSearchParams(queryString || "").get("tcg") ?? undefined;
    return json(demoPriceMovers(tcg));
  }

  if (
    segments[0] === "prices" &&
    segments[1] === "sources" &&
    method === "GET"
  ) {
    return json({
      sources: [
        {
          id: "automatic",
          label: "Saved catalog prices",
          description: "Use the prices included with the offline demo catalog.",
          games: [],
          requiresServer: false,
        },
      ],
      defaultSource: "automatic",
    });
  }

  // ── Setup ───────────────────────────────────────────────────────
  if (segments[0] === "setup") {
    if (segments[1] === "setup-required" && method === "GET") {
      return json({ setupRequired: false });
    }
    if (segments[1] === "setup" && method === "POST") {
      store().init();
      return json({ user: demoAuthUser(), token: "demo-token-static" });
    }
    return notFound();
  }

  // ── Card Search ─────────────────────────────────────────────────
  if (segments[0] === "cards") {
    return handleCards(method, segments.slice(1), queryString);
  }

  return notFound(`Demo: unknown route ${method} ${path}`);
}

async function handleGuides(
  method: string,
  segments: string[],
  body?: unknown,
  queryString?: string,
): Promise<Response> {
  store().init();
  const guides = demoCollectionGuides();
  if (segments.length === 0 && method === "GET") return json(guides);

  if (segments[0] === "cards" && segments.length === 1 && method === "GET") {
    const params = new URLSearchParams(queryString || "");
    const query = normalizeCatalogText(params.get("query") || "");
    const tcg = params.get("tcg");
    const category = params.get("category");
    const guideSlug = params.get("guide");
    const ownership = params.get("ownership") || "all";
    const selectedGuides = guides.filter(
      (guide) =>
        (!tcg || guide.tcg === tcg) &&
        (!category || guide.category === category) &&
        (!guideSlug || guide.slug === guideSlug),
    );
    const rows: Array<{
      card: Card;
      owned: boolean;
      ownedQuantity: number;
      matchedGuides: Array<{
        guideId: string;
        slug: string;
        title: string;
        category: CollectionGuideResponse["category"];
        tags: string[];
        groupKey?: string;
        groupLabel?: string;
        groupOrder?: number;
        position?: number;
      }>;
    }> = [];
    for (const guide of selectedGuides) {
      const cards =
        guide.rule.type === "manual"
          ? demoConnectedArtItems().map((item) => ({
              card: {
                id: item.externalId,
                tcg: item.tcg,
                name: item.name,
                setCode: item.setCode,
                setName: item.setName,
                collectorNumber: item.collectorNumber,
                rarity: item.rarity,
                artist: item.artist,
                imageUrl: item.imageUrl,
                imageUrlSmall: item.imageUrlSmall,
              } satisfies Card,
              item,
            }))
          : guide.rule.type === "name" && guide.rule.query
            ? (await demoSearchCards(guide.rule.query, guide.tcg)).map(
                (card) => ({ card, item: undefined }),
              )
            : guide.rule.type === "tag" &&
                guide.rule.query &&
                isCatalogGame(guide.tcg)
              ? (
                  await searchCatalogByCollectionTag(
                    guide.rule.query,
                    guide.tcg,
                    5000,
                  )
                ).map((card) => ({ card, item: undefined }))
              : [];
      for (const { card, item } of cards) {
        const searchText = normalizeCatalogText(
          [
            card.name,
            card.setName,
            card.artist,
            guide.title,
            ...guide.tags,
            item?.groupLabel,
          ]
            .filter(Boolean)
            .join(" "),
        );
        if (query && !searchText.includes(query)) continue;
        const ownedQuantity = store().getOwnedQuantity(card.id);
        const owned = ownedQuantity > 0;
        if (ownership === "owned" && !owned) continue;
        if (ownership === "missing" && owned) continue;
        rows.push({
          card,
          owned,
          ownedQuantity,
          matchedGuides: [
            {
              guideId: guide.id,
              slug: guide.slug,
              title: guide.title,
              category: guide.category,
              tags: guide.tags,
              groupKey: item?.groupKey,
              groupLabel: item?.groupLabel,
              groupOrder: item?.groupOrder,
              position: item?.position,
            },
          ],
        });
      }
    }
    return json({ results: rows, total: rows.length, failedGuideSlugs: [] });
  }

  const slug = decodeURIComponent(segments[0] ?? "");
  const guide = guides.find((candidate) => candidate.slug === slug);
  if (!guide) return notFound("Collection guide not found");
  if (segments.length === 1 && method === "GET") return json(guide);
  if (segments[1] === "items" && segments.length === 2 && method === "GET") {
    return json(guide.rule.type === "manual" ? demoConnectedArtItems() : []);
  }

  if (segments[1] === "follow" && segments.length === 2 && method === "POST") {
    if (guide.wishlistId) {
      return json({ guide, wishlistId: guide.wishlistId, created: false });
    }
    const name =
      (body as { wishlistName?: string } | undefined)?.wishlistName?.trim() ||
      guide.title;
    const wishlistId = await store().addWishlist(
      name,
      `Following the “${guide.title}” collection guide.`,
    );
    if (guide.rule.type === "manual") {
      for (const item of demoConnectedArtItems()) {
        await store().addCardToWishlist(
          wishlistId,
          {
            id: item.externalId,
            tcg: item.tcg,
            name: item.name,
            setCode: `${item.setCode}-${item.collectorNumber}`,
            setName: item.setName ?? item.setCode ?? "Unknown set",
            rarity: item.rarity ?? "Unknown",
            price: 0,
          },
          {
            externalId: item.externalId,
            tcg: item.tcg,
            name: item.name,
            setCode: item.setCode,
            setName: item.setName,
            rarity: item.rarity,
            artist: item.artist,
            imageUrl: item.imageUrl,
            imageUrlSmall: item.imageUrlSmall,
            collectorNumber: item.collectorNumber,
          },
        );
      }
    } else {
      await store().addWishlistRule(wishlistId, {
        type: guide.rule.type,
        tcg: guide.rule.tcg,
        query: guide.rule.query,
        setCode: guide.rule.setCode,
        setName: guide.rule.setName,
        includeAllPrintings: guide.rule.includeAllPrintings,
        autoSync: true,
      });
    }
    const followed = demoCollectionGuides().find(
      (candidate) => candidate.slug === slug,
    )!;
    return json({ guide: followed, wishlistId, created: true }, 201);
  }
  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Auth handlers                                                       */
/* ------------------------------------------------------------------ */

function handleAuth(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  const action = segments[0];

  if (action === "signup" && method === "POST") {
    store().init();
    return json({ user: demoAuthUser(), token: "demo-token-static" });
  }

  if (action === "login" && method === "POST") {
    store().init();
    return json({ user: demoAuthUser(), token: "demo-token-static" });
  }

  if (action === "logout" && method === "POST") {
    return noContent();
  }

  if (action === "me" && method === "GET") {
    return json({ user: demoAuthUser() });
  }

  if (action === "setup-required" && method === "GET") {
    return json({ setupRequired: false });
  }

  if (action === "setup" && method === "POST") {
    store().init();
    return json({ user: demoAuthUser(), token: "demo-token-static" });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Collections handlers                                                */
/* ------------------------------------------------------------------ */

function handleFinance(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  const transactions = getDemoTransactions();
  if (segments[0] === "summary" && segments.length === 1 && method === "GET") {
    const totalSpent = transactions
      .filter((transaction) => transaction.type === "purchase")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalEarned = transactions
      .filter((transaction) => transaction.type === "sale")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    return json({
      totalSpent,
      totalEarned,
      profitLoss: totalEarned - totalSpent,
      transactionCount: transactions.length,
    });
  }
  if (
    segments[0] === "summary" &&
    segments[1] === "by-currency" &&
    segments.length === 2 &&
    method === "GET"
  ) {
    const byCurrency = new Map<
      string,
      { totalSpent: number; totalEarned: number }
    >();
    for (const transaction of transactions) {
      const currency = transaction.currency.toUpperCase();
      const totals = byCurrency.get(currency) ?? {
        totalSpent: 0,
        totalEarned: 0,
      };
      if (transaction.type === "purchase")
        totals.totalSpent += transaction.amount;
      if (transaction.type === "sale") totals.totalEarned += transaction.amount;
      byCurrency.set(currency, totals);
    }
    return json({
      byCurrency: [...byCurrency.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, totals]) => ({
          currency,
          totalSpent: totals.totalSpent,
          totalEarned: totals.totalEarned,
          profitLoss: totals.totalEarned - totals.totalSpent,
        })),
      transactionCount: transactions.length,
    });
  }
  if (segments[0] === "realized-performance" && method === "GET") {
    const sales = transactions.filter(
      (transaction) => transaction.type === "sale",
    );
    const metrics = sales.map((sale) => {
      const fees = sale.fees ?? 0;
      const shippingCost = sale.shippingCost ?? 0;
      const netProceeds = sale.amount - fees - shippingCost;
      return {
        id: sale.id,
        cardName: sale.cardName,
        tcg: sale.tcg,
        platform: sale.platform,
        currency: sale.currency,
        quantity: sale.quantity,
        date: sale.date,
        revenue: sale.amount,
        costBasis: sale.costBasis,
        fees,
        shippingCost,
        netProceeds,
        realizedProfit:
          sale.costBasis === undefined
            ? undefined
            : netProceeds - sale.costBasis,
        holdingDays: sale.holdingDays,
      };
    });
    const byCurrency = new Map<string, typeof metrics>();
    for (const metric of metrics) {
      byCurrency.set(metric.currency, [
        ...(byCurrency.get(metric.currency) ?? []),
        metric,
      ]);
    }
    const breakdown = (field: "platform" | "tcg") => {
      const groups = new Map<
        string,
        {
          key: string;
          currency: string;
          revenue: number;
          realizedProfit: number;
          saleCount: number;
        }
      >();
      for (const metric of metrics) {
        const key = metric[field] || "Unspecified";
        const mapKey = `${metric.currency}:${key}`;
        const group = groups.get(mapKey) ?? {
          key,
          currency: metric.currency,
          revenue: 0,
          realizedProfit: 0,
          saleCount: 0,
        };
        group.revenue += metric.revenue;
        group.realizedProfit += metric.realizedProfit ?? 0;
        group.saleCount += 1;
        groups.set(mapKey, group);
      }
      return [...groups.values()];
    };
    const inventory = demoCollectionCards();
    return json({
      byCurrency: [...byCurrency.entries()].map(([currency, rows]) => {
        const holding = rows.flatMap((row) =>
          row.holdingDays === undefined ? [] : [row.holdingDays],
        );
        return {
          currency,
          revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
          costBasis: rows.reduce((sum, row) => sum + (row.costBasis ?? 0), 0),
          fees: rows.reduce((sum, row) => sum + row.fees, 0),
          shippingCost: rows.reduce((sum, row) => sum + row.shippingCost, 0),
          netProceeds: rows.reduce((sum, row) => sum + row.netProceeds, 0),
          realizedProfit: rows.reduce(
            (sum, row) => sum + (row.realizedProfit ?? 0),
            0,
          ),
          saleCount: rows.length,
          costedSaleCount: rows.filter((row) => row.costBasis !== undefined)
            .length,
          averageHoldingDays: holding.length
            ? Math.round(
                holding.reduce((sum, value) => sum + value, 0) / holding.length,
              )
            : undefined,
        };
      }),
      byPlatform: breakdown("platform"),
      byGame: breakdown("tcg"),
      recentSales: metrics.slice(0, 8),
      bestReturns: [...metrics]
        .filter((row) => row.realizedProfit !== undefined)
        .sort((a, b) => (b.realizedProfit ?? 0) - (a.realizedProfit ?? 0))
        .slice(0, 5),
      worstReturns: [...metrics]
        .filter((row) => row.realizedProfit !== undefined)
        .sort((a, b) => (a.realizedProfit ?? 0) - (b.realizedProfit ?? 0))
        .slice(0, 5),
      fastestSales: [...metrics]
        .filter((row) => row.holdingDays !== undefined)
        .sort((a, b) => (a.holdingDays ?? 0) - (b.holdingDays ?? 0))
        .slice(0, 5),
      inventoryCost: inventory.reduce(
        (sum, { card }) =>
          sum +
          (card.copies ?? []).reduce(
            (copySum, copy) => copySum + (copy.acquisitionPrice ?? 0),
            0,
          ),
        0,
      ),
      inventoryMarketValue: inventory.reduce(
        (sum, { card }) => sum + card.price * card.quantity,
        0,
      ),
      inventoryCurrency: "USD",
      truncated: false,
    });
  }
  if (segments[0] !== "transactions") return notFound();
  if (segments.length === 1 && method === "GET") {
    return json(
      [...transactions].sort(
        (left, right) =>
          new Date(right.date).getTime() - new Date(left.date).getTime(),
      ),
    );
  }
  if (segments.length === 1 && method === "POST") {
    const parsed = createTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return json({ message: "Payload validation failed" }, 400);
    }
    const input: CreateTransactionInput = parsed.data;
    const transaction: TransactionResponse = {
      id: `demo-transaction-${crypto.randomUUID()}`,
      type: input.type,
      cardName: input.cardName,
      tcg: input.tcg,
      quantity: input.quantity ?? 1,
      amount: input.amount,
      currency: input.currency ?? "USD",
      platform: input.platform,
      costBasis: input.costBasis,
      fees: input.fees,
      shippingCost: input.shippingCost,
      acquiredAt: input.acquiredAt,
      netProceeds:
        input.type === "sale"
          ? input.amount - (input.fees ?? 0) - (input.shippingCost ?? 0)
          : undefined,
      realizedProfit:
        input.type === "sale" && input.costBasis !== undefined
          ? input.amount -
            (input.fees ?? 0) -
            (input.shippingCost ?? 0) -
            input.costBasis
          : undefined,
      notes: input.notes,
      date: input.date ?? new Date().toISOString(),
    };
    setDemoTransactions(
      [transaction, ...transactions].sort(
        (left, right) =>
          new Date(right.date).getTime() - new Date(left.date).getTime(),
      ),
    );
    return json(transaction, 201);
  }
  if (segments.length === 2 && method === "DELETE") {
    if (!transactions.some((item) => item.id === segments[1])) {
      return notFound("Transaction not found");
    }
    setDemoTransactions(transactions.filter((item) => item.id !== segments[1]));
    return noContent();
  }
  return notFound();
}

async function handleCollections(
  method: string,
  segments: string[],
  body?: unknown,
  queryString?: string,
): Promise<Response> {
  if (
    segments[0] === "import" &&
    segments[1] === "template" &&
    method === "GET"
  ) {
    return Promise.resolve(
      new Response(`${DEMO_IMPORT_HEADERS.join(",")}\n`, {
        headers: { "Content-Type": "text/csv" },
      }),
    );
  }

  if (
    segments[0] === "import" &&
    (segments[1] === "preview" || segments[1] === "commit") &&
    method === "POST"
  ) {
    store().init();
    const parsed = collectionImportRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ message: parsed.error.issues[0]?.message }, 400);
    }
    const preview = previewDemoCollectionImport(parsed.data);
    if (segments[1] === "preview") {
      return json(preview, preview.valid ? 200 : 422);
    }
    if (!preview.valid) {
      return json(
        {
          ...preview,
          importedRows: 0,
          importedCopies: 0,
          createdBinders: [],
        } satisfies CollectionImportResult,
        422,
      );
    }
    return json(
      await commitDemoCollectionImport(
        preview,
        parsed.data.options ?? { createMissingBinders: false },
      ),
    );
  }

  if (segments[0] === "history" && segments.length === 1 && method === "GET") {
    store().init();
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number(new URLSearchParams(queryString ?? "").get("limit")) || 50,
      ),
    );
    return json({
      entries: store()
        .collectionHistory.slice(0, limit)
        .map(({ before: _before, after: _after, ...entry }) => entry),
    });
  }

  if (
    segments[0] === "history" &&
    segments[2] === "undo" &&
    segments.length === 3 &&
    method === "POST"
  ) {
    const source = store().collectionHistory.find(
      (entry) => entry.id === segments[1],
    );
    if (!source) return notFound("Collection history entry not found");
    if (!source.canUndo) {
      return json({ message: "This collection change cannot be undone." }, 409);
    }
    const audit = store().undoCollectionMutation(source.id);
    if (!audit) {
      return json(
        { message: "The collection changed after this history entry." },
        409,
      );
    }
    return json({ audit });
  }

  if (segments[0] === "export" && method === "GET") {
    store().init();
    await store().enrichCardsFromCatalog();
    const binders = store().binders.map(toBinder);
    const rows = binders.flatMap((binder) =>
      binder.cards.flatMap((card) =>
        card.copies.map((copy) => ({
          binder: binder.name,
          tcg: card.tcg,
          cardName: card.name,
          setCode: card.setCode ?? "",
          collectorNumber: card.collectorNumber ?? "",
          condition: copy.condition ?? "",
          gradingCompany: copy.gradingCompany ?? "",
          gradingScore: copy.gradingScore ?? "",
          certNumber: copy.certNumber ?? "",
          storageLocation: copy.storageLocation ?? "",
        })),
      ),
    );
    const headers = Object.keys(
      rows[0] ?? {
        binder: "",
        tcg: "",
        cardName: "",
        setCode: "",
        collectorNumber: "",
        condition: "",
        gradingCompany: "",
        gradingScore: "",
        certNumber: "",
        storageLocation: "",
      },
    );
    const csv = [
      headers,
      ...rows.map((row) =>
        headers.map((key) => String(row[key as keyof typeof row] ?? "")),
      ),
    ]
      .map((fields) =>
        fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const wantsCsv =
      new URLSearchParams(queryString ?? "").get("format") === "csv";
    return Promise.resolve(
      new Response(
        wantsCsv
          ? csv
          : JSON.stringify(
              { exportedAt: new Date().toISOString(), binders },
              null,
              2,
            ),
        {
          headers: {
            "Content-Type": wantsCsv ? "text/csv" : "application/json",
          },
        },
      ),
    );
  }
  // GET /collections
  if (segments.length === 0 && method === "GET") {
    store().init();
    await store().enrichCardsFromCatalog();
    return json(store().binders.map(toBinder));
  }

  // POST /collections
  if (segments.length === 0 && method === "POST") {
    const parsed = createBinderSchema.safeParse(body);
    if (!parsed.success) {
      return json({ message: parsed.error.issues[0]?.message }, 400);
    }
    const data: CreateBinderInput = parsed.data;
    const before = collectionRowsSnapshot();
    const id = await store().addBinder(
      data.name.trim(),
      data.colorHex ? `#${data.colorHex}` : undefined,
    );
    await store().updateBinder(id, {
      description: data.description,
      defaultCondition: data.defaultCondition,
      containerType: data.containerType,
      imageUrl: data.imageUrl,
      associatedTcg: data.associatedTcg,
      associatedSetCode: data.associatedSetCode,
      associatedSetName: data.associatedSetName,
    });
    const binder = store().binders.find((b: DemoBinder) => b.id === id)!;
    recordDemoCollectionMutation({
      operationKind: "add",
      affectedCopies: 0,
      binderId: id,
      summary: `Created binder “${binder.name}”`,
      before,
    });
    return json(toBinder(binder));
  }

  // GET/POST /collections/tags
  if (segments[0] === "tags") {
    if (method === "GET") return json(store().tags);
    if (method === "POST") {
      const parsed = createTagSchema.safeParse(body);
      if (!parsed.success) {
        return json({ message: parsed.error.issues[0]?.message }, 400);
      }
      if (!parsed.data.label.trim()) {
        return json({ message: "Label is required" }, 400);
      }
      return json(store().addTag(parsed.data), 201);
    }
    return notFound();
  }

  // POST /collections/cards  (library add)
  if (segments[0] === "cards" && segments.length === 1 && method === "POST") {
    return handleAddCard("__library__", body);
  }

  const collectionId = segments[0];

  // GET /collections/:id
  // The server serves this (convex/http.ts) and the demo did not, so a client
  // asking for a single binder got a 404 in demo mode only.
  if (segments.length === 1 && method === "GET") {
    store().init();
    await store().enrichCardsFromCatalog();
    const binder = store().binders.find(
      (b: DemoBinder) => b.id === collectionId,
    );
    return binder ? json(toBinder(binder)) : notFound("Collection not found");
  }

  // PATCH /collections/:id
  if (segments.length === 1 && method === "PATCH") {
    const parsed = updateBinderSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return json({ message: parsed.error.issues[0]?.message }, 400);
    }
    const data: UpdateBinderInput = parsed.data;
    const before = collectionRowsSnapshot();
    const updated = await store().updateBinder(collectionId, data);
    if (!updated) return notFound("Collection not found");
    const binder = store().binders.find(
      (b: DemoBinder) => b.id === collectionId,
    );
    if (binder) {
      recordDemoCollectionMutation({
        operationKind: "update",
        affectedCopies: 0,
        binderId: collectionId,
        summary: `Updated binder “${binder.name}”`,
        before,
      });
    }
    return binder ? json(toBinder(binder)) : notFound("Collection not found");
  }

  // DELETE /collections/:id
  if (segments.length === 1 && method === "DELETE") {
    const binder = store().binders.find((entry) => entry.id === collectionId);
    if (!binder) return notFound("Collection not found");
    const before = collectionRowsSnapshot();
    const affectedCopies = binder.cards.reduce(
      (sum, card) => sum + card.quantity,
      0,
    );
    await store().removeBinder(collectionId);
    recordDemoCollectionMutation({
      operationKind: "remove",
      affectedCopies,
      binderId: collectionId,
      summary: `Deleted binder “${binder.name}”`,
      before,
    });
    return noContent();
  }

  // POST /collections/:id/cards
  if (segments[1] === "cards" && segments.length === 2 && method === "POST") {
    return handleAddCard(collectionId, body);
  }

  // PATCH /collections/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "PATCH") {
    const cardId = segments[2];
    const patch = body as UpdateCardInput;
    const sourceBinder = store().binders.find(
      (entry) => entry.id === collectionId,
    );
    const sourceCard = sourceBinder?.cards.find(
      (card) =>
        card.id === cardId || card.copies?.some((copy) => copy.id === cardId),
    );
    const before = collectionRowsSnapshot();
    const updated = await store().updateCardInBinder(
      collectionId,
      cardId,
      patch,
    );
    // On a move the card now lives in the target binder, so the response has
    // to describe that binder — reporting the source would tell the UI the
    // card is still where it started.
    const resultBinderId = patch?.targetBinderId ?? collectionId;
    const binder = store().binders.find(
      (entry: DemoBinder) => entry.id === resultBinderId,
    );
    if (!binder || !updated) return notFound("Card not found");
    recordDemoCollectionMutation({
      operationKind: patch.targetBinderId ? "move" : "update",
      affectedCopies: patch.scope === "card" ? (sourceCard?.quantity ?? 1) : 1,
      binderId: binder.id,
      cardName: updated.name,
      summary: patch.targetBinderId
        ? `Moved ${updated.name} to “${binder.name}”`
        : `Updated ${updated.name}`,
      before,
    });
    return json(
      toCollectionCard(updated, binder.id, binder.name, binder.color),
    );
  }

  // DELETE /collections/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "DELETE") {
    const cardId = segments[2];
    const binder = store().binders.find((entry) => entry.id === collectionId);
    const card = binder?.cards.find(
      (entry) =>
        entry.id === cardId || entry.copies?.some((copy) => copy.id === cardId),
    );
    if (!card) return notFound("Card not found");
    const before = collectionRowsSnapshot();
    await store().removeCardFromBinder(collectionId, cardId);
    recordDemoCollectionMutation({
      operationKind: "remove",
      affectedCopies: 1,
      binderId: collectionId,
      cardName: card.name,
      summary: `Removed one copy of ${card.name}`,
      before,
    });
    return noContent();
  }

  return notFound();
}

async function handleAddCard(
  collectionId: string,
  body: unknown,
): Promise<Response> {
  const data = body as AddCardInput;
  const demoCard: DemoOwnedCard | null =
    DEMO_CARDS.find((c) => c.id === data.cardId) ||
    (data.cardData
      ? {
          id: data.cardData.externalId || data.cardId,
          tcg: data.cardData.tcg,
          name: data.cardData.name,
          setCode: data.cardData.setCode || "",
          setName: data.cardData.setName || "",
          rarity: data.cardData.rarity || "Common",
          price: data.price || 0,
        }
      : null);

  if (!demoCard) return json({ message: "Card not found" }, 400);

  const targetBinder =
    collectionId === "__library__" ? store().binders[0]?.id : collectionId;

  if (targetBinder) {
    const before = collectionRowsSnapshot();
    await store().addCardToBinder(targetBinder, demoCard, data.quantity ?? 1, {
      cardData: data.cardData,
      copy: {
        condition: data.condition,
        language: data.language,
        notes: data.notes,
        price: data.price,
        acquisitionPrice: data.acquisitionPrice,
        isFoil: data.isFoil,
        finishCode: data.finishCode,
        finishLabel: data.finishLabel,
        edition: data.edition,
        stamp: data.stamp,
        isSealedPromo: data.isSealedPromo,
        isOversized: data.isOversized,
        isPeelOff: data.isPeelOff,
        isSigned: data.isSigned,
        isAltered: data.isAltered,
        gradingCompany: data.gradingCompany,
        gradingScore: data.gradingScore,
        certNumber: data.certNumber,
        storageLocation: data.storageLocation,
      },
    });
    recordDemoCollectionMutation({
      operationKind: "add",
      affectedCopies: data.quantity ?? 1,
      binderId: targetBinder,
      cardName: demoCard.name,
      summary: `Added ${data.quantity ?? 1} ${(data.quantity ?? 1) === 1 ? "copy" : "copies"} of ${demoCard.name}`,
      before,
    });
  }

  return json({ success: true });
}

/* ------------------------------------------------------------------ */
/*  Wishlists handlers                                                  */
/* ------------------------------------------------------------------ */

async function handleWishlists(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  // GET /wishlists
  if (segments.length === 0 && method === "GET") {
    store().init();
    await store().enrichCardsFromCatalog();
    return json(store().wishlists.map(toWishlist));
  }

  // POST /wishlists
  if (segments.length === 0 && method === "POST") {
    const data = body as {
      name: string;
      description?: string;
      colorHex?: string;
    };
    const id = await store().addWishlist(data.name, data.description);
    const w = store().wishlists.find((wl: DemoWishlist) => wl.id === id)!;
    return json(toWishlist(w));
  }

  const wishlistId = segments[0];

  // GET /wishlists/:id
  if (segments.length === 1 && method === "GET") {
    await store().enrichCardsFromCatalog();
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    );
    return w ? json(toWishlist(w)) : notFound("Wishlist not found");
  }

  // PATCH /wishlists/:id
  if (segments.length === 1 && method === "PATCH") {
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    );
    return w ? json(toWishlist(w)) : notFound("Wishlist not found");
  }

  // DELETE /wishlists/:id
  if (segments.length === 1 && method === "DELETE") {
    await store().removeWishlist(wishlistId);
    return noContent();
  }

  // POST /wishlists/:id/cards
  if (segments[1] === "cards" && segments.length === 2 && method === "POST") {
    const data = body as AddWishlistCardInput;
    const demoCard: DemoOwnedCard = DEMO_CARDS.find(
      (c) => c.id === data.externalId,
    ) || {
      id: data.externalId,
      tcg: data.tcg,
      name: data.name,
      setCode: data.setCode || "",
      setName: data.setName || "",
      rarity: data.rarity || "Common",
      price: 0,
    };
    await store().addCardToWishlist(wishlistId, demoCard, data);
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    )!;
    const card = w.cards[w.cards.length - 1];
    return json(toWishlistCard(card));
  }

  // POST /wishlists/:id/cards/batch
  if (
    segments[1] === "cards" &&
    segments[2] === "batch" &&
    segments.length === 3 &&
    method === "POST"
  ) {
    const data = body as { cards: AddWishlistCardInput[] };
    for (const card of data.cards ?? []) {
      const demoCard: DemoOwnedCard = DEMO_CARDS.find(
        (c) => c.id === card.externalId,
      ) || {
        id: card.externalId,
        tcg: card.tcg,
        name: card.name,
        setCode: card.setCode || "",
        setName: card.setName || "",
        rarity: card.rarity || "Common",
        price: 0,
      };
      await store().addCardToWishlist(wishlistId, demoCard, card);
    }
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    );
    return w ? json(toWishlist(w)) : notFound("Wishlist not found");
  }

  // DELETE /wishlists/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "PATCH") {
    const data = body as { desiredQuantity?: number };
    if (data.desiredQuantity !== undefined) {
      await store().updateWishlistCard(
        wishlistId,
        segments[2],
        data.desiredQuantity,
      );
    }
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    );
    const card = w?.cards.find((entry) => entry.id === segments[2]);
    return card
      ? json(toWishlistCard(card))
      : notFound("Wishlist card not found");
  }

  // DELETE /wishlists/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "DELETE") {
    await store().removeCardFromWishlist(wishlistId, segments[2]);
    return noContent();
  }

  // POST /wishlists/:id/rules
  if (segments[1] === "rules" && segments.length === 2 && method === "POST") {
    const data = body as CreateWishlistRuleInput;
    const rule = await store().addWishlistRule(wishlistId, {
      type: data.type,
      tcg: data.tcg,
      query: data.query,
      setCode: data.setCode,
      setName: data.setName,
      includeAllPrintings: data.includeAllPrintings ?? true,
      autoSync: data.autoSync ?? true,
    });
    return rule ? json(rule) : notFound("Wishlist not found");
  }

  // PATCH /wishlists/:id/rules/:ruleId
  if (segments[1] === "rules" && segments.length === 3 && method === "PATCH") {
    const data = body as UpdateWishlistRuleInput;
    const rule = await store().updateWishlistRule(
      wishlistId,
      segments[2],
      data,
    );
    return rule ? json(rule) : notFound("Wishlist rule not found");
  }

  // DELETE /wishlists/:id/rules/:ruleId
  if (segments[1] === "rules" && segments.length === 3 && method === "DELETE") {
    await store().removeWishlistRule(wishlistId, segments[2]);
    return noContent();
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Users handlers                                                      */
/* ------------------------------------------------------------------ */

function handleUsers(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  // GET /users/me
  if (segments[0] === "me" && segments.length === 1 && method === "GET") {
    const { profile } = store();
    return json({
      id: DEMO_USER_ID,
      email: profile.email,
      username: profile.username,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true,
      createdAt: "2024-01-01T00:00:00Z",
    });
  }

  // PATCH /users/me
  if (segments[0] === "me" && segments.length === 1 && method === "PATCH") {
    const data = body as { username?: string; email?: string };
    store().updateProfile(data);
    const { profile } = store();
    return json({
      id: DEMO_USER_ID,
      email: profile.email,
      username: profile.username,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true,
    });
  }

  // POST /users/me/change-password
  if (
    segments[0] === "me" &&
    segments[1] === "change-password" &&
    method === "POST"
  ) {
    return json({ success: true });
  }

  // GET /users/me/preferences
  if (
    segments[0] === "me" &&
    segments[1] === "preferences" &&
    method === "GET"
  ) {
    return json(store().getPreferences());
  }

  // PATCH /users/me/preferences
  if (
    segments[0] === "me" &&
    segments[1] === "preferences" &&
    method === "PATCH"
  ) {
    const data = body as Partial<UserPreferences>;
    return json(store().updatePreferences(data));
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Settings handlers                                                   */
/* ------------------------------------------------------------------ */

function handleSettings(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  if (segments.length === 0 && method === "GET") return json(store().settings);
  if (segments.length === 0 && method === "PATCH") {
    const parsed = updateSettingsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return json({ message: parsed.error.issues[0]?.message }, 400);
    }
    return json(store().updateSettings(parsed.data));
  }

  if (segments[0] === "source-defaults" && method === "GET") {
    return json({
      scryfall: {
        url: "https://api.scryfall.com",
        label: "Scryfall (Magic)",
      },
      yugioh: {
        url: "https://db.ygoprodeck.com/api/v7",
        label: "YGOPRODeck (Yu-Gi-Oh)",
      },
      pokemon: {
        url: "https://api.scrydex.com/pokemon/v1",
        label: "Scrydex (Pok\u00e9mon)",
      },
      tcgdex: {
        url: "https://api.tcgdex.net/v2/en",
        label: "TCGdex (Pok\u00e9mon Variants)",
      },
    });
  }

  if (segments[0] === "test-source" && method === "POST") {
    const source = (body as { source?: unknown } | undefined)?.source;
    if (
      typeof source !== "string" ||
      !["scryfall", "yugioh", "pokemon", "tcgdex"].includes(source)
    ) {
      return json({ message: "Unsupported source" }, 400);
    }
    return json({ ok: true, latencyMs: 0 });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Cards handlers                                                      */
/* ------------------------------------------------------------------ */

async function handleCards(
  method: string,
  segments: string[],
  queryString?: string,
): Promise<Response> {
  if (
    segments[0] === "search" &&
    segments[1] === "artist" &&
    method === "GET"
  ) {
    const params = new URLSearchParams(queryString || "");
    const artist = params.get("artist") || "";
    const tcg = (params.get("tcg") || "pokemon") as CatalogTcgCode;
    const limit = Number.parseInt(params.get("limit") || "1000", 10);
    const cards =
      isCatalogGame(tcg) && (await isCatalogInstalled(tcg))
        ? await searchCatalogByArtist(artist, tcg, limit)
        : [];
    return json({ cards, total: cards.length });
  }

  // GET /cards/sets?tcg=...
  if (segments[0] === "sets" && segments.length === 1 && method === "GET") {
    const params = new URLSearchParams(queryString || "");
    const tcg = params.get("tcg") as TcgCode | null;
    const sets = await demoCatalogSets(tcg ?? undefined);
    return json({ sets, total: sets.length });
  }

  // GET /cards/sets/:tcg/:setCode
  if (segments[0] === "sets" && segments.length === 3 && method === "GET") {
    const tcg = segments[1] as TcgCode;
    const setCode = decodeURIComponent(segments[2]);
    const cards = await demoCardsInSet(tcg, setCode);
    return json({ cards, total: cards.length });
  }

  // GET /cards/search?query=... and GET /cards/search/all?query=...
  // The demo dataset is small enough that the exhaustive variant can reuse the
  // same search — there are no extra pages to page through.
  if (segments[0] === "search" && method === "GET") {
    const params = new URLSearchParams(queryString || "");
    const query = params.get("query") || "";
    const tcg = params.get("tcg") as TcgCode | undefined;
    const results = await demoSearchCards(query, tcg);
    return json({ cards: results });
  }

  // GET /cards/:tcg/:cardId/prints
  if (segments.length === 3 && segments[2] === "prints" && method === "GET") {
    const tcg = segments[0] as TcgCode;
    const cardId = decodeURIComponent(segments[1]);
    let target =
      demoOwnedCards(tcg).find((card) => card.id === cardId) ??
      DEMO_CARDS.find((card) => card.tcg === tcg && card.id === cardId);
    if (!target && isCatalogGame(tcg) && (await isCatalogInstalled(tcg))) {
      target = (
        await matchCatalogCards(tcg, [
          { key: "target", externalId: cardId, name: "" },
        ])
      ).get("target");
    }
    if (!target) return notFound("Card not found");
    const prints = (await demoSearchCards(target.name, tcg)).filter(
      (card) =>
        normalizeCatalogText(card.name) === normalizeCatalogText(target.name),
    );
    return json({ mode: "simple", prints, total: prints.length });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Re-export demoLogin for the demo login page                         */
/* ------------------------------------------------------------------ */

export function demoLogin() {
  store().init();
  return { user: demoAuthUser(), token: "demo-token-static" };
}
