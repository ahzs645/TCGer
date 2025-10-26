'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, Search, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

import { LIBRARY_COLLECTION_ID, type Collection, type CollectionCard, type CollectionCardCopy, type CollectionTag, type UpdateCollectionCardInput } from '@/lib/api/collections';
import { conditionRangeLabel, formatCurrency, CONDITION_ORDER } from './mock-helpers';
import { FilterDialog } from './filter-dialog';
import { BinderList } from './binder-list';
import { MockDetailPanel } from './detail-panel';
import { useCollectionsStore } from '@/stores/collections';
import { useTagsStore } from '@/stores/tags';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';

const DEFAULT_PRICE_RANGE: [number, number] = [0, 3000];
const DEFAULT_BINDER_COLORS = [
  '#4B5563',
  '#6B7280',
  '#9CA3AF',
  '#E5E7EB',
  '#F3F4F6',
  '#FAFAFA',
  '#F97316',
  '#FB923C',
  '#FCD34D',
  '#A3E635',
  '#4ADE80',
  '#06B6D4',
  '#0284C7',
  '#3B82F6',
  '#6366F1',
  '#A855F7'
] as const;

function normalizeHex(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function isValidHexColor(value: string) {
  return /^#?[0-9A-Fa-f]{6}$/.test(value.trim());
}

function flattenBinders(binders: Collection[]) {
  return binders.flatMap((binder) =>
    binder.cards.map((card) => ({
      ...card,
      binderId: card.binderId ?? binder.id,
      binderName: card.binderName ?? binder.name,
      binderColorHex: card.binderColorHex ?? binder.colorHex
    }))
  );
}

function summarizeTags(cards: CollectionCard[]) {
  const tagCounts = new Map<string, number>();
  cards.forEach((card) => {
    card.copies?.forEach((copy) => {
      copy.tags.forEach((tag) => {
        tagCounts.set(tag.id, (tagCounts.get(tag.id) ?? 0) + 1);
      });
    });
  });
  return Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
}

export function MockCollectionView() {
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { collections, fetchCollections, updateCollectionCard, addCollection, updateCollection, hasFetched, isLoading } = useCollectionsStore((state) => ({
    collections: state.collections,
    fetchCollections: state.fetchCollections,
    updateCollectionCard: state.updateCollectionCard,
    addCollection: state.addCollection,
    updateCollection: state.updateCollection,
    hasFetched: state.hasFetched,
    isLoading: state.isLoading
  }));
  const { tags, fetchTags, addTag } = useTagsStore();

  const [binderFilter, setBinderFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeConditions, setActiveConditions] = useState<(typeof CONDITION_ORDER)[number][]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>(DEFAULT_PRICE_RANGE);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCopyId, setSelectedCopyId] = useState<string | null>(null);
  const [draftBinderId, setDraftBinderId] = useState<string>(LIBRARY_COLLECTION_ID);
  const [draftCondition, setDraftCondition] = useState<(typeof CONDITION_ORDER)[number]>('NM');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftCopyTags, setDraftCopyTags] = useState<string[]>([]);
  const [pendingBinderId, setPendingBinderId] = useState<string>(LIBRARY_COLLECTION_ID);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [moveStatus, setMoveStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isCreateBinderOpen, setIsCreateBinderOpen] = useState(false);
  const [newBinderName, setNewBinderName] = useState('');
  const [newBinderDescription, setNewBinderDescription] = useState('');
  const [newBinderColor, setNewBinderColor] = useState<string>(DEFAULT_BINDER_COLORS[0]);
  const [isCreatingBinder, setIsCreatingBinder] = useState(false);
  const [createBinderError, setCreateBinderError] = useState<string | null>(null);
  const [editBinderId, setEditBinderId] = useState<string | null>(null);
  const [isEditBinderOpen, setIsEditBinderOpen] = useState(false);
  const [isEditBinderColorOpen, setIsEditBinderColorOpen] = useState(false);
  const [editBinderName, setEditBinderName] = useState('');
  const [editBinderDescription, setEditBinderDescription] = useState('');
  const [editBinderColor, setEditBinderColor] = useState<string>('');
  const [isEditingBinder, setIsEditingBinder] = useState(false);
  const [editBinderError, setEditBinderError] = useState<string | null>(null);

  useEffect(() => {
    const binderParam = searchParams.get('binder');
    if (binderParam) {
      setBinderFilter(binderParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (token && !hasFetched) {
      fetchCollections(token);
    }
  }, [token, hasFetched, fetchCollections]);

  useEffect(() => {
    if (token) {
      fetchTags(token);
    }
  }, [token, fetchTags]);

  const binders = collections;
  const flattenedCards = useMemo(() => flattenBinders(binders), [binders]);
  const activeBinder = useMemo(() => binders.find((binder) => binder.id === binderFilter) ?? null, [binders, binderFilter]);
  const workingCards = binderFilter === 'all' ? flattenedCards : activeBinder?.cards ?? [];

  const maxPrice = useMemo(() => {
    const maxValue = flattenedCards.reduce((value, card) => Math.max(value, card.price ?? 0), 0);
    return maxValue || DEFAULT_PRICE_RANGE[1];
  }, [flattenedCards]);

  useEffect(() => {
    setPriceRange([0, maxPrice]);
  }, [maxPrice, binderFilter]);

  const filteredCards = useMemo(() => {
    return workingCards.filter((card) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesText =
          card.name.toLowerCase().includes(query) ||
          (card.setName?.toLowerCase().includes(query) ?? false) ||
          (card.setCode?.toLowerCase().includes(query) ?? false);
        if (!matchesText) {
          return false;
        }
      }

      if (activeTags.length) {
        const cardTagSet = new Set<string>();
        card.copies?.forEach((copy) => copy.tags.forEach((tag) => cardTagSet.add(tag.id)));
        const hasTags = activeTags.every((tagId) => cardTagSet.has(tagId));
        if (!hasTags) {
          return false;
        }
      }

      if (activeConditions.length) {
        const matchesCondition = card.copies?.some((copy) => copy.condition && activeConditions.includes(copy.condition as (typeof CONDITION_ORDER)[number])) ?? false;
        if (!matchesCondition) {
          return false;
        }
      }

      const price = card.price ?? 0;
      if (price < priceRange[0] || price > priceRange[1]) {
        return false;
      }

      return true;
    });
  }, [workingCards, searchTerm, activeTags, activeConditions, priceRange]);

  const sortedCards = useMemo(() => [...filteredCards].sort((a, b) => a.name.localeCompare(b.name)), [filteredCards]);

  useEffect(() => {
    if (!sortedCards.length) {
      setSelectedCardId(null);
      setSelectedCopyId(null);
      return;
    }
    setSelectedCardId((current) => (current && sortedCards.some((card) => card.id === current) ? current : sortedCards[0]?.id ?? null));
  }, [sortedCards]);

  const selectedCard = useMemo(() => sortedCards.find((card) => card.id === selectedCardId) ?? null, [sortedCards, selectedCardId]);

  useEffect(() => {
    if (selectedCard) {
      setSelectedCopyId((current) => {
        if (current && selectedCard.copies?.some((copy) => copy.id === current)) {
          return current;
        }
        const copyCount = selectedCard.copies?.length ?? 0;
        if (copyCount === 1) {
          return selectedCard.copies?.[0]?.id ?? null;
        }
        return null;
      });
      setDraftBinderId(selectedCard.binderId ?? LIBRARY_COLLECTION_ID);
      setPendingBinderId(selectedCard.binderId ?? LIBRARY_COLLECTION_ID);
      setExpandedRows((prev) =>
        Object.prototype.hasOwnProperty.call(prev, selectedCard.id) ? prev : { ...prev, [selectedCard.id]: true }
      );
    } else {
      setSelectedCopyId(null);
    }
  }, [selectedCard]);

  const selectedCopy = useMemo<CollectionCardCopy | null>(
    () => selectedCard?.copies?.find((copy) => copy.id === selectedCopyId) ?? null,
    [selectedCard, selectedCopyId]
  );

  useEffect(() => {
    if (selectedCopy) {
      setDraftCondition(((selectedCopy.condition as (typeof CONDITION_ORDER)[number]) ?? 'NM') as (typeof CONDITION_ORDER)[number]);
      setDraftNotes(selectedCopy.notes ?? '');
      setDraftCopyTags(selectedCopy.tags.map((tag) => tag.id));
    } else {
      setDraftNotes('');
      setDraftCopyTags([]);
    }
    setStatus('idle');
    setErrorMessage(null);
    setMoveStatus('idle');
    setMoveError(null);
  }, [selectedCopy]);

  const summary = useMemo(() => {
    const rows = sortedCards.length;
    const copies = sortedCards.reduce((sum, card) => sum + (card.copies?.length ?? card.quantity ?? 0), 0);
    return {
      rows,
      copies,
      highlightedTags: summarizeTags(sortedCards)
    };
  }, [sortedCards]);

  const binderOptions = useMemo(
    () =>
      binders.map((binder) => ({
        id: binder.id,
        name: binder.name,
        colorHex: binder.colorHex
      })),
    [binders]
  );

  const toggleRowExpansion = (cardId: string) => {
    setExpandedRows((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  const toggleTagFilter = (tagId: string) => {
    setActiveTags((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const toggleConditionFilter = (condition: (typeof CONDITION_ORDER)[number]) => {
    setActiveConditions((prev) => (prev.includes(condition) ? prev.filter((value) => value !== condition) : [...prev, condition]));
  };

  const handleBinderChange = (binderId: string) => {
    setBinderFilter(binderId);
    router.replace(binderId === 'all' ? '/collections' : `/collections?binder=${binderId}`, { scroll: false });
  };

  const handleTagToggle = (tagId: string) => {
    setDraftCopyTags((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const handleCreateTag = useCallback(
    async (label: string): Promise<CollectionTag> => {
      if (!token) {
        throw new Error('Authentication required');
      }
      const tag = await addTag(token, { label });
      return { id: tag.id, label: tag.label, colorHex: tag.colorHex };
    },
    [token, addTag]
  );

  const buildUpdatePayload = (): UpdateCollectionCardInput | null => {
    if (!selectedCopy) {
      return null;
    }
    const updates: UpdateCollectionCardInput = {};
    if ((draftCondition ?? null) !== (selectedCopy.condition ?? null)) {
      updates.condition = draftCondition;
    }
    if (draftNotes !== (selectedCopy.notes ?? '')) {
      const trimmed = draftNotes.trim();
      updates.notes = trimmed.length ? draftNotes : null;
    }
    const sameTags = draftCopyTags.length === selectedCopy.tags.length && draftCopyTags.every((id) => selectedCopy.tags.some((tag) => tag.id === id));
    if (!sameTags) {
      updates.tags = draftCopyTags;
    }
    return Object.keys(updates).length ? updates : null;
  };

  const handleSave = async () => {
    if (!token || !selectedCard || !selectedCopy) {
      return;
    }
    const payload = buildUpdatePayload();
    if (!payload) {
      return;
    }
    setStatus('saving');
    setErrorMessage(null);
    try {
      await updateCollectionCard(token, selectedCard.binderId ?? LIBRARY_COLLECTION_ID, selectedCopy.id, payload);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update copy');
    }
  };

  const handleMove = async () => {
    if (!token || !selectedCard || !selectedCopy || !pendingBinderId || pendingBinderId === (selectedCard.binderId ?? LIBRARY_COLLECTION_ID)) {
      return;
    }
    setMoveStatus('pending');
    setMoveError(null);
    try {
      await updateCollectionCard(token, selectedCard.binderId ?? LIBRARY_COLLECTION_ID, selectedCopy.id, {
        targetBinderId: pendingBinderId
      });
      setMoveStatus('success');
    } catch (error) {
      setMoveStatus('error');
      setMoveError(error instanceof Error ? error.message : 'Failed to move copy');
    }
  };

  const closeCreateBinderDialog = () => {
    setIsCreateBinderOpen(false);
    setNewBinderName('');
    setNewBinderDescription('');
    setNewBinderColor(DEFAULT_BINDER_COLORS[0]);
    setIsCreatingBinder(false);
    setCreateBinderError(null);
  };

  const handleCreateBinder = async () => {
    if (!token) {
      setCreateBinderError('Sign in to create binders.');
      return;
    }
    const trimmedName = newBinderName.trim();
    if (!trimmedName) {
      setCreateBinderError('Binder name is required.');
      return;
    }
    const trimmedDescription = newBinderDescription.trim();
    const colorInput = newBinderColor.trim();
    let colorHex: string | undefined;
    if (colorInput) {
      const normalizedColor = normalizeHex(colorInput);
      if (!isValidHexColor(normalizedColor)) {
        setCreateBinderError('Enter a valid 6-digit hex color (e.g., #1F2937).');
        return;
      }
      colorHex = normalizedColor.toUpperCase();
    }
    setIsCreatingBinder(true);
    setCreateBinderError(null);
    try {
      const payload: { name: string; description?: string; colorHex?: string } = { name: trimmedName };
      if (trimmedDescription) {
        payload.description = trimmedDescription;
      }
      if (colorHex) {
        payload.colorHex = colorHex;
      }
      const newBinderId = await addCollection(token, payload);
      closeCreateBinderDialog();
      handleBinderChange(newBinderId);
    } catch (error) {
      setCreateBinderError(error instanceof Error ? error.message : 'Failed to create binder.');
    } finally {
      setIsCreatingBinder(false);
    }
  };

  const handleCreateDialogChange = (open: boolean) => {
    if (!open) {
      closeCreateBinderDialog();
    } else {
      setIsCreateBinderOpen(true);
    }
  };

  const handleEditBinder = (binderId: string) => {
    const binder = binders.find((b) => b.id === binderId);
    if (!binder) return;
    setEditBinderId(binderId);
    setEditBinderName(binder.name);
    setEditBinderDescription(binder.description ?? '');
    setEditBinderError(null);
    setIsEditBinderOpen(true);
  };

  const handleEditBinderColor = (binderId: string) => {
    const binder = binders.find((b) => b.id === binderId);
    if (!binder) return;
    setEditBinderId(binderId);
    setEditBinderColor(binder.colorHex ?? DEFAULT_BINDER_COLORS[0]);
    setEditBinderError(null);
    setIsEditBinderColorOpen(true);
  };

  const closeEditBinderDialog = () => {
    setIsEditBinderOpen(false);
    setIsEditBinderColorOpen(false);
    setEditBinderId(null);
    setEditBinderName('');
    setEditBinderDescription('');
    setEditBinderColor('');
    setIsEditingBinder(false);
    setEditBinderError(null);
  };

  const handleSaveBinderEdit = async () => {
    if (!token || !editBinderId) return;
    const trimmedName = editBinderName.trim();
    if (!trimmedName) {
      setEditBinderError('Binder name is required.');
      return;
    }
    const trimmedDescription = editBinderDescription.trim();
    setIsEditingBinder(true);
    setEditBinderError(null);
    try {
      const payload: { name?: string; description?: string } = { name: trimmedName };
      if (trimmedDescription) {
        payload.description = trimmedDescription;
      }
      await updateCollection(token, editBinderId, payload);
      closeEditBinderDialog();
    } catch (error) {
      setEditBinderError(error instanceof Error ? error.message : 'Failed to update binder.');
    } finally {
      setIsEditingBinder(false);
    }
  };

  const handleSaveBinderColor = async () => {
    if (!token || !editBinderId) return;
    const colorInput = editBinderColor.trim();
    if (!colorInput) {
      setEditBinderError('Color is required.');
      return;
    }
    const normalizedColor = normalizeHex(colorInput);
    if (!isValidHexColor(normalizedColor)) {
      setEditBinderError('Enter a valid 6-digit hex color (e.g., #1F2937).');
      return;
    }
    setIsEditingBinder(true);
    setEditBinderError(null);
    try {
      await updateCollection(token, editBinderId, { colorHex: normalizedColor.toUpperCase() });
      closeEditBinderDialog();
    } catch (error) {
      setEditBinderError(error instanceof Error ? error.message : 'Failed to update binder color.');
    } finally {
      setIsEditingBinder(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Binder pulse
          </CardTitle>
          <CardDescription>Snapshot metrics for the current scope—rows, copies, and trending tags.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Visible rows</p>
              <p className="text-2xl font-semibold text-foreground">{summary.rows}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Total copies</p>
              <p className="text-2xl font-semibold text-foreground">{summary.copies}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Focus tags</p>
              <p className="text-sm font-medium text-foreground">
                {summary.highlightedTags
                  .map(([tagId]) => tags.find((tag) => tag.id === tagId)?.label)
                  .filter(Boolean)
                  .join(', ') || '—'}
              </p>
            </div>
          </div>
          <BinderList
            binders={binders}
            activeBinderId={binderFilter}
            onSelectBinder={handleBinderChange}
            onAddBinder={token ? () => {
              setNewBinderName('');
              setNewBinderDescription('');
              setCreateBinderError(null);
              setIsCreateBinderOpen(true);
            } : undefined}
            onEditBinder={token ? handleEditBinder : undefined}
            onEditBinderColor={token ? handleEditBinderColor : undefined}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>Collection overview</CardTitle>
                <CardDescription>Select a row to inspect individual copies.</CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search this binder"
                  className="sm:w-64"
                />
                <FilterDialog
                  priceRange={priceRange}
                  onPriceRangeChange={setPriceRange}
                  activeTags={activeTags}
                  onToggleTag={toggleTagFilter}
                  activeConditions={activeConditions}
                  onToggleCondition={toggleConditionFilter}
                  summary={summary}
                  tags={tags}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>{isLoading ? 'Loading…' : `${filteredCards.length} card row${filteredCards.length === 1 ? '' : 's'}`}</span>
              <span>{selectedCard ? `Binder: ${selectedCard.binderName ?? 'Unsorted'}` : 'Select a row to edit'}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Card</TableHead>
                  <TableHead>Binder</TableHead>
                  <TableHead>Rarity</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Est. value</TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCards.map((card) => {
                  const expanded = expandedRows[card.id];
                  const aggregatedTags = Array.from(new Set(card.copies?.flatMap((copy) => copy.tags.map((tag) => tag.id)) ?? []));
                  return (
                    <Fragment key={card.id}>
                      <TableRow
                        key={`${card.id}-row`}
                        className={cn('cursor-pointer transition-colors', selectedCardId === card.id && 'bg-primary/5')}
                        onClick={() => setSelectedCardId(card.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 rounded-full"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleRowExpansion(card.id);
                              }}
                            >
                              {expanded ? '−' : '+'}
                            </Button>
                            <div>
                              <p className="font-medium leading-tight">{card.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {card.setName ?? card.setCode ?? 'Unknown set'}
                                {card.setCode ? ` · #${card.setCode}` : ''}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{card.binderName ?? 'Unsorted'}</TableCell>
                        <TableCell>{card.rarity ?? 'N/A'}</TableCell>
                        <TableCell>{card.copies?.length ?? card.quantity}</TableCell>
                        <TableCell>{conditionRangeLabel(card.copies ?? []) ?? 'Unknown'}</TableCell>
                        <TableCell>{formatCurrency(card.price)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {aggregatedTags.length
                              ? aggregatedTags.slice(0, 3).map((tagId) => {
                                  const tag = card.copies?.flatMap((copy) => copy.tags).find((t) => t.id === tagId);
                                  if (!tag) return null;
                                  return (
                                    <Badge
                                      key={tag.id}
                                      variant="secondary"
                                      style={{ backgroundColor: tag.colorHex, color: '#0B1121' }}
                                    >
                                      {tag.label}
                                    </Badge>
                                  );
                                })
                              : '—'}
                            {aggregatedTags.length > 3 && <Badge variant="outline">+{aggregatedTags.length - 3}</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${card.id}-copies`} className="bg-muted/30">
                          <TableCell colSpan={7}>
                            <div className="space-y-3 rounded-lg border bg-background p-4">
                              <div className="text-xs uppercase text-muted-foreground">Individual copies</div>
                              {card.copies?.map((copy, index) => {
                                const handleClick = () => {
                                  setSelectedCardId(card.id);
                                  setSelectedCopyId(copy.id);
                                };
                                return (
                                  <div
                                    key={copy.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={handleClick}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        handleClick();
                                      }
                                    }}
                                    className={cn(
                                      'flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg border p-3 transition hover:border-primary/50 hover:bg-muted/40',
                                      selectedCopyId === copy.id && 'border-primary/70 bg-muted/40'
                                    )}
                                  >
                                    <div className="flex flex-col gap-1">
                                      <div className="text-xs font-semibold text-foreground">
                                        {copy.condition ?? 'Unknown'} <span className="text-muted-foreground">#{index + 1}</span>
                                      </div>
                                      <div className="text-xs text-muted-foreground">{copy.notes?.trim() || 'No notes yet'}</div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {copy.tags.length ? (
                                        copy.tags.map((tag) => (
                                          <Badge
                                            key={tag.id}
                                            variant="secondary"
                                            style={{ backgroundColor: tag.colorHex, color: '#0B1121' }}
                                          >
                                            {tag.label}
                                          </Badge>
                                        ))
                                      ) : (
                                        <Badge variant="outline">No tags</Badge>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {!sortedCards.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                      No cards match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <MockDetailPanel
          card={selectedCard}
          selectedCopy={selectedCopy}
          availableTags={tags}
          draftCopyTags={draftCopyTags}
          onToggleTag={handleTagToggle}
          onCreateTag={handleCreateTag}
          binderOptions={binderOptions}
          draftBinderId={draftBinderId}
          draftCondition={draftCondition}
          draftNotes={draftNotes}
          onBinderChange={(value) => {
            setDraftBinderId(value);
            setPendingBinderId(value);
          }}
          onConditionChange={setDraftCondition}
          onNotesChange={setDraftNotes}
          onSave={handleSave}
          onReset={() => {
            if (!selectedCopy) {
              return;
            }
            setDraftCondition(((selectedCopy.condition as (typeof CONDITION_ORDER)[number]) ?? 'NM') as (typeof CONDITION_ORDER)[number]);
            setDraftNotes(selectedCopy.notes ?? '');
            setDraftCopyTags(selectedCopy.tags.map((tag) => tag.id));
            setStatus('idle');
            setErrorMessage(null);
          }}
          onMove={handleMove}
          moveStatus={moveStatus}
          moveError={moveError}
          status={status}
          errorMessage={errorMessage}
        />
      </div>

      <Dialog open={isCreateBinderOpen} onOpenChange={handleCreateDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create binder</DialogTitle>
            <DialogDescription>Give your new binder a name and optional description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-binder-name">Binder name</Label>
              <Input
                id="new-binder-name"
                value={newBinderName}
                onChange={(event) => setNewBinderName(event.target.value)}
                placeholder="e.g., Trade Binder"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-binder-description">Description</Label>
              <Textarea
                id="new-binder-description"
                value={newBinderDescription}
                onChange={(event) => setNewBinderDescription(event.target.value)}
                placeholder="Optional details"
                rows={3}
              />
            </div>
            <div className="space-y-3">
              <Label>Color accent</Label>
              <div className="grid grid-cols-8 gap-2">
                {DEFAULT_BINDER_COLORS.map((color) => {
                  const isSelected = normalizeHex(newBinderColor).toUpperCase() === color.toUpperCase();
                  return (
                    <button
                      type="button"
                      key={color}
                      onClick={() => setNewBinderColor(color)}
                      className={cn(
                        'h-6 w-6 rounded-full border border-transparent transition focus:outline-none focus:ring-2 focus:ring-offset-2',
                        isSelected ? 'ring-2 ring-primary ring-offset-2' : 'hover:ring-2 hover:ring-primary/60'
                      )}
                      style={{ backgroundColor: color }}
                    >
                      <span className="sr-only">{color}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="h-8 w-8 rounded-full border"
                  style={{ backgroundColor: normalizeHex(newBinderColor) || '#ffffff' }}
                />
                <Input
                  value={newBinderColor}
                  onChange={(event) => setNewBinderColor(event.target.value)}
                  placeholder="#4B5563"
                />
              </div>
              <p className="text-xs text-muted-foreground">Pick a palette color or enter any 6-digit hex value.</p>
            </div>
            {createBinderError && <p className="text-sm text-destructive">{createBinderError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={closeCreateBinderDialog}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateBinder} disabled={!newBinderName.trim() || isCreatingBinder}>
              {isCreatingBinder ? 'Creating...' : 'Create binder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditBinderOpen} onOpenChange={(open) => !open && closeEditBinderDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit binder</DialogTitle>
            <DialogDescription>Update the name and description of your binder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-binder-name">Binder name</Label>
              <Input
                id="edit-binder-name"
                value={editBinderName}
                onChange={(event) => setEditBinderName(event.target.value)}
                placeholder="e.g., Trade Binder"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-binder-description">Description</Label>
              <Textarea
                id="edit-binder-description"
                value={editBinderDescription}
                onChange={(event) => setEditBinderDescription(event.target.value)}
                placeholder="Optional details"
                rows={3}
              />
            </div>
            {editBinderError && <p className="text-sm text-destructive">{editBinderError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={closeEditBinderDialog}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveBinderEdit} disabled={!editBinderName.trim() || isEditingBinder}>
              {isEditingBinder ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditBinderColorOpen} onOpenChange={(open) => !open && closeEditBinderDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit binder color</DialogTitle>
            <DialogDescription>Choose a new color for your binder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <Label>Color accent</Label>
              <div className="grid grid-cols-8 gap-2">
                {DEFAULT_BINDER_COLORS.map((color) => {
                  const isSelected = normalizeHex(editBinderColor).toUpperCase() === color.toUpperCase();
                  return (
                    <button
                      type="button"
                      key={color}
                      onClick={() => setEditBinderColor(color)}
                      className={cn(
                        'h-6 w-6 rounded-full border border-transparent transition focus:outline-none focus:ring-2 focus:ring-offset-2',
                        isSelected ? 'ring-2 ring-primary ring-offset-2' : 'hover:ring-2 hover:ring-primary/60'
                      )}
                      style={{ backgroundColor: color }}
                    >
                      <span className="sr-only">{color}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="h-8 w-8 rounded-full border"
                  style={{ backgroundColor: normalizeHex(editBinderColor) || '#ffffff' }}
                />
                <Input
                  value={editBinderColor}
                  onChange={(event) => setEditBinderColor(event.target.value)}
                  placeholder="#4B5563"
                />
              </div>
              <p className="text-xs text-muted-foreground">Pick a palette color or enter any 6-digit hex value.</p>
            </div>
            {editBinderError && <p className="text-sm text-destructive">{editBinderError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={closeEditBinderDialog}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveBinderColor} disabled={!editBinderColor.trim() || isEditingBinder}>
              {isEditingBinder ? 'Saving...' : 'Save color'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
