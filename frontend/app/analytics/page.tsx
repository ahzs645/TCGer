"use client";

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

/* ------------------------------------------------------------------ */
/*  Fake analytics data                                                */
/* ------------------------------------------------------------------ */

const MONTHLY_VALUES = [
  { month: "Oct", value: 1420 },
  { month: "Nov", value: 1580 },
  { month: "Dec", value: 1750 },
  { month: "Jan", value: 1690 },
  { month: "Feb", value: 1830 },
  { month: "Mar", value: 2045 },
];

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

const GAME_BREAKDOWN = [
  { game: "Yu-Gi-Oh!", cards: 38, value: 412.5, color: "#ef4444" },
  { game: "Magic: The Gathering", cards: 52, value: 890.25, color: "#8b5cf6" },
  { game: "Pokemon", cards: 45, value: 742.75, color: "#f59e0b" },
];

const RARITY_DIST = [
  { rarity: "Common / Uncommon", count: 32, pct: 24 },
  { rarity: "Rare", count: 28, pct: 21 },
  { rarity: "Ultra / Secret Rare", count: 41, pct: 30 },
  { rarity: "Mythic / Special Art", count: 34, pct: 25 },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  const totalValue = GAME_BREAKDOWN.reduce((s, g) => s + g.value, 0);
  const totalCards = GAME_BREAKDOWN.reduce((s, g) => s + g.cards, 0);
  const maxBarValue = Math.max(...MONTHLY_VALUES.map((m) => m.value));

  return (
    <AppShell data-oid="kxzjafg">
      <div className="space-y-6" data-oid="kv65:1o">
        <div data-oid="uc4::7z">
          <h1
            className="text-3xl font-heading font-semibold"
            data-oid="-fpec6g"
          >
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground" data-oid="17hs4e7">
            Collection value trends, price movers, and distribution breakdowns.
          </p>
        </div>

        {/* Summary stats */}
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4"
          data-oid="m.:8m4d"
        >
          <StatCard
            title="Total Value"
            value={`$${totalValue.toFixed(2)}`}
            icon={<DollarSign className="h-5 w-5" data-oid="cgn-ohi" />}
            sub="Across all games"
            data-oid="2_y21a7"
          />
          <StatCard
            title="Total Cards"
            value={totalCards}
            icon={<Layers className="h-5 w-5" data-oid="8f.vs53" />}
            sub="135 unique cards"
            data-oid="3qohwki"
          />
          <StatCard
            title="30-Day Change"
            value="+$215.00"
            icon={<TrendingUp className="h-5 w-5" data-oid="_z69w5q" />}
            sub="+11.7% this month"
            positive
            data-oid="mpfe2ie"
          />
          <StatCard
            title="Avg Card Value"
            value={`$${(totalValue / totalCards).toFixed(2)}`}
            icon={<BarChart3 className="h-5 w-5" data-oid="hivsxp7" />}
            sub="Per card average"
            data-oid="9-pje._"
          />
        </div>

        {/* Value over time chart (simple bar chart) */}
        <Card data-oid="l7bb1b-">
          <CardHeader data-oid="jrmhu9k">
            <CardTitle className="flex items-center gap-2" data-oid="04phdlg">
              <Calendar className="h-5 w-5" data-oid="kky.bjp" />
              Collection Value Over Time
            </CardTitle>
            <CardDescription data-oid="-zq9xy2">
              Monthly estimated total value (last 6 months).
            </CardDescription>
          </CardHeader>
          <CardContent data-oid="m04c0be">
            <div className="flex items-end gap-3 h-48" data-oid="c-l76s8">
              {MONTHLY_VALUES.map((m) => (
                <div
                  key={m.month}
                  className="flex flex-1 flex-col items-center gap-1"
                  data-oid="lip:rih"
                >
                  <span
                    className="text-xs text-muted-foreground font-medium"
                    data-oid="ktq:.nk"
                  >
                    ${m.value}
                  </span>
                  <div
                    className="w-full rounded-t bg-primary/80 transition-all"
                    style={{ height: `${(m.value / maxBarValue) * 100}%` }}
                    data-oid="i_zkzt6"
                  />

                  <span
                    className="text-xs text-muted-foreground"
                    data-oid="n-b899q"
                  >
                    {m.month}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2" data-oid="6oz.npy">
          {/* Top gainers */}
          <Card data-oid=".._ajkf">
            <CardHeader data-oid="sgg3k86">
              <CardTitle className="flex items-center gap-2" data-oid="20-.29f">
                <TrendingUp
                  className="h-5 w-5 text-green-500"
                  data-oid="temkgj8"
                />
                Top Gainers (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent data-oid="b5-l6bu">
              <div className="space-y-3" data-oid="puux_06">
                {TOP_GAINERS.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                    data-oid="h4i1jjz"
                  >
                    <div data-oid="xd2o5j2">
                      <p className="text-sm font-medium" data-oid="l_4u2pq">
                        {c.name}
                      </p>
                      <p
                        className="text-xs text-muted-foreground"
                        data-oid="6gt03ik"
                      >
                        {c.tcg}
                      </p>
                    </div>
                    <div className="text-right" data-oid="fljcdm1">
                      <p className="text-sm font-semibold" data-oid="n7s:jko">
                        ${c.price.toFixed(2)}
                      </p>
                      <p className="text-xs text-green-500" data-oid="ay0780w">
                        +{c.change}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top losers */}
          <Card data-oid="ndk2pu5">
            <CardHeader data-oid="2olaixu">
              <CardTitle className="flex items-center gap-2" data-oid="gdcqlxr">
                <TrendingDown
                  className="h-5 w-5 text-red-500"
                  data-oid="fo0.ei0"
                />
                Top Losers (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent data-oid="cbme:5d">
              <div className="space-y-3" data-oid="1dfwt-y">
                {TOP_LOSERS.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                    data-oid="br:cm7f"
                  >
                    <div data-oid="dyjzci-">
                      <p className="text-sm font-medium" data-oid="_o-sltb">
                        {c.name}
                      </p>
                      <p
                        className="text-xs text-muted-foreground"
                        data-oid="5jbn1r2"
                      >
                        {c.tcg}
                      </p>
                    </div>
                    <div className="text-right" data-oid="1jik6b:">
                      <p className="text-sm font-semibold" data-oid="_167p:6">
                        ${c.price.toFixed(2)}
                      </p>
                      <p className="text-xs text-red-500" data-oid="_nr8fx-">
                        {c.change}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2" data-oid="fzqa.-9">
          {/* Game breakdown */}
          <Card data-oid="6ilri-j">
            <CardHeader data-oid="-8u48d1">
              <CardTitle data-oid="ci9dxj6">Value by Game</CardTitle>
              <CardDescription data-oid="m3j9wdw">
                How your collection value is distributed across TCGs.
              </CardDescription>
            </CardHeader>
            <CardContent data-oid="y__x4-2">
              <div className="space-y-4" data-oid="2ss5pbk">
                {GAME_BREAKDOWN.map((g) => {
                  const pct = Math.round((g.value / totalValue) * 100);
                  return (
                    <div key={g.game} className="space-y-2" data-oid="ewm:6op">
                      <div
                        className="flex items-center justify-between text-sm"
                        data-oid="aw-uo6t"
                      >
                        <span className="font-medium" data-oid="94c.o.:">
                          {g.game}
                        </span>
                        <span
                          className="text-muted-foreground"
                          data-oid="zj48zo2"
                        >
                          ${g.value.toFixed(2)} ({pct}%)
                        </span>
                      </div>
                      <div
                        className="h-3 rounded-full bg-muted"
                        data-oid="c:1n8ap"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: g.color }}
                          data-oid=":vzh1bn"
                        />
                      </div>
                      <p
                        className="text-xs text-muted-foreground"
                        data-oid="2rtstj_"
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
          <Card data-oid="ef7p6w7">
            <CardHeader data-oid="bhtbl06">
              <CardTitle data-oid="cq73c26">Rarity Distribution</CardTitle>
              <CardDescription data-oid="9ywfr_r">
                Breakdown of your collection by rarity tier.
              </CardDescription>
            </CardHeader>
            <CardContent data-oid="louq.8b">
              <div className="space-y-4" data-oid="61h:2on">
                {RARITY_DIST.map((r) => (
                  <div key={r.rarity} className="space-y-2" data-oid="oeql4ep">
                    <div
                      className="flex items-center justify-between text-sm"
                      data-oid="jtngv2c"
                    >
                      <span className="font-medium" data-oid="73ft44s">
                        {r.rarity}
                      </span>
                      <span
                        className="text-muted-foreground"
                        data-oid="gpy5w50"
                      >
                        {r.count} cards ({r.pct}%)
                      </span>
                    </div>
                    <div
                      className="h-3 rounded-full bg-muted"
                      data-oid="kubyuji"
                    >
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${r.pct}%` }}
                        data-oid=":4n3i54"
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
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  sub: string;
  positive?: boolean;
}) {
  return (
    <Card data-oid="z:ozfvl">
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
        data-oid="6hjn4ud"
      >
        <CardTitle
          className="text-xs md:text-sm font-medium text-muted-foreground"
          data-oid="zh0hg-_"
        >
          {title}
        </CardTitle>
        <span className="text-muted-foreground" data-oid="3n708sm">
          {icon}
        </span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="amjxd8k">
        <div
          className={`text-xl md:text-3xl font-semibold tracking-tight ${positive ? "text-green-500" : ""}`}
          data-oid="iyv.xjc"
        >
          {value}
        </div>
        <p
          className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground"
          data-oid="p8ihgxg"
        >
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}
