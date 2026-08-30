"use client";

import { useMemo } from "react";
import type {
  CollectionFacet,
  CollectionFacetCard,
  GameDefinition,
  GameFilterSelection,
} from "@tcg/api-types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collectionFacetOptions } from "@tcg/api-types";

interface GameFacetFiltersProps {
  definition: GameDefinition;
  cards: readonly CollectionFacetCard[];
  selections: Readonly<Record<string, GameFilterSelection | undefined>>;
  onChange: (facetId: string, selection: GameFilterSelection | undefined) => void;
}

function NumberRangeFacet({
  facet,
  value,
  onChange,
}: {
  facet: Extract<CollectionFacet, { type: "numberRange" }>;
  value: GameFilterSelection | undefined;
  onChange: (selection: GameFilterSelection | undefined) => void;
}) {
  const range = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  function update(key: "min" | "max", raw: string) {
    const next = { ...range, [key]: raw === "" ? undefined : Number(raw) };
    if (next.min === undefined && next.max === undefined) onChange(undefined);
    else onChange(next);
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        type="number"
        min={facet.min}
        max={facet.max}
        step={facet.step ?? 1}
        value={range.min ?? ""}
        onChange={(event) => update("min", event.target.value)}
        placeholder={`Min ${facet.min}`}
        aria-label={`Minimum ${facet.label}`}
      />
      <Input
        type="number"
        min={facet.min}
        max={facet.max}
        step={facet.step ?? 1}
        value={range.max ?? ""}
        onChange={(event) => update("max", event.target.value)}
        placeholder={`Max ${facet.max}`}
        aria-label={`Maximum ${facet.label}`}
      />
    </div>
  );
}

function FacetControl({
  facet,
  cards,
  value,
  onChange,
}: {
  facet: CollectionFacet;
  cards: readonly CollectionFacetCard[];
  value: GameFilterSelection | undefined;
  onChange: (selection: GameFilterSelection | undefined) => void;
}) {
  const options = useMemo(() => collectionFacetOptions(cards, facet), [cards, facet]);

  if (facet.type === "numberRange") {
    return <NumberRangeFacet facet={facet} value={value} onChange={onChange} />;
  }
  if (facet.type === "text") {
    return (
      <Input
        value={typeof value === "string" ? value : ""}
        maxLength={facet.maxLength}
        onChange={(event) => onChange(event.target.value || undefined)}
        placeholder={`Filter by ${facet.label.toLocaleLowerCase()}`}
      />
    );
  }
  if (facet.type === "boolean") {
    return (
      <Select
        value={typeof value === "boolean" ? String(value) : "all"}
        onValueChange={(next) => onChange(next === "all" ? undefined : next === "true")}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="true">{facet.trueLabel ?? "Yes"}</SelectItem>
          <SelectItem value="false">{facet.falseLabel ?? "No"}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (facet.type === "select") {
    return (
      <Select
        value={value === undefined ? "__all__" : String(value)}
        onValueChange={(next) => onChange(next === "__all__" ? undefined : next)}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {options.map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  const selected = Array.isArray(value) ? value : [];
  return (
    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
      {options.slice(0, 60).map((option) => {
        const optionValue = String(option.value);
        const active = selected.some((candidate) => String(candidate) === optionValue);
        return (
          <Button
            key={optionValue}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            onClick={() => {
              const next = active
                ? selected.filter((candidate) => String(candidate) !== optionValue)
                : [...selected, optionValue];
              onChange(next.length ? next : undefined);
            }}
          >
            {option.label}
          </Button>
        );
      })}
      {!options.length && <span className="text-xs text-muted-foreground">No values in this collection</span>}
    </div>
  );
}

export function GameFacetFilters({
  definition,
  cards,
  selections,
  onChange,
}: GameFacetFiltersProps) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-medium">{definition.label} fields</p>
        <p className="text-xs text-muted-foreground">
          These controls come from the game definition, so future games can declare their own fields.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {definition.collection.facets.map((facet) => (
          <div key={facet.id} className="space-y-1.5">
            <Label>{facet.label}</Label>
            <FacetControl
              facet={facet}
              cards={cards}
              value={selections[facet.id]}
              onChange={(selection) => onChange(facet.id, selection)}
            />
            {facet.help && <p className="text-xs text-muted-foreground">{facet.help}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
