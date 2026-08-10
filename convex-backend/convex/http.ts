import { ConvexError } from "convex/values";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./betterAuth/auth";
import type { RichCardMetadata } from "./lib/cardMetadata";
import {
  collectionImportTemplate,
  previewCollectionImport,
  type CollectionImportPreview
} from "./lib/collectionImport";
import {
  errorJson,
  getBridgeIdentity,
  handleConvexError,
  json,
  noContent,
  parseJsonBody,
  requireBridgeAdmin,
  requireBridgeIdentity,
  requireBridgeKey,
  textResponse,
  type BridgeIdentity
} from "./lib/httpBridge";
import type { TcgCode } from "./lib/validators";
import { registerDecksRoutes } from "./decksHttp";
import { registerFinanceRoutes } from "./financeHttp";
import { registerSealedRoutes } from "./sealedHttp";
import { registerAnalyticsRoutes } from "./analyticsHttp";
import { registerTradesRoutes } from "./tradesHttp";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

const LIBRARY_COLLECTION_ID = "__library__";
const TCG_CODES: readonly TcgCode[] = [
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball"
];

function isTcgCode(value: unknown): value is TcgCode {
  return typeof value === "string" && TCG_CODES.includes(value as TcgCode);
}

type NativeTag = {
  id: string;
  label: string;
  colorHex: string;
  createdAt: string;
  updatedAt: string;
};

type NativeEntry = {
  id: string;
  binderId: string;
  cardId: string;
  card: RichCardMetadata & {
    id: string;
    externalId: string;
    baseExternalId?: string;
    printingKey?: string;
    artworkId?: string;
    tcg: TcgCode;
    name: string;
    setCode?: string;
    setName?: string;
    rarity?: string;
    collectorNumber?: string;
    releasedAt?: string;
    imageUrl?: string;
    imageUrlSmall?: string;
  };
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  isFoil?: boolean;
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isSealedPromo?: boolean;
  isOversized?: boolean;
  isPeelOff?: boolean;
  isSigned?: boolean;
  isAltered?: boolean;
  gradingCompany?: string;
  gradingScore?: string;
  certNumber?: string;
  storageLocation?: string;
  imageUrls?: string[];
  tags: NativeTag[];
  createdAt: string;
  updatedAt: string;
};

type NativeBinderDetail = {
  id: string;
  userId: string;
  kind: "binder" | "library";
  name: string;
  description?: string;
  colorHex?: string;
  defaultCondition?: string;
  containerType?: string;
  imageUrl?: string;
  associatedTcg?: TcgCode;
  associatedSetCode?: string;
  associatedSetName?: string;
  entryCount: number;
  entries: NativeEntry[];
  createdAt: string;
  updatedAt: string;
};

type NativeWishlistCard = RichCardMetadata & {
  id: string;
  externalId: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  tcg: TcgCode;
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  setSymbolUrl?: string;
  setLogoUrl?: string;
  collectorNumber?: string;
  releasedAt?: string;
  notes?: string;
  owned: boolean;
  ownedQuantity: number;
  createdAt: string;
};

type NativeWishlistRule = {
  id: string;
  type: "name" | "set" | "artist";
  tcg?: TcgCode;
  query?: string;
  setCode?: string;
  setName?: string;
  includeAllPrintings: boolean;
  autoSync: boolean;
  lastSyncedAt?: string;
  lastMatchCount?: number;
  createdAt: string;
  updatedAt: string;
};

type NativeWishlist = {
  id: string;
  name: string;
  description?: string;
  colorHex?: string;
  matchAnyPrinting?: boolean;
  cards: NativeWishlistCard[];
  rules: NativeWishlistRule[];
  totalCards: number;
  ownedCards: number;
  completionPercent: number;
  createdAt: string;
  updatedAt: string;
};

function toLegacyBinderId(binder: NativeBinderDetail) {
  return binder.kind === "library" ? LIBRARY_COLLECTION_ID : binder.id;
}

function toLegacyTags(tags: NativeTag[]) {
  return tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    colorHex: tag.colorHex
  }));
}

function expandLegacyCopies(entry: NativeEntry) {
  const copyCount = Math.max(1, entry.quantity);
  return Array.from({ length: copyCount }, (_, index) => ({
    id: index === 0 ? entry.id : `${entry.id}#${index + 1}`,
    condition: entry.condition,
    language: entry.language,
    notes: entry.notes,
    price: entry.price,
    acquisitionPrice: entry.acquisitionPrice,
    serialNumber: entry.serialNumber,
    acquiredAt: entry.acquiredAt,
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
    imageUrls: entry.imageUrls ?? [],
    tags: toLegacyTags(entry.tags)
  }));
}

function toLegacyBinder(binder: NativeBinderDetail) {
  const grouped = new Map<string, any>();

  for (const entry of binder.entries) {
    const key = entry.cardId;
    const copies = expandLegacyCopies(entry);
    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += copies.length;
      existing.price ??= entry.price;
      existing.acquisitionPrice ??= entry.acquisitionPrice;
      existing.condition ??= entry.condition;
      existing.language ??= entry.language;
      existing.notes ??= entry.notes;
      existing.serialNumber ??= entry.serialNumber;
      existing.acquiredAt ??= entry.acquiredAt;
      existing.isFoil ??= entry.isFoil;
      existing.finishCode ??= entry.finishCode;
      existing.finishLabel ??= entry.finishLabel;
      existing.edition ??= entry.edition;
      existing.stamp ??= entry.stamp;
      existing.isSealedPromo ??= entry.isSealedPromo;
      existing.isOversized ??= entry.isOversized;
      existing.isPeelOff ??= entry.isPeelOff;
      existing.isSigned ??= entry.isSigned;
      existing.isAltered ??= entry.isAltered;
      existing.gradingCompany ??= entry.gradingCompany;
      existing.gradingScore ??= entry.gradingScore;
      existing.certNumber ??= entry.certNumber;
      existing.storageLocation ??= entry.storageLocation;
      existing.copies.push(...copies);
      continue;
    }

    grouped.set(key, {
      ...entry.card,
      id: copies[0]?.id ?? entry.id,
      cardId: entry.cardId,
      languageCode: entry.card.language,
      quantity: copies.length,
      condition: entry.condition,
      language: entry.language,
      notes: entry.notes,
      price: entry.price,
      acquisitionPrice: entry.acquisitionPrice,
      serialNumber: entry.serialNumber,
      acquiredAt: entry.acquiredAt,
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
      binderId: toLegacyBinderId(binder),
      binderName: binder.name,
      binderColorHex: binder.colorHex,
      copies
    });
  }

  return {
    id: toLegacyBinderId(binder),
    name: binder.name,
    description: binder.description ?? "",
    colorHex: binder.colorHex,
    defaultCondition: binder.defaultCondition,
    containerType: binder.containerType,
    imageUrl: binder.imageUrl,
    associatedTcg: binder.associatedTcg,
    associatedSetCode: binder.associatedSetCode,
    associatedSetName: binder.associatedSetName,
    cards: Array.from(grouped.values()),
    createdAt: binder.createdAt,
    updatedAt: binder.updatedAt
  };
}

function findLegacyCardByCopyId(binder: ReturnType<typeof toLegacyBinder>, copyId: string) {
  return binder.cards.find((card) => card.copies.some((copy: { id: string }) => copy.id === copyId)) ?? null;
}

async function resolveActualBinderId(ctx: any, identity: BridgeIdentity, binderId: string) {
  if (binderId !== LIBRARY_COLLECTION_ID) {
    return binderId;
  }
  return await ctx.runQuery(internal.bridge.libraryBinderId, {
    subject: identity.subject
  });
}

function validateCollectionImportTargets(
  preview: CollectionImportPreview,
  binders: NativeBinderDetail[],
  defaultBinderId: string | undefined,
  createMissingBinders: boolean
) {
  const issues = [...preview.issues];
  const binderIds = new Set(binders.map((binder) => binder.id));
  const binderNames = new Set(
    binders.map((binder) => binder.name.trim().toLocaleLowerCase())
  );
  if (defaultBinderId && defaultBinderId !== LIBRARY_COLLECTION_ID && !binderIds.has(defaultBinderId)) {
    issues.push({
      row: 1,
      field: "defaultBinderId",
      message: "default binder was not found"
    });
  }
  if (!createMissingBinders) {
    for (const row of preview.rows) {
      const name = row.binderName?.trim();
      if (
        name &&
        name.toLocaleLowerCase() !== "unsorted" &&
        !binderNames.has(name.toLocaleLowerCase())
      ) {
        issues.push({
          row: row.row,
          field: "binder_name",
          message: `binder "${name}" does not exist`
        });
      }
    }
  }
  return {
    ...preview,
    valid: issues.length === 0 && preview.rows.length > 0,
    issues
  };
}

type HttpBulkAddIssue = {
  rowId?: string;
  field?: string;
  message: string;
};

function previewBulkAddBody(body: any, binders: NativeBinderDetail[]) {
  const defaults =
    body.defaults && typeof body.defaults === "object" ? body.defaults : {};
  const sourceRows = Array.isArray(body.rows) ? body.rows : [];
  const binderByLegacyId = new Map(
    binders.map((binder) => [toLegacyBinderId(binder), binder])
  );
  const issues: HttpBulkAddIssue[] = [];
  const seenRowIds = new Set<string>();
  let totalCopies = 0;

  if (sourceRows.length < 1 || sourceRows.length > 200) {
    issues.push({ message: "Bulk Add requires between 1 and 200 staged rows" });
  }

  const rows = sourceRows.slice(0, 200).map((source: any, index: number) => {
    const rowId =
      typeof source?.rowId === "string" && source.rowId.trim()
        ? source.rowId.trim()
        : `row-${index + 1}`;
    if (seenRowIds.has(rowId)) {
      issues.push({ rowId, field: "rowId", message: "Row IDs must be unique" });
    }
    seenRowIds.add(rowId);

    const binderId =
      typeof source?.binderId === "string"
        ? source.binderId
        : typeof defaults.binderId === "string"
          ? defaults.binderId
          : "";
    const binder = binderByLegacyId.get(binderId);
    if (!binder) {
      issues.push({
        rowId,
        field: "binderId",
        message: "Destination binder was not found"
      });
    }

    const quantity =
      typeof source?.quantity === "number"
        ? source.quantity
        : typeof defaults.quantity === "number"
          ? defaults.quantity
          : 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      issues.push({
        rowId,
        field: "quantity",
        message: "Quantity must be a whole number between 1 and 100"
      });
    } else {
      totalCopies += quantity;
    }

    const card = source?.cardData;
    const tcg = card?.tcg;
    if (
      !card ||
      typeof card.name !== "string" ||
      !card.name.trim() ||
      typeof card.externalId !== "string" ||
      !card.externalId.trim() ||
      !isTcgCode(tcg)
    ) {
      issues.push({
        rowId,
        field: "cardData",
        message: "An exact card printing snapshot is required"
      });
    }
    if (typeof source?.cardId !== "string" || !source.cardId.trim()) {
      issues.push({ rowId, field: "cardId", message: "Card ID is required" });
    }

    const effective = { ...defaults, ...(source?.overrides ?? {}) };
    if (effective.serialNumber && quantity !== 1) {
      issues.push({
        rowId,
        field: "quantity",
        message: "Serialized copies must be staged as individual rows"
      });
    }
    for (const field of ["price", "acquisitionPrice"] as const) {
      const value = effective[field];
      if (
        value !== undefined &&
        (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      ) {
        issues.push({
          rowId,
          field,
          message: "Price must be a finite, non-negative number"
        });
      }
    }
    if (
      effective.acquiredAt !== undefined &&
      (typeof effective.acquiredAt !== "string" ||
        Number.isNaN(Date.parse(effective.acquiredAt)))
    ) {
      issues.push({
        rowId,
        field: "acquiredAt",
        message: "Acquired date must be an ISO date or timestamp"
      });
    }

    return {
      rowId,
      valid: true,
      cardId: typeof source?.cardId === "string" ? source.cardId : "",
      name: typeof card?.name === "string" ? card.name : "Unknown card",
      tcg: isTcgCode(tcg) ? tcg : "yugioh",
      setCode: typeof card?.setCode === "string" ? card.setCode : undefined,
      rarity: typeof card?.rarity === "string" ? card.rarity : undefined,
      binderId,
      binderName: binder?.name,
      quantity,
      condition:
        typeof effective.condition === "string" ? effective.condition : undefined,
      language:
        typeof effective.language === "string" ? effective.language : undefined,
      finishCode:
        typeof effective.finishCode === "string" ? effective.finishCode : undefined,
      edition: typeof effective.edition === "string" ? effective.edition : undefined
    };
  });

  if (totalCopies > 500) {
    issues.push({
      field: "rows",
      message: "Bulk Add is limited to 500 physical copies per transaction"
    });
  }

  for (const row of rows) {
    row.valid = !issues.some((issue) => issue.rowId === row.rowId);
  }

  return {
    valid: issues.length === 0,
    rows,
    issues,
    totalRows: sourceRows.length,
    totalCopies
  };
}

function buildBulkAddMutationArgs(body: any, binders: NativeBinderDetail[]) {
  const binderByLegacyId = new Map(
    binders.map((binder) => [toLegacyBinderId(binder), binder.id])
  );
  const defaults =
    body.defaults && typeof body.defaults === "object" ? body.defaults : {};
  return {
    defaults: {
      ...pickBulkCopyFields(defaults),
      binderId:
        typeof defaults.binderId === "string"
          ? (binderByLegacyId.get(defaults.binderId) as any)
          : undefined,
      quantity:
        typeof defaults.quantity === "number" ? defaults.quantity : undefined
    },
    rows: body.rows.map((row: any) => ({
      rowId: row.rowId,
      binderId:
        typeof row.binderId === "string"
          ? (binderByLegacyId.get(row.binderId) as any)
          : undefined,
      quantity: typeof row.quantity === "number" ? row.quantity : undefined,
      card: row.cardData,
      overrides:
        row.overrides && typeof row.overrides === "object"
          ? pickBulkCopyFields(row.overrides)
          : undefined
    }))
  };
}

function pickBulkCopyFields(source: any) {
  const result: Record<string, unknown> = {};
  for (const field of [
    "condition",
    "language",
    "notes",
    "serialNumber",
    "acquiredAt",
    "finishCode",
    "finishLabel",
    "edition",
    "stamp",
    "gradingCompany",
    "gradingScore",
    "certNumber",
    "storageLocation"
  ]) {
    if (typeof source?.[field] === "string") {
      result[field] = source[field];
    }
  }
  for (const field of ["price", "acquisitionPrice"]) {
    if (typeof source?.[field] === "number") {
      result[field] = source[field];
    }
  }
  for (const field of [
    "isFoil",
    "isSealedPromo",
    "isOversized",
    "isPeelOff",
    "isSigned",
    "isAltered"
  ]) {
    if (typeof source?.[field] === "boolean") {
      result[field] = source[field];
    }
  }
  if (Array.isArray(source?.tags)) {
    result.tagIds = source.tags.map((tagId: unknown) => String(tagId)) as any;
  }
  if (Array.isArray(source?.newTags)) {
    result.newTags = source.newTags
      .filter((tag: any) => tag && typeof tag.label === "string")
      .map((tag: any) => ({
        label: tag.label,
        colorHex: typeof tag.colorHex === "string" ? tag.colorHex : undefined
      }));
  }
  return result;
}

function asCollectionEntryId(value: string) {
  return value as any;
}

function asBinderId(value: string) {
  return value as any;
}

function asCollectionMutationAuditId(value: string) {
  return value as any;
}

function asWishlistId(value: string) {
  return value as any;
}

function asWishlistCardId(value: string) {
  return value as any;
}

function asWishlistRuleId(value: string) {
  return value as any;
}

function toExportRows(binders: NativeBinderDetail[]) {
  return binders.flatMap((binder) =>
    binder.entries.flatMap((entry) =>
      expandLegacyCopies(entry).map(() => ({
        binderName: binder.name,
        cardName: entry.card.name,
        tcg: entry.card.tcg,
        setCode: entry.card.setCode ?? null,
        setName: entry.card.setName ?? null,
        rarity: entry.card.rarity ?? null,
        baseExternalId: entry.card.baseExternalId ?? null,
        printingKey: entry.card.printingKey ?? null,
        artworkId: entry.card.artworkId ?? null,
        collectorNumber: entry.card.collectorNumber ?? null,
        releasedAt: entry.card.releasedAt ?? null,
        regulationMark: entry.card.regulationMark ?? null,
        cardLanguage: entry.card.language ?? null,
        supertype: entry.card.supertype ?? null,
        region: entry.card.region ?? null,
        setSymbolUrl: entry.card.setSymbolUrl ?? null,
        setLogoUrl: entry.card.setLogoUrl ?? null,
        provenance: entry.card.provenance ?? null,
        legalityPeriods: entry.card.legalityPeriods ?? null,
        evolution: entry.card.evolution ?? null,
        functionalIdentity: entry.card.functionalIdentity ?? null,
        externalId: entry.card.externalId,
        condition: entry.condition ?? null,
        language: entry.language ?? null,
        notes: entry.notes ?? null,
        price: entry.price ?? null,
        acquisitionPrice: entry.acquisitionPrice ?? null,
        serialNumber: entry.serialNumber ?? null,
        isFoil: Boolean(entry.isFoil),
        finishCode: entry.finishCode ?? null,
        finishLabel: entry.finishLabel ?? null,
        edition: entry.edition ?? null,
        stamp: entry.stamp ?? null,
        isSealedPromo: Boolean(entry.isSealedPromo),
        isOversized: Boolean(entry.isOversized),
        isPeelOff: Boolean(entry.isPeelOff),
        isSigned: Boolean(entry.isSigned),
        isAltered: Boolean(entry.isAltered),
        gradingCompany: entry.gradingCompany ?? null,
        gradingScore: entry.gradingScore ?? null,
        certNumber: entry.certNumber ?? null,
        storageLocation: entry.storageLocation ?? null,
        tags: entry.tags.map((tag) => tag.label),
        acquiredAt: entry.acquiredAt ?? null,
        createdAt: entry.createdAt
      }))
    )
  );
}

function escapeCsvField(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function toCsv(rows: ReturnType<typeof toExportRows>) {
  const headers = [
    "Binder",
    "Card Name",
    "TCG",
    "Set Code",
    "Set Name",
    "Rarity",
    "Base External ID",
    "Printing Key",
    "Artwork ID",
    "Collector Number",
    "Released At",
    "Regulation Mark",
    "Card Language",
    "Supertype",
    "Region",
    "External ID",
    "Condition",
    "Language",
    "Notes",
    "Price",
    "Acquisition Price",
    "Serial Number",
    "Foil",
    "Finish Code",
    "Finish Label",
    "Edition",
    "Stamp",
    "Sealed Promo",
    "Oversized",
    "Peel-Off",
    "Signed",
    "Altered",
    "Grading Company",
    "Grading Score",
    "Certification Number",
    "Storage Location",
    "Tags",
    "Acquired At",
    "Created At"
  ];

  const records = rows.map((row) =>
    [
      escapeCsvField(row.binderName),
      escapeCsvField(row.cardName),
      escapeCsvField(row.tcg),
      escapeCsvField(row.setCode),
      escapeCsvField(row.setName),
      escapeCsvField(row.rarity),
      escapeCsvField(row.baseExternalId),
      escapeCsvField(row.printingKey),
      escapeCsvField(row.artworkId),
      escapeCsvField(row.collectorNumber),
      escapeCsvField(row.releasedAt),
      escapeCsvField(row.regulationMark),
      escapeCsvField(row.cardLanguage),
      escapeCsvField(row.supertype),
      escapeCsvField(row.region),
      escapeCsvField(row.externalId),
      escapeCsvField(row.condition),
      escapeCsvField(row.language),
      escapeCsvField(row.notes),
      escapeCsvField(row.price),
      escapeCsvField(row.acquisitionPrice),
      escapeCsvField(row.serialNumber),
      row.isFoil ? "Yes" : "No",
      escapeCsvField(row.finishCode),
      escapeCsvField(row.finishLabel),
      escapeCsvField(row.edition),
      escapeCsvField(row.stamp),
      row.isSealedPromo ? "Yes" : "No",
      row.isOversized ? "Yes" : "No",
      row.isPeelOff ? "Yes" : "No",
      row.isSigned ? "Yes" : "No",
      row.isAltered ? "Yes" : "No",
      escapeCsvField(row.gradingCompany),
      escapeCsvField(row.gradingScore),
      escapeCsvField(row.certNumber),
      escapeCsvField(row.storageLocation),
      escapeCsvField(row.tags.join("; ")),
      escapeCsvField(row.acquiredAt),
      escapeCsvField(row.createdAt)
    ].join(",")
  );

  return [headers.join(","), ...records].join("\n");
}

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () =>
    Response.json({
      status: "ok",
      backend: "convex-native",
      capabilities: ["auth", "users", "settings", "binders", "collections", "tags", "wishlists"]
    })
  )
});

http.route({
  path: "/setup/setup-required",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      requireBridgeKey(request);
      const setupRequired = await ctx.runQuery(internal.bridge.getSetupRequired, {});
      return json({ setupRequired });
    } catch (error) {
      return handleConvexError(error, "Failed to determine setup status");
    }
  })
});

http.route({
  path: "/setup/setup",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const setupRequired = await ctx.runQuery(internal.bridge.getSetupRequired, {});
      if (!setupRequired) {
        return errorJson(409, "CONFLICT", "Admin user already exists");
      }

      await ctx.runMutation(internal.bridge.promoteViewerToAdmin, identity);
      return json({ message: "Admin account configured successfully" });
    } catch (error) {
      return handleConvexError(error, "Failed to complete setup");
    }
  })
});

http.route({
  path: "/users/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const profile = await ctx.runQuery(internal.bridge.getViewerProfile, {
        subject: identity.subject
      });
      return json(profile);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch user profile");
    }
  })
});

http.route({
  path: "/users/me",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const profile = await ctx.runMutation(internal.bridge.updateViewerProfile, {
        subject: identity.subject,
        email: typeof body.email === "string" ? body.email : undefined,
        username: typeof body.username === "string" ? body.username : undefined
      });
      return json(profile);
    } catch (error) {
      return handleConvexError(error, "Failed to update user profile");
    }
  })
});

http.route({
  path: "/users/me/preferences",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const preferences = await ctx.runQuery(internal.bridge.getViewerPreferences, {
        subject: identity.subject
      });
      return json(preferences);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch user preferences");
    }
  })
});

http.route({
  path: "/users/me/preferences",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      if (
        Object.prototype.hasOwnProperty.call(body, "defaultGame") &&
        body.defaultGame !== null &&
        !isTcgCode(body.defaultGame)
      ) {
        return errorJson(
          400,
          "VALIDATION_ERROR",
          `defaultGame must be one of: ${TCG_CODES.join(", ")}, or null`
        );
      }
      if (Object.prototype.hasOwnProperty.call(body, "focusedSetOrder")) {
        const order = body.focusedSetOrder;
        if (
          !Array.isArray(order) ||
          order.length > 100 ||
          order.some(
            (value) => typeof value !== "string" || value.length < 1 || value.length > 200
          ) ||
          new Set(order).size !== order.length
        ) {
          return errorJson(
            400,
            "VALIDATION_ERROR",
            "focusedSetOrder must contain up to 100 unique set identifiers"
          );
        }
      }
      if (
        Object.prototype.hasOwnProperty.call(body, "setCompletionMode") &&
        body.setCompletionMode !== "standard" &&
        body.setCompletionMode !== "master"
      ) {
        return errorJson(
          400,
          "VALIDATION_ERROR",
          "setCompletionMode must be standard or master"
        );
      }
      const preferences = await ctx.runMutation(internal.bridge.updateViewerPreferences, {
        subject: identity.subject,
        showCardNumbers:
          typeof body.showCardNumbers === "boolean" ? body.showCardNumbers : undefined,
        showPricing: typeof body.showPricing === "boolean" ? body.showPricing : undefined,
        enabledYugioh: typeof body.enabledYugioh === "boolean" ? body.enabledYugioh : undefined,
        enabledMagic: typeof body.enabledMagic === "boolean" ? body.enabledMagic : undefined,
        enabledPokemon:
          typeof body.enabledPokemon === "boolean" ? body.enabledPokemon : undefined,
        enabledOnepiece:
          typeof body.enabledOnepiece === "boolean" ? body.enabledOnepiece : undefined,
        enabledLorcana:
          typeof body.enabledLorcana === "boolean" ? body.enabledLorcana : undefined,
        enabledDragonball:
          typeof body.enabledDragonball === "boolean" ? body.enabledDragonball : undefined,
        defaultGame:
          body.defaultGame === null || isTcgCode(body.defaultGame) ? body.defaultGame : undefined,
        focusedSetOrder: Array.isArray(body.focusedSetOrder)
          ? (body.focusedSetOrder as string[])
          : undefined,
        setCompletionMode:
          body.setCompletionMode === "standard" || body.setCompletionMode === "master"
            ? body.setCompletionMode
            : undefined
      });
      return json(preferences);
    } catch (error) {
      return handleConvexError(error, "Failed to update user preferences");
    }
  })
});

http.route({
  path: "/settings",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      requireBridgeKey(request);
      const identity = getBridgeIdentity(request);
      if (identity) {
        await ctx.runMutation(internal.bridge.ensureViewer, identity);
      }
      const settings = await ctx.runQuery(internal.bridge.getSettings, {
        subject: identity?.subject
      });
      return json(settings);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch settings");
    }
  })
});

http.route({
  path: "/settings",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      await requireBridgeAdmin(ctx, identity);
      const body = await parseJsonBody(request);
      const settings = await ctx.runMutation(internal.bridge.updateSettings, {
        subject: identity.subject,
        data: {
          publicDashboard:
            typeof body.publicDashboard === "boolean" ? body.publicDashboard : undefined,
          publicCollections:
            typeof body.publicCollections === "boolean" ? body.publicCollections : undefined,
          requireAuth: typeof body.requireAuth === "boolean" ? body.requireAuth : undefined,
          appName: typeof body.appName === "string" ? body.appName : undefined,
          scrydexApiKey:
            typeof body.scrydexApiKey === "string" || body.scrydexApiKey === null
              ? body.scrydexApiKey
              : undefined,
          scrydexTeamId:
            typeof body.scrydexTeamId === "string" || body.scrydexTeamId === null
              ? body.scrydexTeamId
              : undefined,
          scryfallApiBaseUrl:
            typeof body.scryfallApiBaseUrl === "string" || body.scryfallApiBaseUrl === null
              ? body.scryfallApiBaseUrl
              : undefined,
          ygoApiBaseUrl:
            typeof body.ygoApiBaseUrl === "string" || body.ygoApiBaseUrl === null
              ? body.ygoApiBaseUrl
              : undefined,
          scrydexApiBaseUrl:
            typeof body.scrydexApiBaseUrl === "string" || body.scrydexApiBaseUrl === null
              ? body.scrydexApiBaseUrl
              : undefined,
          tcgdexApiBaseUrl:
            typeof body.tcgdexApiBaseUrl === "string" || body.tcgdexApiBaseUrl === null
              ? body.tcgdexApiBaseUrl
              : undefined
        }
      });
      return json(settings);
    } catch (error) {
      return handleConvexError(error, "Failed to update settings");
    }
  })
});

http.route({
  path: "/settings/source-defaults",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      await requireBridgeAdmin(ctx, identity);
      return json({
        scryfall: { url: process.env.SCRYFALL_API_BASE_URL, label: "Scryfall (Magic)" },
        yugioh: { url: process.env.YGO_API_BASE_URL, label: "YGOPRODeck (Yu-Gi-Oh)" },
        pokemon: { url: process.env.POKEMON_API_BASE_URL, label: "Scrydex (Pokémon)" },
        tcgdex: { url: process.env.TCGDEX_API_BASE_URL, label: "TCGdex (Pokémon Variants)" },
        justtcg: {
          url: process.env.JUSTTCG_API_BASE_URL ?? "https://api.justtcg.com/v1",
          label: "JustTCG (Primary Pricing)",
          configured: Boolean(process.env.JUSTTCG_API_KEY)
        }
      });
    } catch (error) {
      return handleConvexError(error, "Failed to fetch source defaults");
    }
  })
});

http.route({
  path: "/settings/test-source",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      await requireBridgeAdmin(ctx, identity);
      const body = await parseJsonBody(request);
      const source = typeof body.source === "string" ? body.source : "";
      if (!["scryfall", "yugioh", "pokemon", "tcgdex", "justtcg"].includes(source)) {
        return errorJson(400, "BAD_REQUEST", "Unsupported source");
      }

      if (source === "justtcg" && !process.env.JUSTTCG_API_KEY) {
        return json({
          ok: false,
          latencyMs: 0,
          error: "JUSTTCG_API_KEY is not configured on the server"
        });
      }

      const settings = await ctx.runQuery(internal.bridge.getSettings, {
        subject: identity.subject
      });
      const adminSettings = settings as Record<string, string | boolean | number | null>;

      const baseUrls: Record<string, string> = {
        scryfall:
          typeof adminSettings.scryfallApiBaseUrl === "string"
            ? adminSettings.scryfallApiBaseUrl
            : (process.env.SCRYFALL_API_BASE_URL ?? "https://api.scryfall.com"),
        yugioh:
          typeof adminSettings.ygoApiBaseUrl === "string"
            ? adminSettings.ygoApiBaseUrl
            : (process.env.YGO_API_BASE_URL ?? "https://db.ygoprodeck.com/api/v7"),
        pokemon:
          typeof adminSettings.scrydexApiBaseUrl === "string"
            ? adminSettings.scrydexApiBaseUrl
            : (process.env.POKEMON_API_BASE_URL ?? "https://api.scrydex.com"),
        tcgdex:
          typeof adminSettings.tcgdexApiBaseUrl === "string"
            ? adminSettings.tcgdexApiBaseUrl
            : (process.env.TCGDEX_API_BASE_URL ?? "https://api.tcgdex.net/v2/en"),
        justtcg: process.env.JUSTTCG_API_BASE_URL ?? "https://api.justtcg.com/v1"
      };

      const base = baseUrls[source].replace(/\/+$/, "");
      const isLocal = /localhost|:\d{4}|scryfall-bulk|ygo-cache|tcgdex-cache|pokemon-cache/i.test(
        base
      );

      let url: string;
      if (isLocal) {
        url = `${base}/health`;
      } else {
        switch (source) {
          case "scryfall":
            url = `${base}/cards/named?exact=Lightning+Bolt`;
            break;
          case "yugioh":
            url = `${base}/cardinfo.php?fname=Dark+Magician&num=1`;
            break;
          case "pokemon":
            url = base.includes("scrydex")
              ? `${base}/pokemon/v1/cards?q=name:pikachu&pageSize=1`
              : `${base}/cards?q=name:pikachu&pageSize=1`;
            break;
          case "justtcg":
            url = `${base}/games`;
            break;
          default:
            url = `${base}/cards?q=pikachu&pageSize=1`;
            break;
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers:
            source === "justtcg"
              ? { "x-api-key": process.env.JUSTTCG_API_KEY as string }
              : undefined
        });
        const latencyMs = Date.now() - start;
        return json(
          response.ok
            ? { ok: true, latencyMs }
            : { ok: false, latencyMs, error: `HTTP ${response.status}` }
        );
      } catch (error) {
        const latencyMs = Date.now() - start;
        const raw = error instanceof Error ? error.message : "Unknown error";
        const message =
          raw === "fetch failed" || raw.includes("ENOTFOUND") || raw.includes("ECONNREFUSED")
            ? `Service unreachable (${new URL(url).hostname})`
            : raw.includes("abort")
              ? "Timeout (5s)"
              : raw;
        return json({ ok: false, latencyMs, error: message });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return handleConvexError(error, "Failed to test source");
    }
  })
});

http.route({
  path: "/wishlists",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const wishlists = (await ctx.runQuery(internal.bridge.listWishlists, {
        subject: identity.subject
      })) as NativeWishlist[];
      return json(wishlists);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch wishlists");
    }
  })
});

http.route({
  path: "/wishlists",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const wishlist = (await ctx.runMutation(internal.bridge.createWishlist, {
        subject: identity.subject,
        name: typeof body.name === "string" ? body.name : "",
        description: typeof body.description === "string" ? body.description : undefined,
        colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined,
        matchAnyPrinting:
          typeof body.matchAnyPrinting === "boolean" ? body.matchAnyPrinting : undefined
      })) as NativeWishlist;
      return json(wishlist, 201);
    } catch (error) {
      return handleConvexError(error, "Failed to create wishlist");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);

      if (segments.length !== 1) {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }

      const wishlist = (await ctx.runQuery(internal.bridge.getWishlist, {
        subject: identity.subject,
        wishlistId: asWishlistId(segments[0])
      })) as NativeWishlist;
      return json(wishlist);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch wishlist");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);
      const body = await parseJsonBody(request);

      if (segments.length === 2 && segments[1] === "cards") {
        const card = await ctx.runMutation(internal.bridge.addWishlistCard, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          card: body
        });
        return json(card, 201);
      }

      if (segments.length === 3 && segments[1] === "cards" && segments[2] === "batch") {
        const wishlist = await ctx.runMutation(internal.bridge.addWishlistCards, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          cards: Array.isArray(body.cards) ? body.cards : []
        });
        return json(wishlist, 201);
      }

      if (segments.length === 2 && segments[1] === "rules") {
        if (body.type !== "name" && body.type !== "set" && body.type !== "artist") {
          return errorJson(400, "BAD_REQUEST", "type must be 'name', 'set', or 'artist'");
        }
        const rule = await ctx.runMutation(internal.bridge.addWishlistRule, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          type: body.type,
          tcg: typeof body.tcg === "string" ? (body.tcg as TcgCode) : undefined,
          query: typeof body.query === "string" ? body.query : undefined,
          setCode: typeof body.setCode === "string" ? body.setCode : undefined,
          setName: typeof body.setName === "string" ? body.setName : undefined,
          includeAllPrintings:
            typeof body.includeAllPrintings === "boolean" ? body.includeAllPrintings : true,
          autoSync: typeof body.autoSync === "boolean" ? body.autoSync : true
        });
        return json(rule, 201);
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to create wishlist resource");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);
      const body = await parseJsonBody(request);

      if (segments.length === 3 && segments[1] === "rules") {
        const rule = await ctx.runMutation(internal.bridge.updateWishlistRule, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          ruleId: asWishlistRuleId(segments[2]),
          autoSync: typeof body.autoSync === "boolean" ? body.autoSync : undefined,
          includeAllPrintings:
            typeof body.includeAllPrintings === "boolean" ? body.includeAllPrintings : undefined,
          lastSyncedAt: typeof body.lastSyncedAt === "string" ? body.lastSyncedAt : undefined,
          lastMatchCount:
            typeof body.lastMatchCount === "number" ? body.lastMatchCount : undefined
        });
        return json(rule);
      }

      if (segments.length !== 1) {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }

      const wishlist = await ctx.runMutation(internal.bridge.updateWishlist, {
        subject: identity.subject,
        wishlistId: asWishlistId(segments[0]),
        name: typeof body.name === "string" ? body.name : undefined,
        description:
          typeof body.description === "string" || body.description === null
            ? body.description
            : undefined,
        colorHex:
          typeof body.colorHex === "string" || body.colorHex === null ? body.colorHex : undefined,
        matchAnyPrinting:
          typeof body.matchAnyPrinting === "boolean" ? body.matchAnyPrinting : undefined
      });
      return json(wishlist);
    } catch (error) {
      return handleConvexError(error, "Failed to update wishlist");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);

      if (segments.length === 1) {
        await ctx.runMutation(internal.bridge.deleteWishlist, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0])
        });
        return noContent();
      }

      if (segments.length === 3 && segments[1] === "cards") {
        await ctx.runMutation(internal.bridge.removeWishlistCard, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          cardId: asWishlistCardId(segments[2])
        });
        return noContent();
      }

      if (segments.length === 3 && segments[1] === "rules") {
        await ctx.runMutation(internal.bridge.removeWishlistRule, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          ruleId: asWishlistRuleId(segments[2])
        });
        return noContent();
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to delete wishlist resource");
    }
  })
});

http.route({
  path: "/guides",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const guides = await ctx.runQuery(internal.guides.listPublished, {
        subject: identity.subject
      });
      return json(guides);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch collection guides");
    }
  })
});

http.route({
  path: "/guides/owned-card-keys",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const keys = await ctx.runQuery(internal.guides.listOwnedCardKeys, {
        subject: identity.subject
      });
      return json(keys);
    } catch (error) {
      return handleConvexError(error, "Failed to resolve guide ownership");
    }
  })
});

http.route({
  pathPrefix: "/guides/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const segments = new URL(request.url).pathname
        .replace(/^\/guides\//, "")
        .split("/")
        .filter(Boolean);
      if (segments.length === 2 && segments[1] === "items") {
        const items = await ctx.runQuery(internal.guides.listPublishedItems, {
          subject: identity.subject,
          slug: decodeURIComponent(segments[0]!)
        });
        return json(items);
      }
      if (segments.length !== 1) {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }
      const guide = await ctx.runQuery(internal.guides.getPublishedBySlug, {
        subject: identity.subject,
        slug: decodeURIComponent(segments[0]!)
      });
      return json(guide);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch collection guide");
    }
  })
});

http.route({
  pathPrefix: "/guides/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const segments = new URL(request.url).pathname
        .replace(/^\/guides\//, "")
        .split("/")
        .filter(Boolean);
      if (segments.length !== 2 || segments[1] !== "follow") {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }
      const body = await parseJsonBody(request);
      const result = await ctx.runMutation(internal.guides.follow, {
        subject: identity.subject,
        slug: decodeURIComponent(segments[0]!),
        wishlistName: typeof body.wishlistName === "string" ? body.wishlistName : undefined
      });
      return json(result, result.created ? 201 : 200);
    } catch (error) {
      return handleConvexError(error, "Failed to follow collection guide");
    }
  })
});

http.route({
  path: "/collections",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      return json(binders.map((binder) => toLegacyBinder(binder)));
    } catch (error) {
      return handleConvexError(error, "Failed to fetch collections");
    }
  })
});

http.route({
  path: "/collections/history",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const requested = Number(new URL(request.url).searchParams.get("limit") ?? 50);
      const limit = Number.isInteger(requested)
        ? Math.min(100, Math.max(1, requested))
        : 50;
      const entries = await ctx.runQuery(
        internal.bridge.listCollectionMutationHistory,
        {
          subject: identity.subject,
          limit
        }
      );
      return json({ entries });
    } catch (error) {
      return handleConvexError(error, "Failed to fetch collection history");
    }
  })
});

http.route({
  path: "/collections",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const binder = (await ctx.runMutation(internal.bridge.createBinder, {
        subject: identity.subject,
        name: typeof body.name === "string" ? body.name : "",
        description: typeof body.description === "string" ? body.description : undefined,
        colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined,
        defaultCondition:
          typeof body.defaultCondition === "string" ? body.defaultCondition : undefined,
        containerType:
          typeof body.containerType === "string" ? body.containerType : undefined,
        imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
        associatedTcg:
          body.associatedTcg === "magic" ||
          body.associatedTcg === "pokemon" ||
          body.associatedTcg === "yugioh"
            ? body.associatedTcg
            : undefined,
        associatedSetCode:
          typeof body.associatedSetCode === "string" ? body.associatedSetCode : undefined,
        associatedSetName:
          typeof body.associatedSetName === "string" ? body.associatedSetName : undefined
      })) as NativeBinderDetail;
      return json(toLegacyBinder(binder), 201);
    } catch (error) {
      return handleConvexError(error, "Failed to create binder");
    }
  })
});

http.route({
  path: "/collections/import/template",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      await requireBridgeIdentity(ctx, request);
      return textResponse(collectionImportTemplate(), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tcger-collection-import.csv"'
      });
    } catch (error) {
      return handleConvexError(error, "Failed to download import template");
    }
  })
});

http.route({
  path: "/collections/import/preview",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const options =
        body.options && typeof body.options === "object" ? body.options : {};
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      const preview = validateCollectionImportTargets(
        previewCollectionImport(typeof body.csv === "string" ? body.csv : ""),
        binders,
        typeof options.defaultBinderId === "string" ? options.defaultBinderId : undefined,
        options.createMissingBinders === true
      );
      return json(preview, preview.valid ? 200 : 422);
    } catch (error) {
      return handleConvexError(error, "Failed to preview collection import");
    }
  })
});

http.route({
  path: "/collections/import/commit",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const options =
        body.options && typeof body.options === "object" ? body.options : {};
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      const defaultBinderId =
        typeof options.defaultBinderId === "string"
          ? options.defaultBinderId
          : undefined;
      const preview = validateCollectionImportTargets(
        previewCollectionImport(typeof body.csv === "string" ? body.csv : ""),
        binders,
        defaultBinderId,
        options.createMissingBinders === true
      );
      if (!preview.valid) {
        return json(
          {
            ...preview,
            importedRows: 0,
            importedCopies: 0,
            createdBinders: []
          },
          422
        );
      }
      const result = await ctx.runMutation(internal.bridge.importCollectionRows, {
        subject: identity.subject,
        rows: preview.rows,
        defaultBinderId: defaultBinderId
          ? await resolveActualBinderId(ctx, identity, defaultBinderId)
          : undefined,
        createMissingBinders: options.createMissingBinders === true
      });
      return json({ ...preview, ...result, valid: true }, 201);
    } catch (error) {
      return handleConvexError(error, "Failed to import collection");
    }
  })
});

http.route({
  path: "/collections/bulk/preview",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      const preview = previewBulkAddBody(body, binders);
      return json(preview, preview.valid ? 200 : 422);
    } catch (error) {
      return handleConvexError(error, "Failed to preview Bulk Add");
    }
  })
});

http.route({
  path: "/collections/bulk",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      const preview = previewBulkAddBody(body, binders);
      if (!preview.valid) {
        return json(
          {
            error: "VALIDATION_FAILED",
            message: preview.issues[0]?.message ?? "Bulk Add failed validation",
            issues: preview.issues
          },
          422
        );
      }
      const mutationArgs = buildBulkAddMutationArgs(body, binders);
      const result = await ctx.runMutation(internal.bridge.bulkAddToCollection, {
        subject: identity.subject,
        ...mutationArgs
      });
      return json(result, 201);
    } catch (error) {
      return handleConvexError(error, "Failed to commit Bulk Add");
    }
  })
});

http.route({
  path: "/collections/export",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const format = new URL(request.url).searchParams.get("format") ?? "json";
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      const rows = toExportRows(binders);

      if (format === "csv") {
        return textResponse(toCsv(rows), 200, {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="collection-export.csv"'
        });
      }

      return json(rows, 200, {
        "Content-Disposition": 'attachment; filename="collection-export.json"'
      });
    } catch (error) {
      return handleConvexError(error, "Failed to export collection");
    }
  })
});

http.route({
  path: "/collections/tags",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const tags = (await ctx.runQuery(internal.bridge.listTags, {
        subject: identity.subject
      })) as NativeTag[];
      return json(tags);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch tags");
    }
  })
});

http.route({
  path: "/collections/tags",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const tag = await ctx.runMutation(internal.bridge.createTag, {
        subject: identity.subject,
        label: typeof body.label === "string" ? body.label : "",
        colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined
      });
      return json(tag, 201);
    } catch (error) {
      return handleConvexError(error, "Failed to create tag");
    }
  })
});

http.route({
  path: "/collections/cards",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const libraryBinderId = await ctx.runQuery(internal.bridge.libraryBinderId, {
        subject: identity.subject
      });
      const entry = await ctx.runMutation(internal.bridge.addCardToBinder, {
        subject: identity.subject,
        binderId: libraryBinderId,
        cardId: typeof body.cardId === "string" ? body.cardId : undefined,
        quantity: typeof body.quantity === "number" ? body.quantity : undefined,
        condition: typeof body.condition === "string" ? body.condition : undefined,
        language: typeof body.language === "string" ? body.language : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        price: typeof body.price === "number" ? body.price : undefined,
        acquisitionPrice:
          typeof body.acquisitionPrice === "number" ? body.acquisitionPrice : undefined,
        serialNumber: typeof body.serialNumber === "string" ? body.serialNumber : undefined,
        acquiredAt: typeof body.acquiredAt === "string" ? body.acquiredAt : undefined,
        isFoil: typeof body.isFoil === "boolean" ? body.isFoil : undefined,
        finishCode: typeof body.finishCode === "string" ? body.finishCode : undefined,
        finishLabel: typeof body.finishLabel === "string" ? body.finishLabel : undefined,
        edition: typeof body.edition === "string" ? body.edition : undefined,
        stamp: typeof body.stamp === "string" ? body.stamp : undefined,
        isSealedPromo:
          typeof body.isSealedPromo === "boolean" ? body.isSealedPromo : undefined,
        isOversized: typeof body.isOversized === "boolean" ? body.isOversized : undefined,
        isPeelOff: typeof body.isPeelOff === "boolean" ? body.isPeelOff : undefined,
        isSigned: typeof body.isSigned === "boolean" ? body.isSigned : undefined,
        isAltered: typeof body.isAltered === "boolean" ? body.isAltered : undefined,
        gradingCompany:
          typeof body.gradingCompany === "string" ? body.gradingCompany : undefined,
        gradingScore: typeof body.gradingScore === "string" ? body.gradingScore : undefined,
        certNumber: typeof body.certNumber === "string" ? body.certNumber : undefined,
        storageLocation:
          typeof body.storageLocation === "string" ? body.storageLocation : undefined,
        tagIds: Array.isArray(body.tags) ? body.tags : undefined,
        newTags: Array.isArray(body.newTags) ? body.newTags : undefined,
        cardData: body.cardData
      });
      const binder = (await ctx.runQuery(internal.bridge.getBinder, {
        subject: identity.subject,
        binderId: libraryBinderId
      })) as NativeBinderDetail;
      const legacyBinder = toLegacyBinder(binder);
      return json(findLegacyCardByCopyId(legacyBinder, entry.id) ?? legacyBinder.cards[0], 201);
    } catch (error) {
      return handleConvexError(error, "Failed to add card");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);
      if (segments.length === 2 && segments[1] === "pages") {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        return json(await ctx.runQuery(internal.bridge.listBinderPages, {
          subject: identity.subject,
          binderId: asBinderId(binderId)
        }));
      }
      if (segments.length !== 1 || segments[0] === "tags" || segments[0] === "export") {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }
      const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
      const binder = (await ctx.runQuery(internal.bridge.getBinder, {
        subject: identity.subject,
        binderId
      })) as NativeBinderDetail;
      return json(toLegacyBinder(binder));
    } catch (error) {
      return handleConvexError(error, "Failed to fetch binder");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);

      if (
        segments.length === 3 &&
        segments[0] === "history" &&
        segments[2] === "undo"
      ) {
        const body = await parseJsonBody(request);
        const idempotencyKey =
          typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
        const audit = await ctx.runMutation(
          internal.bridge.undoCollectionMutation,
          {
            subject: identity.subject,
            auditId: asCollectionMutationAuditId(segments[1]),
            idempotencyKey
          }
        );
        return json({ audit }, 201);
      }

      if (segments.length === 2 && segments[1] === "cards") {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        const body = await parseJsonBody(request);
        const entry = await ctx.runMutation(internal.bridge.addCardToBinder, {
          subject: identity.subject,
          binderId,
          cardId: typeof body.cardId === "string" ? body.cardId : undefined,
          quantity: typeof body.quantity === "number" ? body.quantity : undefined,
          condition: typeof body.condition === "string" ? body.condition : undefined,
          language: typeof body.language === "string" ? body.language : undefined,
          notes: typeof body.notes === "string" ? body.notes : undefined,
          price: typeof body.price === "number" ? body.price : undefined,
          acquisitionPrice:
            typeof body.acquisitionPrice === "number" ? body.acquisitionPrice : undefined,
          serialNumber: typeof body.serialNumber === "string" ? body.serialNumber : undefined,
          acquiredAt: typeof body.acquiredAt === "string" ? body.acquiredAt : undefined,
          isFoil: typeof body.isFoil === "boolean" ? body.isFoil : undefined,
          finishCode: typeof body.finishCode === "string" ? body.finishCode : undefined,
          finishLabel: typeof body.finishLabel === "string" ? body.finishLabel : undefined,
          edition: typeof body.edition === "string" ? body.edition : undefined,
          stamp: typeof body.stamp === "string" ? body.stamp : undefined,
          isSealedPromo:
            typeof body.isSealedPromo === "boolean" ? body.isSealedPromo : undefined,
          isOversized:
            typeof body.isOversized === "boolean" ? body.isOversized : undefined,
          isPeelOff: typeof body.isPeelOff === "boolean" ? body.isPeelOff : undefined,
          isSigned: typeof body.isSigned === "boolean" ? body.isSigned : undefined,
          isAltered: typeof body.isAltered === "boolean" ? body.isAltered : undefined,
          gradingCompany:
            typeof body.gradingCompany === "string" ? body.gradingCompany : undefined,
          gradingScore:
            typeof body.gradingScore === "string" ? body.gradingScore : undefined,
          certNumber: typeof body.certNumber === "string" ? body.certNumber : undefined,
          storageLocation:
            typeof body.storageLocation === "string" ? body.storageLocation : undefined,
          tagIds: Array.isArray(body.tags) ? body.tags : undefined,
          newTags: Array.isArray(body.newTags) ? body.newTags : undefined,
          cardData: body.cardData
        });
        const binder = (await ctx.runQuery(internal.bridge.getBinder, {
          subject: identity.subject,
          binderId
        })) as NativeBinderDetail;
        const legacyBinder = toLegacyBinder(binder);
        return json(findLegacyCardByCopyId(legacyBinder, entry.id) ?? legacyBinder.cards[0], 201);
      }

      if (segments.length === 4 && segments[1] === "pages" && segments[3] === "image") {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        const pageNumber = Number.parseInt(segments[2] ?? "", 10);
        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
          return errorJson(400, "BAD_REQUEST", "Page number must be a positive integer");
        }
        const form = await request.formData();
        const image = form.get("image");
        if (!(image instanceof File)) {
          return errorJson(400, "BAD_REQUEST", "A page image is required");
        }
        const storageId = await ctx.storage.store(image);
        try {
          const result = await ctx.runMutation(internal.bridge.attachBinderPageImage, {
            subject: identity.subject,
            binderId: asBinderId(binderId),
            pageNumber,
            storageId
          });
          if (result.replacedStorageId) {
            await ctx.storage.delete(result.replacedStorageId);
          }
          const pages = await ctx.runQuery(internal.bridge.listBinderPages, {
            subject: identity.subject,
            binderId: asBinderId(binderId)
          });
          return json(pages.find((page) => page.pageNumber === pageNumber), 201);
        } catch (error) {
          await ctx.storage.delete(storageId);
          throw error;
        }
      }

      if (segments.length === 4 && segments[1] === "cards" && segments[3] === "images") {
        const form = await request.formData();
        const files = form.getAll("images").filter((value): value is File => value instanceof File);
        if (!files.length) {
          return errorJson(400, "BAD_REQUEST", "No images provided");
        }

        let imageUrls: string[] = [];
        for (const file of files) {
          const storageId = await ctx.storage.store(file);
          const imageUrl = await ctx.storage.getUrl(storageId);
          if (!imageUrl) {
            throw new ConvexError({
              code: "INVARIANT",
              message: "Failed to resolve uploaded image URL"
            });
          }
          const result = await ctx.runMutation(internal.bridge.attachImageToEntry, {
            subject: identity.subject,
            entryId: asCollectionEntryId(segments[2]),
            imageUrl,
            storageId
          });
          imageUrls = result.imageUrls;
        }

        return json({ imageUrls }, 201);
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to create resource");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "PUT",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const segments = new URL(request.url).pathname
        .replace(/^\/collections\//, "")
        .split("/")
        .filter(Boolean);
      if (segments.length !== 3 || segments[1] !== "pages") {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }
      const pageNumber = Number.parseInt(segments[2] ?? "", 10);
      const body = await parseJsonBody(request);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Array.isArray(body.placements)) {
        return errorJson(400, "BAD_REQUEST", "Invalid binder page");
      }
      const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
      const capturedAt = typeof body.capturedAt === "string"
        ? Date.parse(body.capturedAt)
        : undefined;
      const page = await ctx.runMutation(internal.bridge.upsertBinderPage, {
        subject: identity.subject,
        binderId: asBinderId(binderId),
        pageNumber,
        capturedAt: capturedAt !== undefined && Number.isFinite(capturedAt) ? capturedAt : undefined,
        placements: body.placements
      });
      return json(page);
    } catch (error) {
      return handleConvexError(error, "Failed to save binder page");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);
      const body = await parseJsonBody(request);

      if (segments.length === 1) {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        const binder = (await ctx.runMutation(internal.bridge.updateBinder, {
          subject: identity.subject,
          binderId,
          name: typeof body.name === "string" ? body.name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined,
          defaultCondition:
            body.defaultCondition === null || typeof body.defaultCondition === "string"
              ? body.defaultCondition
              : undefined,
          containerType:
            body.containerType === null || typeof body.containerType === "string"
              ? body.containerType
              : undefined,
          imageUrl:
            body.imageUrl === null || typeof body.imageUrl === "string"
              ? body.imageUrl
              : undefined,
          associatedTcg:
            body.associatedTcg === null ||
            body.associatedTcg === "magic" ||
            body.associatedTcg === "pokemon" ||
            body.associatedTcg === "yugioh"
              ? body.associatedTcg
              : undefined,
          associatedSetCode:
            body.associatedSetCode === null || typeof body.associatedSetCode === "string"
              ? body.associatedSetCode
              : undefined,
          associatedSetName:
            body.associatedSetName === null || typeof body.associatedSetName === "string"
              ? body.associatedSetName
              : undefined
        })) as NativeBinderDetail;
        return json(toLegacyBinder(binder));
      }

      if (segments.length === 3 && segments[1] === "cards") {
        const targetBinderId =
          typeof body.targetBinderId === "string"
            ? await resolveActualBinderId(ctx, identity, body.targetBinderId)
            : undefined;
        const updated = await ctx.runMutation(internal.bridge.updateEntry, {
          subject: identity.subject,
          entryId: asCollectionEntryId(segments[2]),
          binderId: targetBinderId,
          quantity: typeof body.quantity === "number" ? body.quantity : undefined,
          condition:
            typeof body.condition === "string" || body.condition === null
              ? body.condition
              : undefined,
          language:
            typeof body.language === "string" || body.language === null
              ? body.language
              : undefined,
          notes:
            typeof body.notes === "string" || body.notes === null ? body.notes : undefined,
          price: typeof body.price === "number" ? body.price : undefined,
          acquisitionPrice:
            typeof body.acquisitionPrice === "number" ? body.acquisitionPrice : undefined,
          serialNumber:
            typeof body.serialNumber === "string" || body.serialNumber === null
              ? body.serialNumber
              : undefined,
          acquiredAt:
            typeof body.acquiredAt === "string" || body.acquiredAt === null
              ? body.acquiredAt
              : undefined,
          isFoil: typeof body.isFoil === "boolean" ? body.isFoil : undefined,
          finishCode:
            typeof body.finishCode === "string" || body.finishCode === null
              ? body.finishCode
              : undefined,
          finishLabel:
            typeof body.finishLabel === "string" || body.finishLabel === null
              ? body.finishLabel
              : undefined,
          edition:
            typeof body.edition === "string" || body.edition === null
              ? body.edition
              : undefined,
          stamp:
            typeof body.stamp === "string" || body.stamp === null ? body.stamp : undefined,
          isSealedPromo:
            typeof body.isSealedPromo === "boolean" ? body.isSealedPromo : undefined,
          isOversized:
            typeof body.isOversized === "boolean" ? body.isOversized : undefined,
          isPeelOff: typeof body.isPeelOff === "boolean" ? body.isPeelOff : undefined,
          isSigned: typeof body.isSigned === "boolean" ? body.isSigned : undefined,
          isAltered: typeof body.isAltered === "boolean" ? body.isAltered : undefined,
          gradingCompany:
            typeof body.gradingCompany === "string" || body.gradingCompany === null
              ? body.gradingCompany
              : undefined,
          gradingScore:
            typeof body.gradingScore === "string" || body.gradingScore === null
              ? body.gradingScore
              : undefined,
          certNumber:
            typeof body.certNumber === "string" || body.certNumber === null
              ? body.certNumber
              : undefined,
          storageLocation:
            typeof body.storageLocation === "string" || body.storageLocation === null
              ? body.storageLocation
              : undefined,
          tagIds: Array.isArray(body.tags) ? body.tags : undefined,
          newTags: Array.isArray(body.newTags) ? body.newTags : undefined,
          cardOverride:
            body.cardOverride && typeof body.cardOverride === "object"
              ? {
                  cardId:
                    typeof body.cardOverride.cardId === "string"
                      ? body.cardOverride.cardId
                      : "",
                  cardData: body.cardOverride.cardData
                }
              : undefined
        });
        const binder = (await ctx.runQuery(internal.bridge.getBinder, {
          subject: identity.subject,
          binderId: updated.binderId
        })) as NativeBinderDetail;
        const legacyBinder = toLegacyBinder(binder);
        return json(findLegacyCardByCopyId(legacyBinder, updated.id) ?? legacyBinder.cards[0]);
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to update collection");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);

      if (segments.length === 1) {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        await ctx.runMutation(internal.bridge.deleteBinder, {
          subject: identity.subject,
          binderId
        });
        return noContent();
      }

      if (segments.length === 3 && segments[1] === "cards") {
        await ctx.runMutation(internal.bridge.removeEntry, {
          subject: identity.subject,
          entryId: asCollectionEntryId(segments[2])
        });
        return noContent();
      }

      if (segments.length === 4 && segments[1] === "pages" && segments[3] === "image") {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        const pageNumber = Number.parseInt(segments[2] ?? "", 10);
        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
          return errorJson(400, "BAD_REQUEST", "Page number must be a positive integer");
        }
        const result = await ctx.runMutation(internal.bridge.removeBinderPageImage, {
          subject: identity.subject,
          binderId: asBinderId(binderId),
          pageNumber
        });
        if (result.replacedStorageId) {
          await ctx.storage.delete(result.replacedStorageId);
        }
        return noContent();
      }

      if (segments.length === 5 && segments[1] === "cards" && segments[3] === "images") {
        const imageIndex = Number.parseInt(segments[4] ?? "", 10);
        if (!Number.isInteger(imageIndex)) {
          return errorJson(400, "BAD_REQUEST", "Image index must be an integer");
        }
        const result = await ctx.runMutation(internal.bridge.removeImageFromEntry, {
          subject: identity.subject,
          entryId: asCollectionEntryId(segments[2]),
          imageIndex
        });
        if (result.removedStorageId) {
          await ctx.storage.delete(result.removedStorageId);
        }
        return noContent();
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to delete resource");
    }
  })
});

registerDecksRoutes(http);
registerFinanceRoutes(http);
registerSealedRoutes(http);
registerAnalyticsRoutes(http);
registerTradesRoutes(http);
export default http;
