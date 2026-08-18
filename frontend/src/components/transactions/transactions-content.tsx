"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  Plus,
  RefreshCw,
  Repeat2,
  Trash2,
} from "lucide-react";
import type {
  CreateTransactionInput,
  FinanceSummaryByCurrency,
  RealizedPerformance,
  TransactionResponse,
} from "@tcg/api-types";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import {
  createTransaction,
  deleteTransaction,
  getTransactions,
  getFinanceSummaryByCurrency,
  getRealizedPerformance,
} from "@/lib/api/pricing";
import { useAuthStore } from "@/stores/auth";

const TYPE_CONFIG = {
  purchase: {
    label: "Purchase",
    icon: ArrowDownLeft,
    className: "text-amber-600 bg-amber-500/10",
  },
  sale: {
    label: "Sale",
    icon: ArrowUpRight,
    className: "text-emerald-600 bg-emerald-500/10",
  },
  trade: {
    label: "Trade",
    icon: Repeat2,
    className: "text-blue-600 bg-blue-500/10",
  },
} as const;

function money(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function TransactionsContent() {
  const token = useAuthStore((state) => state.token);
  const [confirm, confirmDialog] = useConfirm();
  const [transactions, setTransactions] = useState<TransactionResponse[]>([]);
  const [summary, setSummary] = useState<FinanceSummaryByCurrency>({
    byCurrency: [],
    transactionCount: 0,
  });
  const [performance, setPerformance] = useState<RealizedPerformance | null>(null);
  const [performancePeriod, setPerformancePeriod] = useState<number | undefined>(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError("Sign in to view your transaction ledger.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextTransactions, nextSummary, nextPerformance] = await Promise.all([
        getTransactions(token),
        getFinanceSummaryByCurrency(token),
        getRealizedPerformance(token, performancePeriod),
      ]);
      setTransactions(nextTransactions);
      setSummary(nextSummary);
      setPerformance(nextPerformance);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load transactions.",
      );
    } finally {
      setLoading(false);
    }
  }, [performancePeriod, token]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const formatSummary = (key: "totalSpent" | "totalEarned" | "profitLoss") =>
    summary.byCurrency.length
      ? summary.byCurrency
          .map((totals) => money(totals[key], totals.currency))
          .join(" · ")
      : money(0);

  const remove = async (transaction: TransactionResponse) => {
    if (
      !token ||
      !(await confirm({
        title: "Delete this transaction?",
        description: "This ledger entry cannot be recovered.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteTransaction(token, transaction.id);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete transaction.",
      );
    }
  };

  return (
    <AppShell>
      {confirmDialog}
      <div className="space-y-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div>
            <h1 className="text-3xl font-heading font-semibold">
              Transactions
            </h1>
            <p className="text-sm text-muted-foreground">
              Track purchases, sales, and trade values in one financial ledger.
            </p>
          </div>
          <Button
            ref={createTriggerRef}
            className="shrink-0"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> Add transaction
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Transactions"
            value={String(summary.transactionCount)}
          />
          <Metric label="Total spent" value={formatSummary("totalSpent")} />
          <Metric label="Total earned" value={formatSummary("totalEarned")} />
          <Metric label="Net cash flow" value={formatSummary("profitLoss")} />
        </div>
        {performance ? (
          <PerformanceDashboard
            performance={performance}
            period={performancePeriod}
            onPeriodChange={setPerformancePeriod}
          />
        ) : null}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle asChild>
              <h2>Ledger</h2>
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />{" "}
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {error ? (
              <div
                className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
                role="alert"
              >
                <p>{error}</p>
                {token ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void load()}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            ) : loading ? (
              <div
                className="flex items-center justify-center py-16 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />{" "}
                Loading transactions…
              </div>
            ) : transactions.length ? (
              <div className="divide-y">
                {transactions.map((transaction) => {
                  const config =
                    TYPE_CONFIG[transaction.type as keyof typeof TYPE_CONFIG] ??
                    TYPE_CONFIG.trade;
                  const Icon = config.icon;
                  return (
                    <div
                      key={transaction.id}
                      className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <div
                        className={`hidden rounded-full p-2 sm:block ${config.className}`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <p className="truncate font-medium">
                            {transaction.cardName || config.label}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            ×{transaction.quantity}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground sm:truncate">
                          {new Date(transaction.date).toLocaleDateString()} ·{" "}
                          {[
                            transaction.tcg,
                            transaction.platform,
                            transaction.notes,
                          ]
                            .filter(Boolean)
                            .join(" · ") || config.label}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">
                            {transaction.type === "purchase"
                              ? "−"
                              : transaction.type === "sale"
                                ? "+"
                                : ""}
                            {money(transaction.amount, transaction.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {transaction.realizedProfit === undefined
                              ? config.label
                              : `${transaction.realizedProfit >= 0 ? "+" : "−"}${money(Math.abs(transaction.realizedProfit), transaction.currency)} realized`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${transaction.cardName || "transaction"}`}
                          onClick={() => void remove(transaction)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-16 text-center">
                <Repeat2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-medium">No transactions yet</p>
                <p className="text-sm text-muted-foreground">
                  Add a purchase, sale, or trade to begin your ledger.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <CreateTransactionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        returnFocusRef={createTriggerRef}
        onCreated={(transaction) =>
          setTransactions((current) =>
            [transaction, ...current].sort(
              (left, right) =>
                new Date(right.date).getTime() - new Date(left.date).getTime(),
            ),
          )
        }
        onRefresh={() => void load()}
      />
    </AppShell>
  );
}

function PerformanceDashboard({
  performance,
  period,
  onPeriodChange,
}: {
  performance: RealizedPerformance;
  period: number | undefined;
  onPeriodChange: (period: number | undefined) => void;
}) {
  const currencyText = (
    key: "revenue" | "netProceeds" | "realizedProfit" | "fees",
  ) =>
    performance.byCurrency.length
      ? performance.byCurrency
          .map((row) => money(row[key], row.currency))
          .join(" · ")
      : money(0);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Select
          value={period === undefined ? "all" : String(period)}
          onValueChange={(value) => onPeriodChange(value === "all" ? undefined : Number(value))}
        >
          <SelectTrigger className="w-44" aria-label="Performance period"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Sales revenue" value={currencyText("revenue")} />
        <Metric label="Net proceeds" value={currencyText("netProceeds")} />
        <Metric label="Realized profit" value={currencyText("realizedProfit")} />
        <Metric label="Fees" value={currencyText("fees")} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle asChild><h2>Realized P&amp;L</h2></CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {performance.byCurrency.length ? performance.byCurrency.map((row) => (
              <div key={row.currency} className="rounded-lg border p-3">
                <div className="flex justify-between font-medium">
                  <span>{row.currency}</span>
                  <span>{money(row.realizedProfit, row.currency)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.costedSaleCount} of {row.saleCount} sales have cost basis
                  {row.averageHoldingDays === undefined ? "" : ` · ${row.averageHoldingDays} day average hold`}
                </p>
              </div>
            )) : <p className="text-muted-foreground">Record a sale to see realized performance.</p>}
          </CardContent>
        </Card>
        <BreakdownCard title="By platform" rows={performance.byPlatform} />
        <BreakdownCard title="By game" rows={performance.byGame} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle asChild><h2>Inventory position</h2></CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Acquisition cost</p>
              <p className="text-xl font-semibold tabular-nums">{money(performance.inventoryCost, performance.inventoryCurrency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Market value</p>
              <p className="text-xl font-semibold tabular-nums">{money(performance.inventoryMarketValue, performance.inventoryCurrency)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle asChild><h2>Fastest sales</h2></CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {performance.fastestSales.length ? performance.fastestSales.map((sale) => (
              <div key={sale.id} className="flex justify-between gap-3">
                <span className="truncate">{sale.cardName || "Sale"}</span>
                <span className="shrink-0 tabular-nums">{sale.holdingDays} days</span>
              </div>
            )) : <p className="text-muted-foreground">Add acquisition dates to calculate holding time.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle asChild><h2>Best / worst returns</h2></CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ReturnRow label="Best" sale={performance.bestReturns[0]} />
            <ReturnRow label="Worst" sale={performance.worstReturns[0]} />
            {!performance.bestReturns.length ? <p className="text-muted-foreground">Add acquisition cost to sales to compare returns.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReturnRow({
  label,
  sale,
}: {
  label: string;
  sale: RealizedPerformance["bestReturns"][number] | undefined;
}) {
  if (!sale || sale.realizedProfit === undefined) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate"><span className="text-xs text-muted-foreground">{label}</span> · {sale.cardName || "Sale"}</span>
      <span className="shrink-0 font-medium tabular-nums">{money(sale.realizedProfit, sale.currency)}</span>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: RealizedPerformance["byPlatform"];
}) {
  return (
    <Card>
      <CardHeader><CardTitle asChild><h2>{title}</h2></CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.length ? rows.slice(0, 6).map((row) => (
          <div key={`${row.currency}-${row.key}`} className="flex items-center justify-between gap-3">
            <span className="truncate">{row.key} <span className="text-xs text-muted-foreground">({row.saleCount})</span></span>
            <span className="shrink-0 font-medium tabular-nums">{money(row.realizedProfit, row.currency)}</span>
          </div>
        )) : <p className="text-muted-foreground">No sales yet.</p>}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      </CardHeader>
      <CardContent>
        <p
          className={`break-words text-xl font-semibold tabular-nums sm:text-2xl ${valueClassName}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function CreateTransactionDialog({
  open,
  onOpenChange,
  onCreated,
  onRefresh,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (transaction: TransactionResponse) => void;
  onRefresh: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const token = useAuthStore((state) => state.token);
  const [form, setForm] = useState({
    type: "purchase" as "purchase" | "sale" | "trade",
    cardName: "",
    tcg: "pokemon",
    quantity: "1",
    amount: "",
    costBasis: "",
    fees: "",
    shippingCost: "",
    acquiredAt: "",
    currency: "USD",
    platform: "",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldPrefix = useId();
  const fieldId = (name: string) => `${fieldPrefix}-${name}`;
  const submit = async () => {
    if (!token) return;
    const amount = Number(form.amount);
    const quantity = Number(form.quantity);
    if (
      !form.amount.trim() ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !form.quantity.trim() ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      setError(
        "Enter an amount greater than zero and a whole-number quantity.",
      );
      return;
    }
    if (!/^[a-z]{3}$/i.test(form.currency.trim())) {
      setError("Enter a three-letter currency code such as USD or CAD.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: CreateTransactionInput = {
        type: form.type,
        cardName: form.cardName.trim() || undefined,
        tcg: form.tcg || undefined,
        quantity,
        amount,
        costBasis: form.costBasis.trim() ? Number(form.costBasis) : undefined,
        fees: form.fees.trim() ? Number(form.fees) : undefined,
        shippingCost: form.shippingCost.trim() ? Number(form.shippingCost) : undefined,
        acquiredAt: form.acquiredAt
          ? new Date(`${form.acquiredAt}T12:00:00`).toISOString()
          : undefined,
        currency: form.currency.trim().toUpperCase() || "USD",
        platform: form.platform.trim() || undefined,
        notes: form.notes.trim() || undefined,
        date: form.date
          ? new Date(`${form.date}T12:00:00`).toISOString()
          : undefined,
      };
      const created = await createTransaction(token, input);
      onCreated(created);
      onRefresh();
      onOpenChange(false);
      setForm((current) => ({
        ...current,
        cardName: "",
        quantity: "1",
        amount: "",
        costBasis: "",
        fees: "",
        shippingCost: "",
        acquiredAt: "",
        platform: "",
        notes: "",
      }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save transaction.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
          <DialogDescription>
            Record a purchase, sale, or trade value.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <Field id={fieldId("type")} label="Type">
              <Select
                value={form.type}
                onValueChange={(value) =>
                  setForm({ ...form, type: value as typeof form.type })
                }
              >
                <SelectTrigger id={fieldId("type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Purchase</SelectItem>
                  <SelectItem value="sale">Sale</SelectItem>
                  <SelectItem value="trade">Trade</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id={fieldId("game")} label="Game">
              <Select
                value={form.tcg}
                onValueChange={(tcg) => setForm({ ...form, tcg })}
              >
                <SelectTrigger id={fieldId("game")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pokemon">Pokémon</SelectItem>
                  <SelectItem value="magic">Magic</SelectItem>
                  <SelectItem value="yugioh">Yu-Gi-Oh!</SelectItem>
                  <SelectItem value="lorcana">Lorcana</SelectItem>
                  <SelectItem value="onepiece">One Piece</SelectItem>
                  <SelectItem value="dragonball">Dragon Ball</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              id={fieldId("card")}
              label="Card or item"
              className="sm:col-span-2"
            >
              <Input
                id={fieldId("card")}
                value={form.cardName}
                onChange={(event) =>
                  setForm({ ...form, cardName: event.target.value })
                }
                placeholder="e.g. Charizard ex"
              />
            </Field>
            <Field id={fieldId("quantity")} label="Quantity">
              <Input
                id={fieldId("quantity")}
                type="number"
                min="1"
                step="1"
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? fieldId("error") : undefined}
                value={form.quantity}
                onChange={(event) =>
                  setForm({ ...form, quantity: event.target.value })
                }
              />
            </Field>
            <Field id={fieldId("amount")} label="Amount">
              <Input
                id={fieldId("amount")}
                type="number"
                min="0.01"
                step="0.01"
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? fieldId("error") : undefined}
                value={form.amount}
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value })
                }
                placeholder="0.00"
              />
            </Field>
            {form.type === "sale" ? (
              <>
                <Field id={fieldId("costBasis")} label="Acquisition cost">
                  <Input
                    id={fieldId("costBasis")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.costBasis}
                    onChange={(event) => setForm({ ...form, costBasis: event.target.value })}
                    placeholder="Optional"
                  />
                </Field>
                <Field id={fieldId("fees")} label="Marketplace fees">
                  <Input
                    id={fieldId("fees")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.fees}
                    onChange={(event) => setForm({ ...form, fees: event.target.value })}
                    placeholder="0.00"
                  />
                </Field>
                <Field id={fieldId("shipping")} label="Shipping cost">
                  <Input
                    id={fieldId("shipping")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.shippingCost}
                    onChange={(event) => setForm({ ...form, shippingCost: event.target.value })}
                    placeholder="0.00"
                  />
                </Field>
                <Field id={fieldId("acquiredAt")} label="Acquired date">
                  <Input
                    id={fieldId("acquiredAt")}
                    type="date"
                    value={form.acquiredAt}
                    onChange={(event) => setForm({ ...form, acquiredAt: event.target.value })}
                  />
                </Field>
              </>
            ) : null}
            <Field id={fieldId("currency")} label="Currency">
              <Input
                id={fieldId("currency")}
                maxLength={3}
                minLength={3}
                required
                autoCapitalize="characters"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? fieldId("error") : undefined}
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value })
                }
              />
            </Field>
            <Field id={fieldId("date")} label="Date">
              <Input
                id={fieldId("date")}
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm({ ...form, date: event.target.value })
                }
              />
            </Field>
            <Field
              id={fieldId("platform")}
              label="Platform"
              className="sm:col-span-2"
            >
              <Input
                id={fieldId("platform")}
                value={form.platform}
                onChange={(event) =>
                  setForm({ ...form, platform: event.target.value })
                }
                placeholder="Local shop, eBay, Cardmarket…"
              />
            </Field>
            <Field
              id={fieldId("notes")}
              label="Notes"
              className="sm:col-span-2"
            >
              <Textarea
                id={fieldId("notes")}
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </Field>
          </div>
          {error ? (
            <p
              id={fieldId("error")}
              className="text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  className = "",
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
