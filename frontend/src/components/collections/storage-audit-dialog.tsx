"use client";

import { useMemo, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import type { StorageAuditObservation, StorageAuditPreview, StorageCompartment, StorageContainer } from "@tcg/api-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { commitStorageAudit, previewStorageAudit } from "@/lib/api/collection-operations";

type EntryDetail = { collectionEntryId: string; name: string };

export function StorageAuditDialog({
  token,
  container,
  compartment,
  entries,
}: {
  token: string;
  container: StorageContainer;
  compartment?: StorageCompartment;
  entries: Map<string, EntryDetail>;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"manual" | "latest-binder-scan" | "import">(
    container.kind === "binder" && container.binderId ? "latest-binder-scan" : "manual",
  );
  const initialManual = useMemo<StorageAuditObservation[]>(() =>
    (compartment?.placements ?? []).map((placement) => ({
      compartmentId: compartment!.id,
      slotIndex: placement.slotIndex,
      collectionEntryId: placement.collectionEntryId,
      quantity: placement.quantity,
    })), [compartment]);
  const [manual, setManual] = useState<StorageAuditObservation[]>(initialManual);
  const [importText, setImportText] = useState("[]");
  const [preview, setPreview] = useState<StorageAuditPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const input = () => {
    let observations: StorageAuditObservation[] | undefined;
    if (source === "manual") observations = manual;
    if (source === "import") observations = JSON.parse(importText) as StorageAuditObservation[];
    return { containerId: container.id, compartmentId: compartment?.id, source, observations };
  };

  const runPreview = async () => {
    setBusy("preview"); setNotice(null);
    try { setPreview(await previewStorageAudit(token, input())); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Audit preview failed."); }
    finally { setBusy(null); }
  };
  const save = async () => {
    setBusy("save"); setNotice(null);
    try {
      const result = await commitStorageAudit(token, input());
      setPreview(result); setNotice("Audit saved as a reviewed, read-only record.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Audit could not be saved."); }
    finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><ClipboardCheck className="mr-2 h-4 w-4" />Audit location</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Audit {compartment?.label ?? container.name}</DialogTitle>
          <DialogDescription>Compare observed cards with the exact copies expected in each slot. Saving the audit never moves inventory.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Observation source</Label>
            <Select value={source} onValueChange={(value) => { setSource(value as typeof source); setPreview(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual check</SelectItem>
                <SelectItem value="latest-binder-scan" disabled={!container.binderId}>Latest binder scan</SelectItem>
                <SelectItem value="import">Scanner JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {source === "manual" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Uncheck a card that is missing. Use scanner JSON to record wrong or extra cards.</p>
              {(compartment?.placements ?? []).map((placement) => {
                const checked = manual.some((row) => row.collectionEntryId === placement.collectionEntryId && row.slotIndex === placement.slotIndex);
                return <label key={placement.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                  <Checkbox checked={checked} onCheckedChange={(value) => setManual((rows) => value === true ? [...rows, { compartmentId: compartment!.id, slotIndex: placement.slotIndex, collectionEntryId: placement.collectionEntryId, quantity: placement.quantity }] : rows.filter((row) => !(row.collectionEntryId === placement.collectionEntryId && row.slotIndex === placement.slotIndex)))} />
                  <span>Slot {placement.slotIndex + 1}: {entries.get(placement.collectionEntryId)?.name ?? "Unknown card"}</span>
                </label>;
              })}
            </div>
          ) : source === "import" ? (
            <div className="space-y-2">
              <Label htmlFor="audit-json">Observed cards JSON</Label>
              <Textarea id="audit-json" className="min-h-36 font-mono text-xs" value={importText} onChange={(event) => { setImportText(event.target.value); setPreview(null); }} placeholder={`[{"compartmentId":"${compartment?.id ?? "..."}","slotIndex":0,"externalId":"...","name":"Card","quantity":1}]`} />
            </div>
          ) : <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">The newest saved scan for page {compartment?.pageNumber ?? "—"} will be compared to this location.</p>}
          {preview && <div className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(preview.summary).map(([status, count]) => <Badge key={status} variant={status === "correct" ? "default" : "outline"}>{status}: {count}</Badge>)}
            </div>
            {preview.issues.map((issue) => <p key={issue} className="text-sm text-destructive">{issue}</p>)}
            <div className="max-h-60 overflow-auto">
              {preview.items.map((item) => <div key={`${item.compartmentId}:${item.slotIndex}`} className="grid grid-cols-[5rem_5rem_1fr] gap-2 border-b py-2 text-sm">
                <span>Slot {item.slotIndex + 1}</span><Badge variant="outline" className="w-fit">{item.status}</Badge>
                <span>{item.expectedName ?? "Empty"} → {item.observedName ?? "Empty"}</span>
              </div>)}
            </div>
          </div>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void runPreview()} disabled={busy !== null}>{busy === "preview" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preview audit</Button>
          <Button onClick={() => void save()} disabled={!preview?.valid || busy !== null}>{busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save audit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
