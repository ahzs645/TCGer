"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Filter, Tag as TagIcon } from "lucide-react";
import type { CollectionTag } from "@/lib/api/collections";
import { CONDITION_COPY, CONDITION_ORDER, formatCurrency } from "./helpers";

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
  tags,
}: FilterControlsProps) {
  const highlightedLabels = useMemo(() => {
    return summary.highlightedTags
      .map(([tagId]) => tags.find((tag) => tag.id === tagId)?.label)
      .filter(Boolean)
      .join(", ");
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
    <div className="space-y-4" data-oid="zr0leh7">
      <div className="space-y-2" data-oid="bygxl2o">
        <Label
          className="text-xs uppercase text-muted-foreground"
          data-oid="x4-optz"
        >
          Estimated value focus
        </Label>
        <Slider
          min={0}
          max={3000}
          step={25}
          value={priceRange}
          onValueChange={(value) =>
            onPriceRangeChange(value as [number, number])
          }
          data-oid="r_eg1h5"
        />

        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-oid="mlr-6bl"
        >
          <Input
            type="number"
            value={priceRange[0]}
            onChange={(event) => handlePriceInputChange(0, event.target.value)}
            className="h-8 w-24"
            data-oid="esrswnx"
          />

          <span data-oid="tfy1uf9">to</span>
          <Input
            type="number"
            value={priceRange[1]}
            onChange={(event) => handlePriceInputChange(1, event.target.value)}
            className="h-8 w-24"
            data-oid="z-p0gp9"
          />

          <span data-oid="a1tt9rt">
            ({formatCurrency(priceRange[0])} – {formatCurrency(priceRange[1])})
          </span>
        </div>
      </div>

      <div className="space-y-2" data-oid="0t:5uuj">
        <Label
          className="text-xs uppercase text-muted-foreground"
          data-oid="q_d-36q"
        >
          Tag focus
        </Label>
        <div className="flex flex-wrap gap-2" data-oid="bgrpk-8">
          {tags.map((tag) => {
            const isActive = activeTags.includes(tag.id);
            return (
              <Button
                key={tag.id}
                variant={isActive ? "default" : "secondary"}
                size="sm"
                className="gap-1"
                style={
                  isActive
                    ? { backgroundColor: tag.colorHex, color: "#0B1121" }
                    : undefined
                }
                onClick={() => onToggleTag(tag.id)}
                data-oid="xt3nfhl"
              >
                <TagIcon className="h-3 w-3" data-oid="6t7u:6h" />
                {tag.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2" data-oid="w7hbjm7">
        <Label
          className="text-xs uppercase text-muted-foreground"
          data-oid="l64h40u"
        >
          Condition bands
        </Label>
        <div className="flex flex-wrap gap-2" data-oid="-.r9:ma">
          {CONDITION_ORDER.map((condition) => {
            const meta = CONDITION_COPY[condition];
            const isActive = activeConditions.includes(condition);
            return (
              <Button
                key={condition}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => onToggleCondition(condition)}
                data-oid="mg.49vg"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: meta.color }}
                  data-oid="c1xce3y"
                />
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3" data-oid="x:ko.e1">
        <Badge variant="outline" className="gap-1" data-oid="vj15z81">
          <Filter className="h-3 w-3" data-oid="qksie_y" />
          {summary.rows} card row{summary.rows === 1 ? "" : "s"}
        </Badge>
        <Badge variant="outline" data-oid="bx-vmze">
          {summary.copies} total copies
        </Badge>
        <Badge variant="outline" data-oid="1tjam3k">
          Focus tags: {highlightedLabels || "—"}
        </Badge>
      </div>
    </div>
  );
}
