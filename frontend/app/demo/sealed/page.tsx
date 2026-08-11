"use client";

import { useEffect, useState } from "react";
import { Package, Plus, DollarSign, TrendingUp, Calendar } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
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
import type { SealedProduct } from "@/lib/data/demo-portfolio";
import { useDemoStore } from "@/stores/demo-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/* ------------------------------------------------------------------ */
/*  Fake sealed products data                                           */
/* ------------------------------------------------------------------ */

const TCG_COLORS: Record<string, string> = {
  Pokemon: "#f59e0b",
  Magic: "#8b5cf6",
  "Yu-Gi-Oh!": "#ef4444",
};

export default function SealedPage() {
  const [sortBy, setSortBy] = useState<"date" | "value" | "profit">("date");
  const [createOpen, setCreateOpen] = useState(false);

  // The demo store is persisted, so it only agrees with the server-rendered
  // markup once we are on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const storeSealed = useDemoStore((state) => state.sealed);
  const addSealedProduct = useDemoStore((state) => state.addSealedProduct);
  const SEALED_PRODUCTS: SealedProduct[] = mounted ? storeSealed : [];

  const [form, setForm] = useState({
    name: "",
    tcg: "Pokemon",
    type: "Booster Box",
    set: "",
    quantity: "1",
    purchasePrice: "",
    currentValue: "",
  });

  const canSubmit = form.name.trim() && Number(form.purchasePrice) > 0;

  const handleCreate = () => {
    if (!canSubmit) return;
    const purchase = Number(form.purchasePrice) || 0;
    addSealedProduct({
      name: form.name.trim(),
      tcg: form.tcg,
      type: form.type.trim() || "Booster Box",
      set: form.set.trim() || form.name.trim(),
      quantity: Math.max(1, Number(form.quantity) || 1),
      purchasePrice: purchase,
      // Default to break-even rather than inventing a gain.
      currentValue: Number(form.currentValue) || purchase,
    });
    setForm({
      name: "",
      tcg: "Pokemon",
      type: "Booster Box",
      set: "",
      quantity: "1",
      purchasePrice: "",
      currentValue: "",
    });
    setCreateOpen(false);
  };

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
        <div
          className="flex items-start justify-between gap-3"
          data-oid="24af:t7"
        >
          <div className="min-w-0 flex-1" data-oid="eh-_rpf">
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
          <div className="shrink-0">
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              data-oid="uffzlfv"
            >
              <Plus className="mr-2 h-4 w-4" data-oid="zoob79u" />
              Add Product
            </Button>
          </div>
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
                        className="text-sm font-semibold line-clamp-2 break-words"
                        data-oid="ziamz_:"
                      >
                        {p.name}
                      </p>
                      <div
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5"
                        data-oid="yzftm0_"
                      >
                        <Badge
                          variant="outline"
                          className="text-xs whitespace-nowrap"
                          style={{ borderColor: TCG_COLORS[p.tcg] }}
                          data-oid="8y7bxo:"
                        >
                          {p.tcg}
                        </Badge>
                        {/* Type and quantity are one wrap unit: as separate
                            flex children a long type pushed the "x2" onto a
                            line of its own. */}
                        <span
                          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                          data-oid=".f8d7oi"
                        >
                          <span className="truncate">{p.type}</span>
                          <span className="shrink-0" data-oid="a8xunk1">
                            ×{p.quantity}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0" data-oid="cc8kecn">
                    <p
                      className="text-sm font-semibold whitespace-nowrap"
                      data-oid="0wicg5e"
                    >
                      ${(p.currentValue * p.quantity).toFixed(2)}
                    </p>
                    <p
                      className={`text-xs whitespace-nowrap ${profit >= 0 ? "text-green-500" : "text-red-500"}`}
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add sealed product</DialogTitle>
            <DialogDescription>
              Track a box, bundle or tin. Leave the market value blank to start
              it at break-even.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sealed-name">Product</Label>
              <Input
                id="sealed-name"
                value={form.name}
                placeholder="e.g. Paldea Evolved Booster Box"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sealed-type">Type</Label>
                <Input
                  id="sealed-type"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sealed-qty">Quantity</Label>
                <Input
                  id="sealed-qty"
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sealed-paid">Paid each</Label>
                <Input
                  id="sealed-paid"
                  inputMode="decimal"
                  value={form.purchasePrice}
                  placeholder="$0.00"
                  onChange={(e) =>
                    setForm({ ...form, purchasePrice: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sealed-value">Market each</Label>
                <Input
                  id="sealed-value"
                  inputMode="decimal"
                  value={form.currentValue}
                  placeholder="Same as paid"
                  onChange={(e) =>
                    setForm({ ...form, currentValue: e.target.value })
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
              Add product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
