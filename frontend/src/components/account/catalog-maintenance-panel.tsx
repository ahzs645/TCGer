"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseZap, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import type {
  Card,
  CatalogCorrection,
  CatalogCorrectionPatch,
  TcgCode,
} from "@tcg/api-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { searchCardsApi } from "@/lib/api-client";
import {
  createCatalogCorrection,
  getCatalogCorrectionHistory,
  rollbackCatalogCorrection,
} from "@/lib/api/catalog-corrections";
import { GAME_LABELS } from "@/lib/utils";
import { synchronizeYugiohBanlists } from "@/lib/api/banlists";

const games: TcgCode[] = [
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
];

type Draft = {
  name: string;
  setCode: string;
  setName: string;
  rarity: string;
  collectorNumber: string;
  attributes: string;
  reason: string;
};

const emptyDraft: Draft = {
  name: "",
  setCode: "",
  setName: "",
  rarity: "",
  collectorNumber: "",
  attributes: "{}",
  reason: "",
};

export function CatalogMaintenancePanel({ token }: { token: string }) {
  const [tcg, setTcg] = useState<TcgCode>("yugioh");
  const [targetType, setTargetType] = useState<"identity" | "printing">(
    "printing",
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [history, setHistory] = useState<CatalogCorrection[]>([]);
  const [busy, setBusy] = useState<"search" | "save" | "history" | string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setBusy("history");
    try {
      setHistory(await getCatalogCorrectionHistory(token, 40));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load corrections");
    } finally {
      setBusy(null);
    }
  }, [token]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(task);
  }, [loadHistory]);

  const latestIds = useMemo(() => {
    const latest = new Map<string, string>();
    for (const correction of history) {
      const key = `${correction.tcg}:${correction.targetType}:${correction.targetKey}`;
      if (!latest.has(key)) latest.set(key, correction.id);
    }
    return new Set(latest.values());
  }, [history]);

  const targetKey = selected
    ? targetType === "identity"
      ? selected.baseExternalId ?? selected.id
      : selected.printingKey ?? selected.id
    : "";

  async function runSearch() {
    if (!query.trim()) return;
    setBusy("search");
    setMessage(null);
    try {
      setResults(await searchCardsApi({ query: query.trim(), tcg, token }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Card search failed");
    } finally {
      setBusy(null);
    }
  }

  function selectCard(card: Card) {
    setSelected(card);
    setDraft({
      name: card.name,
      setCode: card.setCode ?? "",
      setName: card.setName ?? "",
      rarity: card.rarity ?? "",
      collectorNumber: card.collectorNumber ?? "",
      attributes: JSON.stringify(card.attributes ?? {}, null, 2),
      reason: "",
    });
  }

  async function saveCorrection() {
    if (!selected || !targetKey) return;
    setBusy("save");
    setMessage(null);
    try {
      const attributes = JSON.parse(draft.attributes || "{}") as unknown;
      if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
        throw new Error("Attributes must be a JSON object");
      }
      const patch: CatalogCorrectionPatch = {};
      if (draft.name.trim() !== selected.name) patch.name = draft.name.trim();
      if (draft.setCode.trim() !== (selected.setCode ?? "")) patch.setCode = draft.setCode.trim() || null;
      if (draft.setName.trim() !== (selected.setName ?? "")) patch.setName = draft.setName.trim() || null;
      if (draft.rarity.trim() !== (selected.rarity ?? "")) patch.rarity = draft.rarity.trim() || null;
      if (draft.collectorNumber.trim() !== (selected.collectorNumber ?? "")) {
        patch.collectorNumber = draft.collectorNumber.trim() || null;
      }
      if (JSON.stringify(attributes) !== JSON.stringify(selected.attributes ?? {})) {
        patch.attributes = attributes as Record<string, unknown>;
      }
      if (!Object.keys(patch).length) throw new Error("Change at least one field");
      await createCatalogCorrection(token, {
        tcg,
        targetType,
        targetKey,
        patch,
        reason: draft.reason,
      });
      setMessage("Correction revision saved. Collection views will use it immediately.");
      await loadHistory();
      window.dispatchEvent(new Event("tcger:catalog-corrections-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save correction");
    } finally {
      setBusy(null);
    }
  }

  async function rollback(correction: CatalogCorrection) {
    setBusy(correction.id);
    setMessage(null);
    try {
      await rollbackCatalogCorrection(token, correction.id);
      setMessage(`Rolled back revision ${correction.revision}.`);
      await loadHistory();
      window.dispatchEvent(new Event("tcger:catalog-corrections-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rollback failed");
    } finally {
      setBusy(null);
    }
  }

  async function syncBanlists() {
    setBusy("banlist");
    setMessage(null);
    try {
      const result = await synchronizeYugiohBanlists(token);
      setMessage(`Synchronized ${result.synced.length} Yu-Gi-Oh formats (${result.synced.reduce((sum, row) => sum + row.entryCount, 0)} restricted-card rows).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Banlist synchronization failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <DatabaseZap className="h-4 w-4" />
          Catalog maintenance
        </h3>
        <p className="text-sm text-muted-foreground">
          Overlay provider mistakes without editing upstream catalog records. Every change is revisioned and reversible.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Yu-Gi-Oh banlists</p>
          <p className="text-xs text-muted-foreground">
            Refresh Advanced and Traditional from the official Konami list, plus OCG and Goat identity data.
          </p>
        </div>
        <Button variant="outline" onClick={() => void syncBanlists()} disabled={busy === "banlist"}>
          {busy === "banlist" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Synchronize
        </Button>
      </div>

      <div className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[180px_180px_1fr_auto]">
        <Select value={tcg} onValueChange={(value) => setTcg(value as TcgCode)}>
          <SelectTrigger aria-label="Catalog game"><SelectValue /></SelectTrigger>
          <SelectContent>
            {games.map((game) => <SelectItem key={game} value={game}>{GAME_LABELS[game]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={targetType} onValueChange={(value) => setTargetType(value as "identity" | "printing")}>
          <SelectTrigger aria-label="Correction scope"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="printing">Exact printing</SelectItem>
            <SelectItem value="identity">All printings</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }}
          placeholder="Search the provider catalog"
          aria-label="Card search"
        />
        <Button onClick={() => void runSearch()} disabled={busy === "search" || !query.trim()}>
          {busy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </Button>
      </div>

      {results.length > 0 && (
        <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
          {results.slice(0, 20).map((card) => (
            <button
              type="button"
              key={`${card.tcg}:${card.printingKey ?? card.id}`}
              onClick={() => selectCard(card)}
              className="rounded-lg border p-3 text-left hover:border-primary"
            >
              <span className="block text-sm font-medium">{card.name}</span>
              <span className="block text-xs text-muted-foreground">
                {[card.setCode, card.rarity, card.collectorNumber].filter(Boolean).join(" · ") || "Base identity"}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-3 rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{targetType === "identity" ? "All printings" : "Exact printing"}</Badge>
            <code className="break-all text-xs text-muted-foreground">{targetKey}</code>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["name", "setCode", "setName", "rarity", "collectorNumber"] as const).map((field) => (
              <div key={field} className="space-y-1">
                <Label htmlFor={`catalog-${field}`}>{field === "setCode" ? "Set code" : field === "setName" ? "Set name" : field === "collectorNumber" ? "Collector number" : field[0]!.toUpperCase() + field.slice(1)}</Label>
                <Input id={`catalog-${field}`} value={draft[field]} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="catalog-attributes">Game-specific attributes</Label>
            <Textarea id="catalog-attributes" className="min-h-40 font-mono text-xs" value={draft.attributes} onChange={(event) => setDraft((current) => ({ ...current, attributes: event.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="catalog-reason">Reason</Label>
            <Input id="catalog-reason" value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Provider typo, wrong rarity, missing archetype…" />
          </div>
          <Button onClick={() => void saveCorrection()} disabled={busy === "save" || draft.reason.trim().length < 3}>
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
            Save revision
          </Button>
        </div>
      )}

      {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Recent revisions</h4>
          {busy === "history" && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        {history.slice(0, 12).map((correction) => (
          <div key={correction.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{GAME_LABELS[correction.tcg]}</Badge>
                <span className="font-medium">{correction.targetType}</span>
                <span>revision {correction.revision}</span>
                {correction.action === "remove" && <Badge variant="secondary">removed</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{correction.targetKey}</p>
              <p className="text-xs text-muted-foreground">{correction.reason}</p>
            </div>
            {latestIds.has(correction.id) && (
              <Button size="sm" variant="outline" onClick={() => void rollback(correction)} disabled={busy === correction.id}>
                {busy === correction.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Roll back
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
