"use client";

import { useState } from "react";
import { Search, ArrowUpDown } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/* ------------------------------------------------------------------ */
/*  Fake price data                                                     */
/* ------------------------------------------------------------------ */

interface PriceEntry {
  name: string;
  tcg: string;
  setName: string;
  rarity: string;
  price: number;
  change7d: number;
  change30d: number;
  owned: number;
}

const PRICE_DATA: PriceEntry[] = [
  {
    name: "Charizard ex",
    tcg: "Pokemon",
    setName: "Paldea Evolved",
    rarity: "Special Art Rare",
    price: 85.0,
    change7d: 3.2,
    change30d: 18.5,
    owned: 1,
  },
  {
    name: "Ragavan, Nimble Pilferer",
    tcg: "Magic",
    setName: "Modern Horizons 2",
    rarity: "Mythic Rare",
    price: 68.4,
    change7d: 1.5,
    change30d: 12.3,
    owned: 2,
  },
  {
    name: "Wrenn and Six",
    tcg: "Magic",
    setName: "Modern Horizons",
    rarity: "Mythic Rare",
    price: 55.0,
    change7d: -0.8,
    change30d: 5.1,
    owned: 1,
  },
  {
    name: "Chalice of the Void",
    tcg: "Magic",
    setName: "Modern Masters",
    rarity: "Rare",
    price: 45.0,
    change7d: 2.1,
    change30d: 3.7,
    owned: 2,
  },
  {
    name: "Umbreon ex",
    tcg: "Pokemon",
    setName: "Obsidian Flames",
    rarity: "Special Art Rare",
    price: 42.0,
    change7d: 1.8,
    change30d: 6.2,
    owned: 1,
  },
  {
    name: "Force of Negation",
    tcg: "Magic",
    setName: "Modern Horizons",
    rarity: "Rare",
    price: 42.5,
    change7d: -1.2,
    change30d: -2.4,
    owned: 1,
  },
  {
    name: "Exodia the Forbidden One",
    tcg: "Yu-Gi-Oh!",
    setName: "Legend of Blue Eyes",
    rarity: "Ultra Rare",
    price: 38.0,
    change7d: 0.5,
    change30d: 1.2,
    owned: 1,
  },
  {
    name: "Urza's Saga",
    tcg: "Magic",
    setName: "Modern Horizons 2",
    rarity: "Rare",
    price: 35.0,
    change7d: -2.3,
    change30d: -5.1,
    owned: 2,
  },
  {
    name: "Iono",
    tcg: "Pokemon",
    setName: "Paldea Evolved",
    rarity: "Special Art Rare",
    price: 32.0,
    change7d: 0.9,
    change30d: 2.8,
    owned: 3,
  },
  {
    name: "Solitude",
    tcg: "Magic",
    setName: "Modern Horizons 2",
    rarity: "Mythic Rare",
    price: 32.0,
    change7d: -1.5,
    change30d: -4.2,
    owned: 1,
  },
  {
    name: "Endurance",
    tcg: "Magic",
    setName: "Modern Horizons 2",
    rarity: "Mythic Rare",
    price: 26.0,
    change7d: 0.3,
    change30d: 1.1,
    owned: 1,
  },
  {
    name: "Blue-Eyes White Dragon",
    tcg: "Yu-Gi-Oh!",
    setName: "Starter Deck: Kaiba",
    rarity: "Ultra Rare",
    price: 24.99,
    change7d: -0.2,
    change30d: -1.5,
    owned: 2,
  },
  {
    name: "Pikachu VMAX",
    tcg: "Pokemon",
    setName: "Vivid Voltage",
    rarity: "VMAX",
    price: 24.5,
    change7d: -2.1,
    change30d: -4.1,
    owned: 1,
  },
  {
    name: "Pot of Prosperity",
    tcg: "Yu-Gi-Oh!",
    setName: "Blazing Vortex",
    rarity: "Secret Rare",
    price: 22.5,
    change7d: 1.3,
    change30d: 8.7,
    owned: 2,
  },
  {
    name: "Aether Vial",
    tcg: "Magic",
    setName: "Darksteel",
    rarity: "Uncommon",
    price: 22.0,
    change7d: 0.0,
    change30d: -1.2,
    owned: 4,
  },
  {
    name: "Accesscode Talker",
    tcg: "Yu-Gi-Oh!",
    setName: "Eternity Code",
    rarity: "Ultra Rare",
    price: 18.0,
    change7d: -0.5,
    change30d: -2.3,
    owned: 1,
  },
  {
    name: "Murktide Regent",
    tcg: "Magic",
    setName: "Modern Horizons 2",
    rarity: "Mythic Rare",
    price: 18.5,
    change7d: 0.7,
    change30d: 3.4,
    owned: 2,
  },
  {
    name: "Mew ex",
    tcg: "Pokemon",
    setName: "Pokemon 151",
    rarity: "Double Rare",
    price: 18.75,
    change7d: -0.9,
    change30d: -3.1,
    owned: 1,
  },
  {
    name: "Infinite Impermanence",
    tcg: "Yu-Gi-Oh!",
    setName: "Flames of Destruction",
    rarity: "Secret Rare",
    price: 14.25,
    change7d: 0.2,
    change30d: 1.5,
    owned: 3,
  },
  {
    name: "Dark Magician",
    tcg: "Yu-Gi-Oh!",
    setName: "Starter Deck: Yugi",
    rarity: "Ultra Rare",
    price: 12.5,
    change7d: 0.1,
    change30d: 0.8,
    owned: 1,
  },
];

const TCG_COLORS: Record<string, string> = {
  Pokemon: "#f59e0b",
  Magic: "#8b5cf6",
  "Yu-Gi-Oh!": "#ef4444",
};

export default function PricesPage() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"price" | "7d" | "30d">("price");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = PRICE_DATA.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
  ).sort((a, b) => {
    let diff = 0;
    if (sortBy === "price") diff = b.price - a.price;
    else if (sortBy === "7d") diff = b.change7d - a.change7d;
    else diff = b.change30d - a.change30d;
    return sortAsc ? -diff : diff;
  });

  const totalValue = PRICE_DATA.reduce((s, p) => s + p.price * p.owned, 0);
  const avgChange =
    PRICE_DATA.reduce((s, p) => s + p.change30d, 0) / PRICE_DATA.length;

  const handleSort = (key: "price" | "7d" | "30d") => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else {
      setSortBy(key);
      setSortAsc(false);
    }
  };

  return (
    <AppShell data-oid="llm625j">
      <div className="space-y-6" data-oid="okhe2kx">
        <div data-oid="xoqv4py">
          <h1
            className="text-3xl font-heading font-semibold"
            data-oid="_p8g_q6"
          >
            Price Tracker
          </h1>
          <p className="text-sm text-muted-foreground" data-oid="9it-h89">
            Market prices and trends for cards in your collection.
          </p>
        </div>

        {/* Summary */}
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4"
          data-oid="l5wd0bg"
        >
          <Card data-oid="jt6o05p">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="nqudd_t">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="pzujw2g"
              >
                Portfolio Value
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="qtae189">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="9n.l63x"
              >
                ${totalValue.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="6o7:bvn">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="xn4341u">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="7s:n1d_"
              >
                Tracked Cards
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="8fpbd:n">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="sx0oilc"
              >
                {PRICE_DATA.length}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="uhbjw5x">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="l0w8doz">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="c4j_ea9"
              >
                Avg 30d Change
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="ddi4znx">
              <div
                className={`text-xl md:text-3xl font-semibold ${avgChange >= 0 ? "text-green-500" : "text-red-500"}`}
                data-oid="bk:w-se"
              >
                {avgChange >= 0 ? "+" : ""}
                {avgChange.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
          <Card data-oid="0391iwr">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="9z-jj:0">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="45ezh6e"
              >
                Most Valuable
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="mrw81fy">
              <div
                className="text-sm md:text-lg font-semibold truncate"
                data-oid="rkf1qiv"
              >
                {PRICE_DATA[0].name}
              </div>
              <p className="text-xs text-muted-foreground" data-oid="abosiy7">
                ${PRICE_DATA[0].price.toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-sm" data-oid="zw63-io">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            data-oid="sq5:9jv"
          />
          <Input
            placeholder="Search cards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-oid="0hwp56p"
          />
        </div>

        {/* Price table */}
        <Card data-oid="g0xkgtg">
          <CardContent className="p-0" data-oid="_1u_zh_">
            <div className="overflow-x-auto" data-oid="nijhdug">
              <table className="w-full text-sm" data-oid=".lme0z:">
                <thead data-oid="585albj">
                  <tr className="border-b bg-muted/50" data-oid="0ug_lea">
                    <th
                      className="p-3 text-left font-medium text-muted-foreground"
                      data-oid="47v9_r_"
                    >
                      Card
                    </th>
                    <th
                      className="p-3 text-left font-medium text-muted-foreground"
                      data-oid="2dduu.z"
                    >
                      Game
                    </th>
                    <th
                      className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell"
                      data-oid="r.sldiw"
                    >
                      Set
                    </th>
                    <th
                      className="p-3 text-center font-medium text-muted-foreground hidden sm:table-cell"
                      data-oid="33sedv."
                    >
                      Owned
                    </th>
                    <th
                      className="p-3 text-right font-medium text-muted-foreground cursor-pointer select-none"
                      onClick={() => handleSort("price")}
                      data-oid="0r.tck9"
                    >
                      <span
                        className="inline-flex items-center gap-1"
                        data-oid="yia49:7"
                      >
                        Price{" "}
                        <ArrowUpDown className="h-3 w-3" data-oid="k2h9vk0" />
                      </span>
                    </th>
                    <th
                      className="p-3 text-right font-medium text-muted-foreground cursor-pointer select-none hidden sm:table-cell"
                      onClick={() => handleSort("7d")}
                      data-oid="ypqhnbk"
                    >
                      <span
                        className="inline-flex items-center gap-1"
                        data-oid="t-utxh3"
                      >
                        7d{" "}
                        <ArrowUpDown className="h-3 w-3" data-oid="g.dmho:" />
                      </span>
                    </th>
                    <th
                      className="p-3 text-right font-medium text-muted-foreground cursor-pointer select-none"
                      onClick={() => handleSort("30d")}
                      data-oid="fo8g:f_"
                    >
                      <span
                        className="inline-flex items-center gap-1"
                        data-oid="aegzjd6"
                      >
                        30d{" "}
                        <ArrowUpDown className="h-3 w-3" data-oid="2q_aq2_" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody data-oid="5lzc6n9">
                  {filtered.map((p) => (
                    <tr
                      key={p.name}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      data-oid="9fxmoib"
                    >
                      <td className="p-3" data-oid="2.8-21v">
                        <span className="font-medium" data-oid="9k.evv.">
                          {p.name}
                        </span>
                        <span
                          className="ml-2 text-xs text-muted-foreground hidden xl:inline"
                          data-oid="ehipbf7"
                        >
                          {p.rarity}
                        </span>
                      </td>
                      <td className="p-3" data-oid="tqe5.ty">
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: TCG_COLORS[p.tcg] }}
                          data-oid=":118di7"
                        >
                          {p.tcg}
                        </Badge>
                      </td>
                      <td
                        className="p-3 text-muted-foreground hidden md:table-cell"
                        data-oid="5g:ozr9"
                      >
                        {p.setName}
                      </td>
                      <td
                        className="p-3 text-center hidden sm:table-cell"
                        data-oid="y1nktfu"
                      >
                        {p.owned}
                      </td>
                      <td
                        className="p-3 text-right font-semibold"
                        data-oid="_42r01a"
                      >
                        ${p.price.toFixed(2)}
                      </td>
                      <td
                        className="p-3 text-right hidden sm:table-cell"
                        data-oid="i7c8jl5"
                      >
                        <span
                          className={
                            p.change7d >= 0 ? "text-green-500" : "text-red-500"
                          }
                          data-oid="x5jef1y"
                        >
                          {p.change7d >= 0 ? "+" : ""}
                          {p.change7d.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-3 text-right" data-oid="me2bxy2">
                        <span
                          className={
                            p.change30d >= 0 ? "text-green-500" : "text-red-500"
                          }
                          data-oid="exdgzo_"
                        >
                          {p.change30d >= 0 ? "+" : ""}
                          {p.change30d.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
