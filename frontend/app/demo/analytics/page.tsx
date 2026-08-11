"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Layers,
  Calendar,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useDemoCollectionTotals,
  useDemoGameBreakdown,
  useDemoRarityBreakdown,
} from "@/stores/demo-store";

/* ------------------------------------------------------------------ */
/*  Fake analytics data                                                */
/* ------------------------------------------------------------------ */

/**
 * Shape of the canned history, expressed as a multiple of the live collection
 * value rather than as absolute dollars. Anchoring it this way keeps the
 * six-month trend pointing at the real headline number — with fixed dollar
 * values, a seed worth $1430 after a canned $1830 February would tell the
 * visitor their collection just fell 22%.
 */
const MONTHLY_SHAPE = [
  { month: "Oct", factor: 0.78 },
  { month: "Nov", factor: 0.84 },
  { month: "Dec", factor: 0.91 },
  { month: "Jan", factor: 0.88 },
  { month: "Feb", factor: 0.95 },
];

const CURRENT_MONTH = "Mar";

const TOP_GAINERS = [
  { name: "Charizard ex", tcg: "Pokemon", change: +18.5, price: 85.0 },
  {
    name: "Ragavan, Nimble Pilferer",
    tcg: "Magic",
    change: +12.3,
    price: 68.4,
  },
  { name: "Pot of Prosperity", tcg: "Yu-Gi-Oh!", change: +8.7, price: 22.5 },
  { name: "Umbreon ex", tcg: "Pokemon", change: +6.2, price: 42.0 },
  { name: "Wrenn and Six", tcg: "Magic", change: +5.1, price: 55.0 },
];

const TOP_LOSERS = [
  { name: "Fury", tcg: "Magic", change: -15.2, price: 12.0 },
  { name: "Grief", tcg: "Magic", change: -11.8, price: 8.5 },
  { name: "Mewtwo VSTAR", tcg: "Pokemon", change: -7.3, price: 7.5 },
  { name: "Pikachu VMAX", tcg: "Pokemon", change: -4.1, price: 24.5 },
  { name: "Mirror Force", tcg: "Yu-Gi-Oh!", change: -3.5, price: 4.0 },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  // The demo store is persisted, so its totals only agree with the markup the
  // server rendered once we are mounted on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { totalCards, uniqueCards, totalValue } = useDemoCollectionTotals();

  const monthlyHistory = MONTHLY_SHAPE.map((m) => ({
    month: m.month,
    value: Math.round(totalValue * m.factor * 100) / 100,
  }));
  const monthlyValues = mounted
    ? [...monthlyHistory, { month: CURRENT_MONTH, value: totalValue }]
    : monthlyHistory;
  const maxBarValue = Math.max(1, ...monthlyValues.map((m) => m.value));
  const latestChartValue = monthlyValues[monthlyValues.length - 1].value;

  const previousMonth = monthlyHistory[monthlyHistory.length - 1];
  const monthChange = totalValue - previousMonth.value;
  const monthChangePct = previousMonth.value
    ? (monthChange / previousMonth.value) * 100
    : 0;
  const avgCardValue = totalCards > 0 ? totalValue / totalCards : 0;

  // Both breakdowns are aggregated from the same binders as the headline
  // totals, so their counts sum back to totalCards instead of contradicting it.
  const gameBreakdown = useDemoGameBreakdown();
  const rarityBreakdown = useDemoRarityBreakdown();
  const gameBreakdownValue = gameBreakdown.reduce((s, g) => s + g.value, 0);

  return (
    <AppShell data-oid="0x:212q">
      <div className="space-y-6" data-oid="08a-o4q">
        <div data-oid="nbxx_6e">
          <h1
            className="text-3xl font-heading font-semibold"
            data-oid="fo252w_"
          >
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground" data-oid="3fzlh2s">
            Collection value trends, price movers, and distribution breakdowns.
          </p>
        </div>

        {/* Summary stats */}
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4"
          data-oid="ma5.n2j"
        >
          <StatCard
            title="Total Value"
            value={mounted ? `$${totalValue.toFixed(2)}` : "—"}
            icon={<DollarSign className="h-5 w-5" data-oid="mt89jh7" />}
            sub="Across all games"
            data-oid="mun8pi5"
          />
          <StatCard
            title="Total Cards"
            value={mounted ? totalCards.toLocaleString() : "—"}
            icon={<Layers className="h-5 w-5" data-oid="brh-qc." />}
            sub={
              mounted
                ? `${uniqueCards.toLocaleString()} unique cards`
                : "Across your binders"
            }
            data-oid="yip_-tb"
          />
          <StatCard
            title="30-Day Change"
            value={
              mounted
                ? `${monthChange >= 0 ? "+" : "-"}$${Math.abs(monthChange).toFixed(2)}`
                : "—"
            }
            icon={
              mounted && monthChange < 0 ? (
                <TrendingDown className="h-5 w-5" />
              ) : (
                <TrendingUp className="h-5 w-5" data-oid="ywyuj8w" />
              )
            }
            sub={
              mounted
                ? `${monthChangePct >= 0 ? "+" : ""}${monthChangePct.toFixed(1)}% since ${previousMonth.month}`
                : "Versus last month"
            }
            positive={mounted && monthChange >= 0}
            negative={mounted && monthChange < 0}
            data-oid="m4lulu9"
          />
          <StatCard
            title="Avg Card Value"
            value={mounted ? `$${avgCardValue.toFixed(2)}` : "—"}
            icon={<BarChart3 className="h-5 w-5" data-oid="4mjb6dx" />}
            sub="Per card average"
            data-oid="_cm1w::"
          />
        </div>

        {/* Value over time chart (simple bar chart) */}
        <Card data-oid="7xg-3d7">
          <CardHeader data-oid="asjomy6">
            <CardTitle className="flex items-center gap-2" data-oid="-_xht46">
              <Calendar className="h-5 w-5" data-oid="onmqbv2" />
              Collection Value Over Time
            </CardTitle>
            <CardDescription data-oid="846x8c6">
              Monthly estimated total value (last 6 months).
            </CardDescription>
          </CardHeader>
          <CardContent data-oid="pu8f.fm">
            <div
              className="flex items-end gap-3 h-48"
              role="img"
              aria-label={`Collection value over the last ${monthlyValues.length} months, currently $${latestChartValue.toFixed(2)}`}
              data-oid="rtts-rv"
            >
              {monthlyValues.map((m) => (
                <div
                  key={m.month}
                  className="flex h-full flex-1 flex-col items-center gap-1"
                  title={`${m.month}: $${m.value.toFixed(2)}`}
                  data-oid="4f:xh5c"
                >
                  <span
                    className="text-xs text-muted-foreground font-medium"
                    data-oid="geq.yah"
                  >
                    ${Math.round(m.value)}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-primary/80 transition-all"
                      style={{
                        height: `${Math.max(2, (m.value / maxBarValue) * 100)}%`,
                      }}
                      data-oid="yypyl_v"
                    />
                  </div>

                  <span
                    className="text-xs text-muted-foreground"
                    data-oid="tzif5.3"
                  >
                    {m.month}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2" data-oid="ppdlqdg">
          {/* Top gainers */}
          <Card data-oid="zxxf544">
            <CardHeader data-oid="5hb3eul">
              <CardTitle className="flex items-center gap-2" data-oid="y6m2quf">
                <TrendingUp
                  className="h-5 w-5 text-green-500"
                  data-oid="emoc:pw"
                />
                Top Gainers (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent data-oid="qs437em">
              <div className="space-y-3" data-oid="0gy2cqp">
                {TOP_GAINERS.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                    data-oid="u.n.w_4"
                  >
                    <div data-oid="2mr23pz">
                      <p className="text-sm font-medium" data-oid="wrdj51s">
                        {c.name}
                      </p>
                      <p
                        className="text-xs text-muted-foreground"
                        data-oid="p6h6e88"
                      >
                        {c.tcg}
                      </p>
                    </div>
                    <div className="text-right" data-oid="xis4-8q">
                      <p className="text-sm font-semibold" data-oid="cjy.n7r">
                        ${c.price.toFixed(2)}
                      </p>
                      <p className="text-xs text-green-500" data-oid="-o2pfrm">
                        +{c.change}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top losers */}
          <Card data-oid="fr1a76u">
            <CardHeader data-oid="m2d4dms">
              <CardTitle className="flex items-center gap-2" data-oid="74c8ysk">
                <TrendingDown
                  className="h-5 w-5 text-red-500"
                  data-oid="zqmovgv"
                />
                Top Losers (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent data-oid="t0p.9ke">
              <div className="space-y-3" data-oid="-3zv_v6">
                {TOP_LOSERS.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                    data-oid="se30vtg"
                  >
                    <div data-oid="lhrx72y">
                      <p className="text-sm font-medium" data-oid=":jmadcg">
                        {c.name}
                      </p>
                      <p
                        className="text-xs text-muted-foreground"
                        data-oid="w09guh6"
                      >
                        {c.tcg}
                      </p>
                    </div>
                    <div className="text-right" data-oid="hz2:zrf">
                      <p className="text-sm font-semibold" data-oid="p5f_:mv">
                        ${c.price.toFixed(2)}
                      </p>
                      <p className="text-xs text-red-500" data-oid="sx86n2d">
                        {c.change}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2" data-oid="ont8-nn">
          {/* Game breakdown */}
          <Card data-oid="d.gyvc1">
            <CardHeader data-oid="k_8uh7b">
              <CardTitle data-oid="c.ogied">Value by Game</CardTitle>
              <CardDescription data-oid="ysekv_u">
                How your collection value is distributed across TCGs.
              </CardDescription>
            </CardHeader>
            <CardContent data-oid="fpy-5h8">
              <div className="space-y-4" data-oid="al90b:i">
                {gameBreakdown.map((g) => {
                  const pct = Math.round((g.value / gameBreakdownValue) * 100);
                  return (
                    <div key={g.game} className="space-y-2" data-oid="od0_lel">
                      <div
                        className="flex items-center justify-between text-sm"
                        data-oid="k-wdwyw"
                      >
                        <span className="font-medium" data-oid="1xp6iqd">
                          {g.game}
                        </span>
                        <span
                          className="text-muted-foreground"
                          data-oid="xx-9yap"
                        >
                          ${g.value.toFixed(2)} ({pct}%)
                        </span>
                      </div>
                      <div
                        className="h-3 rounded-full bg-muted"
                        data-oid="sr_3pdu"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: g.color }}
                          data-oid="lwy7tvu"
                        />
                      </div>
                      <p
                        className="text-xs text-muted-foreground"
                        data-oid="x.:s0zw"
                      >
                        {g.cards} cards
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Rarity distribution */}
          <Card data-oid="xfrbzdn">
            <CardHeader data-oid="07yi2fs">
              <CardTitle data-oid="nuf6uny">Rarity Distribution</CardTitle>
              <CardDescription data-oid="f44.:di">
                Breakdown of your collection by rarity tier.
              </CardDescription>
            </CardHeader>
            <CardContent data-oid="uani25c">
              <div className="space-y-4" data-oid="sbbkp7m">
                {rarityBreakdown.map((r) => (
                  <div key={r.rarity} className="space-y-2" data-oid="_4mtrj5">
                    <div
                      className="flex items-center justify-between text-sm"
                      data-oid="7hc98jc"
                    >
                      <span className="font-medium" data-oid="39op6-h">
                        {r.rarity}
                      </span>
                      <span
                        className="text-muted-foreground"
                        data-oid="oijl7bf"
                      >
                        {r.count} cards ({r.pct}%)
                      </span>
                    </div>
                    <div
                      className="h-3 rounded-full bg-muted"
                      data-oid="pikqlg5"
                    >
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${r.pct}%` }}
                        data-oid="06ojnpe"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({
  title,
  value,
  icon,
  sub,
  positive,
  negative,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  sub: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <Card data-oid="zg0ogug">
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
        data-oid="ozgi:i_"
      >
        <CardTitle
          className="text-xs md:text-sm font-medium text-muted-foreground"
          data-oid="5scknf8"
        >
          {title}
        </CardTitle>
        <span className="text-muted-foreground" data-oid="3lwpkf4">
          {icon}
        </span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid=":ko-:3o">
        <div
          className={`text-xl md:text-3xl font-semibold tracking-tight ${
            positive ? "text-green-500" : negative ? "text-red-500" : ""
          }`}
          data-oid="93dq5ol"
        >
          {value}
        </div>
        <p
          className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground"
          data-oid="hi55s4g"
        >
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}
