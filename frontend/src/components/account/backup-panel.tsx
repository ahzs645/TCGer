"use client";
import { useState } from "react";
import { normalizePortableBackup, type PortableBackup } from "@tcg/api-types";
import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "@/lib/api/base-url";
import { isDemoMode } from "@/lib/demo-mode";
import {
  exportLocalBackup,
  importLocalBackup,
} from "@/lib/storage/portable-backup";
import { restoreDemoBackup } from "@/stores/demo-store";

export function BackupPanel({ token }: { token: string | null }) {
  const [pending, setPending] = useState<PortableBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const request = async (path: string, options?: RequestInit) => {
    if (!token) throw new Error("Sign in before transferring a hosted backup");
    const response = await fetch(`${API_BASE_URL}/backups${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.message ?? body.error ?? "Backup transfer failed");
    return body;
  };
  return (
    <section className="space-y-3" aria-label="Backup and recovery">
      <h3 className="font-semibold">Backup &amp; recovery</h3>
      <p className="text-sm text-muted-foreground">
        Transfer collections, copy details, wishlists, sealed inventory and
        saved records between web, iOS and Android. Extra sections remain in the
        backup even when this interface cannot display them. Credentials and
        downloaded catalogs are excluded.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const backup = isDemoMode()
                ? await exportLocalBackup()
                : await request("");
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(backup, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `tcger-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setMessage("Backup exported.");
            })
          }
        >
          Export JSON backup
        </Button>
        <label className="text-sm">
          Import backup
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            aria-label="Import portable backup"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file)
                void run(async () => {
                  setPending(
                    normalizePortableBackup(JSON.parse(await file.text())),
                  );
                });
            }}
          />
        </label>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Restore the snapshot saved before the last import? This replaces data covered by that recovery point.",
              )
            )
              void run(async () => {
                if (isDemoMode()) await restoreDemoBackup();
                else await request("/recovery", { method: "POST" });
                setMessage(
                  "Recovery point restored. Reload to refresh all open views.",
                );
              });
          }}
        >
          Restore recovery point
        </Button>
      </div>
      {pending && (
        <div className="space-y-2 rounded border p-3">
          <p>
            {pending.binders.length} binders ·{" "}
            {pending.binders.reduce(
              (n, binder) =>
                n + binder.cards.reduce((sum, card) => sum + card.quantity, 0),
              0,
            )}{" "}
            copies · {pending.wishlists.length} wishlists. Existing matching IDs
            will be updated; other data is retained.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (isDemoMode()) await importLocalBackup(pending);
                else
                  await request("", {
                    method: "POST",
                    body: JSON.stringify(pending),
                  });
                setPending(null);
                setMessage(
                  "Import saved. A recovery point is available. Reload to refresh all open views.",
                );
              })
            }
          >
            Import reviewed backup
          </Button>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
