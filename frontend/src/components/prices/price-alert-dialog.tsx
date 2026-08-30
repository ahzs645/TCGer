"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createAlert, deleteAlert, getAlerts, getTrackedCardPrices, updateAlert } from "@/lib/api/pricing";
import { formatMoney } from "@/lib/format-money";
import { useAuthStore } from "@/stores/auth";

export function PriceAlertDialog({
  card,
  currentPrice,
  compact = false,
}: {
  card: { externalId: string; tcg: string; name: string; imageUrl?: string; finishCode?: string; currency?: string };
  currentPrice?: number;
  compact?: boolean;
}) {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"below" | "above">("below");
  const [target, setTarget] = useState(currentPrice && currentPrice > 0 ? String((currentPrice * 0.9).toFixed(2)) : "");
  const [cooldown, setCooldown] = useState("24");
  const [notice, setNotice] = useState<string | null>(null);
  const alertsQuery = useQuery({ queryKey: ["price-alerts"], queryFn: () => getAlerts(token!), enabled: !!token && open });
  const alert = useMemo(() => alertsQuery.data?.find((item) => item.externalId === card.externalId && item.tcg === card.tcg && (item.finishCode ?? "") === (card.finishCode ?? "")), [alertsQuery.data, card]);
  useEffect(() => {
    if (!alert) return;
    setDirection(alert.direction === "above" ? "above" : "below");
    setTarget(String(alert.targetPrice));
    setCooldown(String(alert.cooldownHours));
  }, [alert]);
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Sign in to create an alert.");
      const targetPrice = Number(target);
      if (!Number.isFinite(targetPrice) || targetPrice <= 0) throw new Error("Enter a positive target price.");
      const cooldownHours = Number(cooldown);
      if (!Number.isInteger(cooldownHours) || cooldownHours < 1 || cooldownHours > 720) throw new Error("Cooldown must be 1–720 hours.");
      if (alert) return updateAlert(token, alert.id, { targetPrice, direction, cooldownHours, isActive: true });
      return createAlert(token, { externalId: card.externalId, tcg: card.tcg, cardName: card.name, imageUrl: card.imageUrl, finishCode: card.finishCode, targetPrice, direction, currency: card.currency ?? "USD", cooldownHours });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["price-alerts"] }),
        token ? getTrackedCardPrices(token, [{ tcg: card.tcg, externalId: card.externalId, finishCode: card.finishCode }]).catch(() => undefined) : Promise.resolve(),
      ]);
      setNotice("Price watch saved. You’ll be notified when the threshold is crossed.");
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const toggleMutation = useMutation({
    mutationFn: () => updateAlert(token!, alert!.id, { isActive: !alert!.isActive }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["price-alerts"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteAlert(token!, alert!.id),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["price-alerts"] }); setNotice("Price watch removed."); },
  });

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size={compact ? "icon" : "sm"} className={compact ? "h-8 w-8" : undefined} aria-label={`Watch price for ${card.name}`}>
        <Bell className={compact ? "h-3.5 w-3.5" : "mr-2 h-4 w-4"} />{compact ? null : "Watch price"}
      </Button>
    </DialogTrigger>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Watch {card.name}</DialogTitle><DialogDescription>Alerts trigger only when a trusted quote crosses the target. Repeat alerts respect your cooldown.</DialogDescription></DialogHeader>
      {alert && <div className="flex items-center justify-between rounded-md border p-3 text-sm"><span>Existing watch</span><Badge variant={alert.isActive ? "default" : "outline"}>{alert.isActive ? "Active" : "Paused"}</Badge></div>}
      {currentPrice && currentPrice > 0 ? <p className="text-sm text-muted-foreground">Current price: {formatMoney(currentPrice, { currency: card.currency ?? "USD" })}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Trigger when price is</Label><Select value={direction} onValueChange={(value) => setDirection(value as "below" | "above")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="below">At or below</SelectItem><SelectItem value="above">At or above</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="alert-target">Target ({card.currency ?? "USD"})</Label><Input id="alert-target" type="number" min="0.01" step="0.01" value={target} onChange={(event) => setTarget(event.target.value)} /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="alert-cooldown">Repeat cooldown (hours)</Label><Input id="alert-cooldown" type="number" min="1" max="720" value={cooldown} onChange={(event) => setCooldown(event.target.value)} /></div>
      {alert?.lastObservedAt && <p className="text-xs text-muted-foreground">Last observed {formatMoney(alert.lastObservedPrice ?? 0, { currency: alert.currency })} on {new Date(alert.lastObservedAt).toLocaleString()}.</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <DialogFooter className="sm:justify-between">
        <div className="flex gap-2">{alert && <><Button type="button" variant="outline" onClick={() => toggleMutation.mutate()} disabled={toggleMutation.isPending}>{alert.isActive ? <BellOff className="mr-2 h-4 w-4" /> : <Bell className="mr-2 h-4 w-4" />}{alert.isActive ? "Pause" : "Resume"}</Button><Button type="button" variant="ghost" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}><Trash2 className="h-4 w-4" /></Button></>}</div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{alert ? "Update watch" : "Create watch"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
