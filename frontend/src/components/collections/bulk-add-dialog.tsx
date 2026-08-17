"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Layers3,
  Loader2,
  Plus,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  bulkAddRequestSchema,
  type BulkAddCopyFields,
  type BulkAddPreview,
  type BulkAddRequest,
  type Card,
  type CardDataPayload,
  type TcgCode,
} from "@tcg/api-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { searchCardsApi } from "@/lib/api-client";
import {
  commitBulkAdd,
  previewBulkAdd,
  type Collection,
} from "@/lib/api/collections";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { cn, GAME_LABELS } from "@/lib/utils";
import { supportedGames } from "@/stores/game-filter";
import { formatCopyCount } from "@/lib/copy-labels";

const INHERIT = "__inherit__";

type StagedRow = {
  rowId: string;
  card: Card;
  binderId?: string;
  quantity?: number;
  overrides: BulkAddCopyFields;
};

export function BulkAddDialog() {
  const token = useAuthStore((state) => state.token);
  const viewer = useAuthStore((state) => state.user);
  const collections = useCollectionsStore((state) => state.collections);
  const refreshCollections = useCollectionsStore(
    (state) => state.fetchCollections,
  );

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [game, setGame] = useState<TcgCode>("yugioh");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<Card[]>([]);
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [stagedFilter, setStagedFilter] = useState("");

  const [defaultBinderId, setDefaultBinderId] = useState("");
  const [defaultQuantity, setDefaultQuantity] = useState(1);
  const [defaultCondition, setDefaultCondition] = useState("NM");
  const [defaultLanguage, setDefaultLanguage] = useState("EN");
  const [defaultFinish, setDefaultFinish] = useState("");
  const [defaultEdition, setDefaultEdition] = useState("");
  const [defaultNotes, setDefaultNotes] = useState("");
  const [defaultFoil, setDefaultFoil] = useState(false);

  const [batchBinderId, setBatchBinderId] = useState(INHERIT);
  const [batchCondition, setBatchCondition] = useState("");
  const [batchLanguage, setBatchLanguage] = useState("");

  const [preview, setPreview] = useState<BulkAddPreview | null>(null);
  const [validatedFingerprint, setValidatedFingerprint] = useState("");
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const effectiveDefaultBinder =
    defaultBinderId || collections[0]?.id || "";
  const filteredRows = useMemo(() => {
    const query = stagedFilter.trim().toLocaleLowerCase();
    if (!query) return staged;
    return staged.filter((row) =>
      [
        row.card.name,
        row.card.setCode,
        row.card.setName,
        row.card.rarity,
        row.card.collectorNumber,
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    );
  }, [staged, stagedFilter]);

  const request = useMemo(
    () =>
      buildRequest(staged, {
        binderId: effectiveDefaultBinder,
        quantity: defaultQuantity,
        condition: defaultCondition,
        language: defaultLanguage,
        finishCode: defaultFinish || undefined,
        edition: defaultEdition || undefined,
        notes: defaultNotes || undefined,
        isFoil: defaultFoil,
      }),
    [
      staged,
      effectiveDefaultBinder,
      defaultQuantity,
      defaultCondition,
      defaultLanguage,
      defaultFinish,
      defaultEdition,
      defaultNotes,
      defaultFoil,
    ],
  );
  const fingerprint = JSON.stringify(request);
  const locallyParsed = bulkAddRequestSchema.safeParse(request);
  const isCurrentPreview =
    preview?.valid === true && validatedFingerprint === fingerprint;

  const invalidatePreview = () => {
    setPreview(null);
    setValidatedFingerprint("");
    setMessage(null);
  };

  const handleSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      setResults(
        await searchCardsApi({
          query: search.trim(),
          tcg: game,
          token,
        }),
      );
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Card search failed",
      );
    } finally {
      setSearching(false);
    }
  };

  const stageCard = (card: Card) => {
    setStaged((current) => {
      const existing = current.find(
        (row) =>
          row.card.id === card.id &&
          !row.binderId &&
          Object.keys(row.overrides).length === 0,
      );
      if (existing) {
        return current.map((row) =>
          row.rowId === existing.rowId
            ? {
                ...row,
                quantity: (row.quantity ?? defaultQuantity) + 1,
              }
            : row,
        );
      }
      return [
        ...current,
        {
          rowId: createRowId(),
          card,
          overrides: {},
        },
      ];
    });
    invalidatePreview();
  };

  const updateRow = (rowId: string, patch: Partial<StagedRow>) => {
    setStaged((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
    );
    invalidatePreview();
  };

  const updateOverrides = (
    row: StagedRow,
    patch: Partial<BulkAddCopyFields>,
  ) => {
    updateRow(row.rowId, {
      overrides: compactOverrides({ ...row.overrides, ...patch }),
    });
  };

  const applyBatch = () => {
    const filteredIds = new Set(filteredRows.map((row) => row.rowId));
    setStaged((current) =>
      current.map((row) => {
        if (!filteredIds.has(row.rowId)) return row;
        return {
          ...row,
          binderId:
            batchBinderId === INHERIT ? row.binderId : batchBinderId,
          overrides: compactOverrides({
            ...row.overrides,
            condition: batchCondition || row.overrides.condition,
            language: batchLanguage || row.overrides.language,
          }),
        };
      }),
    );
    invalidatePreview();
  };

  const handleValidate = async () => {
    if (!token || !viewer) return;
    if (!locallyParsed.success) {
      setPreview({
        valid: false,
        rows: [],
        issues: locallyParsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
        totalRows: staged.length,
        totalCopies: 0,
      });
      setValidatedFingerprint(fingerprint);
      return;
    }
    setValidating(true);
    setMessage(null);
    try {
      const nextPreview = await previewBulkAdd(
        token,
        locallyParsed.data,
        viewer,
      );
      setPreview(nextPreview);
      setValidatedFingerprint(fingerprint);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Bulk Add validation failed",
      );
    } finally {
      setValidating(false);
    }
  };

  const handleCommit = async () => {
    if (!token || !viewer || !locallyParsed.success || !isCurrentPreview) {
      return;
    }
    setCommitting(true);
    setMessage(null);
    try {
      const result = await commitBulkAdd(token, locallyParsed.data, viewer);
      await refreshCollections(token);
      setStaged([]);
      setPreview(null);
      setValidatedFingerprint("");
      setMessage(
        `Added ${result.addedCopies} physical ${
          result.addedCopies === 1 ? "copy" : "copies"
        } atomically.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Bulk Add commit failed",
      );
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Layers3 className="mr-2 h-4 w-4" />
          Bulk Add
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] max-w-7xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Bulk Add physical copies</DialogTitle>
          <DialogDescription>
            Stage exact printings, apply shared defaults, then validate and
            commit the entire batch as one transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(280px,0.85fr)_minmax(520px,1.5fr)]">
          <section className="space-y-3 rounded-xl border p-4">
            <div>
              <h3 className="font-medium">1. Find exact printings</h3>
              <p className="text-xs text-muted-foreground">
                Each staged card keeps its provider, printing, and artwork IDs.
              </p>
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-2">
              <Select
                value={game}
                onValueChange={(value) => setGame(value as TcgCode)}
              >
                <SelectTrigger aria-label="Card game">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedGames
                    .filter((value) => value !== "all")
                    .map((value) => (
                    <SelectItem key={value} value={value}>
                      {GAME_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleSearch();
                  }}
                  placeholder="Card name"
                />
                <Button
                  size="icon"
                  variant="secondary"
                  disabled={searching || !search.trim()}
                  onClick={() => void handleSearch()}
                  aria-label="Search cards"
                >
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            {searchError && (
              <p className="text-sm text-destructive">{searchError}</p>
            )}
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {results.map((card) => (
                <div
                  key={card.id}
                  className="flex items-start gap-3 rounded-lg border bg-background p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{card.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[card.setCode, card.collectorNumber, card.rarity]
                        .filter(Boolean)
                        .join(" • ") || "Representative printing"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline">{GAME_LABELS[card.tcg]}</Badge>
                      {card.printingKey && (
                        <Badge variant="secondary">Exact print</Badge>
                      )}
                      {card.artworkId && (
                        <Badge variant="outline">Art {card.artworkId}</Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => stageCard(card)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Stage
                  </Button>
                </div>
              ))}
              {!searching && results.length === 0 && (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Search by card name to begin staging.
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">2. Configure and validate</h3>
                <p className="text-xs text-muted-foreground">
                  Row values override defaults; batch actions affect the current
                  row filter only.
                </p>
              </div>
              <Badge variant="secondary">
                {staged.length} rows ·{" "}
                {formatCopyCount(
                  staged.reduce(
                    (sum, row) => sum + (row.quantity ?? defaultQuantity),
                    0,
                  ),
                )}
              </Badge>
            </div>

            <div className="grid gap-3 rounded-lg bg-muted/40 p-3 md:grid-cols-4">
              <Field label="Default binder">
                <BinderSelect
                  collections={collections}
                  value={effectiveDefaultBinder}
                  onChange={(value) => {
                    setDefaultBinderId(value);
                    invalidatePreview();
                  }}
                />
              </Field>
              <Field label="Quantity">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={defaultQuantity}
                  onChange={(event) => {
                    setDefaultQuantity(Number(event.target.value));
                    invalidatePreview();
                  }}
                />
              </Field>
              <Field label="Condition">
                <Input
                  value={defaultCondition}
                  onChange={(event) => {
                    setDefaultCondition(event.target.value);
                    invalidatePreview();
                  }}
                />
              </Field>
              <Field label="Language">
                <Input
                  value={defaultLanguage}
                  onChange={(event) => {
                    setDefaultLanguage(event.target.value);
                    invalidatePreview();
                  }}
                />
              </Field>
              <Field label="Finish">
                <Input
                  value={defaultFinish}
                  onChange={(event) => {
                    setDefaultFinish(event.target.value);
                    invalidatePreview();
                  }}
                  placeholder="Normal, holo…"
                />
              </Field>
              <Field label="Edition">
                <Input
                  value={defaultEdition}
                  onChange={(event) => {
                    setDefaultEdition(event.target.value);
                    invalidatePreview();
                  }}
                  placeholder="1st Edition"
                />
              </Field>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={1}
                  value={defaultNotes}
                  onChange={(event) => {
                    setDefaultNotes(event.target.value);
                    invalidatePreview();
                  }}
                  placeholder="Applied to every row unless overridden"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={defaultFoil}
                  onCheckedChange={(checked) => {
                    setDefaultFoil(checked === true);
                    invalidatePreview();
                  }}
                />
                Foil by default
              </label>
            </div>

            <div className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <BinderSelect
                collections={collections}
                value={batchBinderId}
                onChange={setBatchBinderId}
                includeInherit
              />
              <Input
                value={batchCondition}
                onChange={(event) => setBatchCondition(event.target.value)}
                placeholder="Batch condition"
              />
              <Input
                value={batchLanguage}
                onChange={(event) => setBatchLanguage(event.target.value)}
                placeholder="Batch language"
              />
              <Button
                variant="secondary"
                disabled={!filteredRows.length}
                onClick={applyBatch}
              >
                Apply to {filteredRows.length}
              </Button>
            </div>

            <Input
              value={stagedFilter}
              onChange={(event) => setStagedFilter(event.target.value)}
              placeholder="Filter staged rows by card, set, rarity…"
            />

            <div className="max-h-[33vh] space-y-2 overflow-y-auto pr-1">
              {filteredRows.map((row) => (
                <div key={row.rowId} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.card.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[row.card.setCode, row.card.collectorNumber, row.card.rarity]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    </div>
                    <Badge variant="outline">{GAME_LABELS[row.card.tcg]}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setStaged((current) =>
                          current.filter((entry) => entry.rowId !== row.rowId),
                        );
                        invalidatePreview();
                      }}
                      aria-label={`Remove ${row.card.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <BinderSelect
                      collections={collections}
                      value={row.binderId ?? INHERIT}
                      onChange={(value) =>
                        updateRow(row.rowId, {
                          binderId: value === INHERIT ? undefined : value,
                        })
                      }
                      includeInherit
                    />
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={row.quantity ?? defaultQuantity}
                      onChange={(event) =>
                        updateRow(row.rowId, {
                          quantity: Number(event.target.value),
                        })
                      }
                      aria-label={`${row.card.name} quantity`}
                    />
                    <Input
                      value={row.overrides.condition ?? ""}
                      onChange={(event) =>
                        updateOverrides(row, {
                          condition: event.target.value || undefined,
                        })
                      }
                      placeholder={`Condition (${defaultCondition})`}
                    />
                    <Input
                      value={row.overrides.language ?? ""}
                      onChange={(event) =>
                        updateOverrides(row, {
                          language: event.target.value || undefined,
                        })
                      }
                      placeholder={`Language (${defaultLanguage})`}
                    />
                    <Input
                      value={row.overrides.finishCode ?? ""}
                      onChange={(event) =>
                        updateOverrides(row, {
                          finishCode: event.target.value || undefined,
                        })
                      }
                      placeholder={`Finish (${defaultFinish || "none"})`}
                    />
                    <Input
                      value={row.overrides.edition ?? ""}
                      onChange={(event) =>
                        updateOverrides(row, {
                          edition: event.target.value || undefined,
                        })
                      }
                      placeholder={`Edition (${defaultEdition || "none"})`}
                    />
                  </div>
                </div>
              ))}
              {!filteredRows.length && (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {staged.length
                    ? "No staged rows match this filter."
                    : "Stage cards from the search pane."}
                </div>
              )}
            </div>

            {preview && (
              <div
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  preview.valid
                    ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
                    : "border-destructive bg-destructive/10",
                )}
              >
                <div className="flex items-center gap-2 font-medium">
                  {preview.valid ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {preview.valid
                    ? `${formatCopyCount(preview.totalCopies)} ${preview.totalCopies === 1 ? "is" : "are"} ready for one atomic commit.`
                    : `${preview.issues.length} validation issue${
                        preview.issues.length === 1 ? "" : "s"
                      }`}
                </div>
                {preview.issues.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {preview.issues.slice(0, 6).map((issue, index) => (
                      <li key={`${issue.rowId ?? "batch"}-${index}`}>
                        {issue.rowId ? `${issue.rowId}: ` : ""}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {message && <p className="text-sm">{message}</p>}
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={!staged.length || validating || committing}
            onClick={() => void handleValidate()}
          >
            {validating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Validate preview
          </Button>
          <Button
            disabled={!isCurrentPreview || committing}
            onClick={() => void handleCommit()}
          >
            {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Commit entire batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function BinderSelect({
  collections,
  value,
  onChange,
  includeInherit = false,
}: {
  collections: Collection[];
  value: string;
  onChange: (value: string) => void;
  includeInherit?: boolean;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select binder" />
      </SelectTrigger>
      <SelectContent>
        {includeInherit && (
          <SelectItem value={INHERIT}>Use global default</SelectItem>
        )}
        {collections.map((binder) => (
          <SelectItem key={binder.id} value={binder.id}>
            {binder.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function buildRequest(
  staged: StagedRow[],
  defaults: BulkAddRequest["defaults"],
): BulkAddRequest {
  return {
    defaults,
    rows: staged.map((row) => ({
      rowId: row.rowId,
      cardId: row.card.id,
      cardData: cardSnapshot(row.card),
      binderId: row.binderId,
      quantity: row.quantity,
      overrides:
        Object.keys(row.overrides).length > 0 ? row.overrides : undefined,
    })),
  };
}

function cardSnapshot(card: Card): CardDataPayload {
  return {
    name: card.name,
    tcg: card.tcg,
    externalId: card.id,
    baseExternalId: card.baseExternalId,
    printingKey: card.printingKey,
    artworkId: card.artworkId,
    printingKind: card.printingKind,
    sanctionedPlayLegal: card.sanctionedPlayLegal,
    originalPrintingKey: card.originalPrintingKey,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    collectorNumber: card.collectorNumber,
    releasedAt: card.releasedAt,
    imageUrl: card.imageUrl,
    imageUrlSmall: card.imageUrlSmall,
    setSymbolUrl: card.setSymbolUrl,
    setLogoUrl: card.setLogoUrl,
    regulationMark: card.regulationMark,
    language: card.language,
    supertype: card.supertype,
    formatLegality: card.formatLegality,
    dexEntries: card.dexEntries,
    region: card.region,
    pokemonPrint: card.pokemonPrint,
    attributes: card.attributes,
    provenance: card.provenance,
    legalityPeriods: card.legalityPeriods,
    evolution: card.evolution,
    functionalIdentity: card.functionalIdentity,
  };
}

function compactOverrides(
  overrides: BulkAddCopyFields,
): BulkAddCopyFields {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as BulkAddCopyFields;
}

function createRowId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
