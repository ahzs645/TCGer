"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  exchangeRateCacheKey,
  FALLBACK_CURRENCIES,
  getExchangeRate,
  getSupportedCurrencies,
} from "@/lib/currency/exchange-rates";
import { getTrackedCardPrices, getTransactions } from "@/lib/api/pricing";
import { formatMoney, formatMoneyDelta } from "@/lib/format-money";
import { getAppRoute } from "@/lib/app-routes";
import {
  buildPurchasePerformanceLots,
  convertPurchasePerformanceLots,
  purchasePriceItems,
} from "@/lib/pricing/purchase-performance";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { useModuleStore } from "@/stores/preferences";
import { useShallow } from "zustand/react/shallow";

const DISPLAY_CURRENCY_KEY = "tcger.prices.display-currency";

interface RateRequest {
  source: string;
  date?: string;
}

export function CostReturnsContent() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const { token, isAuthenticated } = useAuthStore();
  const { showPricing, priceSource } = useModuleStore(
    useShallow((state) => ({
      showPricing: state.showPricing,
      priceSource: state.priceSource,
    })),
  );
  const { collections, fetchCollections, hasFetched, isLoading, error } =
    useCollectionsStore(
      useShallow((state) => ({
        collections: state.collections,
        fetchCollections: state.fetchCollections,
        hasFetched: state.hasFetched,
        isLoading: state.isLoading,
        error: state.error,
      })),
    );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMounted(true);
      const stored = window.localStorage.getItem(DISPLAY_CURRENCY_KEY);
      if (stored && /^[A-Z]{3}$/.test(stored)) setDisplayCurrency(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (mounted)
      window.localStorage.setItem(DISPLAY_CURRENCY_KEY, displayCurrency);
  }, [displayCurrency, mounted]);
  useEffect(() => {
    if (token && isAuthenticated && !hasFetched && !isLoading) {
      void fetchCollections(token);
    }
  }, [fetchCollections, hasFetched, isAuthenticated, isLoading, token]);

  const transactionsQuery = useQuery({
    queryKey: ["finance", "transactions"],
    queryFn: () => getTransactions(token!),
    enabled: mounted && !!token && isAuthenticated,
    staleTime: 60_000,
  });
  const currenciesQuery = useQuery({
    queryKey: ["currencies", "supported"],
    queryFn: getSupportedCurrencies,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const currencies = useMemo(() => {
    const byCode = new Map(
      (currenciesQuery.data ?? FALLBACK_CURRENCIES).map((item) => [
        item.isoCode,
        item,
      ]),
    );
    if (!byCode.has(displayCurrency)) {
      byCode.set(displayCurrency, {
        isoCode: displayCurrency,
        name: displayCurrency,
      });
    }
    return Array.from(byCode.values()).sort((left, right) =>
      left.isoCode.localeCompare(right.isoCode),
    );
  }, [currenciesQuery.data, displayCurrency]);

  const priceItems = useMemo(
    () => purchasePriceItems(collections, transactionsQuery.data ?? []),
    [collections, transactionsQuery.data],
  );
  const trackedPricesQuery = useQuery({
    queryKey: ["prices", "cost-returns", priceSource, priceItems],
    queryFn: () => getTrackedCardPrices(token!, priceItems, false, priceSource),
    enabled:
      mounted &&
      !!token &&
      isAuthenticated &&
      showPricing &&
      priceItems.length > 0,
    staleTime: 12 * 60 * 60 * 1000,
  });
  const lots = useMemo(
    () =>
      buildPurchasePerformanceLots(
        collections,
        transactionsQuery.data ?? [],
        trackedPricesQuery.data?.prices ?? [],
      ),
    [collections, trackedPricesQuery.data?.prices, transactionsQuery.data],
  );

  const rateRequests = useMemo(() => {
    const byKey = new Map<string, RateRequest>();
    for (const lot of lots) {
      const paidDate = lot.purchasedAt?.slice(0, 10);
      if (lot.paidCurrency.toUpperCase() !== displayCurrency) {
        byKey.set(
          exchangeRateCacheKey(lot.paidCurrency, displayCurrency, paidDate),
          { source: lot.paidCurrency, date: paidDate },
        );
      }
      if (
        lot.currentValue !== undefined &&
        lot.currentCurrency.toUpperCase() !== displayCurrency
      ) {
        byKey.set(exchangeRateCacheKey(lot.currentCurrency, displayCurrency), {
          source: lot.currentCurrency,
        });
      }
    }
    return Array.from(byKey.entries());
  }, [displayCurrency, lots]);

  const ratesQuery = useQuery({
    queryKey: [
      "exchange-rates",
      displayCurrency,
      rateRequests.map(([key]) => key),
    ],
    queryFn: async () => {
      const rates = new Map<string, number>();
      const results = await Promise.allSettled(
        rateRequests.map(async ([key, request]) => {
          const quote = await getExchangeRate(
            request.source,
            displayCurrency,
            request.date,
          );
          return [key, quote.rate] as const;
        }),
      );
      for (const result of results) {
        if (result.status === "fulfilled") rates.set(...result.value);
      }
      return rates;
    },
    enabled: rateRequests.length > 0,
    staleTime: 12 * 60 * 60 * 1000,
  });

  const convertedLots = useMemo(
    () =>
      convertPurchasePerformanceLots(lots, (source, date) => {
        if (source.toUpperCase() === displayCurrency) return 1;
        return ratesQuery.data?.get(
          exchangeRateCacheKey(source, displayCurrency, date?.slice(0, 10)),
        );
      }).sort((left, right) => right.gain - left.gain),
    [displayCurrency, lots, ratesQuery.data],
  );
  const totalPaid = convertedLots.reduce(
    (sum, lot) => sum + lot.paidInDisplayCurrency,
    0,
  );
  const totalValue = convertedLots.reduce(
    (sum, lot) => sum + lot.valueInDisplayCurrency,
    0,
  );
  const totalGain = totalValue - totalPaid;
  const totalReturn = totalPaid > 0 ? (totalGain / totalPaid) * 100 : 0;
  const missingCount = lots.length - convertedLots.length;
  const loading =
    !mounted ||
    (isAuthenticated && (!hasFetched || transactionsQuery.isLoading)) ||
    trackedPricesQuery.isLoading ||
    ratesQuery.isLoading;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Button variant="ghost" size="sm" asChild className="-ml-3">
              <Link href={getAppRoute("/prices", pathname)}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                Price Tracker
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-heading font-semibold">
                Cost &amp; Returns
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Compare what each copy cost in its original currency with its
                current market value. Purchase costs use the exchange rate from
                the purchase date; current values use the latest reference rate.
              </p>
            </div>
          </div>
          <div className="w-44 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Display currency
            </label>
            <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
              <SelectTrigger aria-label="Display currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((currency) => (
                  <SelectItem key={currency.isoCode} value={currency.isoCode}>
                    {currency.isoCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          These figures are currency-normalized, not inflation-adjusted. A true
          CPI-adjusted view can be added later without putting inflation
          controls in the card editor.
        </div>

        {!mounted || loading ? (
          <Card>
            <CardContent className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Calculating purchase performance…
            </CardContent>
          </Card>
        ) : !isAuthenticated ? (
          <Card role="alert">
            <CardHeader>
              <CardTitle>Sign in required</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Sign in to compare your purchase costs with current prices.
            </CardContent>
          </Card>
        ) : !showPricing ? (
          <Card role="alert">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Pricing is hidden in your preferences. Enable it to calculate
              returns.
            </CardContent>
          </Card>
        ) : error || transactionsQuery.error ? (
          <Card role="alert">
            <CardContent className="p-6 text-sm text-destructive">
              {error ?? "Purchase transactions could not be loaded."}
            </CardContent>
          </Card>
        ) : lots.length === 0 ? (
          <Card>
            <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
              <WalletCards
                className="h-10 w-10 text-muted-foreground"
                aria-hidden
              />
              <div>
                <p className="font-medium">No purchase costs yet</p>
                <p className="text-sm text-muted-foreground">
                  Select a copy in Collections and add its purchase details.
                </p>
              </div>
              <Button asChild size="sm">
                <Link href={getAppRoute("/collections", pathname)}>
                  Open Collections
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard title="Total paid">
                {formatMoney(totalPaid, { currency: displayCurrency })}
              </SummaryCard>
              <SummaryCard title="Current value">
                {formatMoney(totalValue, { currency: displayCurrency })}
              </SummaryCard>
              <SummaryCard
                title="Return"
                tone={totalGain >= 0 ? "positive" : "negative"}
              >
                {formatMoneyDelta(totalGain, displayCurrency)}
              </SummaryCard>
              <SummaryCard
                title="Portfolio return"
                tone={totalReturn >= 0 ? "positive" : "negative"}
              >
                {totalReturn >= 0 ? "+" : ""}
                {totalReturn.toFixed(1)}%
              </SummaryCard>
            </div>

            {missingCount > 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                {missingCount} {missingCount === 1 ? "copy is" : "copies are"}{" "}
                omitted because a current price or exchange rate is unavailable.
              </p>
            ) : null}

            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {convertedLots.map((lot) => (
                    <div
                      key={lot.id}
                      className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/20"
                    >
                      {lot.imageUrl ? (
                        <Image
                          src={lot.imageUrl}
                          alt=""
                          width={44}
                          height={62}
                          className="h-[62px] w-11 shrink-0 rounded object-contain"
                        />
                      ) : (
                        <div className="h-[62px] w-11 shrink-0 rounded bg-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium">{lot.cardName}</p>
                          {lot.source ? (
                            <Badge variant="outline" className="font-normal">
                              {lot.source}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {lot.setName ?? "Unknown set"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Paid{" "}
                          {formatMoney(lot.paidAmount, {
                            currency: lot.paidCurrency,
                          })}
                          {lot.purchasedAt
                            ? ` · ${new Date(lot.purchasedAt).toLocaleDateString()}`
                            : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">
                          {formatMoney(lot.valueInDisplayCurrency, {
                            currency: displayCurrency,
                          })}
                        </p>
                        <p
                          className={`flex items-center justify-end gap-1 text-sm tabular-nums ${
                            lot.gain >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {lot.gain >= 0 ? (
                            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {formatMoneyDelta(lot.gain, displayCurrency)}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {lot.returnPercent >= 0 ? "+" : ""}
                          {lot.returnPercent.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function SummaryCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "positive" | "negative";
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={`text-2xl font-semibold tabular-nums ${
          tone === "positive"
            ? "text-green-600"
            : tone === "negative"
              ? "text-red-600"
              : ""
        }`}
      >
        {children}
      </CardContent>
    </Card>
  );
}
