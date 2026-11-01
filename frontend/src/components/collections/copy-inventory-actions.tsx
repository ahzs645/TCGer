// @tcger-feature {"id":"inventory.sales","platform":"web","status":"implemented","modes":["server"],"requires":["authenticated-server","atomic-sales"]}
"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CollectionCard,
  CollectionCardCopy,
  InventorySaleInput,
} from "@tcg/api-types";
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
import { useAuthStore } from "@/stores/auth";
import { useServerFeatures } from "@/lib/api/health";
import { removeCollectionCopy } from "@/lib/api/collections";
import {
  pendingSales,
  submitDurableSale,
  SALE_DRAFT_CHANGED,
  type SaleDraft,
} from "@/lib/sales/durable-sale";
import { formatMoney } from "@/lib/format-money";
import {
  inferredSaleCost,
  originalCurrency,
  UNKNOWN_CURRENCY,
} from "@/lib/pricing/acquisition-currency";

export function CopyInventoryActions({
  card,
  copy,
  binderId,
}: {
  card: CollectionCard;
  copy: CollectionCardCopy | null;
  binderId?: string;
}) {
  const token = useAuthStore((state) => state.token);
  const features = useServerFeatures();
  const [action, setAction] = useState<"delete" | "sale" | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [fees, setFees] = useState("");
  const [remove, setRemove] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [frozen, setFrozen] = useState<InventorySaleInput | null>(null);
  const busy = useRef(false);
  const open = (next: "delete" | "sale") => {
    setError("");
    setAction(next);
    try {
      const draft =
        next === "sale"
          ? pendingSales().find((sale) => sale.input.copyIds.includes(copy!.id))
          : undefined;
      setFrozen(draft?.input ?? null);
      setAmount(draft ? String(draft.input.amount) : "");
      const original = originalCurrency(copy?.acquisitionCurrency);
      const saleCurrency =
        draft?.input.currency ??
        (original === UNKNOWN_CURRENCY ? "" : original);
      setCurrency(saleCurrency);
      const inferred = copy ? inferredSaleCost(copy, saleCurrency) : undefined;
      setCostBasis(
        draft
          ? draft.input.costBasis === undefined
            ? ""
            : String(draft.input.costBasis)
          : inferred === undefined
            ? ""
            : String(inferred),
      );
      setFees(draft?.input.fees === undefined ? "" : String(draft.input.fees));
      setRemove(draft?.input.removeFromInventory ?? true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Saved sales could not be loaded.",
      );
    }
  };
  if (!copy || !token || !binderId) return null;
  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (action === "delete")
        await removeCollectionCopy(token, binderId, copy.id);
      else {
        if (features.atomicSales !== true)
          throw new Error(
            "This server does not support atomic sales. Connect to an updated Convex server.",
          );
        const input: InventorySaleInput = frozen ?? {
          operationId: crypto.randomUUID(),
          collectionId: binderId,
          copyIds: [copy.id],
          amount: Number(amount),
          currency: currency.trim().toUpperCase(),
          removeFromInventory: remove,
          ...(costBasis.trim() ? { costBasis: Number(costBasis) } : {}),
          ...(fees.trim() ? { fees: Number(fees) } : {}),
        };
        if (
          !Number.isFinite(input.amount) ||
          input.amount <= 0 ||
          !/^[A-Z]{3}$/.test(input.currency) ||
          [input.costBasis, input.fees].some(
            (value) =>
              value !== undefined && (!Number.isFinite(value) || value < 0),
          )
        ) {
          throw new Error(
            "Enter a positive sale amount, a three-letter currency, and nonnegative costs.",
          );
        }
        setFrozen(input);
        await submitDurableSale(token, input);
      }
      setAction(null);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "This operation could not be confirmed.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => open("sale")}>
          Record sale of this copy
        </Button>
        <Button variant="outline" size="sm" onClick={() => open("delete")}>
          Delete this copy
        </Button>
      </div>
      <Dialog
        open={action !== null}
        onOpenChange={(value) => {
          if (!value && !pending) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "delete"
                ? "Delete this physical copy?"
                : frozen
                  ? "Recover this sale"
                  : "Sell this physical copy"}
            </DialogTitle>
            <DialogDescription>
              {card.name} · {copy.condition ?? "Condition not specified"}.{" "}
              {action === "delete"
                ? "Only this copy will be removed. Its sibling copies remain in the collection."
                : "The sale records this exact copy, its currency and any inventory removal together."}
            </DialogDescription>
          </DialogHeader>
          {action === "sale" && (
            <fieldset
              disabled={pending || Boolean(frozen)}
              className="space-y-3"
            >
              <Label className="block">
                Sale amount
                <Input
                  aria-label="Copy sale amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Label>
              <Label className="block">
                Currency
                <Input
                  aria-label="Copy sale currency"
                  maxLength={3}
                  placeholder="Choose currency"
                  value={currency}
                  onChange={(event) => {
                    setCurrency(event.target.value.toUpperCase());
                    setCostBasis("");
                  }}
                />
              </Label>
              <Label className="block">
                Cost basis in {currency} (optional)
                <Input
                  aria-label="Copy sale cost basis"
                  type="number"
                  min="0"
                  step="0.01"
                  value={costBasis}
                  onChange={(event) => setCostBasis(event.target.value)}
                />
              </Label>
              <Label className="block">
                Fees in {currency} (optional)
                <Input
                  aria-label="Copy sale fees"
                  type="number"
                  min="0"
                  step="0.01"
                  value={fees}
                  onChange={(event) => setFees(event.target.value)}
                />
              </Label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={remove}
                  onChange={(event) => setRemove(event.target.checked)}
                />
                Remove this copy from inventory
              </label>
            </fieldset>
          )}
          {action === "sale" &&
            copy.acquisitionPrice !== undefined &&
            originalCurrency(copy.acquisitionCurrency) === UNKNOWN_CURRENCY && (
              <p className="text-sm text-muted-foreground">
                The original purchase currency is unknown. Its numeric amount
                has not been assumed as this sale’s cost basis.
              </p>
            )}
          {action === "sale" && features.atomicSales !== true && (
            <p className="text-sm text-muted-foreground">
              Atomic sales require an updated Convex server. This server has not
              advertised that support.
            </p>
          )}
          {frozen && action === "sale" && (
            <p className="text-sm">
              The original request is saved. Retrying recovers its receipt and
              cannot record another sale.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setAction(null)}
            >
              Close
            </Button>
            <Button
              disabled={
                pending || (action === "sale" && features.atomicSales !== true)
              }
              onClick={() => void submit()}
            >
              {pending
                ? "Confirming…"
                : action === "delete"
                  ? "Delete this copy"
                  : frozen
                    ? "Recover sale"
                    : "Record sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Sales remain recoverable even when their sold copy no longer exists. */
export function PendingSalesRecovery() {
  const token = useAuthStore((state) => state.token);
  const features = useServerFeatures();
  const [drafts, setDrafts] = useState<SaleDraft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const load = () => {
      try {
        setDrafts(token ? pendingSales() : []);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Saved sales could not be loaded.",
        );
      }
    };
    load();
    window.addEventListener(SALE_DRAFT_CHANGED, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(SALE_DRAFT_CHANGED, load);
      window.removeEventListener("storage", load);
    };
  }, [token]);
  if (!drafts.length && !error) return null;
  const recover = async (draft: SaleDraft) => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await submitDurableSale(token, draft.input);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Recovery failed. Retry the saved sale.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label="Pending sale recovery"
    >
      <h2 className="font-semibold">Sales awaiting confirmation</h2>
      {drafts.map((draft) => (
        <div
          key={draft.input.operationId}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            {draft.input.copyIds.length}{" "}
            {draft.input.copyIds.length === 1 ? "copy" : "copies"} ·{" "}
            {formatMoney(draft.input.amount, {
              currency: draft.input.currency,
            })}
          </span>
          <Button
            variant="outline"
            disabled={busy || features.atomicSales !== true}
            onClick={() => void recover(draft)}
          >
            Recover original sale
          </Button>
        </div>
      ))}
      {features.atomicSales !== true && (
        <p className="text-sm">
          Connect to the updated Convex server that received these sales to
          recover their receipts.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
