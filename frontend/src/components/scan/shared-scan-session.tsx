"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Smartphone, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCollections, type Collection } from "@/lib/api/collections";
import { scanCardImageApi } from "@/lib/api/scan";
import {
  addSharedScanItem,
  commitSharedScanSession,
  createSharedScanSession,
  getSharedScanItems,
  updateSharedScanItem,
  type SharedScanItem,
  type SharedScanSession,
} from "@/lib/api/scan-sessions";
import { useAuthStore } from "@/stores/auth";

const languages = ["English", "Japanese", "German", "French", "Italian", "Spanish", "Portuguese", "Korean", "Chinese"];

export function SharedScanSessionPanel() {
  const token = useAuthStore((state) => state.token);
  const inputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<SharedScanSession | null>(null);
  const [items, setItems] = useState<SharedScanItem[]>([]);
  const [binders, setBinders] = useState<Collection[]>([]);
  const [binderId, setBinderId] = useState("");
  const [language, setLanguage] = useState("English");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !session || session.status !== "open") return;
    const refresh = () => getSharedScanItems(token, session.id).then(setItems).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => window.clearInterval(timer);
  }, [session, token]);

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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start session");
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
        const result = await scanCardImageApi({ file, token, tcg: "all", captureSource: "shared-web-session" });
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
      setItems(await getSharedScanItems(token, session.id));
      setMessage(`Matched ${matched} of ${files.length} uploaded images.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Batch scan failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const edit = async (item: SharedScanItem, patch: Partial<SharedScanItem>) => {
    if (!token) return;
    const updated = await updateSharedScanItem(token, item.id, {
      language: patch.language ?? item.language,
      condition: patch.condition ?? item.condition,
      finishCode: patch.finishCode,
      finishLabel: patch.finishLabel,
    });
    setItems((current) => current.map((row) => row.id === updated.id ? updated : row));
  };

  const commit = async () => {
    if (!token || !session || !binderId) return;
    setBusy(true);
    try {
      const result = await commitSharedScanSession(token, session.id, binderId);
      setSession({ ...session, status: "committed", binderId });
      setMessage(`Committed ${result.committed} cards to the binder.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commit failed");
    } finally { setBusy(false); }
  };

  if (!token) return <p className="text-sm text-muted-foreground">Sign in to share a scan session with the iOS app.</p>;

  return (
    <div className="space-y-4">
      {!session ? (
        <Card>
          <CardHeader><CardTitle>Start on the web, scan on iPhone</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Both devices connect to this TCGer server. Local-only iOS mode remains private to the phone.</p>
            <div className="max-w-xs space-y-2">
              <Label>Default language</Label>
              <Select value={language} onValueChange={setLanguage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{languages.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
            </div>
            <Button onClick={() => void start()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}Start shared session</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm text-muted-foreground">Enter this code in the iOS scanner</p><p className="font-mono text-3xl font-bold tracking-[0.2em]">{session.code}</p></div>
              <div><Input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void upload(event.target.files)} /><Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy || session.status !== "open"}><Upload className="mr-2 h-4 w-4" />Upload multiple images</Button></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Staged cards ({items.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {items.length ? items.map((item) => (
                <div key={item.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_170px_150px] sm:items-center">
                  <div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="truncate text-xs text-muted-foreground">{item.setName || item.setCode || item.tcg}{item.confidence === undefined ? "" : ` · ${Math.round(item.confidence * 100)}% match`}</p></div>
                  <Select value={item.language} onValueChange={(value) => void edit(item, { language: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{languages.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
                  <Input value={item.finishCode ?? ""} placeholder="Finish (optional)" onChange={(event) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, finishCode: event.target.value } : row))} onBlur={(event) => void edit(item, { finishCode: event.target.value || undefined, finishLabel: event.target.value || undefined })} />
                </div>
              )) : <p className="py-8 text-center text-sm text-muted-foreground">Waiting for iPhone scans or image uploads…</p>}
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
                <Select value={binderId} onValueChange={setBinderId}><SelectTrigger className="sm:max-w-xs"><SelectValue placeholder="Choose binder" /></SelectTrigger><SelectContent>{binders.map((binder) => <SelectItem key={binder.id} value={binder.id}>{binder.name}</SelectItem>)}</SelectContent></Select>
                <Button onClick={() => void commit()} disabled={busy || !items.length || !binderId || session.status !== "open"}>Commit session to binder</Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}
