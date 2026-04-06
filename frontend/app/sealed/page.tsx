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
    <AppShell data-oid="6qunjhi">
      <div className="space-y-6" data-oid="xofp:3p">
        <div className="flex items-center justify-between" data-oid="maw6qu:">
          <div data-oid="y.akese">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="r7qztxu"
            >
              Sealed Products
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="s.:cyq7">
              Track your sealed product investments and market values.
            </p>
          </div>
          <Button size="sm" disabled data-oid="y.wxjkr">
            <Plus className="mr-2 h-4 w-4" data-oid="3ekqyzv" />
            Add Product
          </Button>
        </div>

        {/* Summary */}
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4"
          data-oid="7.ra:te"
        >
          <Card data-oid="n8k7b4g">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="hcf34f3"
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="j9.6yt0"
              >
                Total Invested
              </CardTitle>
              <DollarSign
                className="h-5 w-5 text-muted-foreground"
                data-oid="d_j.1c5"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="9mubghe">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="vq98r7_"
              >
                ${totalInvested.toFixed(2)}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="wuewdh9"
              >
                {totalItems} sealed items
              </p>
            </CardContent>
          </Card>
          <Card data-oid="pqc_4x2">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="7yavg_r"
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="v1q77va"
              >
                Current Value
              </CardTitle>
              <TrendingUp
                className="h-5 w-5 text-muted-foreground"
                data-oid="v6qm6vu"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="iutr.hp">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="k7nzvni"
              >
                ${totalCurrent.toFixed(2)}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="fbsg0z0"
              >
                Market estimate
              </p>
            </CardContent>
          </Card>
          <Card data-oid="yx82y.x">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="o..e_he"
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="1:4eutt"
              >
                Total Profit
              </CardTitle>
              <Package
                className="h-5 w-5 text-muted-foreground"
                data-oid=":r:xhqz"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="y3nx-n0">
              <div
                className={`text-xl md:text-3xl font-semibold ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`}
                data-oid="jvaba5:"
              >
                {totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="o.t7wm1"
              >
                {totalProfit >= 0 ? "+" : ""}
                {((totalProfit / totalInvested) * 100).toFixed(1)}% ROI
              </p>
            </CardContent>
          </Card>
          <Card data-oid="13p8mi9">
            <CardHeader
              className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
              data-oid="lsmzgz6"
            >
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="8nao-zy"
              >
                Products
              </CardTitle>
              <Calendar
                className="h-5 w-5 text-muted-foreground"
                data-oid="xtvx.uw"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="z1vke_e">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="4wu2dsx"
              >
                {SEALED_PRODUCTS.length}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="u:9i3ek"
              >
                Unique products tracked
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Sort controls */}
        <div className="flex gap-2" data-oid="rga9ok2">
          {(["date", "value", "profit"] as const).map((s) => (
            <Button
              key={s}
              variant={sortBy === s ? "default" : "outline"}
              size="sm"
              onClick={() => setSortBy(s)}
              data-oid="07t.w._"
            >
              {s === "date" ? "Recent" : s === "value" ? "Value" : "Profit"}
            </Button>
          ))}
        </div>

        {/* Product list */}
        <div className="space-y-3" data-oid="-67xfn0">
          {sorted.map((p) => {
            const profit = (p.currentValue - p.purchasePrice) * p.quantity;
            const profitPct =
              ((p.currentValue - p.purchasePrice) / p.purchasePrice) * 100;
            return (
              <Card key={p.id} data-oid="bszay2j">
                <CardContent
                  className="flex items-center justify-between gap-4 p-4"
                  data-oid="kwxejz:"
                >
                  <div
                    className="flex items-center gap-3 min-w-0"
                    data-oid="z5hntal"
                  >
                    <div
                      className="hidden sm:flex h-10 w-10 items-center justify-center rounded-lg bg-muted"
                      data-oid="k763l7j"
                    >
                      <Package
                        className="h-5 w-5 text-muted-foreground"
                        data-oid="45aizc9"
                      />
                    </div>
                    <div className="min-w-0" data-oid="mf7g3id">
                      <p
                        className="text-sm font-semibold truncate"
                        data-oid="co_:y8_"
                      >
                        {p.name}
                      </p>
                      <div
                        className="flex items-center gap-2 mt-0.5"
                        data-oid="td23t8r"
                      >
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: TCG_COLORS[p.tcg] }}
                          data-oid="3z_2dgk"
                        >
                          {p.tcg}
                        </Badge>
                        <span
                          className="text-xs text-muted-foreground"
                          data-oid="af9qzc1"
                        >
                          {p.type}
                        </span>
                        <span
                          className="text-xs text-muted-foreground"
                          data-oid="wrw:0d-"
                        >
                          x{p.quantity}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0" data-oid="fuv4yt.">
                    <p className="text-sm font-semibold" data-oid="k23hiyd">
                      ${(p.currentValue * p.quantity).toFixed(2)}
                    </p>
                    <p
                      className={`text-xs ${profit >= 0 ? "text-green-500" : "text-red-500"}`}
                      data-oid="qr6cavf"
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
