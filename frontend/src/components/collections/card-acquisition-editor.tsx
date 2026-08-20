"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ExternalLink,
  Loader2,
  ShoppingCart,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { CollectionCard, CollectionCardCopy } from "@/lib/api/collections";
import {
  createTransaction,
  deleteTransaction,
  getTransactions,
  updateTransaction,
} from "@/lib/api/pricing";
import {
  FALLBACK_CURRENCIES,
  getSupportedCurrencies,
} from "@/lib/currency/exchange-rates";
import { formatMoney } from "@/lib/format-money";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";

interface CardAcquisitionEditorProps {
  card: CollectionCard;
  copy: CollectionCardCopy | null;
  binderId?: string;
  compact?: boolean;
}

function dateInputValue(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function purchaseDateTime(value: string): string {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function isValidOptionalHttpUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function CardAcquisitionEditor({
  card,
  copy,
  binderId,
  compact = false,
}: CardAcquisitionEditorProps) {
  const token = useAuthStore((state) => state.token);
  const updateCollectionCard = useCollectionsStore(
    (state) => state.updateCollectionCard,
  );
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transactionQuery = useQuery({
    queryKey: ["finance", "purchase", copy?.id],
    queryFn: () => getTransactions(token!, copy!.id),
    enabled: !!token && !!copy,
    staleTime: 60_000,
  });
  const currenciesQuery = useQuery({
    queryKey: ["currencies", "supported"],
    queryFn: getSupportedCurrencies,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const transaction = transactionQuery.data?.find(
    (candidate) => candidate.type === "purchase",
  );
  const currencies = useMemo(() => {
    const byCode = new Map(
      (currenciesQuery.data ?? FALLBACK_CURRENCIES).map((item) => [
        item.isoCode,
        item,
      ]),
    );
    if (!byCode.has(currency)) {
      byCode.set(currency, { isoCode: currency, name: currency });
    }
    return Array.from(byCode.values()).sort((left, right) =>
      left.isoCode.localeCompare(right.isoCode),
    );
  }, [currenciesQuery.data, currency]);

  const openEditor = () => {
    const initialAmount = transaction?.amount ?? copy?.acquisitionPrice;
    setAmount(initialAmount === undefined ? "" : String(initialAmount));
    setCurrency(transaction?.currency ?? "USD");
    setPurchaseDate(dateInputValue(transaction?.date ?? copy?.acquiredAt));
    setSource(transaction?.platform ?? "");
    setSourceUrl(transaction?.sourceUrl ?? "");
    setNotes(transaction?.notes ?? "");
    setError(null);
    setOpen(true);
  };

  if (!copy) {
    return null;
  }

  const parsedAmount = Number(amount);
  const sourceUrlIsValid = isValidOptionalHttpUrl(sourceUrl);
  const canSave =
    !!token &&
    !!binderId &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    /^[A-Z]{3}$/.test(currency) &&
    sourceUrlIsValid &&
    !isSaving;
  const hasPurchase = !!transaction || copy.acquisitionPrice !== undefined;
  const summaryAmount = transaction?.amount ?? copy.acquisitionPrice;
  const summaryCurrency = transaction?.currency ?? "USD";
  const summaryDate = transaction?.date ?? copy.acquiredAt;

  const save = async () => {
    if (!canSave || !token || !binderId) return;
    setIsSaving(true);
    setError(null);
    const date = purchaseDateTime(purchaseDate);
    const normalizedSource = source.trim() || null;
    const normalizedUrl = sourceUrl.trim() || null;
    const normalizedNotes = notes.trim() || null;
    try {
      await updateCollectionCard(token, binderId, copy.id, {
        acquisitionPrice: parsedAmount,
        acquiredAt: date,
      });
      if (transaction) {
        await updateTransaction(token, transaction.id, {
          collectionEntryId: copy.id,
          cardId: card.cardId,
          externalId: card.externalId ?? null,
          cardName: card.name,
          tcg: card.tcg,
          quantity: 1,
          amount: parsedAmount,
          currency,
          platform: normalizedSource,
          sourceUrl: normalizedUrl,
          notes: normalizedNotes,
          date,
        });
      } else {
        await createTransaction(token, {
          type: "purchase",
          collectionEntryId: copy.id,
          cardId: card.cardId,
          externalId: card.externalId,
          cardName: card.name,
          tcg: card.tcg,
          quantity: 1,
          amount: parsedAmount,
          currency,
          platform: normalizedSource ?? undefined,
          sourceUrl: normalizedUrl ?? undefined,
          notes: normalizedNotes ?? undefined,
          date,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: ["finance", "purchase", copy.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["finance", "transactions"],
      });
      setOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Purchase details could not be saved.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (!token || !binderId || !transaction || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await updateCollectionCard(token, binderId, copy.id, {
        acquisitionPrice: null,
        acquiredAt: null,
      });
      await deleteTransaction(token, transaction.id);
      await queryClient.invalidateQueries({
        queryKey: ["finance", "purchase", copy.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["finance", "transactions"],
      });
      setOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Purchase details could not be removed.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-lg border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={openEditor}
        disabled={transactionQuery.isLoading || !token || !binderId}
      >
        <ShoppingCart className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {hasPurchase ? "Purchased" : "Add purchase details"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {transactionQuery.isLoading ? (
              "Loading…"
            ) : summaryAmount !== undefined ? (
              <>
                {formatMoney(summaryAmount, { currency: summaryCurrency })}
                {summaryDate
                  ? ` · ${new Date(summaryDate).toLocaleDateString()}`
                  : ""}
                {transaction?.platform ? ` · ${transaction.platform}` : ""}
              </>
            ) : (
              "Cost, currency, date, and optional source"
            )}
          </span>
        </span>
        {transactionQuery.isLoading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </button>

      <Dialog open={open} onOpenChange={(next) => !isSaving && setOpen(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Purchase Details</DialogTitle>
            <DialogDescription>
              Record the acquisition cost for this copy of {card.name}. These
              details power Cost &amp; Returns in Prices.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor={`purchase-amount-${compact ? "mobile" : "desktop"}`}
                >
                  Total paid
                </Label>
                <Input
                  id={`purchase-amount-${compact ? "mobile" : "desktop"}`}
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger aria-label="Purchase currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((item) => (
                      <SelectItem key={item.isoCode} value={item.isoCode}>
                        {item.isoCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor={`purchase-date-${compact ? "mobile" : "desktop"}`}
              >
                Purchase date
              </Label>
              <Input
                id={`purchase-date-${compact ? "mobile" : "desktop"}`}
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={purchaseDate}
                onChange={(event) => setPurchaseDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor={`purchase-source-${compact ? "mobile" : "desktop"}`}
              >
                Source{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id={`purchase-source-${compact ? "mobile" : "desktop"}`}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Local card shop, eBay, trade…"
              />
            </div>

            <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
              <div>
                <p className="text-sm font-medium">Optional reference</p>
                <p className="text-xs text-muted-foreground">
                  Supporting links stay secondary to the purchase record.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor={`purchase-url-${compact ? "mobile" : "desktop"}`}
                >
                  Receipt or listing link
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`purchase-url-${compact ? "mobile" : "desktop"}`}
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="https://…"
                    aria-invalid={!sourceUrlIsValid}
                  />
                  {sourceUrlIsValid && sourceUrl.trim() ? (
                    <Button variant="outline" size="icon" asChild>
                      <a
                        href={sourceUrl.trim()}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open purchase source"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </a>
                    </Button>
                  ) : null}
                </div>
                {!sourceUrlIsValid ? (
                  <p className="text-xs text-destructive" role="alert">
                    Enter a complete http or https link.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor={`purchase-notes-${compact ? "mobile" : "desktop"}`}
                >
                  Purchase notes
                </Label>
                <Textarea
                  id={`purchase-notes-${compact ? "mobile" : "desktop"}`}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder="Taxes, shipping, bundle details…"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Total paid should include any tax, shipping, or marketplace costs
              you want included in the cost basis.
            </p>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {transaction ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => void remove()}
                disabled={isSaving}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                Remove purchase
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void save()}
                disabled={!canSave}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
