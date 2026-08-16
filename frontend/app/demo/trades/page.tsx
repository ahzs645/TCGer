"use client";

import { useEffect, useState } from "react";
import {
  Repeat2,
  ArrowRight,
  Check,
  Clock,
  X,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

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
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Trade } from "@/lib/data/demo-portfolio";
import { useDemoStore } from "@/stores/demo-store";

/* ------------------------------------------------------------------ */
/*  Fake trade data                                                     */
/* ------------------------------------------------------------------ */

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
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  // The demo store is persisted, so it only agrees with the server-rendered
  // markup once we are on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const storeTrades = useDemoStore((state) => state.trades);
  const addTrade = useDemoStore((state) => state.addTrade);
  const setTradeStatus = useDemoStore((state) => state.setTradeStatus);
  const removeTrade = useDemoStore((state) => state.removeTrade);
  const TRADES: Trade[] = mounted ? storeTrades : [];

  const [form, setForm] = useState({
    partner: "",
    giveName: "",
    giveValue: "",
    receiveName: "",
    receiveValue: "",
  });

  const canSubmit =
    form.partner.trim() && form.giveName.trim() && form.receiveName.trim();

  const handleCreate = () => {
    if (!canSubmit) return;
    addTrade({
      partner: form.partner.trim(),
      giving: [
        {
          name: form.giveName.trim(),
          tcg: "Magic",
          value: Number(form.giveValue) || 0,
        },
      ],
      receiving: [
        {
          name: form.receiveName.trim(),
          tcg: "Magic",
          value: Number(form.receiveValue) || 0,
        },
      ],
    });
    setForm({
      partner: "",
      giveName: "",
      giveValue: "",
      receiveName: "",
      receiveValue: "",
    });
    setCreateOpen(false);
    setTab("pending");
  };

  const filtered =
    tab === "all" ? TRADES : TRADES.filter((t) => t.status === tab);

  const handleDelete = async (trade: Trade) => {
    const ok = await confirm({
      title: `Delete trade with ${trade.partner}?`,
      description: "This removes the trade and both card lists.",
      confirmLabel: "Delete trade",
      destructive: true,
    });
    if (ok) await removeTrade(trade.id);
  };

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
        <div
          className="flex items-start justify-between gap-3"
          data-oid="fm9pabc"
        >
          <div className="min-w-0 flex-1" data-oid="99k2..z">
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
          <div className="shrink-0">
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              data-oid="e_i3k.-"
            >
              <Plus className="mr-2 h-4 w-4" data-oid="u450_2:" />
              New Trade
            </Button>
          </div>
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
          <TabsList
            className="h-auto w-full max-w-full flex-wrap gap-1 sm:h-10 sm:w-auto sm:gap-0"
            data-oid="qlk::r4"
          >
            <TabsTrigger
              value="all"
              className="flex-1 sm:flex-none"
              data-oid="s5p886h"
            >
              All ({TRADES.length})
            </TabsTrigger>
            <TabsTrigger
              value="pending"
              className="flex-1 sm:flex-none"
              data-oid="5ade4e5"
            >
              Pending ({TRADES.filter((t) => t.status === "pending").length})
            </TabsTrigger>
            <TabsTrigger
              value="completed"
              className="flex-1 sm:flex-none"
              data-oid="ldhrr.7"
            >
              Completed ({completedTrades.length})
            </TabsTrigger>
            <TabsTrigger
              value="declined"
              className="flex-1 sm:flex-none"
              data-oid="m88osv-"
            >
              Declined ({TRADES.filter((t) => t.status === "declined").length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Trade list */}
        <div className="space-y-4" data-oid="frxt3ow">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No {tab === "all" ? "" : `${tab} `}trades yet.
              </CardContent>
            </Card>
          ) : null}
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
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap sm:justify-between"
                    data-oid="spvmsx-"
                  >
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2"
                      data-oid="0pcurvn"
                    >
                      <Repeat2
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        data-oid="zbouj7q"
                      />
                      <CardTitle
                        className="truncate text-base"
                        data-oid="2q5q.qf"
                      >
                        {/* The "Trade with" prefix costs ~75px that the partner
                            name needs — and the icon plus the page title
                            already say what this is. */}
                        <span className="hidden sm:inline">Trade with </span>
                        {trade.partner}
                      </CardTitle>
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-2"
                      data-oid="l5dle6."
                    >
                      {/* Icon-only on phones: the label repeats down the whole
                          list and costs ~78px the partner name needs. Colour
                          plus icon carries the state; the accessible name and
                          tooltip carry the word. */}
                      <Badge
                        variant="outline"
                        className={`${cfg.color} ${cfg.bg} shrink-0 px-1.5 sm:px-2.5`}
                        aria-label={cfg.label}
                        title={cfg.label}
                        data-oid="a_mh9sj"
                      >
                        <StatusIcon
                          className="h-3 w-3 sm:mr-1"
                          aria-hidden="true"
                          data-oid="97c97:0"
                        />
                        <span className="hidden sm:inline">{cfg.label}</span>
                      </Badge>
                      <span
                        className="whitespace-nowrap text-xs text-muted-foreground"
                        title={new Date(trade.date).toLocaleDateString(
                          undefined,
                          {
                            dateStyle: "long",
                          },
                        )}
                        data-oid="41iviaj"
                      >
                        <span className="sm:hidden">
                          {new Date(trade.date).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="hidden sm:inline">
                          {new Date(trade.date).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2" data-oid="s7acok5">
                  <div
                    className="grid gap-3 md:gap-4 md:grid-cols-[1fr_auto_1fr]"
                    data-oid="olvqw13"
                  >
                    {/* Giving */}
                    <div
                      className="min-w-0 space-y-1.5 md:space-y-2"
                      data-oid="p47-_v1"
                    >
                      <p
                        className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                        data-oid="ibex:g_"
                      >
                        You give
                      </p>
                      {trade.giving.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm md:p-2"
                          data-oid="v:apcta"
                        >
                          <div className="min-w-0 truncate" data-oid="v:7lbbx">
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
                            className="shrink-0 whitespace-nowrap text-muted-foreground"
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
                    <div
                      className="min-w-0 space-y-1.5 md:space-y-2"
                      data-oid="8-keg4c"
                    >
                      <p
                        className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                        data-oid="t9d1::m"
                      >
                        You receive
                      </p>
                      {trade.receiving.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm md:p-2"
                          data-oid="_mi6-ck"
                        >
                          <div className="min-w-0 truncate" data-oid="13hhfie">
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
                            className="shrink-0 whitespace-nowrap text-muted-foreground"
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
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-3">
                    {trade.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void setTradeStatus(trade.id, "declined")
                          }
                        >
                          <X className="mr-1.5 h-4 w-4" />
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            void setTradeStatus(trade.id, "completed")
                          }
                        >
                          <Check className="mr-1.5 h-4 w-4" />
                          Complete
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setTradeStatus(trade.id, "pending")}
                      >
                        <RotateCcw className="mr-1.5 h-4 w-4" />
                        Reopen
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDelete(trade)}
                      aria-label={`Delete trade with ${trade.partner}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New trade offer</DialogTitle>
            <DialogDescription>
              Log what each side is putting up. The offer starts as pending.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="trade-partner">Trading with</Label>
              <Input
                id="trade-partner"
                value={form.partner}
                placeholder="Collector name"
                onChange={(e) => setForm({ ...form, partner: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trade-give">You give</Label>
              <div className="flex gap-2">
                <Input
                  id="trade-give"
                  className="flex-1"
                  value={form.giveName}
                  placeholder="Card name"
                  onChange={(e) =>
                    setForm({ ...form, giveName: e.target.value })
                  }
                />
                <Input
                  className="w-24"
                  inputMode="decimal"
                  value={form.giveValue}
                  placeholder="$0.00"
                  aria-label="Value of the card you give"
                  onChange={(e) =>
                    setForm({ ...form, giveValue: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="trade-receive">You receive</Label>
              <div className="flex gap-2">
                <Input
                  id="trade-receive"
                  className="flex-1"
                  value={form.receiveName}
                  placeholder="Card name"
                  onChange={(e) =>
                    setForm({ ...form, receiveName: e.target.value })
                  }
                />
                <Input
                  className="w-24"
                  inputMode="decimal"
                  value={form.receiveValue}
                  placeholder="$0.00"
                  aria-label="Value of the card you receive"
                  onChange={(e) =>
                    setForm({ ...form, receiveValue: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!canSubmit}>
              Log trade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AppShell>
  );
}
