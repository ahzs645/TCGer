"use client";

import { useState } from "react";
import { FileDown, FileUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  commitCollectionSource,
  downloadCollectionImportTemplate,
  previewCollectionSource,
  type CollectionImportPreview,
} from "@/lib/api/collections";
import type {
  CollectionImportResolution,
  CollectionImportSourceFormat,
} from "@tcg/api-types";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";

const NO_DEFAULT_BINDER = "__none__";

export function CollectionImportDialog() {
  const { token, user } = useAuthStore();
  const { collections, fetchCollections } = useCollectionsStore((state) => ({
    collections: state.collections,
    fetchCollections: state.fetchCollections,
  }));
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<CollectionImportSourceFormat>("auto");
  const [resolutionsText, setResolutionsText] = useState("{}");
  const [defaultBinderId, setDefaultBinderId] = useState(NO_DEFAULT_BINDER);
  const [createMissingBinders, setCreateMissingBinders] = useState(false);
  const [preview, setPreview] = useState<CollectionImportPreview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | "template" | null>(
    null,
  );

  const options = {
    defaultBinderId:
      defaultBinderId === NO_DEFAULT_BINDER ? undefined : defaultBinderId,
    createMissingBinders,
  };

  const reset = () => {
    setCsv("");
    setFileName("");
    setFormat("auto");
    setResolutionsText("{}");
    setPreview(null);
    setStatus(null);
    setBusy(null);
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      setStatus("Import files are limited to 1 MB.");
      return;
    }
    setCsv(await file.text());
    setFileName(file.name);
    setPreview(null);
    setStatus(null);
  };

  const runPreview = async () => {
    if (!token || !csv) return;
    setBusy("preview");
    setStatus(null);
    try {
      const resolutions = JSON.parse(resolutionsText) as Record<
        string,
        CollectionImportResolution
      >;
      const result = await previewCollectionSource(
        token,
        { content: csv, fileName, format, resolutions, options },
        user,
      );
      setPreview(result);
      setStatus(
        result.valid
          ? `${result.sourceRows} source rows resolve to ${result.rows.length} inventory rows and ${result.totalCopies} copies.`
          : "Resolve the validation issues before importing.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!token || !csv || !preview?.valid) return;
    setBusy("commit");
    setStatus(null);
    try {
      const resolutions = JSON.parse(resolutionsText) as Record<
        string,
        CollectionImportResolution
      >;
      const result = await commitCollectionSource(
        token,
        { content: csv, fileName, format, resolutions, options },
        user,
      );
      setPreview(result);
      if (!result.valid) {
        setStatus("The import changed during validation. Review the issues.");
        return;
      }
      await fetchCollections(token);
      setStatus(
        `Imported ${result.importedCopies} copies across ${result.importedRows} rows.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = async () => {
    if (!token) return;
    setBusy("template");
    try {
      const blob = await downloadCollectionImportTemplate(token, user);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tcger-import-template.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Template download failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileUp className="mr-2 h-4 w-4" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import collection</DialogTitle>
          <DialogDescription>
            Preview first. Nothing is written unless every row is valid.
            Supports TCGer CSV, JSON, and Cardmarket Yu-Gi-Oh singles text.
            Duplicate rows with identical copy attributes are merged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Label
              htmlFor="collection-import-file"
              className="cursor-pointer rounded-md border px-3 py-2 text-sm"
            >
              Choose file
            </Label>
            <input
              id="collection-import-file"
              type="file"
              accept=".csv,.json,.txt,text/csv,text/plain,application/json"
              className="sr-only"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
            <span className="text-sm text-muted-foreground">
              {fileName || "No file selected"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={downloadTemplate}
              disabled={!token || busy !== null}
            >
              {busy === "template" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 h-4 w-4" />
              )}
              Template
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Source format</Label>
            <Select
              value={format}
              onValueChange={(value) => {
                setFormat(value as CollectionImportSourceFormat);
                setPreview(null);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="csv">TCGer CSV</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="cardmarket-text">Cardmarket Yu-Gi-Oh text</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              PDF text extraction is not bundled; export or copy the order as text first.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Default binder for rows without a binder</Label>
              <Select
                value={defaultBinderId}
                onValueChange={(value) => {
                  setDefaultBinderId(value);
                  setPreview(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEFAULT_BINDER}>Unsorted</SelectItem>
                  {collections.map((binder) => (
                    <SelectItem key={binder.id} value={binder.id}>
                      {binder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-3 self-end rounded-md border p-3">
              <Checkbox
                checked={createMissingBinders}
                onCheckedChange={(value) => {
                  setCreateMissingBinders(value === true);
                  setPreview(null);
                }}
              />
              <span className="text-sm">Create binders named by the CSV</span>
            </label>
          </div>

          {preview && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <span>{preview.rows.length} inventory rows</span>
                <span>·</span>
                <span>{preview.totalCopies} copies</span>
                <span>·</span>
                <span>{preview.issues.length} issues</span>
              </div>
              {preview.issues.length > 0 && (
                <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-destructive">
                  {preview.issues.slice(0, 50).map((issue, index) => (
                    <li key={`${issue.row}:${issue.field}:${index}`}>
                      Row {issue.row}
                      {issue.field ? `, ${issue.field}` : ""}: {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {(preview.ambiguities?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Exact printing resolutions required
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {preview.ambiguities?.map((ambiguity) => (
                      <li key={ambiguity.sourceRow}>
                        Source row {ambiguity.sourceRow}: {ambiguity.query.name}
                        {ambiguity.query.collectorNumber
                          ? ` (${ambiguity.query.collectorNumber})`
                          : ""}
                      </li>
                    ))}
                  </ul>
                  <Label htmlFor="collection-import-resolutions">
                    Resolution map (source row → exact card fields)
                  </Label>
                  <Textarea
                    id="collection-import-resolutions"
                    value={resolutionsText}
                    onChange={(event) => {
                      setResolutionsText(event.target.value);
                      setPreview(null);
                    }}
                    rows={5}
                    className="font-mono text-xs"
                    placeholder={'{"3":{"externalId":"...","baseExternalId":"46986414","printingKey":"..."}}'}
                  />
                </div>
              )}
              {preview.rows.length > 0 && (
                <div className="max-h-52 overflow-auto rounded border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="p-2">Card</th>
                        <th className="p-2">TCG</th>
                        <th className="p-2">Binder</th>
                        <th className="p-2 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 50).map((row) => (
                        <tr
                          key={`${row.row}:${row.tcg}:${row.externalId}`}
                          className="border-t"
                        >
                          <td className="p-2">{row.cardName}</td>
                          <td className="p-2">{row.tcg}</td>
                          <td className="p-2">{row.binderName || "Default"}</td>
                          <td className="p-2 text-right">{row.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={runPreview}
            disabled={!csv || busy !== null}
          >
            {busy === "preview" && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Preview
          </Button>
          <Button onClick={commit} disabled={!preview?.valid || busy !== null}>
            {busy === "commit" && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Import {preview?.totalCopies ?? 0} copies
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
