"use client";

import { useState } from "react";
import { Repeat2, ArrowRight, Check, Clock, X, Plus } from "lucide-react";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* ------------------------------------------------------------------ */
/*  Fake trade data                                                     */
/* ------------------------------------------------------------------ */

interface TradeCard {
  name: string;
  tcg: string;
  value: number;
}

interface Trade {
  id: string;
  partner: string;
  status: "completed" | "pending" | "declined";
  date: string;
  giving: TradeCard[];
  receiving: TradeCard[];
}

const TRADES: Trade[] = [
  {
    id: "t1",
    partner: "CardMaster42",
    status: "completed",
    date: "2025-03-15",
    giving: [
      { name: "Fury", tcg: "Magic", value: 12.0 },
      { name: "Grief", tcg: "Magic", value: 8.5 },
    ],

    receiving: [
      { name: "Ash Blossom & Joyous Spring", tcg: "Yu-Gi-Oh!", value: 5.5 },
      { name: "Nibiru, the Primal Being", tcg: "Yu-Gi-Oh!", value: 8.95 },
      { name: "Effect Veiler", tcg: "Yu-Gi-Oh!", value: 3.8 },
    ],
  },
  {
    id: "t2",
    partner: "PikachuCollector",
    status: "completed",
    date: "2025-03-10",
    giving: [
      { name: "Mewtwo VSTAR", tcg: "Pokemon", value: 7.5 },
      { name: "Pikachu", tcg: "Pokemon", value: 2.5 },
    ],

    receiving: [{ name: "Iono", tcg: "Pokemon", value: 32.0 }],
  },
  {
    id: "t3",
    partner: "ModernMage",
    status: "pending",
    date: "2025-03-18",
    giving: [{ name: "Solitude", tcg: "Magic", value: 32.0 }],

    receiving: [
      { name: "Ragavan, Nimble Pilferer", tcg: "Magic", value: 68.4 },
    ],
  },
  {
    id: "t4",
    partner: "DuelistKing",
    status: "completed",
    date: "2025-02-28",
    giving: [
      { name: "Pot of Greed", tcg: "Yu-Gi-Oh!", value: 3.2 },
      { name: "Monster Reborn", tcg: "Yu-Gi-Oh!", value: 5.0 },
      { name: "Raigeki", tcg: "Yu-Gi-Oh!", value: 6.25 },
    ],

    receiving: [{ name: "Accesscode Talker", tcg: "Yu-Gi-Oh!", value: 18.0 }],
  },
  {
    id: "t5",
    partner: "VintageVault",
    status: "declined",
    date: "2025-03-05",
    giving: [{ name: "Charizard ex", tcg: "Pokemon", value: 85.0 }],

    receiving: [
      { name: "Lightning Bolt", tcg: "Magic", value: 1.5 },
      { name: "Counterspell", tcg: "Magic", value: 2.25 },
    ],
  },
  {
    id: "t6",
    partner: "TradeKing99",
    status: "pending",
    date: "2025-03-19",
    giving: [
      { name: "Endurance", tcg: "Magic", value: 26.0 },
      { name: "Fatal Push", tcg: "Magic", value: 3.5 },
    ],

    receiving: [{ name: "Wrenn and Six", tcg: "Magic", value: 55.0 }],
  },
  {
    id: "t7",
    partner: "PKMNTrader",
    status: "completed",
    date: "2025-02-14",
    giving: [{ name: "Palkia VSTAR", tcg: "Pokemon", value: 9.75 }],

    receiving: [
      { name: "Gardevoir ex", tcg: "Pokemon", value: 6.25 },
      { name: "Eevee", tcg: "Pokemon", value: 0.75 },
      { name: "Boss's Orders", tcg: "Pokemon", value: 2.5 },
    ],
  },
];

const STATUS_CONFIG = {
  completed: {
    label: "Completed",
    icon: Check,
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
  },
  declined: {
    label: "Declined",
    icon: X,
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
};

export default function TradesPage() {
  const [tab, setTab] = useState("all");

  const filtered =
    tab === "all" ? TRADES : TRADES.filter((t) => t.status === tab);

  const completedTrades = TRADES.filter((t) => t.status === "completed");
  const totalGiven = completedTrades.reduce(
    (s, t) => s + t.giving.reduce((a, c) => a + c.value, 0),
    0,
  );
  const totalReceived = completedTrades.reduce(
    (s, t) => s + t.receiving.reduce((a, c) => a + c.value, 0),
    0,
  );

  return (
    <AppShell data-oid="nkjvlu_">
      <div className="space-y-6" data-oid="64mg-f2">
        <div className="flex items-center justify-between" data-oid="fm9pabc">
          <div data-oid="99k2..z">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="9d4:6yh"
            >
              Trades
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="qodyw66">
              Track card trades with other collectors.
            </p>
          </div>
          <Button size="sm" disabled data-oid="e_i3k.-">
            <Plus className="mr-2 h-4 w-4" data-oid="u450_2:" />
            New Trade
          </Button>
        </div>

        {/* Stats */}
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4"
          data-oid="2igfdp."
        >
          <Card data-oid="v0g45e5">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="tb2vuyt">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="8plqzjr"
              >
                Total Trades
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="bz1b5:o">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="bkq2bbn"
              >
                {TRADES.length}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="-kci1_i">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="t6:sbx0">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="35.:yvq"
              >
                Completed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="tcm78hp">
              <div
                className="text-xl md:text-3xl font-semibold text-green-500"
                data-oid="ycxy9re"
              >
                {completedTrades.length}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="ld8-uv2">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="g-kx_z.">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="9tl3ple"
              >
                Value Sent
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="f_xovze">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="qgucovk"
              >
                ${totalGiven.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="vv:nf09">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="7damyxg">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="2koohit"
              >
                Value Received
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="x1.yz99">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="8i9ou3g"
              >
                ${totalReceived.toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter tabs */}
        <Tabs value={tab} onValueChange={setTab} data-oid="-gkig62">
          <TabsList data-oid="qlk::r4">
            <TabsTrigger value="all" data-oid="s5p886h">
              All ({TRADES.length})
            </TabsTrigger>
            <TabsTrigger value="pending" data-oid="5ade4e5">
              Pending ({TRADES.filter((t) => t.status === "pending").length})
            </TabsTrigger>
            <TabsTrigger value="completed" data-oid="ldhrr.7">
              Completed ({completedTrades.length})
            </TabsTrigger>
            <TabsTrigger value="declined" data-oid="m88osv-">
              Declined ({TRADES.filter((t) => t.status === "declined").length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Trade list */}
        <div className="space-y-4" data-oid="frxt3ow">
          {filtered.map((trade) => {
            const givingTotal = trade.giving.reduce((s, c) => s + c.value, 0);
            const receivingTotal = trade.receiving.reduce(
              (s, c) => s + c.value,
              0,
            );
            const cfg = STATUS_CONFIG[trade.status];
            const StatusIcon = cfg.icon;

            return (
              <Card key={trade.id} data-oid="ebn8ikd">
                <CardHeader className="p-4 pb-2" data-oid="ukukgm-">
                  <div
                    className="flex items-center justify-between"
                    data-oid="spvmsx-"
                  >
                    <div className="flex items-center gap-2" data-oid="0pcurvn">
                      <Repeat2
                        className="h-4 w-4 text-muted-foreground"
                        data-oid="zbouj7q"
                      />
                      <CardTitle className="text-base" data-oid="2q5q.qf">
                        Trade with {trade.partner}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2" data-oid="l5dle6.">
                      <Badge
                        variant="outline"
                        className={`${cfg.color} ${cfg.bg}`}
                        data-oid="a_mh9sj"
                      >
                        <StatusIcon
                          className="mr-1 h-3 w-3"
                          data-oid="97c97:0"
                        />
                        {cfg.label}
                      </Badge>
                      <span
                        className="text-xs text-muted-foreground"
                        data-oid="41iviaj"
                      >
                        {new Date(trade.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2" data-oid="s7acok5">
                  <div
                    className="grid gap-4 md:grid-cols-[1fr_auto_1fr]"
                    data-oid="olvqw13"
                  >
                    {/* Giving */}
                    <div className="space-y-2" data-oid="p47-_v1">
                      <p
                        className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                        data-oid="ibex:g_"
                      >
                        You give
                      </p>
                      {trade.giving.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded border p-2 text-sm"
                          data-oid="v:apcta"
                        >
                          <div data-oid="v:7lbbx">
                            <span className="font-medium" data-oid="r.gdn1i">
                              {c.name}
                            </span>
                            <span
                              className="ml-2 text-xs text-muted-foreground"
                              data-oid="348d-l1"
                            >
                              {c.tcg}
                            </span>
                          </div>
                          <span
                            className="text-muted-foreground"
                            data-oid="wf30jzj"
                          >
                            ${c.value.toFixed(2)}
                          </span>
                        </div>
                      ))}
                      <p
                        className="text-xs text-muted-foreground text-right"
                        data-oid="1v4dgaj"
                      >
                        Total: ${givingTotal.toFixed(2)}
                      </p>
                    </div>

                    {/* Arrow */}
                    <div
                      className="hidden md:flex items-center justify-center"
                      data-oid="dzai5p:"
                    >
                      <ArrowRight
                        className="h-5 w-5 text-muted-foreground"
                        data-oid=".yx1x-6"
                      />
                    </div>

                    {/* Receiving */}
                    <div className="space-y-2" data-oid="8-keg4c">
                      <p
                        className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                        data-oid="t9d1::m"
                      >
                        You receive
                      </p>
                      {trade.receiving.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded border p-2 text-sm"
                          data-oid="_mi6-ck"
                        >
                          <div data-oid="13hhfie">
                            <span className="font-medium" data-oid=".r8jhb6">
                              {c.name}
                            </span>
                            <span
                              className="ml-2 text-xs text-muted-foreground"
                              data-oid="8.un:h5"
                            >
                              {c.tcg}
                            </span>
                          </div>
                          <span
                            className="text-muted-foreground"
                            data-oid="ii8kio."
                          >
                            ${c.value.toFixed(2)}
                          </span>
                        </div>
                      ))}
                      <p
                        className="text-xs text-muted-foreground text-right"
                        data-oid="0khe_u8"
                      >
                        Total: ${receivingTotal.toFixed(2)}
                      </p>
                    </div>
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
