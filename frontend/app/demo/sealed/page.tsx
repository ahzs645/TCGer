"use client";

import { useState } from "react";
import { Package, Plus, DollarSign, TrendingUp, Calendar } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/* ------------------------------------------------------------------ */
/*  Fake sealed products data                                           */
/* ------------------------------------------------------------------ */

interface SealedProduct {
  id: string;
  name: string;
  tcg: string;
  type: string;
  purchasePrice: number;
  currentValue: number;
  quantity: number;
  purchaseDate: string;
  set: string;
}

const SEALED_PRODUCTS: SealedProduct[] = [
  {
    id: "s1",
    name: "Paldea Evolved Booster Box",
    tcg: "Pokemon",
    type: "Booster Box",
    purchasePrice: 105.0,
    currentValue: 128.0,
    quantity: 2,
    purchaseDate: "2024-08-15",
    set: "Paldea Evolved",
  },
  {
    id: "s2",
    name: "Modern Horizons 2 Draft Box",
    tcg: "Magic",
    type: "Draft Booster Box",
    purchasePrice: 240.0,
    currentValue: 310.0,
    quantity: 1,
    purchaseDate: "2024-03-20",
    set: "Modern Horizons 2",
  },
  {
    id: "s3",
    name: "25th Anniversary Tin",
    tcg: "Yu-Gi-Oh!",
    type: "Tin",
    purchasePrice: 29.99,
    currentValue: 45.0,
    quantity: 4,
    purchaseDate: "2024-06-10",
    set: "25th Anniversary",
  },
  {
    id: "s4",
    name: "Pokemon 151 ETB",
    tcg: "Pokemon",
    type: "Elite Trainer Box",
    purchasePrice: 49.99,
    currentValue: 72.0,
    quantity: 3,
    purchaseDate: "2024-01-05",
    set: "Pokemon 151",
  },
  {
    id: "s5",
    name: "Battles of Legend Chapter 1",
    tcg: "Yu-Gi-Oh!",
    type: "Booster Box",
    purchasePrice: 70.0,
    currentValue: 65.0,
    quantity: 1,
    purchaseDate: "2024-09-12",
    set: "Battles of Legend",
  },
  {
    id: "s6",
    name: "Commander Masters Collector Box",
    tcg: "Magic",
    type: "Collector Booster Box",
    purchasePrice: 290.0,
    currentValue: 255.0,
    quantity: 1,
    purchaseDate: "2024-11-01",
    set: "Commander Masters",
  },
  {
    id: "s7",
    name: "Obsidian Flames Booster Bundle",
    tcg: "Pokemon",
    type: "Booster Bundle",
    purchasePrice: 32.0,
    currentValue: 38.0,
    quantity: 5,
    purchaseDate: "2024-07-22",
    set: "Obsidian Flames",
  },
  {
    id: "s8",
    name: "Maze of Millennia Booster Box",
    tcg: "Yu-Gi-Oh!",
    type: "Booster Box",
    purchasePrice: 75.0,
    currentValue: 82.0,
    quantity: 2,
    purchaseDate: "2024-04-18",
    set: "Maze of Millennia",
  },
  {
    id: "s9",
    name: "Lord of the Rings Set Booster Box",
    tcg: "Magic",
    type: "Set Booster Box",
    purchasePrice: 170.0,
    currentValue: 215.0,
    quantity: 1,
    purchaseDate: "2024-02-14",
    set: "Tales of Middle-earth",
  },
  {
    id: "s10",
    name: "Scarlet & Violet ETB",
    tcg: "Pokemon",
    type: "Elite Trainer Box",
    purchasePrice: 42.0,
    currentValue: 55.0,
    quantity: 2,
    purchaseDate: "2024-05-30",
    set: "Scarlet & Violet",
  },
];

const TCG_COLORS: Record<string, string> = {
  Pokemon: "#f59e0b",
  Magic: "#8b5cf6",
  "Yu-Gi-Oh!": "#ef4444",
};

export default function SealedPage() {
  const [sortBy, setSortBy] = useState<"date" | "value" | "profit">("date");

  const totalInvested = SEALED_PRODUCTS.reduce(
    (s, p) => s + p.purchasePrice * p.quantity,
    0,
  );
  const totalCurrent = SEALED_PRODUCTS.reduce(
    (s, p) => s + p.currentValue * p.quantity,
    0,
  );
  const totalProfit = totalCurrent - totalInvested;
  const totalItems = SEALED_PRODUCTS.reduce((s, p) => s + p.quantity, 0);

  const sorted = [...SEALED_PRODUCTS].sort((a, b) => {
    if (sortBy === "value")
      return b.currentValue * b.quantity - a.currentValue * a.quantity;
    if (sortBy === "profit")
      return (
        (b.currentValue - b.purchasePrice) * b.quantity -
        (a.currentValue - a.purchasePrice) * a.quantity
      );
    return (
      new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime()
    );
  });

  return (
    <AppShell data-oid="400i9:c">
      <div className="space-y-6" data-oid="46o67ox">
        <div className="flex items-center justify-between" data-oid="24af:t7">
          <div data-oid="eh-_rpf">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="ol_wf5d"
            >
              Sealed Products
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="k2:v5o8">
              Track your sealed product investments and market values.
            </p>
          </div>
          <Button size="sm" disabled data-oid="uffzlfv">
            <Plus className="mr-2 h-4 w-4" data-oid="zoob79u" />
            Add Product
          </Button>
        </div>

        {/* Summary */}
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4"
          data-oid="h-q6.ys"
        >
          <Card data-oid="pivfhe:">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="1ufbjn."
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid=".30r2r4"
              >
                Total Invested
              </CardTitle>
              <DollarSign
                className="h-5 w-5 text-muted-foreground"
                data-oid="t0gledu"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="9ylixo5">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="pjv6w1v"
              >
                ${totalInvested.toFixed(2)}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="o_zuq0a"
              >
                {totalItems} sealed items
              </p>
            </CardContent>
          </Card>
          <Card data-oid=":u4:pmt">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="8_xg1zk"
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="6bmx.33"
              >
                Current Value
              </CardTitle>
              <TrendingUp
                className="h-5 w-5 text-muted-foreground"
                data-oid="scd:f2m"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="zuh7mi4">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="ww_f30c"
              >
                ${totalCurrent.toFixed(2)}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="yy-h:30"
              >
                Market estimate
              </p>
            </CardContent>
          </Card>
          <Card data-oid="7.t5n1t">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="4l5j2p0"
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="lcrc8uy"
              >
                Total Profit
              </CardTitle>
              <Package
                className="h-5 w-5 text-muted-foreground"
                data-oid="os6g929"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="8q_qynx">
              <div
                className={`text-xl md:text-3xl font-semibold ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`}
                data-oid="pepqdf8"
              >
                {totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="ffkl02y"
              >
                {totalProfit >= 0 ? "+" : ""}
                {((totalProfit / totalInvested) * 100).toFixed(1)}% ROI
              </p>
            </CardContent>
          </Card>
          <Card data-oid="ggu-3gh">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="c9b46pb"
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="89v7fdn"
              >
                Products
              </CardTitle>
              <Calendar
                className="h-5 w-5 text-muted-foreground"
                data-oid="b65j79_"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="cw_.p_w">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="4jk.cty"
              >
                {SEALED_PRODUCTS.length}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="cp7_77_"
              >
                Unique products tracked
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Sort controls */}
        <div className="flex gap-2" data-oid="jwgb64b">
          {(["date", "value", "profit"] as const).map((s) => (
            <Button
              key={s}
              variant={sortBy === s ? "default" : "outline"}
              size="sm"
              onClick={() => setSortBy(s)}
              data-oid="afjovjg"
            >
              {s === "date" ? "Recent" : s === "value" ? "Value" : "Profit"}
            </Button>
          ))}
        </div>

        {/* Product list */}
        <div className="space-y-3" data-oid="mh7-dbr">
          {sorted.map((p) => {
            const profit = (p.currentValue - p.purchasePrice) * p.quantity;
            const profitPct =
              ((p.currentValue - p.purchasePrice) / p.purchasePrice) * 100;
            return (
              <Card key={p.id} data-oid="e05-m4k">
                <CardContent
                  className="flex items-center justify-between gap-4 p-4"
                  data-oid="u4uz5_l"
                >
                  <div
                    className="flex items-center gap-3 min-w-0"
                    data-oid="4ygfu2n"
                  >
                    <div
                      className="hidden sm:flex h-10 w-10 items-center justify-center rounded-lg bg-muted"
                      data-oid="hahae.d"
                    >
                      <Package
                        className="h-5 w-5 text-muted-foreground"
                        data-oid="w.i7jgj"
                      />
                    </div>
                    <div className="min-w-0" data-oid=":uqj999">
                      <p
                        className="text-sm font-semibold truncate"
                        data-oid="ziamz_:"
                      >
                        {p.name}
                      </p>
                      <div
                        className="flex items-center gap-2 mt-0.5"
                        data-oid="yzftm0_"
                      >
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: TCG_COLORS[p.tcg] }}
                          data-oid="8y7bxo:"
                        >
                          {p.tcg}
                        </Badge>
                        <span
                          className="text-xs text-muted-foreground"
                          data-oid=".f8d7oi"
                        >
                          {p.type}
                        </span>
                        <span
                          className="text-xs text-muted-foreground"
                          data-oid="a8xunk1"
                        >
                          x{p.quantity}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0" data-oid="cc8kecn">
                    <p className="text-sm font-semibold" data-oid="0wicg5e">
                      ${(p.currentValue * p.quantity).toFixed(2)}
                    </p>
                    <p
                      className={`text-xs ${profit >= 0 ? "text-green-500" : "text-red-500"}`}
                      data-oid="_hlp0de"
                    >
                      {profit >= 0 ? "+" : ""}${profit.toFixed(2)} (
                      {profitPct >= 0 ? "+" : ""}
                      {profitPct.toFixed(1)}%)
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
