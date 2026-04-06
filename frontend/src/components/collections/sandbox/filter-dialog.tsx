"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FilterControls } from "./filter-controls";
import { Filter } from "lucide-react";
import type { CollectionTag } from "@/lib/api/collections";
import type { CONDITION_ORDER } from "./helpers";

interface FilterDialogProps {
  priceRange: [number, number];
  onPriceRangeChange: (value: [number, number]) => void;
  activeTags: string[];
  onToggleTag: (tagId: string) => void;
  activeConditions: (typeof CONDITION_ORDER)[number][];
  onToggleCondition: (condition: (typeof CONDITION_ORDER)[number]) => void;
  summary: {
    rows: number;
    copies: number;
    highlightedTags: [string, number][];
  };
  tags: CollectionTag[];
}

export function FilterDialog(props: FilterDialogProps) {
  const [open, setOpen] = useState(false);
  const appliedFilters = useMemo(() => {
    return (
      props.activeTags.length +
      props.activeConditions.length +
      (props.priceRange[0] > 0 || props.priceRange[1] < 3000 ? 1 : 0)
    );
  }, [
    props.activeTags.length,
    props.activeConditions.length,
    props.priceRange,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen} data-oid="id1i0x9">
      <DialogTrigger asChild data-oid="0-lcdsi">
        <Button variant="outline" className="gap-2" data-oid="7-14mjy">
          <Filter className="h-4 w-4" data-oid="sf0tl_2" />
          Filters
          {appliedFilters > 0 && (
            <span
              className="rounded-full bg-primary/10 px-2 text-xs font-medium text-primary"
              data-oid="xq7ipaw"
            >
              {appliedFilters}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl" data-oid="l4qj8xm">
        <DialogHeader data-oid="710_z03">
          <DialogTitle data-oid="6qdq0x_">Filter collection</DialogTitle>
          <DialogDescription data-oid="_:9bigk">
            Slice the binder by tag, game condition, language, or estimated
            value range.
          </DialogDescription>
        </DialogHeader>
        <FilterControls {...props} data-oid="adt-vc0" />
      </DialogContent>
    </Dialog>
  );
}
