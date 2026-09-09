"use client";

import { useEffect, useMemo, useState } from "react";
import {
  calculateGrading,
  blankGradingOutcomes,
  emptyGradingCosts,
  gradingCalculationInputSchema,
  gradingSnapshotSchema,
  gradingExpenseSchema,
  gradingSearchResultSchema,
  type GradingSearchResult,
  type GradingExpense,
  type GradingCosts,
  type GradingOutcome,
  type GradingSnapshot,
} from "@tcg/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_BASE_URL } from "@/lib/api/base-url";
import { useAuthStore } from "@/stores/auth";

const costLabels: Record<keyof GradingCosts, string> = {
  grading: "Grading fee",
  shipping: "Round-trip shipping",
  insurance: "Insurance",
  upcharge: "Possible upcharge",
  sellingFeePercent: "Graded selling fee (%)",
  sellingFixed: "Graded fixed selling cost",
  rawSellingFeePercent: "Raw selling fee (%)",
  rawSellingFixed: "Raw fixed selling cost",
};
const initialRows = blankGradingOutcomes;
const verdicts = {
  grade: "Worth grading under these assumptions",
  keep: "Keep it raw under these assumptions",
  borderline: "Borderline — close to break-even",
  insufficient: "More data needed for an expected-value verdict",
};
const draftKey = "tcger.grading-workspace.v1";

export function GradingWorkspace() {
  const token = useAuthStore((s) => s.token);
  const [matches, setMatches] = useState<GradingSearchResult["cards"]>([]);
  const [expenses, setExpenses] = useState<GradingExpense[]>([]);
  const [serviceTier, setServiceTier] = useState("");
  const [byGrader, setByGrader] = useState<Record<string, GradingOutcome[]>>(
    {},
  );
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [language, setLanguage] = useState("english");
  const [grader, setGrader] = useState("PSA");
  const [currency, setCurrency] = useState("USD");
  const [raw, setRaw] = useState("");
  const [costs, setCosts] = useState<GradingCosts>({ ...emptyGradingCosts });
  const [rows, setRows] = useState<GradingOutcome[]>(initialRows("PSA"));
  const [snapshot, setSnapshot] = useState<GradingSnapshot | null>(null);
  const [interpolate, setInterpolate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    try {
      const records = JSON.parse(
        localStorage.getItem(`${draftKey}.expenses`) ?? "[]",
      );
      if (Array.isArray(records))
        setExpenses(
          records.flatMap((record) => {
            const parsed = gradingExpenseSchema.safeParse(record);
            return parsed.success ? [parsed.data] : [];
          }),
        );
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (!saved) return;
      const parsed = gradingCalculationInputSchema.safeParse(saved);
      if (!parsed.success) return;
      if (typeof saved.serviceTier === "string")
        setServiceTier(saved.serviceTier);
      const market = gradingSnapshotSchema.safeParse(saved.snapshot);
      if (market.success) setSnapshot(market.data);
      setCosts(parsed.data.costs);
      setRows(parsed.data.outcomes);
      setRaw(String(parsed.data.rawValue));
      setInterpolate(parsed.data.interpolate);
      if (typeof saved.name === "string") setName(saved.name);
      if (typeof saved.grader === "string") setGrader(saved.grader);
      if (["USD", "CAD", "EUR", "GBP"].includes(saved.currency))
        setCurrency(saved.currency);
    } catch {
      /* An unavailable or older draft does not prevent manual calculation. */
    }
  }, []);
  const parsed = useMemo(
    () =>
      gradingCalculationInputSchema.safeParse({
        rawValue: raw.trim() === "" ? undefined : Number(raw),
        costs,
        outcomes: rows,
        interpolate,
      }),
    [raw, costs, rows, interpolate],
  );
  const result = parsed.success ? calculateGrading(parsed.data) : null;
  const money = (value: number | null | undefined) =>
    value == null
      ? "Unavailable"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency,
        }).format(value);
  const chooseGrader = (value: string) => {
    setGrader(value);
    setByGrader((current) => ({ ...current, [grader]: rows }));
    setRows(
      byGrader[value] ??
        snapshot?.graders.find((g) => g.grader === value)?.outcomes ??
        initialRows(value),
    );
  };
  const editRow = (key: string, field: "price" | "population", value: string) =>
    setRows((current) =>
      current.map((row) =>
        row.key !== key
          ? row
          : {
              ...row,
              [field]: value === "" ? undefined : Number(value),
              ...(field === "price"
                ? { source: "manual", confidence: undefined }
                : {}),
            },
      ),
    );
  async function search() {
    if (!token || token.startsWith("demo-token")) {
      setMessage(
        "Connect and sign in to search market data. Manual calculations work offline.",
      );
      return;
    }
    setBusy(true);
    setMatches([]);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE_URL}/grading/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ search: name, language }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.message ?? "Card search failed");
      const found = gradingSearchResultSchema.parse(payload).cards;
      setMatches(found);
      if (!found.length)
        setMessage(
          "No matching cards. Try a different name or enter manual estimates.",
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Card search failed");
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    if (!token || token.startsWith("demo-token")) {
      setMessage(
        "Connect and sign in to load market data. Manual calculations work offline.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE_URL}/grading/snapshot`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tcgPlayerId: productId, language }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.message ?? "Could not load grading data");
      const loaded = gradingSnapshotSchema.parse(payload);
      setSnapshot(loaded);
      setName(`${loaded.name} · ${loaded.setName} · ${loaded.collectorNumber}`);
      if (currency !== "USD") setCosts({ ...emptyGradingCosts });
      setCurrency("USD");
      setRaw("");
      setByGrader({});
      setRows(
        loaded.graders.find((g) => g.grader === grader)?.outcomes ??
          initialRows(grader),
      );
      setMessage(
        "Market data loaded in USD. Select the matching raw printing and condition, and review your USD costs.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load data",
      );
    } finally {
      setBusy(false);
    }
  }
  function save() {
    if (!parsed.success) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          ...parsed.data,
          name,
          grader,
          currency,
          serviceTier,
          snapshot,
        }),
      );
      setMessage(
        "Scenario saved on this device. It does not change collection cost basis.",
      );
    } catch {
      setMessage("Could not save this scenario on this device.");
    }
  }
  function writeExpenses(records: GradingExpense[]) {
    try {
      localStorage.setItem(`${draftKey}.expenses`, JSON.stringify(records));
      setExpenses(records);
      setMessage("Expense records saved on this device.");
    } catch {
      setMessage("Could not save expense records.");
    }
  }
  function recordExpense() {
    const expense = gradingExpenseSchema.safeParse({
      id:
        globalThis.crypto?.randomUUID?.() ??
        `grading-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      cardName: name,
      grader,
      serviceTier,
      currency,
      paidAt: new Date().toISOString(),
      grading: costs.grading,
      shipping: costs.shipping,
      insurance: costs.insurance,
      upcharge: costs.upcharge,
    });
    if (expense.success && result && result.totalCost > 0)
      writeExpenses([expense.data, ...expenses]);
  }
  return (
    <div className="space-y-5" data-testid="feature.pricing.gradingWorkspace">
      <Card>
        <CardHeader>
          <CardTitle>Grading planner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            Compare selling raw with graded outcomes. Manual estimates work for
            any game. Live lookup covers Pokémon.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Card / scenario
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Pokémon TCGplayer product ID
              <Input
                value={productId}
                inputMode="numeric"
                onChange={(e) => setProductId(e.target.value)}
              />
            </label>
            <label>
              Card language
              <select
                className="block w-full rounded border bg-background p-2 text-foreground"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="english">English</option>
                <option value="japanese">Japanese</option>
              </select>
            </label>
            <Button onClick={load} disabled={busy || !/^\d+$/.test(productId)}>
              {busy ? "Loading…" : "Load market data"}
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={search}
            disabled={busy || name.trim().length < 3}
          >
            Find Pokémon card by name
          </Button>
          {matches.map((match) => (
            <Button
              key={match.tcgPlayerId}
              className="block h-auto whitespace-normal text-left"
              variant="outline"
              onClick={() => {
                setProductId(match.tcgPlayerId);
                setName(
                  `${match.name} · ${match.setName} · ${match.collectorNumber}`,
                );
                setMatches([]);
                setSnapshot(null);
                setByGrader({});
                setRows(initialRows(grader));
                setRaw("");
                setMessage(
                  "Card selected. Load market data to see its grade prices.",
                );
              }}
            >
              {match.name} · {match.setName} · {match.collectorNumber}
            </Button>
          ))}
          {message && <p role="status">{message}</p>}
          {snapshot && (
            <div className="text-sm text-muted-foreground">
              <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">
                {snapshot.source}
              </a>
              <p>
                Retrieved {snapshot.retrievedAt} · Source updated{" "}
                {snapshot.priceAsOf ?? "date unavailable"}
              </p>
              <p>
                Check the matched card and printing before using its prices.
                Sale counts are lifetime counts, not recent volume.
              </p>
              {snapshot.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          Grader
          <select
            aria-label="Grader"
            className="block w-full rounded border bg-background p-2 text-foreground"
            value={grader}
            onChange={(e) => chooseGrader(e.target.value)}
          >
            {[
              ...new Set([
                "PSA",
                "BGS",
                "CGC",
                "SGC",
                "ACE",
                "TAG",
                "HGA",
                "ARS",
                ...(snapshot?.graders.map((g) => g.grader) ?? []),
              ]),
            ].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label>
          Currency
          <select
            className="block w-full rounded border bg-background p-2 text-foreground"
            value={currency}
            disabled={snapshot != null}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {["USD", "CAD", "EUR", "GBP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Raw value ({currency})
          <Input
            type="number"
            min="0"
            step="0.01"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </label>
      </div>
      {!!snapshot?.rawQuotes.length && (
        <label className="block">
          Use a raw printing / condition price
          <select
            className="block w-full rounded border bg-background p-2 text-foreground"
            value=""
            onChange={(e) => {
              const q = snapshot.rawQuotes[Number(e.target.value)];
              if (q) setRaw(String(q.price));
            }}
          >
            <option value="">Select your exact printing and condition</option>
            {snapshot.rawQuotes.map((q, i) => (
              <option key={i} value={i}>
                {q.printing} · {q.condition} · {money(q.price)}
              </option>
            ))}
          </select>
        </label>
      )}
      <Tabs defaultValue="decision">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="decision">Decision</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="population">Population</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
        </TabsList>
        <TabsContent value="decision" className="space-y-4">
          <Card>
            <CardContent className="space-y-2 pt-5">
              <h2 className="font-semibold" data-testid="grading.verdict">
                {result
                  ? verdicts[result.verdict]
                  : "Enter a raw value and valid nonnegative amounts"}
              </h2>
              {result && (
                <>
                  <p>
                    Expected gain over selling raw:{" "}
                    <strong>{money(result.expectedGain)}</strong>
                  </p>
                  <p>
                    Expected graded value: {money(result.expectedValue)} ·
                    Submission cost: {money(result.totalCost)}
                  </p>
                  <p>
                    Lowest priced grade beating raw:{" "}
                    {result.breakEven ?? "None"}
                  </p>
                  <p>
                    Priced population: {result.pricedPopulation} /{" "}
                    {result.population}
                  </p>
                </>
              )}
              <p className="text-sm text-muted-foreground">
                These are scenarios, not a prediction of your copy’s grade.
                Submitted-card populations are selective. Inspect centering,
                corners, edges, and surfaces before choosing your assumptions.
              </p>
            </CardContent>
          </Card>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={interpolate}
              onChange={(e) => setInterpolate(e.target.checked)}
            />
            Estimate missing prices between known numeric grades
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="text-left">
                Prices and scenario weights. Leave unknown values blank; weight
                zero excludes an outcome from your scenario.
              </caption>
              <thead>
                <tr>
                  {[
                    "Grade",
                    "Value",
                    "Weight / population",
                    "Gain vs raw",
                    "Evidence",
                  ].map((h) => (
                    <th className="p-2 text-left" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const computed = result?.rows.find((r) => r.key === row.key);
                  return (
                    <tr key={row.key} className="border-t">
                      <td className="p-2">{row.label}</td>
                      <td className="p-2">
                        <Input
                          className="min-w-24"
                          aria-label={`${row.label} value`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.price ?? ""}
                          onChange={(e) =>
                            editRow(row.key, "price", e.target.value)
                          }
                        />
                        {computed?.estimated && (
                          <span>Estimated {money(computed.price)}</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          className="min-w-24"
                          aria-label={`${row.label} weight`}
                          type="number"
                          min="0"
                          step="1"
                          value={row.population ?? ""}
                          onChange={(e) =>
                            editRow(row.key, "population", e.target.value)
                          }
                        />
                      </td>
                      <td className="p-2">{money(computed?.gain)}</td>
                      <td className="p-2">
                        {row.source === "manual"
                          ? "Manual estimate"
                          : `${row.salesCount ?? "Unknown"} sales · ${row.confidence ?? "confidence unavailable"}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="costs" className="space-y-4">
          <label className="block">
            Service tier / quote reference
            <Input
              value={serviceTier}
              onChange={(e) => setServiceTier(e.target.value)}
              placeholder="Enter the service and quote date"
            />
          </label>
          <p>
            Enter your service quote; no current fee is assumed. Include all
            costs per card, in {currency}. Changing currency does not convert
            amounts.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(costLabels).map(([key, label]) => (
              <label key={key}>
                {label}
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costs[key as keyof GradingCosts]}
                  onChange={(e) =>
                    setCosts({ ...costs, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <p>
            Compare service tiers by changing the quote. Use a unique card/copy
            label above. Record paid submission costs below to keep a separate
            receipt.
          </p>
          <Button
            onClick={recordExpense}
            disabled={!name.trim() || !result || result.totalCost <= 0}
          >
            Record these submission costs as paid
          </Button>
          <p className="text-sm text-muted-foreground">
            Receipts are local records; they do not automatically change your
            collection’s acquisition cost or sale cost basis.
          </p>
        </TabsContent>
        <TabsContent value="population" className="space-y-3">
          <p>
            Population / scenario weights: {result?.population ?? 0}.{" "}
            {result && result.population < 50
              ? "Low data: fewer than 50 weighted outcomes."
              : ""}
          </p>
          <p>
            Provider gem rate:{" "}
            {snapshot?.graders.find((g) => g.grader === grader)?.gemRate != null
              ? `${(snapshot.graders.find((g) => g.grader === grader)!.gemRate! * 100).toFixed(1)}%`
              : "Unavailable"}
          </p>
          {result?.rows.map((row) => (
            <div key={row.key}>
              <span>
                {row.label}: {row.population ?? "unknown"} ·{" "}
                {row.probability == null
                  ? "unknown"
                  : `${(row.probability * 100).toFixed(1)}%`}
              </span>
              <progress
                className="block w-full"
                max={1}
                value={row.probability ?? 0}
              />
            </div>
          ))}
          <p>
            Edited weights are your scenario, not the provider’s population.
            Missing prices prevent an expected-value verdict until all weighted
            outcomes are priced.
          </p>
        </TabsContent>
        <TabsContent value="history" className="space-y-3">
          <p>
            Dated eBay graded sales averages, in USD. Editing a current estimate
            does not alter historical data.
          </p>
          {rows.some((row) => row.history.length) ? (
            rows
              .filter((row) => row.history.length)
              .map((row) => (
                <details key={row.key}>
                  <summary>
                    {row.label} · {row.history.length} observations
                  </summary>
                  {row.history.map((point) => (
                    <p key={point.date}>
                      {point.date} ·{" "}
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: "USD",
                      }).format(point.price)}
                    </p>
                  ))}
                </details>
              ))
          ) : (
            <p>
              No graded history available. Load market data to check coverage.
            </p>
          )}
        </TabsContent>
        <TabsContent value="receipts" className="space-y-3">
          <p>
            Actual submission expenses by card/copy. These local receipts are
            separate from collection cost basis.
          </p>
          {expenses.length === 0 && <p>No recorded grading expenses.</p>}
          {expenses.map((expense) => (
            <Card key={expense.id}>
              <CardContent className="space-y-2 pt-4">
                <p className="font-semibold">
                  {expense.cardName} · {expense.grader}
                </p>
                <p>
                  {expense.serviceTier} · {expense.paidAt.slice(0, 10)}
                </p>
                <p>
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: expense.currency,
                  }).format(
                    expense.grading +
                      expense.shipping +
                      expense.insurance +
                      expense.upcharge,
                  )}{" "}
                  total
                </p>
                <p>
                  Grading {expense.grading} · Shipping {expense.shipping} ·
                  Insurance {expense.insurance} · Upcharge {expense.upcharge} (
                  {expense.currency})
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    writeExpenses(expenses.filter((e) => e.id !== expense.id))
                  }
                >
                  Delete receipt
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
      <div className="flex gap-3">
        <Button onClick={save} disabled={!parsed.success}>
          Save scenario on this device
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setSnapshot(null);
            setByGrader({});
            setRows(initialRows(grader));
            setRaw("");
            setMessage("Manual mode. Enter prices in your selected currency.");
          }}
        >
          Clear market data
        </Button>
      </div>
    </div>
  );
}
