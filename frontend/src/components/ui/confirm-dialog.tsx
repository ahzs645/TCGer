"use client";

import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Label for the confirming action. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Use for anything irreversible. */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Promise-based replacement for `window.confirm`.
 *
 * Native confirms are unstyled, ignore the app's theme, cannot be dismissed by
 * the same affordances as the rest of the UI, and are suppressed outright in
 * some embedded contexts — which silently turns "are you sure?" into "yes".
 *
 * Usage mirrors the native call it replaces:
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   ...
 *   if (!(await confirm({ title: "Delete X?", destructive: true }))) return;
 *   ...
 *   return <>{confirmDialog}...</>;
 */
export function useConfirm(): [
  (options: ConfirmOptions) => Promise<boolean>,
  React.ReactNode,
] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Held in a ref so an unmount or a second call can settle the first promise
  // rather than leaving the caller awaiting forever.
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        // Escape, overlay click and the close button all land here.
        if (!open) settle(false);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          {pending?.description ? (
            <DialogDescription>{pending.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => settle(false)}>
            {pending?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={pending?.destructive ? "destructive" : "default"}
            onClick={() => settle(true)}
            autoFocus
          >
            {pending?.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return [confirm, dialog];
}
