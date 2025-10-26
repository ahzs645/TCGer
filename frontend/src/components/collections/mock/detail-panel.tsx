'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CONDITION_COPY, CONDITION_ORDER, conditionRangeLabel, formatCurrency } from './mock-helpers';
import type { Collection, CollectionCard, CollectionCardCopy, CollectionTag } from '@/lib/api/collections';
import { TagCombobox } from './tag-combobox';

const GAME_LABELS: Record<string, string> = {
  magic: 'Magic: The Gathering',
  yugioh: 'Yu-Gi-Oh!',
  pokemon: 'Pokémon'
};

interface MockDetailPanelProps {
  card: CollectionCard | null;
  selectedCopy: CollectionCardCopy | null;
  availableTags: CollectionTag[];
  draftCopyTags: string[];
  onToggleTag: (tagId: string) => void;
  onCreateTag: (label: string) => Promise<CollectionTag>;
  binderOptions: { id: string; name: string; colorHex?: string }[];
  draftBinderId: string;
  draftCondition: (typeof CONDITION_ORDER)[number];
  draftNotes: string;
  onBinderChange: (binderId: string) => void;
  onConditionChange: (condition: (typeof CONDITION_ORDER)[number]) => void;
  onNotesChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onMove: () => void;
  moveStatus: 'idle' | 'pending' | 'success' | 'error';
  moveError: string | null;
  status: 'idle' | 'saving' | 'success' | 'error';
  errorMessage: string | null;
}

export function MockDetailPanel({
  card,
  selectedCopy,
  availableTags,
  draftCopyTags,
  onToggleTag,
  onCreateTag,
  binderOptions,
  draftBinderId,
  draftCondition,
  draftNotes,
  onBinderChange,
  onConditionChange,
  onNotesChange,
  onSave,
  onReset,
  onMove,
  moveStatus,
  moveError,
  status,
  errorMessage
}: MockDetailPanelProps) {
  if (!card) {
    return (
      <Card className="sticky top-4 h-fit">
        <CardHeader>
          <CardTitle>Select a card</CardTitle>
          <CardDescription>Choose a row from the table to preview binder details and edit metadata.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="sticky top-4 h-fit">
      <CardHeader className="space-y-4">
        <div className="flex gap-4">
          <div className="w-36 shrink-0">
            {card.imageUrl ? (
              <Button
                variant="ghost"
                className="w-full overflow-hidden rounded-lg border-2 bg-muted p-0 h-auto"
                style={{ borderColor: card.binderColorHex || 'var(--border)' }}
                onClick={() => {
                  const overlay = window.open('', '_blank');
                  if (overlay) {
                    overlay.document.write(`<img src=\"${card.imageUrl}\" style=\"width:100%;height:100%;object-fit:contain\" />`);
                  }
                }}
              >
                <Image
                  src={card.imageUrl}
                  alt={card.name}
                  width={240}
                  height={340}
                  className="w-full"
                  style={{ height: 'auto', objectFit: 'contain' }}
                />
              </Button>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                No image
              </div>
            )}
          </div>
          <div className="space-y-2">
            <CardTitle>{card.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {card.setName ?? card.setCode} · #{card.cardId}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <p className="uppercase">Binder</p>
                <p className="text-sm font-medium text-foreground">{card.binderName ?? 'Unsorted'}</p>
              </div>
              <div>
                <p className="uppercase">Game</p>
                <p className="text-sm font-medium text-foreground">{GAME_LABELS[card.tcg]}</p>
              </div>
              <div>
                <p className="uppercase">Rarity</p>
                <p className="text-sm font-medium text-foreground">{card.rarity ?? 'Unknown'}</p>
              </div>
              <div>
                <p className="uppercase">Quantity</p>
                <p className="text-sm font-medium text-foreground">{card.copies.length}</p>
              </div>
              <div>
                <p className="uppercase">Condition</p>
                <p className="text-sm font-medium text-foreground">{conditionRangeLabel(card.copies)}</p>
              </div>
              <div>
                <p className="uppercase">Est. value</p>
                <p className="text-sm font-medium text-foreground">{formatCurrency(card.price)}</p>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedCopy ? (
          <>
            <div className="space-y-2">
              <Label>Binder assignment</Label>
              <Select value={draftBinderId} onValueChange={onBinderChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select binder" />
                </SelectTrigger>
                <SelectContent>
                  {binderOptions.map((binder) => (
                    <SelectItem key={binder.id} value={binder.id}>
                      {binder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Button variant="secondary" className="w-full" onClick={onMove} disabled={moveStatus === 'pending'}>
                {moveStatus === 'pending' ? 'Moving…' : 'Move card'}
              </Button>
              {moveStatus === 'success' && <p className="text-xs text-emerald-600">Copy moved successfully.</p>}
              {moveStatus === 'error' && <p className="text-xs text-destructive">{moveError ?? 'Unable to move copy.'}</p>}
            </div>
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select value={draftCondition} onValueChange={(value) => onConditionChange(value as (typeof CONDITION_ORDER)[number])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_ORDER.map((condition) => (
                    <SelectItem key={condition} value={condition}>
                      {CONDITION_COPY[condition].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={draftNotes}
                onChange={(event) => onNotesChange(event.target.value)}
                rows={4}
                placeholder="Add personal notes (sleeves, grading plans, etc.)"
              />
            </div>
            <div className="space-y-2">
              <Label>Tags</Label>
              <TagCombobox
                availableTags={availableTags}
                selectedTags={draftCopyTags}
                onToggleTag={onToggleTag}
                onCreateTag={onCreateTag}
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={onSave}>
                {status === 'saving' ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={onReset}>
                Reset
              </Button>
            </div>
            {status === 'success' && <p className="text-xs text-emerald-600">Copy updated successfully.</p>}
            {status === 'error' && <p className="text-xs text-destructive">{errorMessage ?? 'Failed to update copy.'}</p>}
          </>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Select a specific copy from the table to edit binder assignment, condition, notes, or tags.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
