"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCardToCollection,
  LIBRARY_COLLECTION_ID,
  updateCollectionCard,
  undoCollectionMutation,
} from "@/lib/api/collections";
import {
  createRapidEntry,
  lookupPsaCertificate,
  splitAcquisitionCost,
  type RapidEntryReceiptLine,
} from "@/lib/api/collection-operations";
import { getSetCards, getSets, searchCards } from "@/lib/api/cards";
import {
  allocateCostCents,
  collectorNumberKey,
} from "@/lib/collection-operations";
import {
  FALLBACK_CURRENCIES,
  getSupportedCurrencies,
} from "@/lib/currency/exchange-rates";
import { formatMoney } from "@/lib/format-money";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import type { Card as CardResult, TcgCode } from "@tcg/api-types";

const GAMES: TcgCode[] = [
  "pokemon",
  "magic",
  "yugioh",
  "onepiece",
  "lorcana",
  "dragonball",
];
const NO_BINDER = "__unsorted__";

export function RapidSetEntry() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const collections = useCollectionsStore((state) => state.collections);
  const fetchCollections = useCollectionsStore(
    (state) => state.fetchCollections,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [tcg, setTcg] = useState<TcgCode>("pokemon");
  const [setCode, setSetCode] = useState("");
  const [binderId, setBinderId] = useState(NO_BINDER);
  const [collectorNumber, setCollectorNumber] = useState("");
  const [printedName, setPrintedName] = useState("");
  const [receipt, setReceipt] = useState<RapidEntryReceiptLine[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const effectiveBinderId =
    binderId === NO_BINDER ? (collections[0]?.id ?? NO_BINDER) : binderId;
  const setsQuery = useQuery({
    queryKey: ["sets", tcg],
    queryFn: () => getSets(token!, tcg),
    enabled: !!token,
  });
  const cardsQuery = useQuery({
    queryKey: ["set-cards", tcg, setCode],
    queryFn: () => getSetCards(token!, tcg, setCode),
    enabled: !!token && !!setCode,
  });
  const matchingCards = useMemo(() => {
    const key = collectorNumberKey(collectorNumber);
    if (!key) return [];
    return (cardsQuery.data ?? []).filter(
      (card) => collectorNumberKey(card.collectorNumber ?? "") === key,
    );
  }, [cardsQuery.data, collectorNumber]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const exactCard =
    matchingCards.find((card) => card.id === selectedCardId) ??
    (matchingCards.length === 1 ? matchingCards[0] : null);

  const addMutation = useMutation({
    mutationFn: () =>
      createRapidEntry(token!, {
        binderId: effectiveBinderId,
        tcg,
        setCode,
        entries: [
          {
            rowId: crypto.randomUUID(),
            collectorNumber: collectorNumberKey(collectorNumber),
            quantity: 1,
            card: {
              ...exactCard!,
              name: exactCard!.name,
              externalId: exactCard!.id,
            },
          },
        ],
      }),
    onSuccess: async (result) => {
      const line = result.items[0];
      const targetBinderId = effectiveBinderId;
      if (line && targetBinderId && printedName.trim()) {
        await updateCollectionCard(
          token!,
          targetBinderId,
          line.entryId,
          {
            printedName: printedName.trim(),
            searchAliases: [printedName.trim()],
          } as Parameters<typeof updateCollectionCard>[3],
          user,
        );
      }
      if (line && exactCard)
        setReceipt((current) => [{ ...line, card: exactCard }, ...current]);
      setCollectorNumber("");
      setPrintedName("");
      setSelectedCardId(null);
      setStatus(`Added ${exactCard?.name ?? "card"}.`);
      await fetchCollections(token!);
      inputRef.current?.focus();
    },
    onError: (error) => {
      setStatus((error as Error).message);
      inputRef.current?.focus();
    },
  });
  const undoMutation = useMutation({
    mutationFn: (line: RapidEntryReceiptLine) =>
      undoCollectionMutation(token!, line.auditId, crypto.randomUUID(), user),
    onSuccess: async (_result, line) => {
      setReceipt((current) =>
        current.filter((item) => item.auditId !== line.auditId),
      );
      await fetchCollections(token!);
      inputRef.current?.focus();
    },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Card>
        <CardHeader>
          <CardTitle>Rapid set entry</CardTitle>
          <CardDescription>
            Pin a set, type collector numbers, and keep moving. The field
            regains focus after every add.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (exactCard) addMutation.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Game</Label>
                <Select
                  value={tcg}
                  onValueChange={(value) => {
                    setTcg(value as TcgCode);
                    setSetCode("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GAMES.map((game) => (
                      <SelectItem key={game} value={game}>
                        {GAME_LABELS[game as SupportedGame]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Set</Label>
                <Select value={setCode} onValueChange={setSetCode}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        setsQuery.isLoading ? "Loading…" : "Pin a set"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(setsQuery.data ?? []).map((set) => (
                      <SelectItem key={set.code} value={set.code}>
                        {set.name} ({set.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collection</Label>
                <Select value={effectiveBinderId} onValueChange={setBinderId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((binder) => (
                      <SelectItem key={binder.id} value={binder.id}>
                        {binder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="rapid-collector-number">Collector number</Label>
                <Input
                  ref={inputRef}
                  id="rapid-collector-number"
                  value={collectorNumber}
                  onChange={(event) => {
                    setCollectorNumber(event.target.value);
                    setSelectedCardId(null);
                  }}
                  disabled={!setCode || addMutation.isPending}
                  placeholder="025/165"
                  inputMode="text"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rapid-printed-name">
                  Printed name{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="rapid-printed-name"
                  value={printedName}
                  onChange={(event) => setPrintedName(event.target.value)}
                  placeholder="Localized card name"
                />
              </div>
              <Button
                type="submit"
                disabled={
                  !exactCard ||
                  effectiveBinderId === NO_BINDER ||
                  addMutation.isPending
                }
              >
                {addMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Add
              </Button>
            </div>
            {collectorNumber && cardsQuery.isFetching && (
              <p className="text-sm text-muted-foreground">
                Checking the pinned set…
              </p>
            )}
            {collectorNumber &&
              !cardsQuery.isFetching &&
              matchingCards.length === 0 && (
                <p className="text-sm text-destructive" role="alert">
                  No card in this set has that collector number.
                </p>
              )}
            {matchingCards.length > 1 && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">
                  Choose the exact printing
                </p>
                {matchingCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setSelectedCardId(card.id)}
                    className={`mr-2 rounded border px-3 py-2 text-sm ${selectedCardId === card.id ? "border-primary bg-primary/5" : ""}`}
                  >
                    {card.name} · {card.rarity ?? "Unknown rarity"}
                  </button>
                ))}
              </div>
            )}
            {exactCard && (
              <p className="rounded-lg border bg-muted/20 p-3 text-sm">
                <strong>{printedName.trim() || exactCard.name}</strong>
                {printedName.trim() && printedName.trim() !== exactCard.name ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · Canonical: {exactCard.name}
                  </span>
                ) : null}{" "}
                · {exactCard.setName} #{exactCard.collectorNumber}
              </p>
            )}
            {status && (
              <p className="text-sm text-muted-foreground" role="status">
                {status}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle className="text-base">Session receipt</CardTitle>
          <CardDescription>
            Each addition has its own audit record and undo.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[32rem] space-y-2 overflow-y-auto">
          {receipt.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cards added this session appear here.
            </p>
          ) : (
            receipt.map((line) => (
              <div
                key={line.auditId}
                className="flex items-center gap-2 rounded-lg border p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {line.card.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    #{line.collectorNumber} · x{line.quantity}
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Undo adding ${line.card.name}`}
                  disabled={undoMutation.isPending}
                  onClick={() => undoMutation.mutate(line)}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface SelectableCopy {
  id: string;
  name: string;
  printedName?: string;
  setCode?: string;
  collectorNumber?: string;
  binderName?: string;
}

export function AcquisitionCostSplitter() {
  const token = useAuthStore((state) => state.token);
  const collections = useCollectionsStore((state) => state.collections);
  const fetchCollections = useCollectionsStore(
    (state) => state.fetchCollections,
  );
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [mode, setMode] = useState<"equal" | "proportional">("equal");
  const [source, setSource] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const currenciesQuery = useQuery({
    queryKey: ["currencies", "supported"],
    queryFn: getSupportedCurrencies,
    staleTime: 86_400_000,
  });
  const copies = useMemo<SelectableCopy[]>(
    () =>
      collections.flatMap((binder) =>
        binder.cards.flatMap((card) =>
          card.copies.map((copy) => ({
            id: copy.id,
            name: card.name,
            printedName: (copy as typeof copy & { printedName?: string })
              .printedName,
            setCode: card.setCode,
            collectorNumber: card.collectorNumber,
            binderName: binder.name,
          })),
        ),
      ),
    [collections],
  );
  const filtered = copies
    .filter((copy) =>
      `${copy.name} ${copy.printedName ?? ""} ${copy.setCode ?? ""} ${copy.collectorNumber ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .slice(0, 100);
  const totalCents = Math.round(Number(total) * 100);
  const allocation = useMemo(() => {
    try {
      return allocateCostCents(
        totalCents,
        Object.entries(selected).map(([copyId, weight]) => ({
          copyId,
          weight: mode === "equal" ? 1 : weight,
        })),
      );
    } catch {
      return [];
    }
  }, [mode, selected, totalCents]);
  const mutation = useMutation({
    mutationFn: () =>
      splitAcquisitionCost(token!, {
        totalCents,
        currency,
        mode: mode === "equal" ? "equal" : "weighted",
        notes: [source.trim(), date].filter(Boolean).join(" · "),
        lines: Object.entries(selected).map(([collectionEntryId, weight]) => ({
          collectionEntryId,
          weight: mode === "equal" ? undefined : weight,
        })),
      }),
    onSuccess: async () => {
      setSelected({});
      setTotal("");
      await Promise.all([
        fetchCollections(token!),
        queryClient.invalidateQueries({ queryKey: ["finance"] }),
      ]);
    },
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Card>
        <CardHeader>
          <CardTitle>Choose owned copies</CardTitle>
          <CardDescription>
            Select the cards acquired together. Allocations are recorded as
            purchase transactions and audit entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search collection"
              className="pl-9"
            />
          </div>
          <div className="max-h-[34rem] space-y-2 overflow-y-auto">
            {filtered.map((copy) => {
              const checked = selected[copy.id] !== undefined;
              return (
                <label
                  key={copy.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      setSelected((current) => {
                        const next = { ...current };
                        if (value === true) next[copy.id] = 1;
                        else delete next[copy.id];
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {copy.printedName ?? copy.name}
                    </span>
                    {copy.printedName && copy.printedName !== copy.name && (
                      <span className="block truncate text-xs text-muted-foreground">
                        Canonical: {copy.name}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {[
                        copy.binderName,
                        copy.setCode,
                        copy.collectorNumber && `#${copy.collectorNumber}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {checked && mode === "proportional" && (
                    <Input
                      className="w-20"
                      aria-label={`Weight for ${copy.name}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={selected[copy.id]}
                      onChange={(event) =>
                        setSelected((current) => ({
                          ...current,
                          [copy.id]: Number(event.target.value),
                        }))
                      }
                    />
                  )}
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>Split purchase cost</CardTitle>
          <CardDescription>
            Exact cents are assigned deterministically; the preview always sums
            to the total.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="split-total">Total paid</Label>
              <Input
                id="split-total"
                type="number"
                min="0.01"
                step="0.01"
                value={total}
                onChange={(event) => setTotal(event.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(currenciesQuery.data ?? FALLBACK_CURRENCIES).map((item) => (
                    <SelectItem key={item.isoCode} value={item.isoCode}>
                      {item.isoCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as typeof mode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="equal">Equal split</SelectItem>
                <SelectItem value="proportional">
                  Proportional weights
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="split-source">Source</Label>
            <Input
              id="split-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="Pack, deck, collection lot…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="split-date">Purchase date</Label>
            <Input
              id="split-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
            {allocation.map((line) => {
              const copy = copies.find((item) => item.id === line.copyId);
              return (
                <div
                  key={line.copyId}
                  className="flex justify-between gap-2 text-xs"
                >
                  <span className="truncate">
                    {copy?.printedName ?? copy?.name}
                  </span>
                  <span>
                    {formatMoney(line.amountCents / 100, { currency })}
                  </span>
                </div>
              );
            })}
            <div className="mt-2 flex justify-between border-t pt-2 text-sm font-medium">
              <span>{allocation.length} copies</span>
              <span>
                {formatMoney(
                  allocation.reduce((sum, line) => sum + line.amountCents, 0) /
                    100,
                  { currency },
                )}
              </span>
            </div>
          </div>
          {mutation.error && (
            <p className="text-sm text-destructive" role="alert">
              {(mutation.error as Error).message}
            </p>
          )}
          {mutation.isSuccess && (
            <p className="text-sm text-muted-foreground" role="status">
              Purchase cost recorded with an audit trail.
            </p>
          )}
          <Button
            className="w-full"
            disabled={
              !token ||
              (selected && Object.keys(selected).length === 0) ||
              totalCents <= 0 ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Recording…" : "Record split"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function PsaCertificateIntake() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const collections = useCollectionsStore((state) => state.collections);
  const fetchCollections = useCollectionsStore(
    (state) => state.fetchCollections,
  );
  const [certNumber, setCertNumber] = useState("");
  const [binderId, setBinderId] = useState(NO_BINDER);
  const [selectedCard, setSelectedCard] = useState<CardResult | null>(null);
  const [printedName, setPrintedName] = useState("");
  const lookupMutation = useMutation({
    mutationFn: () => lookupPsaCertificate(token!, certNumber.trim()),
    onSuccess: () => setSelectedCard(null),
  });
  const candidatesQuery = useQuery({
    queryKey: [
      "psa",
      "candidates",
      lookupMutation.data?.certNumber,
      lookupMutation.data?.searchableName,
    ],
    queryFn: () =>
      searchCards(
        token!,
        lookupMutation.data!.searchableName ??
          lookupMutation.data!.subject ??
          "",
      ),
    enabled:
      !!token &&
      !!(lookupMutation.data?.searchableName ?? lookupMutation.data?.subject),
  });
  const addMutation = useMutation({
    mutationFn: () =>
      addCardToCollection(
        token!,
        binderId === NO_BINDER ? LIBRARY_COLLECTION_ID : binderId,
        {
          cardId: selectedCard!.id,
          quantity: 1,
          gradingCompany: "PSA",
          gradingScore: String(
            lookupMutation.data!.grade ?? lookupMutation.data!.gradeLabel ?? "",
          ),
          certNumber: lookupMutation.data!.certNumber,
          cardData: {
            ...selectedCard!,
            externalId: selectedCard!.id,
            printedName: printedName.trim() || undefined,
            searchAliases: printedName.trim()
              ? [printedName.trim()]
              : undefined,
          },
        } as Parameters<typeof addCardToCollection>[2],
        user,
      ),
    onSuccess: async () => {
      await fetchCollections(token!);
      setCertNumber("");
      setSelectedCard(null);
      setPrintedName("");
      lookupMutation.reset();
    },
  });
  const result = lookupMutation.data;
  const candidates = (candidatesQuery.data ?? []).sort((left, right) => {
    const leftExact = result?.cardId === left.id ? 1 : 0;
    const rightExact = result?.cardId === right.id ? 1 : 0;
    return rightExact - leftExact;
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>PSA certificate</CardTitle>
          <CardDescription>
            Look up the slab first; TCGer stores normalized certificate fields
            and cache provenance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              lookupMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="psa-cert">Certification number</Label>
              <Input
                id="psa-cert"
                inputMode="numeric"
                autoComplete="off"
                value={certNumber}
                onChange={(event) =>
                  setCertNumber(event.target.value.replace(/\D/g, ""))
                }
                placeholder="12345678"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={
                !token || certNumber.length < 6 || lookupMutation.isPending
              }
            >
              {lookupMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Look up certificate
            </Button>
            {lookupMutation.error && (
              <p className="text-sm text-destructive" role="alert">
                {(lookupMutation.error as Error).message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Confirm exact printing</CardTitle>
          <CardDescription>
            Certificate labels do not always identify a unique catalog printing.
            Choose before adding it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!result ? (
            <p className="text-sm text-muted-foreground">
              Certificate details and candidates appear here.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge>PSA {result.gradeLabel ?? result.grade ?? "—"}</Badge>
                <Badge variant="outline">Cert {result.certNumber}</Badge>
                {result.year && (
                  <Badge variant="secondary">{result.year}</Badge>
                )}
              </div>
              <div>
                <p className="font-medium">
                  {result.searchableName ??
                    result.subject ??
                    "PSA-certified card"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.cached ? "Cached" : "Fetched"}{" "}
                  {new Date(result.retrievedAt).toLocaleString()} · verification{" "}
                  {result.providerResponseHash.slice(0, 10)}…
                  {result.refreshAfter
                    ? ` · refresh after ${new Date(result.refreshAfter).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {candidatesQuery.isLoading && (
                  <p className="text-sm text-muted-foreground">
                    Finding catalog candidates…
                  </p>
                )}
                {candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelectedCard(candidate)}
                    className={`rounded-lg border p-3 text-left ${selectedCard?.id === candidate.id ? "border-primary ring-2 ring-primary" : "hover:bg-muted/40"}`}
                  >
                    <span className="block font-medium">{candidate.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {candidate.setName} · #{candidate.collectorNumber}
                      {result.cardId === candidate.id
                        ? " · Provider card match"
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Collection</Label>
                  <Select value={binderId} onValueChange={setBinderId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_BINDER}>Unsorted</SelectItem>
                      {collections.map((binder) => (
                        <SelectItem key={binder.id} value={binder.id}>
                          {binder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="psa-printed-name">
                    Printed name{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="psa-printed-name"
                    value={printedName}
                    onChange={(event) => setPrintedName(event.target.value)}
                  />
                </div>
              </div>
              {addMutation.error && (
                <p className="text-sm text-destructive" role="alert">
                  {(addMutation.error as Error).message}
                </p>
              )}
              <Button
                disabled={!selectedCard || addMutation.isPending}
                onClick={() => addMutation.mutate()}
              >
                {addMutation.isPending ? "Adding…" : "Confirm and add slab"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
