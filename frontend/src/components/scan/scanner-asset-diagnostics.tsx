"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  runScannerAssetDiagnostics,
  type ScannerAssetCheck,
} from "@/lib/scan/scanner-asset-diagnostics";

export function ScannerAssetDiagnostics() {
  const [checks, setChecks] = useState<ScannerAssetCheck[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setChecks([]);
    try {
      setChecks(await runScannerAssetDiagnostics());
    } finally {
      setRunning(false);
    }
  };

  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warning").length;

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Scanner asset diagnostics</h2>
          <p className="text-sm text-muted-foreground">
            Downloads and validates the active embedding index, encoder, gate,
            YOLO manifest/shards, and bundled reference files.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void run()}
          disabled={running}
        >
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ShieldAlert className="mr-2 h-4 w-4" />
          )}
          {running ? "Checking assets…" : "Run integrity checks"}
        </Button>
      </div>

      {checks.length > 0 ? (
        <>
          <div className="flex gap-2 text-sm">
            <Badge
              variant={failures ? "default" : "secondary"}
              className={
                failures
                  ? "bg-destructive text-destructive-foreground"
                  : undefined
              }
            >
              {failures} failed
            </Badge>
            <Badge variant="outline">{warnings} warnings</Badge>
            <Badge variant="outline">
              {checks.length - failures - warnings} passed
            </Badge>
          </div>
          <div className="space-y-2">
            {checks.map((check) => (
              <div
                key={check.id}
                className="flex items-start gap-3 rounded-md border p-3 text-sm"
              >
                {check.status === "pass" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <TriangleAlert
                    className={`mt-0.5 h-4 w-4 shrink-0 ${check.status === "fail" ? "text-destructive" : "text-amber-600"}`}
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium">{check.label}</p>
                  <p className="break-words text-muted-foreground">
                    {check.detail}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {check.url}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
