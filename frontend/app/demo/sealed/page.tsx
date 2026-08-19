"use client";

import { useEffect, useState } from "react";
import {
  Package,
  Plus,
  DollarSign,
  TrendingUp,
  Calendar,
  Pencil,
  Trash2,
} from "lucide-react";

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
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { SealedProduct } from "@/lib/data/demo-portfolio";
import { useDemoStore } from "@/stores/demo-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getInstalledSealedProducts,
  type SealedCatalogProduct,
} from "@/lib/catalog/catalog-client";
import { formatMoney } from "@/lib/format-money";
import { PageHeader } from "@/components/layout/page-header";

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
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [catalogProducts, setCatalogProducts] = useState<
    SealedCatalogProduct[]
  >([]);

  // The demo store is persisted, so it only agrees with the server-rendered
  // markup once we are on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (createOpen) {
      void getInstalledSealedProducts()
        .then(setCatalogProducts)
        .catch(() => setCatalogProducts([]));
    }
  }, [createOpen]);

  const storeSealed = useDemoStore((state) => state.sealed);
  const addSealedProduct = useDemoStore((state) => state.addSealedProduct);
  const updateSealedProduct = useDemoStore(
    (state) => state.updateSealedProduct,
  );
  const removeSealedProduct = useDemoStore(
    (state) => state.removeSealedProduct,
  );
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
  const [editForm, setEditForm] = useState({
    name: "",
    type: "",
    set: "",
    quantity: "1",
    purchasePrice: "",
    currentValue: "",
    purchaseDate: "",
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

  const openEditor = (product: SealedProduct) => {
    setEditingId(product.id);
    setEditForm({
      name: product.name,
      type: product.type,
      set: product.set,
      quantity: String(product.quantity),
      purchasePrice: String(product.purchasePrice),
      currentValue: String(product.currentValue),
      purchaseDate: product.purchaseDate,
    });
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    if (
      !editingId ||
      !editForm.name.trim() ||
      Number(editForm.quantity) < 1 ||
      Number(editForm.purchasePrice) < 0 ||
      Number(editForm.currentValue) < 0
    )
      return;
    await updateSealedProduct(editingId, {
      name: editForm.name.trim(),
      type: editForm.type.trim() || "Sealed Product",
      set: editForm.set.trim(),
      quantity: Math.max(1, Math.floor(Number(editForm.quantity))),
      purchasePrice: Number(editForm.purchasePrice),
      currentValue: Number(editForm.currentValue),
      purchaseDate: editForm.purchaseDate,
    });
    setEditOpen(false);
    setEditingId(null);
  };

  const handleDelete = async (product: SealedProduct) => {
    const ok = await confirm({
      title: `Delete ${product.name}?`,
      description: `This removes all ${product.quantity} tracked ${product.quantity === 1 ? "item" : "items"}.`,
      confirmLabel: "Delete product",
      destructive: true,
    });
    if (ok) await removeSealedProduct(product.id);
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
        <PageHeader
          title="Sealed Products"
          description="Track your sealed product investments and market values."
          actions={
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              data-oid="uffzlfv"
            >
              <Plus className="mr-2 h-4 w-4" data-oid="zoob79u" />
              Add Product
            </Button>
          }
        />

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
                {formatMoney(totalInvested)}
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
                {formatMoney(totalCurrent)}
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
                {totalProfit >= 0 ? "+" : ""}
                {formatMoney(totalProfit)}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="ffkl02y"
              >
                {totalProfit >= 0 ? "+" : ""}
                {totalInvested > 0
                  ? `${((totalProfit / totalInvested) * 100).toFixed(1)}% ROI`
                  : "— ROI"}
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
          {sorted.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No sealed products tracked yet.
              </CardContent>
            </Card>
          ) : null}
          {sorted.map((p) => {
            const profit = (p.currentValue - p.purchasePrice) * p.quantity;
            const profitPct =
              p.purchasePrice > 0
                ? ((p.currentValue - p.purchasePrice) / p.purchasePrice) * 100
                : null;
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
                          <span className="min-w-0">{p.type}</span>
                          <span className="shrink-0" data-oid="a8xunk1">
                            ×{p.quantity}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-1"
                    data-oid="cc8kecn"
                  >
                    <div className="text-right">
                      <p
                        className="text-sm font-semibold whitespace-nowrap"
                        data-oid="0wicg5e"
                      >
                        {formatMoney(p.currentValue * p.quantity)}
                      </p>
                      <p
                        className={`text-xs whitespace-nowrap ${profit >= 0 ? "text-green-500" : "text-red-500"}`}
                        data-oid="_hlp0de"
                      >
                        {profit >= 0 ? "+" : ""}
                        {formatMoney(profit)} (
                        {profitPct === null
                          ? "—"
                          : `${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(1)}%`}
                        )
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditor(p)}
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDelete(p)}
                      aria-label={`Delete ${p.name}`}
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
                list="sealed-product-catalog"
                value={form.name}
                placeholder="e.g. Paldea Evolved Booster Box"
                onChange={(e) => {
                  const name = e.target.value;
                  const product = catalogProducts.find(
                    (entry) => entry.name === name,
                  );
                  setForm({
                    ...form,
                    name,
                    ...(product
                      ? {
                          tcg:
                            product.tcg === "pokemon"
                              ? "Pokemon"
                              : product.tcg === "magic"
                                ? "Magic"
                                : product.tcg === "yugioh"
                                  ? "Yu-Gi-Oh!"
                                  : product.tcg,
                          type: product.productType,
                          set: product.setCode ?? "",
                          currentValue: product.marketPrice?.toFixed(2) ?? "",
                        }
                      : {}),
                  });
                }}
                autoFocus
              />
              <datalist id="sealed-product-catalog">
                {catalogProducts.slice(0, 500).map((product) => (
                  <option key={product.id} value={product.name} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                {catalogProducts.length
                  ? `${catalogProducts.length.toLocaleString()} downloaded products available as suggestions.`
                  : "Download optional sealed-product catalogs in Account settings for suggestions."}
              </p>
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
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit sealed product</DialogTitle>
            <DialogDescription>
              Update the holding quantity, cost basis, and current estimate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-sealed-name">Product</Label>
              <Input
                id="edit-sealed-name"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-sealed-type">Type</Label>
                <Input
                  id="edit-sealed-type"
                  value={editForm.type}
                  onChange={(e) =>
                    setEditForm({ ...editForm, type: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-sealed-set">Set</Label>
                <Input
                  id="edit-sealed-set"
                  value={editForm.set}
                  onChange={(e) =>
                    setEditForm({ ...editForm, set: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-sealed-qty">Quantity</Label>
                <Input
                  id="edit-sealed-qty"
                  type="number"
                  min="1"
                  step="1"
                  value={editForm.quantity}
                  onChange={(e) =>
                    setEditForm({ ...editForm, quantity: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-sealed-paid">Paid each</Label>
                <Input
                  id="edit-sealed-paid"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.purchasePrice}
                  onChange={(e) =>
                    setEditForm({ ...editForm, purchasePrice: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-sealed-value">Market each</Label>
                <Input
                  id="edit-sealed-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.currentValue}
                  onChange={(e) =>
                    setEditForm({ ...editForm, currentValue: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-sealed-date">Purchase date</Label>
              <Input
                id="edit-sealed-date"
                type="date"
                value={editForm.purchaseDate}
                onChange={(e) =>
                  setEditForm({ ...editForm, purchaseDate: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleUpdate()}
              disabled={!editForm.name.trim() || Number(editForm.quantity) < 1}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AppShell>
  );
}
