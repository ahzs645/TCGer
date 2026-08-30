"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers3 } from "lucide-react";
import type { CollectionCard, YugiohBanlistSnapshot } from "@tcg/api-types";
import { groupCollectionCards } from "@tcg/api-types";

import { YugiohLimitBadge } from "@/components/cards/yugioh-limit-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { banlistEntryForCollectionCard, indexYugiohBanlist } from "@/lib/yugioh-banlist";
import { formatCurrency } from "./helpers";

export function ConsolidatedCollection({
  cards,
  selectedCardId,
  showPricing,
  banlist,
  onSelect,
}: {
  cards: CollectionCard[];
  selectedCardId: string | null;
  showPricing: boolean;
  banlist?: YugiohBanlistSnapshot | null;
  onSelect: (cardId: string, trigger?: HTMLElement) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupCollectionCards(cards), [cards]);
  const banlistIndex = useMemo(() => indexYugiohBanlist(banlist), [banlist]);

  if (!groups.length) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No cards match these filters.</div>;
  }

  return (
    <div className="divide-y">
      {groups.map((group) => {
        const isExpanded = expanded.has(group.key);
        const first = group.printings[0]!;
        const entry = banlistEntryForCollectionCard(first, banlistIndex);
        return (
          <div key={group.key}>
            <div className="flex items-center gap-3 px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.name} printings`}
                onClick={() => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{group.name}</p>
                  <YugiohLimitBadge entry={entry} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{group.totalQuantity} owned</span>
                  <span>·</span>
                  <span>{group.printings.length} {group.printings.length === 1 ? "printing" : "printings"}</span>
                  {showPricing && group.totalValue !== undefined ? <><span>·</span><span>{formatCurrency(group.totalValue)}</span></> : null}
                </div>
              </div>
              <Layers3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>

            {isExpanded ? (
              <div className="space-y-2 bg-muted/20 px-4 py-3 pl-16">
                {group.printings.map((printing) => (
                  <button
                    key={printing.id}
                    type="button"
                    aria-pressed={selectedCardId === printing.id}
                    onClick={(event) => onSelect(printing.id, event.currentTarget)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selectedCardId === printing.id && "border-primary bg-primary/5",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {printing.setName ?? printing.setCode ?? "Unknown set"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[printing.setCode, printing.collectorNumber ? `#${printing.collectorNumber}` : undefined, printing.rarity]
                          .filter(Boolean).join(" · ") || "Printing details unavailable"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary">{printing.quantity}×</Badge>
                      {showPricing && printing.price !== undefined ? (
                        <span className="text-xs text-muted-foreground">{formatCurrency(printing.price)}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
