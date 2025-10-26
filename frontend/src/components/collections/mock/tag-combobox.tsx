'use client';

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CollectionTag } from '@/lib/api/collections';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface TagComboboxProps {
  availableTags: CollectionTag[];
  selectedTags: string[];
  onToggleTag: (tagId: string) => void;
  onCreateTag: (label: string) => Promise<CollectionTag>;
}

export function TagCombobox({ availableTags, selectedTags, onToggleTag, onCreateTag }: TagComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim();
  const normalizedLower = normalizedQuery.toLowerCase();

  const filteredTags = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }
    return availableTags.filter(
      (tag) => !selectedTags.includes(tag.id) && tag.label.toLowerCase().includes(normalizedLower)
    );
  }, [availableTags, normalizedLower, normalizedQuery, selectedTags]);

  const canCreate =
    normalizedQuery.length > 1 && !availableTags.some((tag) => tag.label.toLowerCase() === normalizedLower);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const shouldListen = open;
    if (shouldListen) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelectTag = (tagId: string) => {
    onToggleTag(tagId);
    setQuery('');
    setOpen(false);
  };

  const handleCreateTag = async () => {
    if (!normalizedQuery.length || isCreating) {
      return;
    }
    try {
      setIsCreating(true);
      const tag = await onCreateTag(normalizedQuery);
      onToggleTag(tag.id);
      setQuery('');
      setOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (filteredTags.length) {
        handleSelectTag(filteredTags[0].id);
      } else if (canCreate) {
        void handleCreateTag();
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  const showSuggestions = open;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {selectedTags.length ? (
          selectedTags.map((tagId) => {
            const tag = availableTags.find((entry) => entry.id === tagId);
            if (!tag) return null;
            return (
              <Badge
                key={tag.id}
                className="cursor-pointer"
                style={{ backgroundColor: tag.colorHex, color: '#0B1121' }}
                onClick={() => onToggleTag(tag.id)}
              >
                {tag.label}
              </Badge>
            );
          })
        ) : (
          <Badge variant="outline">No tags yet</Badge>
        )}
      </div>
      <div className="relative" ref={containerRef}>
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedTags.length ? 'Type to adjust tags' : 'Type to add tags'}
        />
        {showSuggestions ? (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg">
            {!normalizedQuery.length ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Start typing to search existing tags.</p>
            ) : (
              <>
                {filteredTags.length ? (
                  <ul className="max-h-48 overflow-y-auto py-1">
                    {filteredTags.map((tag) => (
                      <li key={tag.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleSelectTag(tag.id);
                          }}
                        >
                          <span className="inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: tag.colorHex }} />
                          <span>{tag.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No tags found.</p>
                )}
                {canCreate ? (
                  <div className="border-t px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      disabled={isCreating}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void handleCreateTag()}
                    >
                      {isCreating ? 'Creating...' : `Create "${normalizedQuery}"`}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
