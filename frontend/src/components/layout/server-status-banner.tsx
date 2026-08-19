"use client";

import { CloudOff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useServerStatus } from "@/lib/api/health";

/**
 * Says out loud that the API is unreachable.
 *
 * Without it, a total backend outage renders as an ordinary empty account:
 * "Welcome to your dashboard — start by adding cards to a binder", zero cards,
 * zero value, achievements at 0/8. Nothing on screen distinguishes "your server
 * is down" from "you are new here", and the only trace is a console error.
 */
export function ServerStatusBanner({ demoMode }: { demoMode: boolean }) {
  const { status, retry } = useServerStatus();

  // The demo runs entirely in the browser and has no API to reach.
  if (demoMode || status !== "offline") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-destructive/40 bg-destructive/10"
      data-oid="server-status-banner"
    >
      <div className="mx-auto flex w-full flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span className="flex items-start gap-2 text-destructive-foreground">
          <CloudOff
            className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <span className="min-w-0">
            <strong className="font-medium">
              Can&rsquo;t reach the TCGer server.
            </strong>{" "}
            <span className="text-muted-foreground">
              Your collection isn&rsquo;t loading — what you see below may be
              empty or out of date. Nothing you change now will be saved.
            </span>
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={retry}
          className="self-start sm:self-auto"
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  );
}
