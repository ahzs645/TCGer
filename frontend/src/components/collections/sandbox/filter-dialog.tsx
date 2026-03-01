'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { FilterControls } from './filter-controls';
import { Filter } from 'lucide-react';
import type { CollectionTag } from '@/lib/api/collections';
import type { CONDITION_ORDER } from './helpers';

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
    return props.activeTags.length + props.activeConditions.length + (props.priceRange[0] > 0 || props.priceRange[1] < 3000 ? 1 : 0);
  }, [props.activeTags.length, props.activeConditions.length, props.priceRange]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
          {appliedFilters > 0 && (
            <span className="rounded-full bg-primary/10 px-2 text-xs font-medium text-primary">{appliedFilters}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Filter collection</DialogTitle>
          <DialogDescription>Slice the binder by tag, game condition, language, or estimated value range.</DialogDescription>
        </DialogHeader>
        <FilterControls {...props} />
      </DialogContent>
    </Dialog>
  );
}
