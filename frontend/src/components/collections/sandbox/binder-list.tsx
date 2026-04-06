"use client";

import { ChevronDown, Palette, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Collection } from "@/lib/api/collections";

interface BinderListProps {
  binders: Collection[];
  activeBinderId: string;
  onSelectBinder: (binderId: string) => void;
  onAddBinder?: () => void;
  onEditBinder?: (binderId: string) => void;
  onEditBinderColor?: (binderId: string) => void;
}

function normalizeColor(hex?: string) {
  if (!hex) return "#9CA3AF";
  return hex.startsWith("#") ? hex : `#${hex}`;
}

function binderCopyCount(binder: Collection) {
  return binder.cards.reduce(
    (sum, card) => sum + (card.copies?.length ?? card.quantity ?? 0),
    0,
  );
}

export function BinderList({
  binders,
  activeBinderId,
  onSelectBinder,
  onAddBinder,
  onEditBinder,
  onEditBinderColor,
}: BinderListProps) {
  const totals = binders.reduce(
    (acc, binder) => {
      acc.rows += binder.cards.length;
      acc.copies += binderCopyCount(binder);
      return acc;
    },
    { rows: 0, copies: 0 },
  );

  const activeBinder = binders.find((b) => b.id === activeBinderId);
  const activeLabel =
    activeBinderId === "all"
      ? "All binders"
      : (activeBinder?.name ?? "Select binder");
  const activeColor =
    activeBinderId === "all"
      ? undefined
      : normalizeColor(activeBinder?.colorHex);
  const activeCount =
    activeBinderId === "all"
      ? `${totals.copies} copies · ${totals.rows} unique`
      : activeBinder
        ? `${binderCopyCount(activeBinder)} copies · ${activeBinder.cards.length} unique`
        : "";

  return (
    <div className="space-y-2" data-oid="kas:4nw">
      <div
        className="flex items-center justify-between gap-2"
        data-oid="i7.9f-w"
      >
        <div data-oid="ws8o4wz">
          <p
            className="text-sm font-semibold text-foreground"
            data-oid="7i:0l_i"
          >
            Binder
          </p>
          <p
            className="text-xs text-muted-foreground hidden sm:block"
            data-oid="_fq3qlg"
          >
            Switch between binder scopes or jump into All binders.
          </p>
        </div>
      </div>

      <DropdownMenu data-oid="p2qsfcc">
        <DropdownMenuTrigger asChild data-oid="kpfv-_4">
          <Button
            variant="outline"
            className="w-full justify-between gap-2 h-auto py-2"
            data-oid="m078ijk"
          >
            <div className="flex items-center gap-2 min-w-0" data-oid="ucum8tx">
              {activeColor && (
                <span
                  className="inline-flex h-3 w-3 rounded-full shrink-0 border border-gray-300 dark:border-gray-600"
                  style={{ backgroundColor: activeColor }}
                  data-oid="dv31lx7"
                />
              )}
              <div className="text-left min-w-0" data-oid="d04:le0">
                <p className="text-sm font-medium truncate" data-oid="k4ofef0">
                  {activeLabel}
                </p>
                <p
                  className="text-xs text-muted-foreground font-normal"
                  data-oid="_6n57mh"
                >
                  {activeCount}
                </p>
              </div>
            </div>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground"
              data-oid=".gagrhv"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-80 overflow-y-auto"
          data-oid="c5kjmy8"
        >
          <DropdownMenuLabel data-oid="dmb__d5">Binders</DropdownMenuLabel>
          <DropdownMenuGroup data-oid="k8ahwcn">
            <DropdownMenuItem
              className="flex items-center justify-between gap-2"
              onSelect={() => onSelectBinder("all")}
              data-oid="xuev.ri"
            >
              <span className="font-medium" data-oid="r9ekcpm">
                All binders
              </span>
              <span
                className="text-xs text-muted-foreground"
                data-oid="-r6:3o."
              >
                {totals.copies}
              </span>
            </DropdownMenuItem>
            {binders.map((binder) => {
              const color = normalizeColor(binder.colorHex);
              const copies = binderCopyCount(binder);
              return (
                <DropdownMenuItem
                  key={binder.id}
                  className="flex items-center gap-2 group/item"
                  onSelect={() => onSelectBinder(binder.id)}
                  data-oid="utylm2j"
                >
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                    data-oid="_-gwrpd"
                  />

                  <span className="flex-1 truncate" data-oid="u:obm3q">
                    {binder.name}
                  </span>
                  <div className="flex items-center gap-1" data-oid=".hc8le2">
                    {onEditBinder && (
                      <button
                        className="h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted hidden group-focus/item:flex group-hover/item:flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBinder(binder.id);
                        }}
                        data-oid="4l88yds"
                      >
                        <Pencil className="h-3 w-3" data-oid="me3v8pd" />
                      </button>
                    )}
                    {onEditBinderColor && (
                      <button
                        className="h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted hidden group-focus/item:flex group-hover/item:flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBinderColor(binder.id);
                        }}
                        data-oid=":em9fw4"
                      >
                        <Palette className="h-3 w-3" data-oid="18-t3lp" />
                      </button>
                    )}
                    <span
                      className="text-xs text-muted-foreground tabular-nums"
                      data-oid="-wb_tad"
                    >
                      {copies}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          {onAddBinder && (
            <>
              <DropdownMenuSeparator data-oid=":tzwiv5" />
              <DropdownMenuItem
                onSelect={onAddBinder}
                className="gap-2"
                data-oid="9kjorui"
              >
                <Plus className="h-3.5 w-3.5" data-oid="w:81k66" />
                Add binder
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
