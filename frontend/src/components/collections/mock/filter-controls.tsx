'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Filter, Tag as TagIcon } from 'lucide-react';
import type { CollectionTag } from '@/lib/api/collections';
import { CONDITION_COPY, CONDITION_ORDER, formatCurrency } from './mock-helpers';

interface FilterControlsProps {
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

export function FilterControls({
  priceRange,
  onPriceRangeChange,
  activeTags,
  onToggleTag,
  activeConditions,
  onToggleCondition,
  summary,
  tags
}: FilterControlsProps) {
  const highlightedLabels = useMemo(() => {
    return summary.highlightedTags
      .map(([tagId]) => tags.find((tag) => tag.id === tagId)?.label)
      .filter(Boolean)
      .join(', ');
  }, [summary.highlightedTags, tags]);

  const handlePriceInputChange = (index: 0 | 1, value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }
    if (index === 0) {
      const nextMin = Math.max(0, Math.min(parsed, priceRange[1]));
      onPriceRangeChange([nextMin, priceRange[1]]);
    } else {
      const nextMax = Math.min(5000, Math.max(parsed, priceRange[0]));
      onPriceRangeChange([priceRange[0], nextMax]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs uppercase text-muted-foreground">Estimated value focus</Label>
        <Slider
          min={0}
          max={3000}
          step={25}
          value={priceRange}
          onValueChange={(value) => onPriceRangeChange(value as [number, number])}
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Input
            type="number"
            value={priceRange[0]}
            onChange={(event) => handlePriceInputChange(0, event.target.value)}
            className="h-8 w-24"
          />
          <span>to</span>
          <Input
            type="number"
            value={priceRange[1]}
            onChange={(event) => handlePriceInputChange(1, event.target.value)}
            className="h-8 w-24"
          />
          <span>({formatCurrency(priceRange[0])} – {formatCurrency(priceRange[1])})</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase text-muted-foreground">Tag focus</Label>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const isActive = activeTags.includes(tag.id);
            return (
              <Button
                key={tag.id}
                variant={isActive ? 'default' : 'secondary'}
                size="sm"
                className="gap-1"
                style={
                  isActive
                    ? { backgroundColor: tag.colorHex, color: '#0B1121' }
                    : undefined
                }
                onClick={() => onToggleTag(tag.id)}
              >
                <TagIcon className="h-3 w-3" />
                {tag.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase text-muted-foreground">Condition bands</Label>
        <div className="flex flex-wrap gap-2">
          {CONDITION_ORDER.map((condition) => {
            const meta = CONDITION_COPY[condition];
            const isActive = activeConditions.includes(condition);
            return (
              <Button
                key={condition}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                className="gap-2"
                onClick={() => onToggleCondition(condition)}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Badge variant="outline" className="gap-1">
          <Filter className="h-3 w-3" />
          {summary.rows} card row{summary.rows === 1 ? '' : 's'}
        </Badge>
        <Badge variant="outline">{summary.copies} total copies</Badge>
        <Badge variant="outline">Focus tags: {highlightedLabels || '—'}</Badge>
      </div>
    </div>
  );
}
