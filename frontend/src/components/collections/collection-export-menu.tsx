"use client";

import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadCollectionExport } from "@/lib/api/collections";
import { useAuthStore } from "@/stores/auth";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function CollectionExportMenu() {
  const token = useAuthStore((state) => state.token);
  const viewer = useAuthStore((state) => state.user);
  type ExportFormat = "csv" | "json" | "manabox" | "moxfield" | "tcgplayer" | "collectr";
  const [format, setFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportCollection = async (nextFormat: ExportFormat) => {
    if (!token) return;
    setFormat(nextFormat);
    setError(null);
    try {
      const blob = await downloadCollectionExport(token, nextFormat, viewer);
      const date = new Date().toISOString().slice(0, 10);
      saveBlob(
        blob,
        nextFormat === "csv" || nextFormat === "json"
          ? `tcger-collection-${date}.${nextFormat}`
          : `tcger-${nextFormat}-${date}.csv`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to export collection.",
      );
    } finally {
      setFormat(null);
    }
  };

  return (
    <div className="space-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={!token || format !== null}
          >
            {format ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {format ? `Exporting ${format.toUpperCase()}…` : "Export"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportCollection("csv")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportCollection("json")}>
            <FileJson className="mr-2 h-4 w-4" />
            Export JSON
          </DropdownMenuItem>
          {(["manabox", "moxfield", "tcgplayer", "collectr"] as const).map((profile) => (
            <DropdownMenuItem key={profile} onSelect={() => void exportCollection(profile)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export {profile === "tcgplayer" ? "TCGPlayer" : profile === "manabox" ? "ManaBox" : profile[0].toUpperCase() + profile.slice(1)} CSV
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="max-w-56 text-right text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
