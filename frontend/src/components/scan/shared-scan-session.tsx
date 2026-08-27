"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Smartphone, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCollections, type Collection } from "@/lib/api/collections";
import { scanCardImageApi } from "@/lib/api/scan";
import {
  addSharedScanItem,
  clearSharedScanItems,
  commitSharedScanSession,
  createSharedScanSession,
  getSharedScanItems,
  removeSharedScanItem,
  updateSharedScanItem,
  type SharedScanItem,
  type SharedScanSession,
} from "@/lib/api/scan-sessions";
import { useAuthStore } from "@/stores/auth";
import {
  normalizeScannerLanguage,
  SCANNER_DEFAULT_LANGUAGE_STORAGE_KEY,
  SCANNER_LANGUAGES,
} from "@/lib/scan/scanner-options";

export function SharedScanSessionPanel() {
  const token = useAuthStore((state) => state.token);
  const inputRef = useRef<HTMLInputElement>(null);
  const knownItemIdsRef = useRef(new Set<string>());
  const [session, setSession] = useState<SharedScanSession | null>(null);
  const [items, setItems] = useState<SharedScanItem[]>([]);
  const [binders, setBinders] = useState<Collection[]>([]);
  const [binderId, setBinderId] = useState("");
  const [language, setLanguage] = useState("English");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setLanguage(
        normalizeScannerLanguage(
          window.localStorage.getItem(SCANNER_DEFAULT_LANGUAGE_STORAGE_KEY),
        ),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const updateLanguage = (value: string) => {
    const next = normalizeScannerLanguage(value);
    setLanguage(next);
    window.localStorage.setItem(SCANNER_DEFAULT_LANGUAGE_STORAGE_KEY, next);
  };

  const applyItems = useCallback((nextItems: SharedScanItem[]) => {
    const nextIds = new Set(nextItems.map((item) => item.id));
    setItems(nextItems);
    setSelectedItemIds((current) => {
      const next = new Set([...current].filter((id) => nextIds.has(id)));
      for (const item of nextItems) {
        if (!knownItemIdsRef.current.has(item.id) && !item.committedEntryId) {
          next.add(item.id);
        }
      }
      return next;
    });
    knownItemIdsRef.current = nextIds;
  }, []);

  useEffect(() => {
    if (!token || !session || session.status !== "open") return;
    const refresh = () =>
      getSharedScanItems(token, session.id)
        .then(applyItems)
        .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => window.clearInterval(timer);
  }, [applyItems, session, token]);

  const start = async () => {
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      const [created, collections] = await Promise.all([
        createSharedScanSession(token, language),
        getCollections(token),
      ]);
      setSession(created);
      setBinders(collections);
      setBinderId(collections[0]?.id ?? "");
      setItems([]);
      setSelectedItemIds(new Set());
      knownItemIdsRef.current = new Set();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not start session",
      );
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!token || !session || !files?.length) return;
    setBusy(true);
    setMessage(null);
    let matched = 0;
    try {
      for (const file of Array.from(files)) {
        const result = await scanCardImageApi({
          file,
          token,
          tcg: "all",
          captureSource: "shared-web-session",
        });
        if (!result.match) continue;
        await addSharedScanItem(token, {
          code: session.code,
          clientEventId: crypto.randomUUID(),
          tcg: result.match.tcg,
          externalId: result.match.externalId,
          name: result.match.name,
          setCode: result.match.setCode ?? undefined,
          setName: result.match.setName ?? undefined,
          rarity: result.match.rarity ?? undefined,
          imageUrl: result.match.imageUrl ?? undefined,
          confidence: result.match.confidence,
          language,
        });
        matched += 1;
      }
      applyItems(await getSharedScanItems(token, session.id));
      setMessage(`Matched ${matched} of ${files.length} uploaded images.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Batch scan failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const edit = async (
    item: SharedScanItem,
    patch: Partial<Pick<SharedScanItem, "language" | "condition">> & {
      finishCode?: string | null;
      finishLabel?: string | null;
    },
  ) => {
    if (!token) return;
    try {
      const updated = await updateSharedScanItem(token, item.id, {
        language: patch.language ?? item.language,
        condition: patch.condition ?? item.condition,
        finishCode: patch.finishCode,
        finishLabel: patch.finishLabel,
      });
      setItems((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed");
    }
  };

  const commit = async () => {
    if (!token || !session || !binderId || !selectedItemIds.size) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await commitSharedScanSession(
        token,
        session.id,
        binderId,
        [...selectedItemIds],
      );
      const refreshed = await getSharedScanItems(token, session.id);
      applyItems(refreshed);
      setSelectedItemIds(new Set());
      const finished = refreshed.every((item) => item.committedEntryId);
      setSession({
        ...session,
        status: finished ? "committed" : "open",
        binderId,
      });
      setMessage(`Added ${result.committed} selected cards to the binder.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: SharedScanItem) => {
    if (!token || item.committedEntryId) return;
    setBusy(true);
    setMessage(null);
    try {
      await removeSharedScanItem(token, item.id);
      if (session) {
        applyItems(await getSharedScanItems(token, session.id));
      }
      setMessage(`Removed ${item.name} from the scan session.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!token || !session) return;
    if (!window.confirm("Remove every uncommitted card from this session?")) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await clearSharedScanItems(token, session.id);
      applyItems(await getSharedScanItems(token, session.id));
      setMessage(`Removed ${result.removed} uncommitted cards.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  };

  const editableItems = items.filter((item) => !item.committedEntryId);
  const allEditableSelected =
    editableItems.length > 0 &&
    editableItems.every((item) => selectedItemIds.has(item.id));

  const toggleAll = () => {
    setSelectedItemIds(
      allEditableSelected
        ? new Set()
        : new Set(editableItems.map((item) => item.id)),
    );
  };

  if (!token)
    return (
      <p className="text-sm text-muted-foreground">
        Sign in to share a scan session with the iOS app.
      </p>
    );

  return (
    <div className="space-y-4">
      {!session ? (
        <Card>
          <CardHeader>
            <CardTitle>Start on the web, scan on iPhone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Both devices connect to this TCGer server. Local-only iOS mode
              remains private to the phone.
            </p>
            <div className="max-w-xs space-y-2">
              <Label htmlFor="shared-scan-default-language">
                Default language
              </Label>
              <Select value={language} onValueChange={updateLanguage}>
                <SelectTrigger id="shared-scan-default-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCANNER_LANGUAGES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Saved on this browser and applied to new scanner sessions and
                uploaded matches.
              </p>
            </div>
            <Button onClick={() => void start()} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Smartphone className="mr-2 h-4 w-4" />
              )}
              Start shared session
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Enter this code in the iOS scanner
                </p>
                <p className="font-mono text-3xl font-bold tracking-[0.2em]">
                  {session.code}
                </p>
              </div>
              <div>
                <Input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => void upload(event.target.files)}
                />
                <Button
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy || session.status !== "open"}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload multiple images
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Staged cards ({items.length})</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={toggleAll}
                  disabled={busy || editableItems.length === 0}
                >
                  {allEditableSelected ? "Select none" : "Select all"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void clear()}
                  disabled={busy || editableItems.length === 0}
                >
                  Clear uncommitted
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length ? (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr_170px_150px_auto] sm:items-center"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.name}`}
                      checked={
                        !!item.committedEntryId || selectedItemIds.has(item.id)
                      }
                      disabled={busy || !!item.committedEntryId}
                      onChange={(event) =>
                        setSelectedItemIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-input"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.setName || item.setCode || item.tcg}
                        {item.confidence === undefined
                          ? ""
                          : ` · ${Math.round(item.confidence * 100)}% match`}
                        {item.committedEntryId ? " · Added" : ""}
                      </p>
                    </div>
                    <Select
                      value={item.language}
                      disabled={busy || !!item.committedEntryId}
                      onValueChange={(value) =>
                        void edit(item, { language: value })
                      }
                    >
                      <SelectTrigger aria-label={`Language for ${item.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCANNER_LANGUAGES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      key={`${item.id}:${item.finishCode ?? ""}`}
                      defaultValue={item.finishCode ?? ""}
                      disabled={busy || !!item.committedEntryId}
                      placeholder="Finish (optional)"
                      onBlur={(event) =>
                        void edit(item, {
                          finishCode: event.target.value || null,
                          finishLabel: event.target.value || null,
                        })
                      }
                      aria-label={`Finish for ${item.name}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => void remove(item)}
                      disabled={busy || !!item.committedEntryId}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Waiting for iPhone scans or image uploads…
                </p>
              )}
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
                <Select value={binderId} onValueChange={setBinderId}>
                  <SelectTrigger
                    className="sm:max-w-xs"
                    aria-label="Destination binder"
                  >
                    <SelectValue placeholder="Choose binder" />
                  </SelectTrigger>
                  <SelectContent>
                    {binders.map((binder) => (
                      <SelectItem key={binder.id} value={binder.id}>
                        {binder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => void commit()}
                  disabled={
                    busy ||
                    !selectedItemIds.size ||
                    !binderId ||
                    session.status !== "open"
                  }
                >
                  Add selected ({selectedItemIds.size}) to binder
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
