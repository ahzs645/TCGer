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
    <AppShell data-oid="qgj.y_p">
      <div className="space-y-6" data-oid="zbgfv8h">
        <div className="flex items-center justify-between" data-oid="2:bk1kv">
          <div data-oid="3yywx12">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="s.vro_n"
            >
              Trades
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="73f7nf-">
              Track card trades with other collectors.
            </p>
          </div>
          <Button size="sm" disabled data-oid="bdb96f2">
            <Plus className="mr-2 h-4 w-4" data-oid="z_..xgv" />
            New Trade
          </Button>
        </div>

        {/* Stats */}
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4"
          data-oid="i78latq"
        >
          <Card data-oid="0zs31vs">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid=":we5y88">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="ftlkhw."
              >
                Total Trades
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="m:byw9g">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="p2wngpn"
              >
                {TRADES.length}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="00a-r2w">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid=".dj_fx6">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid=":zbvbbq"
              >
                Completed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="h-cbgl_">
              <div
                className="text-xl md:text-3xl font-semibold text-green-500"
                data-oid="iedlzsv"
              >
                {completedTrades.length}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="wc370hh">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="ec2kuh0">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="9_3_et:"
              >
                Value Sent
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="xk6ngx0">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="-9mosiy"
              >
                ${totalGiven.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="0ovi6ck">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="jlgc57o">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="vw3npgi"
              >
                Value Received
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="2quugsf">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="v_:qzzc"
              >
                ${totalReceived.toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter tabs */}
        <Tabs value={tab} onValueChange={setTab} data-oid="5p86snd">
          <TabsList data-oid="1d3-hu0">
            <TabsTrigger value="all" data-oid="e34kdyn">
              All ({TRADES.length})
            </TabsTrigger>
            <TabsTrigger value="pending" data-oid="fch6:i6">
              Pending ({TRADES.filter((t) => t.status === "pending").length})
            </TabsTrigger>
            <TabsTrigger value="completed" data-oid="7-1qna1">
              Completed ({completedTrades.length})
            </TabsTrigger>
            <TabsTrigger value="declined" data-oid="5u1x11v">
              Declined ({TRADES.filter((t) => t.status === "declined").length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Trade list */}
        <div className="space-y-4" data-oid="2dthu7g">
          {filtered.map((trade) => {
            const givingTotal = trade.giving.reduce((s, c) => s + c.value, 0);
            const receivingTotal = trade.receiving.reduce(
              (s, c) => s + c.value,
              0,
            );
            const cfg = STATUS_CONFIG[trade.status];
            const StatusIcon = cfg.icon;

            return (
              <Card key={trade.id} data-oid="ge489k7">
                <CardHeader className="p-4 pb-2" data-oid="ymupr3g">
                  <div
                    className="flex items-center justify-between"
                    data-oid=":2j0jt5"
                  >
                    <div className="flex items-center gap-2" data-oid="ez7eu0x">
                      <Repeat2
                        className="h-4 w-4 text-muted-foreground"
                        data-oid=".hv9otg"
                      />
                      <CardTitle className="text-base" data-oid="bi8r42x">
                        Trade with {trade.partner}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2" data-oid="hfz8n:y">
                      <Badge
                        variant="outline"
                        className={`${cfg.color} ${cfg.bg}`}
                        data-oid="crw73b:"
                      >
                        <StatusIcon
                          className="mr-1 h-3 w-3"
                          data-oid="cd_5g4p"
                        />
                        {cfg.label}
                      </Badge>
                      <span
                        className="text-xs text-muted-foreground"
                        data-oid="wmbg3ep"
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
                <CardContent className="p-4 pt-2" data-oid="ar0y9ql">
                  <div
                    className="grid gap-4 md:grid-cols-[1fr_auto_1fr]"
                    data-oid="n0zxpf."
                  >
                    {/* Giving */}
                    <div className="space-y-2" data-oid="pf7hjnl">
                      <p
                        className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                        data-oid="j5dy_ag"
                      >
                        You give
                      </p>
                      {trade.giving.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded border p-2 text-sm"
                          data-oid="3czxja1"
                        >
                          <div data-oid=":1mgy1w">
                            <span className="font-medium" data-oid="xwm:5u.">
                              {c.name}
                            </span>
                            <span
                              className="ml-2 text-xs text-muted-foreground"
                              data-oid=".at9ytu"
                            >
                              {c.tcg}
                            </span>
                          </div>
                          <span
                            className="text-muted-foreground"
                            data-oid="jql4vsv"
                          >
                            ${c.value.toFixed(2)}
                          </span>
                        </div>
                      ))}
                      <p
                        className="text-xs text-muted-foreground text-right"
                        data-oid="5m8sizm"
                      >
                        Total: ${givingTotal.toFixed(2)}
                      </p>
                    </div>

                    {/* Arrow */}
                    <div
                      className="hidden md:flex items-center justify-center"
                      data-oid="j2zvnme"
                    >
                      <ArrowRight
                        className="h-5 w-5 text-muted-foreground"
                        data-oid="1ue5neh"
                      />
                    </div>

                    {/* Receiving */}
                    <div className="space-y-2" data-oid="jkueb8a">
                      <p
                        className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                        data-oid="hcw:92:"
                      >
                        You receive
                      </p>
                      {trade.receiving.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded border p-2 text-sm"
                          data-oid="srddw_h"
                        >
                          <div data-oid="v:s7oe3">
                            <span className="font-medium" data-oid="2q5gnm3">
                              {c.name}
                            </span>
                            <span
                              className="ml-2 text-xs text-muted-foreground"
                              data-oid="zllayer"
                            >
                              {c.tcg}
                            </span>
                          </div>
                          <span
                            className="text-muted-foreground"
                            data-oid="-xw1za4"
                          >
                            ${c.value.toFixed(2)}
                          </span>
                        </div>
                      ))}
                      <p
                        className="text-xs text-muted-foreground text-right"
                        data-oid="l:w9bcw"
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
