"use client";

import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { CollectionTag } from "@/lib/api/collections";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface TagComboboxProps {
  inputId?: string;
  availableTags: CollectionTag[];
  selectedTags: string[];
  onToggleTag: (tagId: string) => void;
  onCreateTag: (label: string) => Promise<CollectionTag>;
}

export function TagCombobox({
  inputId,
  availableTags,
  selectedTags,
  onToggleTag,
  onCreateTag,
}: TagComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim();
  const normalizedLower = normalizedQuery.toLowerCase();

  const filteredTags = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }
    return availableTags.filter(
      (tag) =>
        !selectedTags.includes(tag.id) &&
        tag.label.toLowerCase().includes(normalizedLower),
    );
  }, [availableTags, normalizedLower, normalizedQuery, selectedTags]);

  const canCreate =
    normalizedQuery.length > 1 &&
    !availableTags.some((tag) => tag.label.toLowerCase() === normalizedLower);
  const optionCount = filteredTags.length + (canCreate ? 1 : 0);
  const activeOptionId =
    activeIndex < filteredTags.length
      ? `${listboxId}-${filteredTags[activeIndex]?.id}`
      : canCreate
        ? `${listboxId}-create`
        : undefined;

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const shouldListen = open;
    if (shouldListen) {
      document.addEventListener("mousedown", handler);
    }
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelectTag = (tagId: string) => {
    onToggleTag(tagId);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
    setCreateError(null);
  };

  const handleCreateTag = async () => {
    if (!normalizedQuery.length || isCreating) {
      return;
    }
    try {
      setIsCreating(true);
      setCreateError(null);
      const tag = await onCreateTag(normalizedQuery);
      onToggleTag(tag.id);
      setQuery("");
      setOpen(false);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Could not create this tag.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        optionCount ? (current + 1) % optionCount : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        optionCount ? (current - 1 + optionCount) % optionCount : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex < filteredTags.length) {
        handleSelectTag(filteredTags[activeIndex]?.id ?? filteredTags[0].id);
      } else if (canCreate) {
        void handleCreateTag();
      }
    } else if (event.key === "Escape") {
      if (!open && !query) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
      setActiveIndex(0);
    }
  };

  const showSuggestions = open;
  return (
    <div className="space-y-2" data-oid="l9hodsd">
      <div className="flex flex-wrap gap-2" data-oid="7zj3iu_">
        {selectedTags.length ? (
          selectedTags.map((tagId) => {
            const tag = availableTags.find((entry) => entry.id === tagId);
            if (!tag) return null;
            return (
              <button
                type="button"
                key={tag.id}
                className="inline-flex min-h-8 items-center rounded-full border border-transparent px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                style={{ backgroundColor: tag.colorHex, color: "#0B1121" }}
                onClick={() => onToggleTag(tag.id)}
                aria-label={`Remove ${tag.label} tag`}
                data-oid="igqmz.z"
              >
                {tag.label} <span aria-hidden="true">×</span>
              </button>
            );
          })
        ) : (
          <Badge variant="outline" data-oid="yym0v-4">
            No tags yet
          </Badge>
        )}
      </div>
      <div className="relative" ref={containerRef} data-oid="59gn962">
        <Input
          id={inputId}
          role="combobox"
          aria-label="Tags"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={showSuggestions ? listboxId : undefined}
          aria-activedescendant={showSuggestions ? activeOptionId : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            setCreateError(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedTags.length ? "Type to adjust tags" : "Type to add tags"
          }
          data-oid="_y-9tx2"
        />

        {showSuggestions ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Tag suggestions"
            className="absolute z-20 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg"
            data-oid="wx18719"
          >
            {!normalizedQuery.length ? (
              <p
                className="px-3 py-2 text-xs text-muted-foreground"
                data-oid="0x5t6n4"
              >
                Start typing to search existing tags.
              </p>
            ) : (
              <>
                {filteredTags.length ? (
                  <ul
                    role="none"
                    className="max-h-48 overflow-y-auto py-1"
                    data-oid="c15t39y"
                  >
                    {filteredTags.map((tag, index) => (
                      <li key={tag.id} role="none" data-oid="1avczxa">
                        <button
                          id={`${listboxId}-${tag.id}`}
                          type="button"
                          role="option"
                          aria-selected={index === activeIndex}
                          tabIndex={-1}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                            index === activeIndex ? "bg-muted" : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleSelectTag(tag.id);
                          }}
                          onMouseEnter={() => setActiveIndex(index)}
                          data-oid="uvvz-s9"
                        >
                          <span
                            className="inline-flex h-2 w-2 rounded-full"
                            style={{ backgroundColor: tag.colorHex }}
                            data-oid="aoo-_yr"
                          />
                          <span data-oid="2zg0mvs">{tag.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p
                    className="px-3 py-2 text-sm text-muted-foreground"
                    data-oid="9baf0i:"
                  >
                    No tags found.
                  </p>
                )}
                {canCreate ? (
                  <div className="border-t px-2 py-2" data-oid="7xwczdv">
                    <Button
                      id={`${listboxId}-create`}
                      type="button"
                      role="option"
                      aria-selected={activeIndex === filteredTags.length}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      disabled={isCreating}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(filteredTags.length)}
                      onClick={() => void handleCreateTag()}
                      data-oid="opg5cvw"
                    >
                      {isCreating
                        ? "Creating..."
                        : `Create "${normalizedQuery}"`}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {createError ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {createError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
