"use client";

import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  LIBRARY_COLLECTION_ID,
  type Collection,
  type CollectionCard,
  type CollectionCardCopy,
  type CollectionTag,
  type UpdateCollectionCardInput,
} from "@/lib/api/collections";
import { fetchCardPrintsApi } from "@/lib/api-client";
import {
  conditionRangeLabel,
  formatCurrency,
  CONDITION_ORDER,
} from "./helpers";
import { FilterDialog } from "./filter-dialog";
import { BinderList } from "./binder-list";
import { DetailPanel, MobileDetailDrawer } from "./detail-panel";
import { useCollectionsStore } from "@/stores/collections";
import { useTagsStore } from "@/stores/tags";
import { useAuthStore } from "@/stores/auth";
import { useModuleStore } from "@/stores/preferences";
import { cn } from "@/lib/utils";
import { getAppRoute } from "@/lib/app-routes";
import type {
  Card as TcgCard,
  CardPrintsResponse,
  PokemonFinishType,
  PokemonFunctionalGroup,
  TcgCode,
} from "@/types/card";

const DEFAULT_PRICE_RANGE: [number, number] = [0, 3000];
const DEFAULT_BINDER_COLORS = [
  "#4B5563",
  "#6B7280",
  "#9CA3AF",
  "#E5E7EB",
  "#F3F4F6",
  "#FAFAFA",
  "#F97316",
  "#FB923C",
  "#FCD34D",
  "#A3E635",
  "#4ADE80",
  "#06B6D4",
  "#0284C7",
  "#3B82F6",
  "#6366F1",
  "#A855F7",
] as const;

const GAME_LABELS: Record<TcgCode, string> = {
  magic: "Magic: The Gathering",
  pokemon: "Pokémon",
  yugioh: "Yu-Gi-Oh!",
};

function normalizeHex(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
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
      binderColorHex: card.binderColorHex ?? binder.colorHex,
    })),
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

function formatPrintDetails(print: TcgCard) {
  const parts: string[] = [];
  if (print.collectorNumber) {
    parts.push(`#${print.collectorNumber}`);
  }
  if (print.rarity) {
    parts.push(print.rarity);
  }
  if (print.regulationMark) {
    parts.push(`Reg ${print.regulationMark}`);
  }
  if (print.releasedAt) {
    const year = new Date(print.releasedAt).getFullYear();
    if (!Number.isNaN(year)) {
      parts.push(String(year));
    }
  }
  return parts.join(" • ");
}

function getFinishBadges(print: TcgCard): PokemonFinishType[] {
  if (print.pokemonPrint?.finishes?.length) {
    return print.pokemonPrint.finishes;
  }
  const variants = print.pokemonPrint?.variants;
  if (!variants) {
    return [];
  }
  const finishes: PokemonFinishType[] = [];
  if (variants.normal) finishes.push("normal");
  if (variants.reverse) finishes.push("reverse");
  if (variants.holo) finishes.push("holo");
  if (variants.firstEdition) finishes.push("firstEdition");
  return finishes;
}

export function CollectionView() {
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    collections,
    fetchCollections,
    updateCollectionCard,
    addCollection,
    updateCollection,
    hasFetched,
    isLoading,
  } = useCollectionsStore((state) => ({
    collections: state.collections,
    fetchCollections: state.fetchCollections,
    updateCollectionCard: state.updateCollectionCard,
    addCollection: state.addCollection,
    updateCollection: state.updateCollection,
    hasFetched: state.hasFetched,
    isLoading: state.isLoading,
  }));
  const { tags, fetchTags, addTag } = useTagsStore();
  const showCardNumbers = useModuleStore((state) => state.showCardNumbers);
  const showPricing = useModuleStore((state) => state.showPricing);

  const [binderFilter, setBinderFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeConditions, setActiveConditions] = useState<
    (typeof CONDITION_ORDER)[number][]
  >([]);
  const [priceRange, setPriceRange] =
    useState<[number, number]>(DEFAULT_PRICE_RANGE);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCopyId, setSelectedCopyId] = useState<string | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [draftBinderId, setDraftBinderId] = useState<string>(
    LIBRARY_COLLECTION_ID,
  );
  const [draftCondition, setDraftCondition] =
    useState<(typeof CONDITION_ORDER)[number]>("NM");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftCopyTags, setDraftCopyTags] = useState<string[]>([]);
  const [pendingBinderId, setPendingBinderId] = useState<string>(
    LIBRARY_COLLECTION_ID,
  );
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">(
    "idle",
  );
  const [moveStatus, setMoveStatus] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isCreateBinderOpen, setIsCreateBinderOpen] = useState(false);
  const [newBinderName, setNewBinderName] = useState("");
  const [newBinderDescription, setNewBinderDescription] = useState("");
  const [newBinderColor, setNewBinderColor] = useState<string>(
    DEFAULT_BINDER_COLORS[0],
  );
  const [isCreatingBinder, setIsCreatingBinder] = useState(false);
  const [createBinderError, setCreateBinderError] = useState<string | null>(
    null,
  );
  const [editBinderId, setEditBinderId] = useState<string | null>(null);
  const [isEditBinderOpen, setIsEditBinderOpen] = useState(false);
  const [isEditBinderColorOpen, setIsEditBinderColorOpen] = useState(false);
  const [editBinderName, setEditBinderName] = useState("");
  const [editBinderDescription, setEditBinderDescription] = useState("");
  const [editBinderColor, setEditBinderColor] = useState<string>("");
  const [isEditingBinder, setIsEditingBinder] = useState(false);
  const [editBinderError, setEditBinderError] = useState<string | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [printData, setPrintData] = useState<CardPrintsResponse | null>(null);
  const [selectedPrintCard, setSelectedPrintCard] = useState<TcgCard | null>(
    null,
  );
  const [isLoadingPrints, setIsLoadingPrints] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [isSavingPrintSelection, setIsSavingPrintSelection] = useState(false);

  useEffect(() => {
    const binderParam = searchParams.get("binder");
    const nextBinder = binderParam ?? "all";
    setBinderFilter((current) =>
      current === nextBinder ? current : nextBinder,
    );
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
  const activeBinder = useMemo(
    () => binders.find((binder) => binder.id === binderFilter) ?? null,
    [binders, binderFilter],
  );
  const workingCards = useMemo(
    () =>
      binderFilter === "all" ? flattenedCards : (activeBinder?.cards ?? []),
    [binderFilter, flattenedCards, activeBinder],
  );

  const maxPrice = useMemo(() => {
    const maxValue = flattenedCards.reduce(
      (value, card) => Math.max(value, card.price ?? 0),
      0,
    );
    return maxValue || DEFAULT_PRICE_RANGE[1];
  }, [flattenedCards]);

  useEffect(() => {
    setPriceRange([0, maxPrice]);
  }, [maxPrice]);

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
        card.copies?.forEach((copy) =>
          copy.tags.forEach((tag) => cardTagSet.add(tag.id)),
        );
        const hasTags = activeTags.every((tagId) => cardTagSet.has(tagId));
        if (!hasTags) {
          return false;
        }
      }

      if (activeConditions.length) {
        const matchesCondition =
          card.copies?.some(
            (copy) =>
              copy.condition &&
              activeConditions.includes(
                copy.condition as (typeof CONDITION_ORDER)[number],
              ),
          ) ?? false;
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

  const sortedCards = useMemo(
    () =>
      [...filteredCards].sort((a, b) => {
        if (a.collectorNumber && b.collectorNumber) {
          const partsA = a.collectorNumber.match(/^([A-Za-z]*)(\d+)(.*)$/);
          const partsB = b.collectorNumber.match(/^([A-Za-z]*)(\d+)(.*)$/);
          if (partsA && partsB) {
            const prefixCmp = (partsA[1] || "").localeCompare(partsB[1] || "");
            if (prefixCmp !== 0) return prefixCmp;
            const numA = parseInt(partsA[2], 10);
            const numB = parseInt(partsB[2], 10);
            if (numA !== numB) return numA - numB;
          }
        }
        return a.name.localeCompare(b.name);
      }),
    [filteredCards],
  );

  useEffect(() => {
    if (!sortedCards.length) {
      setSelectedCardId(null);
      setSelectedCopyId(null);
      return;
    }
    setSelectedCardId((current) =>
      current && sortedCards.some((card) => card.id === current)
        ? current
        : (sortedCards[0]?.id ?? null),
    );
  }, [sortedCards]);

  const selectedCard = useMemo(
    () => sortedCards.find((card) => card.id === selectedCardId) ?? null,
    [sortedCards, selectedCardId],
  );
  const currentGameLabel = selectedCard
    ? (GAME_LABELS[selectedCard.tcg as TcgCode] ?? "this card")
    : "this card";
  const supportsPrintSelection = selectedCard
    ? ["magic", "pokemon"].includes(selectedCard.tcg)
    : false;
  const printOptions = printData?.prints ?? null;
  const pokemonFunctionalGroup: PokemonFunctionalGroup | null =
    printData?.mode === "pokemon-functional" ? printData.functionalGroup : null;

  useEffect(() => {
    setIsPrintDialogOpen(false);
    setPrintData(null);
    setSelectedPrintCard(null);
    setIsLoadingPrints(false);
    setPrintError(null);
    setIsSavingPrintSelection(false);
  }, [selectedCard?.cardId]);

  useEffect(() => {
    if (selectedCard) {
      setSelectedCopyId((current) => {
        if (
          current &&
          selectedCard.copies?.some((copy) => copy.id === current)
        ) {
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
        Object.prototype.hasOwnProperty.call(prev, selectedCard.id)
          ? prev
          : { ...prev, [selectedCard.id]: true },
      );
    } else {
      setSelectedCopyId(null);
    }
  }, [selectedCard]);

  const selectedCopy = useMemo<CollectionCardCopy | null>(
    () =>
      selectedCard?.copies?.find((copy) => copy.id === selectedCopyId) ?? null,
    [selectedCard, selectedCopyId],
  );

  useEffect(() => {
    if (selectedCopy) {
      setDraftCondition(
        ((selectedCopy.condition as (typeof CONDITION_ORDER)[number]) ??
          "NM") as (typeof CONDITION_ORDER)[number],
      );
      setDraftNotes(selectedCopy.notes ?? "");
      setDraftCopyTags(selectedCopy.tags.map((tag) => tag.id));
    } else {
      setDraftNotes("");
      setDraftCopyTags([]);
    }
    setStatus("idle");
    setErrorMessage(null);
    setMoveStatus("idle");
    setMoveError(null);
  }, [selectedCopy]);

  useEffect(() => {
    if (
      !supportsPrintSelection ||
      !isPrintDialogOpen ||
      printOptions ||
      !selectedCard
    ) {
      return;
    }
    let cancelled = false;
    setIsLoadingPrints(true);
    setPrintError(null);
    const targetExternalId = selectedCard.externalId ?? selectedCard.cardId;
    fetchCardPrintsApi({
      tcg: selectedCard.tcg as TcgCode,
      cardId: targetExternalId,
      token,
    })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setPrintData(data);
        const prints = data.prints ?? [];
        const matching = prints.find((print) => print.id === targetExternalId);
        setSelectedPrintCard(matching ?? prints[0] ?? null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPrintError(
          error instanceof Error ? error.message : "Unable to load prints.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPrints(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supportsPrintSelection, isPrintDialogOpen, printOptions, selectedCard]);

  useEffect(() => {
    if (!isPrintDialogOpen || !printOptions || !selectedCard) {
      return;
    }
    const externalId = selectedCard.externalId ?? selectedCard.cardId;
    const matching = printOptions.find((print) => print.id === externalId);
    setSelectedPrintCard(matching ?? printOptions[0] ?? null);
  }, [isPrintDialogOpen, printOptions, selectedCard]);

  const summary = useMemo(() => {
    const rows = sortedCards.length;
    const copies = sortedCards.reduce(
      (sum, card) => sum + (card.copies?.length ?? card.quantity ?? 0),
      0,
    );
    return {
      rows,
      copies,
      highlightedTags: summarizeTags(sortedCards),
    };
  }, [sortedCards]);

  const binderOptions = useMemo(
    () =>
      binders.map((binder) => ({
        id: binder.id,
        name: binder.name,
        colorHex: binder.colorHex,
      })),
    [binders],
  );
  const printSelectionLabel = useMemo(() => {
    if (!selectedCard) {
      return "Select a print";
    }
    return selectedCard.setName ?? selectedCard.setCode ?? selectedCard.name;
  }, [selectedCard]);
  const printSelectionDisabled =
    !selectedCopy ||
    isLoadingPrints ||
    isSavingPrintSelection ||
    moveStatus === "pending";
  const isPrintSaveDisabled =
    !selectedPrintCard ||
    !selectedCard ||
    selectedPrintCard.id === selectedCard.cardId ||
    isSavingPrintSelection;

  const toggleRowExpansion = (cardId: string) => {
    setExpandedRows((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  /** Select a card via user tap — opens the mobile drawer */
  const selectCard = (cardId: string) => {
    setSelectedCardId(cardId);
    setMobileDrawerOpen(true);
  };

  const toggleTagFilter = (tagId: string) => {
    setActiveTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  };

  const toggleConditionFilter = (
    condition: (typeof CONDITION_ORDER)[number],
  ) => {
    setActiveConditions((prev) =>
      prev.includes(condition)
        ? prev.filter((value) => value !== condition)
        : [...prev, condition],
    );
  };

  const handleBinderChange = (binderId: string) => {
    setBinderFilter(binderId);
    router.replace(
      binderId === "all"
        ? getAppRoute("/collections", pathname)
        : `${getAppRoute("/collections", pathname)}?binder=${binderId}`,
      { scroll: false },
    );
  };

  const handleTagToggle = (tagId: string) => {
    setDraftCopyTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  };

  const handlePrintButtonClick = () => {
    if (!supportsPrintSelection || !selectedCopy) {
      return;
    }
    setIsPrintDialogOpen(true);
  };

  const handleCreateTag = useCallback(
    async (label: string): Promise<CollectionTag> => {
      if (!token) {
        throw new Error("Authentication required");
      }
      const tag = await addTag(token, { label });
      return { id: tag.id, label: tag.label, colorHex: tag.colorHex };
    },
    [token, addTag],
  );

  const buildUpdatePayload = (): UpdateCollectionCardInput | null => {
    if (!selectedCopy) {
      return null;
    }
    const updates: UpdateCollectionCardInput = {};
    if ((draftCondition ?? null) !== (selectedCopy.condition ?? null)) {
      updates.condition = draftCondition;
    }
    if (draftNotes !== (selectedCopy.notes ?? "")) {
      const trimmed = draftNotes.trim();
      updates.notes = trimmed.length ? draftNotes : null;
    }
    const sameTags =
      draftCopyTags.length === selectedCopy.tags.length &&
      draftCopyTags.every((id) =>
        selectedCopy.tags.some((tag) => tag.id === id),
      );
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
    setStatus("saving");
    setErrorMessage(null);
    try {
      await updateCollectionCard(
        token,
        selectedCard.binderId ?? LIBRARY_COLLECTION_ID,
        selectedCopy.id,
        payload,
      );
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update copy",
      );
    }
  };

  const handleMove = async () => {
    if (
      !token ||
      !selectedCard ||
      !selectedCopy ||
      !pendingBinderId ||
      pendingBinderId === (selectedCard.binderId ?? LIBRARY_COLLECTION_ID)
    ) {
      return;
    }
    setMoveStatus("pending");
    setMoveError(null);
    try {
      await updateCollectionCard(
        token,
        selectedCard.binderId ?? LIBRARY_COLLECTION_ID,
        selectedCopy.id,
        {
          targetBinderId: pendingBinderId,
        },
      );
      setMoveStatus("success");
    } catch (error) {
      setMoveStatus("error");
      setMoveError(
        error instanceof Error ? error.message : "Failed to move copy",
      );
    }
  };

  const handleConfirmPrintSelection = async () => {
    if (!token || !selectedCard || !selectedCopy || !selectedPrintCard) {
      return;
    }
    if (selectedPrintCard.id === selectedCard.cardId) {
      setIsPrintDialogOpen(false);
      return;
    }
    setIsSavingPrintSelection(true);
    setPrintError(null);
    try {
      await updateCollectionCard(
        token,
        selectedCard.binderId ?? LIBRARY_COLLECTION_ID,
        selectedCopy.id,
        {
          cardOverride: {
            cardId: selectedPrintCard.id,
            cardData: {
              name: selectedPrintCard.name,
              tcg: selectedPrintCard.tcg,
              externalId: selectedPrintCard.id,
              setCode: selectedPrintCard.setCode,
              setName: selectedPrintCard.setName,
              rarity: selectedPrintCard.rarity,
              imageUrl: selectedPrintCard.imageUrl,
              imageUrlSmall: selectedPrintCard.imageUrlSmall,
            },
          },
        },
      );
      setIsPrintDialogOpen(false);
    } catch (error) {
      setPrintError(
        error instanceof Error ? error.message : "Failed to update print.",
      );
    } finally {
      setIsSavingPrintSelection(false);
    }
  };

  const closeCreateBinderDialog = () => {
    setIsCreateBinderOpen(false);
    setNewBinderName("");
    setNewBinderDescription("");
    setNewBinderColor(DEFAULT_BINDER_COLORS[0]);
    setIsCreatingBinder(false);
    setCreateBinderError(null);
  };

  const handleCreateBinder = async () => {
    if (!token) {
      setCreateBinderError("Sign in to create binders.");
      return;
    }
    const trimmedName = newBinderName.trim();
    if (!trimmedName) {
      setCreateBinderError("Binder name is required.");
      return;
    }
    const trimmedDescription = newBinderDescription.trim();
    const colorInput = newBinderColor.trim();
    let colorHex: string | undefined;
    if (colorInput) {
      const normalizedColor = normalizeHex(colorInput);
      if (!isValidHexColor(normalizedColor)) {
        setCreateBinderError(
          "Enter a valid 6-digit hex color (e.g., #1F2937).",
        );
        return;
      }
      // Remove the # symbol for backend validation
      colorHex = normalizedColor.replace("#", "").toUpperCase();
    }
    setIsCreatingBinder(true);
    setCreateBinderError(null);
    try {
      const payload: { name: string; description?: string; colorHex?: string } =
        { name: trimmedName };
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
      setCreateBinderError(
        error instanceof Error ? error.message : "Failed to create binder.",
      );
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
    setEditBinderDescription(binder.description ?? "");
    setEditBinderError(null);
    setIsEditBinderOpen(true);
  };

  const handleEditBinderColor = (binderId: string) => {
    const binder = binders.find((b) => b.id === binderId);
    if (!binder) return;
    setEditBinderId(binderId);
    // Add # prefix if not present
    const colorWithHash = binder.colorHex
      ? binder.colorHex.startsWith("#")
        ? binder.colorHex
        : `#${binder.colorHex}`
      : DEFAULT_BINDER_COLORS[0];
    setEditBinderColor(colorWithHash);
    setEditBinderError(null);
    setIsEditBinderColorOpen(true);
  };

  const closeEditBinderDialog = () => {
    setIsEditBinderOpen(false);
    setIsEditBinderColorOpen(false);
    setEditBinderId(null);
    setEditBinderName("");
    setEditBinderDescription("");
    setEditBinderColor("");
    setIsEditingBinder(false);
    setEditBinderError(null);
  };

  const handleSaveBinderEdit = async () => {
    if (!token || !editBinderId) return;
    const trimmedName = editBinderName.trim();
    if (!trimmedName) {
      setEditBinderError("Binder name is required.");
      return;
    }
    const trimmedDescription = editBinderDescription.trim();
    setIsEditingBinder(true);
    setEditBinderError(null);
    try {
      const payload: { name?: string; description?: string } = {
        name: trimmedName,
      };
      if (trimmedDescription) {
        payload.description = trimmedDescription;
      }
      await updateCollection(token, editBinderId, payload);
      closeEditBinderDialog();
    } catch (error) {
      setEditBinderError(
        error instanceof Error ? error.message : "Failed to update binder.",
      );
    } finally {
      setIsEditingBinder(false);
    }
  };

  const handleSaveBinderColor = async () => {
    if (!token || !editBinderId) return;
    const colorInput = editBinderColor.trim();
    if (!colorInput) {
      setEditBinderError("Color is required.");
      return;
    }
    const normalizedColor = normalizeHex(colorInput);
    if (!isValidHexColor(normalizedColor)) {
      setEditBinderError("Enter a valid 6-digit hex color (e.g., #1F2937).");
      return;
    }
    // Remove the # symbol for backend validation
    const colorHexWithoutHash = normalizedColor.replace("#", "").toUpperCase();
    setIsEditingBinder(true);
    setEditBinderError(null);
    try {
      await updateCollection(token, editBinderId, {
        colorHex: colorHexWithoutHash,
      });
      closeEditBinderDialog();
    } catch (error) {
      setEditBinderError(
        error instanceof Error
          ? error.message
          : "Failed to update binder color.",
      );
    } finally {
      setIsEditingBinder(false);
    }
  };

  return (
    <div className="space-y-6" data-oid="bclo5-9">
      <Card data-oid=".w1l6u0">
        <CardHeader className="gap-1 sm:gap-2 pb-2 sm:pb-6" data-oid="14.62_5">
          <CardTitle
            className="flex items-center gap-2 text-base sm:text-lg"
            data-oid="vggtkc9"
          >
            <Sparkles className="h-4 w-4 text-primary" data-oid="wnf9eam" />
            Binder pulse
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-6" data-oid="y1f1uqz">
          <div
            className="flex items-baseline gap-4 sm:gap-6 sm:grid sm:grid-cols-3"
            data-oid="__eky43"
          >
            <div
              className="flex items-baseline gap-1.5 sm:block"
              data-oid="-p_16_4"
            >
              <p
                className="text-[11px] uppercase text-muted-foreground sm:text-xs"
                data-oid=".wttbw-"
              >
                Rows
              </p>
              <p
                className="text-lg font-semibold text-foreground sm:text-2xl"
                data-oid="f:x30lb"
              >
                {summary.rows}
              </p>
            </div>
            <div
              className="flex items-baseline gap-1.5 sm:block"
              data-oid="-z_asjd"
            >
              <p
                className="text-[11px] uppercase text-muted-foreground sm:text-xs"
                data-oid="iqcj4-2"
              >
                Copies
              </p>
              <p
                className="text-lg font-semibold text-foreground sm:text-2xl"
                data-oid="-p1c.t0"
              >
                {summary.copies}
              </p>
            </div>
            <div
              className="flex items-baseline gap-1.5 sm:block min-w-0"
              data-oid="-6o-ozd"
            >
              <p
                className="text-[11px] uppercase text-muted-foreground shrink-0 sm:text-xs"
                data-oid="-e5by:g"
              >
                Tags
              </p>
              <p
                className="text-sm font-medium text-foreground truncate"
                data-oid="lz4sn2g"
              >
                {summary.highlightedTags
                  .map(([tagId]) => tags.find((tag) => tag.id === tagId)?.label)
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
            </div>
          </div>
          <BinderList
            binders={binders}
            activeBinderId={binderFilter}
            onSelectBinder={handleBinderChange}
            onAddBinder={
              token
                ? () => {
                    setNewBinderName("");
                    setNewBinderDescription("");
                    setCreateBinderError(null);
                    setIsCreateBinderOpen(true);
                  }
                : undefined
            }
            onEditBinder={token ? handleEditBinder : undefined}
            onEditBinderColor={token ? handleEditBinderColor : undefined}
            data-oid="5zjh1dp"
          />
        </CardContent>
      </Card>

      <div
        className="grid gap-4 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]"
        data-oid="a8cw.i9"
      >
        <Card className="overflow-hidden" data-oid="p0f0__e">
          <CardHeader className="space-y-4" data-oid="bi8ix53">
            <div
              className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
              data-oid="hslotwj"
            >
              <div data-oid="w7vue49">
                <CardTitle data-oid="bvy.w40">Collection overview</CardTitle>
                <CardDescription data-oid=".nj0f9u">
                  Select a row to inspect individual copies.
                </CardDescription>
              </div>
              <div
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                data-oid="ite-ed1"
              >
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search this binder"
                  className="sm:w-64"
                  data-oid="djma0h7"
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
                  data-oid="m7iwvx7"
                />
              </div>
            </div>
            <div
              className="flex flex-wrap gap-4 text-sm text-muted-foreground"
              data-oid="ukmf-7o"
            >
              <span data-oid="dj98d-2">
                {isLoading
                  ? "Loading…"
                  : `${filteredCards.length} card row${filteredCards.length === 1 ? "" : "s"}`}
              </span>
              <span data-oid="xoowgdd">
                {selectedCard
                  ? `Binder: ${selectedCard.binderName ?? "Unsorted"}`
                  : "Select a row to edit"}
              </span>
            </div>
          </CardHeader>
          {/* Mobile: compact card list */}
          <CardContent className="p-0 md:hidden" data-oid="4crtseg">
            <div className="divide-y" data-oid="a2m72_x">
              {sortedCards.map((card) => {
                const expanded = expandedRows[card.id];
                const isSelected = selectedCardId === card.id;
                const binderColor = card.binderColorHex
                  ? card.binderColorHex.startsWith("#")
                    ? card.binderColorHex
                    : `#${card.binderColorHex}`
                  : undefined;
                return (
                  <div key={card.id} data-oid="19un-4y">
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "w-full text-left px-4 py-3 transition-colors cursor-pointer",
                        isSelected && "bg-primary/5",
                      )}
                      onClick={() => selectCard(card.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectCard(card.id);
                        }
                      }}
                      data-oid="3wj3_y1"
                    >
                      <div
                        className="flex items-start gap-3"
                        data-oid="19yn.eb"
                      >
                        <button
                          type="button"
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRowExpansion(card.id);
                          }}
                          data-oid="jmv3egp"
                        >
                          {expanded ? "−" : "+"}
                        </button>
                        <div className="flex-1 min-w-0" data-oid="j38pt51">
                          <div
                            className="flex items-center gap-2"
                            data-oid="dtoc5b2"
                          >
                            {binderColor && (
                              <span
                                className="inline-flex h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: binderColor }}
                                data-oid="0x8h1gv"
                              />
                            )}
                            <p
                              className="text-sm font-medium truncate"
                              data-oid="aznvj8q"
                            >
                              {card.name}
                            </p>
                          </div>
                          <div
                            className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-xs text-muted-foreground"
                            data-oid="46.th0u"
                          >
                            <span data-oid="eza.4h3">
                              {card.binderName ?? "Unsorted"}
                            </span>
                            <span data-oid="zr1-0z0">·</span>
                            <span data-oid="mhv2sr4">
                              {card.rarity ?? "N/A"}
                            </span>
                            <span data-oid="yd.-e41">·</span>
                            <span data-oid="d.p0j5.">
                              {card.copies?.length ?? card.quantity}{" "}
                              {(card.copies?.length ?? card.quantity) === 1
                                ? "copy"
                                : "copies"}
                            </span>
                            {showPricing && card.price !== undefined && (
                              <>
                                <span data-oid="23z:efd">·</span>
                                <span data-oid="4g1892_">
                                  {formatCurrency(card.price)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    {expanded && card.copies?.length ? (
                      <div
                        className="px-4 pb-3 pl-[3.25rem]"
                        data-oid="keztso8"
                      >
                        <div
                          className="space-y-2 rounded-lg border bg-muted/20 p-3"
                          data-oid="vqd_pfq"
                        >
                          <p
                            className="text-[10px] uppercase text-muted-foreground"
                            data-oid="89_2-7j"
                          >
                            Copies
                          </p>
                          {card.copies.map((copy, index) => (
                            <button
                              key={copy.id}
                              type="button"
                              className={cn(
                                "w-full text-left rounded-md border px-3 py-2 text-xs transition",
                                selectedCopyId === copy.id
                                  ? "border-primary/70 bg-muted/40"
                                  : "hover:border-primary/40",
                              )}
                              onClick={() => {
                                selectCard(card.id);
                                setSelectedCopyId(copy.id);
                              }}
                              data-oid="1nq047e"
                            >
                              <span
                                className="font-semibold"
                                data-oid=".72vhjv"
                              >
                                {copy.condition ?? "Unknown"}
                              </span>
                              <span
                                className="text-muted-foreground"
                                data-oid="bvdmpn:"
                              >
                                {" "}
                                #{index + 1}
                              </span>
                              {copy.notes?.trim() ? (
                                <p
                                  className="mt-0.5 text-muted-foreground truncate"
                                  data-oid="75w4x3n"
                                >
                                  {copy.notes}
                                </p>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!sortedCards.length && (
                <div
                  className="py-12 text-center text-sm text-muted-foreground"
                  data-oid="v.bd5l0"
                >
                  No cards match these filters.
                </div>
              )}
            </div>
          </CardContent>

          {/* Desktop: full table */}
          <CardContent className="p-0 hidden md:block" data-oid="7zne16d">
            <Table data-oid="ega5d0x">
              <TableHeader data-oid="_a9ge:9">
                <TableRow data-oid="uv.u7t7">
                  <TableHead data-oid="g9ja3yo">Card</TableHead>
                  <TableHead data-oid="ggq..52">Binder</TableHead>
                  <TableHead data-oid="lkhd4hl">Rarity</TableHead>
                  <TableHead data-oid="27v.f6g">Quantity</TableHead>
                  <TableHead data-oid="-w2i7so">Condition</TableHead>
                  <TableHead data-oid="mt74kb5">Est. value</TableHead>
                  <TableHead data-oid="vgw-82v">Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody data-oid="obe9u.h">
                {sortedCards.map((card) => {
                  const expanded = expandedRows[card.id];
                  const aggregatedTags = Array.from(
                    new Set(
                      card.copies?.flatMap((copy) =>
                        copy.tags.map((tag) => tag.id),
                      ) ?? [],
                    ),
                  );
                  return (
                    <Fragment key={card.id}>
                      <TableRow
                        key={`${card.id}-row`}
                        className={cn(
                          "cursor-pointer transition-colors",
                          selectedCardId === card.id && "bg-primary/5",
                        )}
                        onClick={() => selectCard(card.id)}
                        data-oid="t3bkr-x"
                      >
                        <TableCell data-oid="wa7fcu3">
                          <div
                            className="flex items-center gap-3"
                            data-oid="sislt0o"
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 rounded-full"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleRowExpansion(card.id);
                              }}
                              data-oid="rg29468"
                            >
                              {expanded ? "−" : "+"}
                            </Button>
                            <div data-oid="iazhh8:">
                              <p
                                className="font-medium leading-tight"
                                data-oid="4hzd59i"
                              >
                                {card.name}
                              </p>
                              {showCardNumbers && (
                                <p
                                  className="text-xs text-muted-foreground"
                                  data-oid="s-paji:"
                                >
                                  {card.setName ??
                                    card.setCode ??
                                    "Unknown set"}
                                  {card.setCode ? ` · #${card.setCode}` : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-oid="s7t42kw">
                          {card.binderName ?? "Unsorted"}
                        </TableCell>
                        <TableCell data-oid="-x0uiz3">
                          {card.rarity ?? "N/A"}
                        </TableCell>
                        <TableCell data-oid=".b_:2gu">
                          {card.copies?.length ?? card.quantity}
                        </TableCell>
                        <TableCell data-oid="hh7_5ok">
                          {conditionRangeLabel(card.copies ?? []) ?? "Unknown"}
                        </TableCell>
                        <TableCell data-oid="v.7rv3y">
                          {showPricing ? formatCurrency(card.price) : "—"}
                        </TableCell>
                        <TableCell data-oid="7uym.8f">
                          <div
                            className="flex flex-wrap gap-1"
                            data-oid="rx9vwyq"
                          >
                            {aggregatedTags.length
                              ? aggregatedTags.slice(0, 3).map((tagId) => {
                                  const tag = card.copies
                                    ?.flatMap((copy) => copy.tags)
                                    .find((t) => t.id === tagId);
                                  if (!tag) return null;
                                  return (
                                    <Badge
                                      key={tag.id}
                                      variant="secondary"
                                      style={{
                                        backgroundColor: tag.colorHex,
                                        color: "#0B1121",
                                      }}
                                      data-oid="2o7e-nn"
                                    >
                                      {tag.label}
                                    </Badge>
                                  );
                                })
                              : "—"}
                            {aggregatedTags.length > 3 && (
                              <Badge variant="outline" data-oid="cl2vqxp">
                                +{aggregatedTags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow
                          key={`${card.id}-copies`}
                          className="bg-muted/30"
                          data-oid="gxoctdj"
                        >
                          <TableCell colSpan={7} data-oid="5yo3fc3">
                            <div
                              className="space-y-3 rounded-lg border bg-background p-4"
                              data-oid="jpm7yf1"
                            >
                              <div
                                className="text-xs uppercase text-muted-foreground"
                                data-oid="mcxcbzc"
                              >
                                Individual copies
                              </div>
                              {card.copies?.map((copy, index) => {
                                const handleClick = () => {
                                  selectCard(card.id);
                                  setSelectedCopyId(copy.id);
                                };
                                return (
                                  <div
                                    key={copy.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={handleClick}
                                    onKeyDown={(event) => {
                                      if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                      ) {
                                        event.preventDefault();
                                        handleClick();
                                      }
                                    }}
                                    className={cn(
                                      "flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg border p-3 transition hover:border-primary/50 hover:bg-muted/40",
                                      selectedCopyId === copy.id &&
                                        "border-primary/70 bg-muted/40",
                                    )}
                                    data-oid="-mkg93d"
                                  >
                                    <div
                                      className="flex flex-col gap-1"
                                      data-oid="xzy7:0m"
                                    >
                                      <div
                                        className="text-xs font-semibold text-foreground"
                                        data-oid="ms9.8yh"
                                      >
                                        {copy.condition ?? "Unknown"}{" "}
                                        <span
                                          className="text-muted-foreground"
                                          data-oid="4fgyn3t"
                                        >
                                          #{index + 1}
                                        </span>
                                      </div>
                                      <div
                                        className="text-xs text-muted-foreground"
                                        data-oid="5xf0gqu"
                                      >
                                        {copy.notes?.trim() || "No notes yet"}
                                      </div>
                                    </div>
                                    <div
                                      className="flex flex-wrap items-center gap-2"
                                      data-oid="5zdh.bt"
                                    >
                                      {copy.tags.length ? (
                                        copy.tags.map((tag) => (
                                          <Badge
                                            key={tag.id}
                                            variant="secondary"
                                            style={{
                                              backgroundColor: tag.colorHex,
                                              color: "#0B1121",
                                            }}
                                            data-oid="7z:6h-o"
                                          >
                                            {tag.label}
                                          </Badge>
                                        ))
                                      ) : (
                                        <Badge
                                          variant="outline"
                                          data-oid="hjy1tt5"
                                        >
                                          No tags
                                        </Badge>
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
                  <TableRow data-oid="0sm1tc-">
                    <TableCell
                      colSpan={7}
                      className="h-32 text-center text-sm text-muted-foreground"
                      data-oid="ul8xy1i"
                    >
                      No cards match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <DetailPanel
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
            setDraftCondition(
              ((selectedCopy.condition as (typeof CONDITION_ORDER)[number]) ??
                "NM") as (typeof CONDITION_ORDER)[number],
            );
            setDraftNotes(selectedCopy.notes ?? "");
            setDraftCopyTags(selectedCopy.tags.map((tag) => tag.id));
            setStatus("idle");
            setErrorMessage(null);
          }}
          onMove={handleMove}
          moveStatus={moveStatus}
          moveError={moveError}
          status={status}
          errorMessage={errorMessage}
          onSelectPrint={
            supportsPrintSelection ? handlePrintButtonClick : undefined
          }
          printSelectionLabel={printSelectionLabel}
          printSelectionDisabled={printSelectionDisabled}
          data-oid=":y3w889"
        />
      </div>

      <MobileDetailDrawer
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
          setDraftCondition(
            ((selectedCopy.condition as (typeof CONDITION_ORDER)[number]) ??
              "NM") as (typeof CONDITION_ORDER)[number],
          );
          setDraftNotes(selectedCopy.notes ?? "");
          setDraftCopyTags(selectedCopy.tags.map((tag) => tag.id));
          setStatus("idle");
          setErrorMessage(null);
        }}
        onMove={handleMove}
        moveStatus={moveStatus}
        moveError={moveError}
        status={status}
        errorMessage={errorMessage}
        onSelectPrint={
          supportsPrintSelection ? handlePrintButtonClick : undefined
        }
        printSelectionLabel={printSelectionLabel}
        printSelectionDisabled={printSelectionDisabled}
        open={mobileDrawerOpen}
        onClose={() => {
          setMobileDrawerOpen(false);
        }}
        data-oid="92cpy1."
      />

      <Dialog
        open={isPrintDialogOpen}
        onOpenChange={(open) => {
          setIsPrintDialogOpen(open);
          if (!open) {
            setPrintError(null);
          }
        }}
        data-oid="m_khlun"
      >
        <DialogContent className="sm:max-w-lg" data-oid="q7_t:1f">
          <DialogHeader data-oid="-sx.izg">
            <DialogTitle data-oid="41s2xob">Select a print</DialogTitle>
            <DialogDescription data-oid="du79e1_">
              Choose the exact {currentGameLabel} printing to keep your binder
              entry accurate.
            </DialogDescription>
          </DialogHeader>
          {isLoadingPrints ? (
            <div
              className="flex items-center justify-center py-10"
              data-oid="z_hxyka"
            >
              <Loader2
                className="h-5 w-5 animate-spin text-muted-foreground"
                data-oid="gu97vrw"
              />
            </div>
          ) : printError ? (
            <div
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              data-oid="1ls0m_7"
            >
              <p data-oid="rjggca-">{printError}</p>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-oid="a7keo_4"
              >
                You can close the dialog and try again later.
              </p>
            </div>
          ) : (
            <>
              {pokemonFunctionalGroup ? (
                <div
                  className="mb-3 space-y-2 rounded-lg border bg-muted/40 p-3 text-xs"
                  data-oid="n-0hrmh"
                >
                  <div
                    className="flex flex-wrap items-center gap-2 text-sm font-semibold"
                    data-oid="q6b96nq"
                  >
                    <span data-oid="bdryfhc">
                      {pokemonFunctionalGroup.name}
                    </span>
                    {pokemonFunctionalGroup.hp ? (
                      <span
                        className="text-muted-foreground"
                        data-oid="oui:60o"
                      >
                        HP {pokemonFunctionalGroup.hp}
                      </span>
                    ) : null}
                    {pokemonFunctionalGroup.regulationMark ? (
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        data-oid="lntz8j:"
                      >
                        Reg {pokemonFunctionalGroup.regulationMark}
                      </Badge>
                    ) : null}
                  </div>
                  {pokemonFunctionalGroup.attacks?.length ? (
                    <div className="space-y-1" data-oid="qpq725a">
                      {pokemonFunctionalGroup.attacks.map((attack) => (
                        <div
                          key={`${attack.name}-${attack.damage ?? "na"}`}
                          data-oid="9lt:qx-"
                        >
                          <p className="font-medium" data-oid="3hyxuxg">
                            {attack.name}
                          </p>
                          <p
                            className="text-muted-foreground"
                            data-oid="jao245k"
                          >
                            {[attack.cost?.join(", "), attack.damage]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                          {attack.text ? (
                            <p
                              className="text-muted-foreground"
                              data-oid="8gon-01"
                            >
                              {attack.text}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {pokemonFunctionalGroup.rules?.length ? (
                    <p className="text-muted-foreground" data-oid="ybya8m5">
                      {pokemonFunctionalGroup.rules.join(" ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div
                className="max-h-80 space-y-2 overflow-y-auto pr-1"
                data-oid="hgvlabx"
              >
                {(printOptions ?? []).map((print) => {
                  const isSelected = selectedPrintCard?.id === print.id;
                  const finishes = getFinishBadges(print);
                  return (
                    <button
                      type="button"
                      key={print.id}
                      onClick={() => setSelectedPrintCard(print)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-muted/60",
                      )}
                      data-oid="jr34j5-"
                    >
                      {print.imageUrlSmall ? (
                        <Image
                          src={print.imageUrlSmall}
                          alt={print.name}
                          width={40}
                          height={56}
                          className="h-14 w-10 flex-shrink-0 rounded-md object-cover"
                          loading="lazy"
                          data-oid="b_kgv1v"
                        />
                      ) : null}
                      <div className="flex-1" data-oid="lz-r3el">
                        <p className="text-sm font-medium" data-oid="ml8f83v">
                          {print.setName ?? print.setCode ?? print.name}
                        </p>
                        <p
                          className="text-xs text-muted-foreground"
                          data-oid="a4dgm8z"
                        >
                          {formatPrintDetails(print) || "No additional details"}
                        </p>
                        <div
                          className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground"
                          data-oid="yxzvqdp"
                        >
                          {print.regulationMark ? (
                            <span data-oid="an5rv25">
                              Reg {print.regulationMark}
                            </span>
                          ) : null}
                          {print.language ? (
                            <span className="uppercase" data-oid="s7xa20x">
                              {print.language}
                            </span>
                          ) : null}
                        </div>
                        {finishes.length ? (
                          <div
                            className="mt-1 flex flex-wrap gap-1"
                            data-oid="x_pq6a5"
                          >
                            {finishes.map((finish) => (
                              <Badge
                                key={finish}
                                variant="outline"
                                className="text-[10px] capitalize"
                                data-oid=":mwiyxs"
                              >
                                {finish === "firstEdition" ? "1st Ed" : finish}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {isSelected ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px]"
                          data-oid="5broxd5"
                        >
                          Selected
                        </Badge>
                      ) : null}
                    </button>
                  );
                })}
                {!printOptions?.length && (
                  <div
                    className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground"
                    data-oid="74fqk3i"
                  >
                    No alternate printings were returned for this card.
                  </div>
                )}
              </div>
            </>
          )}
          <DialogFooter data-oid="uim_2lk">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsPrintDialogOpen(false)}
              disabled={isSavingPrintSelection}
              data-oid="k8c6sa8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmPrintSelection}
              disabled={isPrintSaveDisabled || Boolean(printError)}
              data-oid="6xmg4q7"
            >
              {isSavingPrintSelection ? "Saving…" : "Use This Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateBinderOpen}
        onOpenChange={handleCreateDialogChange}
        data-oid="55g:v8i"
      >
        <DialogContent className="sm:max-w-md" data-oid="mhe3gg8">
          <DialogHeader data-oid="5yaetxa">
            <DialogTitle data-oid="slpahs_">Create binder</DialogTitle>
            <DialogDescription data-oid="ltzx4u0">
              Give your new binder a name and optional description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4" data-oid="ee7mhnx">
            <div className="space-y-2" data-oid="p2mqx09">
              <Label htmlFor="new-binder-name" data-oid=":-raxt:">
                Binder name
              </Label>
              <Input
                id="new-binder-name"
                value={newBinderName}
                onChange={(event) => setNewBinderName(event.target.value)}
                placeholder="e.g., Trade Binder"
                data-oid="l0os6yy"
              />
            </div>
            <div className="space-y-2" data-oid="bw5p1wi">
              <Label htmlFor="new-binder-description" data-oid="b2-m5qr">
                Description
              </Label>
              <Textarea
                id="new-binder-description"
                value={newBinderDescription}
                onChange={(event) =>
                  setNewBinderDescription(event.target.value)
                }
                placeholder="Optional details"
                rows={3}
                data-oid="z4ia-:f"
              />
            </div>
            <div className="space-y-3" data-oid="qbovcfx">
              <Label data-oid="lvv6t2-">Color accent</Label>
              <div className="grid grid-cols-8 gap-2" data-oid="un2:84d">
                {DEFAULT_BINDER_COLORS.map((color) => {
                  const isSelected =
                    normalizeHex(newBinderColor).toUpperCase() ===
                    color.toUpperCase();
                  return (
                    <button
                      type="button"
                      key={color}
                      onClick={() => setNewBinderColor(color)}
                      className={cn(
                        "h-6 w-6 rounded-full border border-transparent transition focus:outline-none focus:ring-2 focus:ring-offset-2",
                        isSelected
                          ? "ring-2 ring-primary ring-offset-2"
                          : "hover:ring-2 hover:ring-primary/60",
                      )}
                      style={{ backgroundColor: color }}
                      data-oid=":ihefdt"
                    >
                      <span className="sr-only" data-oid="8pmbkt:">
                        {color}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3" data-oid="iztva:v">
                <div
                  className="h-8 w-8 rounded-full border"
                  style={{
                    backgroundColor: normalizeHex(newBinderColor) || "#ffffff",
                  }}
                  data-oid="e-xye88"
                />

                <Input
                  value={newBinderColor}
                  onChange={(event) => setNewBinderColor(event.target.value)}
                  placeholder="#4B5563"
                  data-oid="6zd1loo"
                />
              </div>
              <p className="text-xs text-muted-foreground" data-oid=".z112:j">
                Pick a palette color or enter any 6-digit hex value.
              </p>
            </div>
            {createBinderError && (
              <p className="text-sm text-destructive" data-oid="o1xh:69">
                {createBinderError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between" data-oid="_.pv2e3">
            <Button
              type="button"
              variant="ghost"
              onClick={closeCreateBinderDialog}
              data-oid="2n7h-7h"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateBinder}
              disabled={!newBinderName.trim() || isCreatingBinder}
              data-oid=".evd:2i"
            >
              {isCreatingBinder ? "Creating..." : "Create binder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isEditBinderOpen}
        onOpenChange={(open) => !open && closeEditBinderDialog()}
        data-oid="ymc773f"
      >
        <DialogContent className="sm:max-w-md" data-oid="d5f6e-0">
          <DialogHeader data-oid="m:mbeql">
            <DialogTitle data-oid="pvw7hp5">Edit binder</DialogTitle>
            <DialogDescription data-oid="9kn-lnl">
              Update the name and description of your binder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4" data-oid="c_opvlt">
            <div className="space-y-2" data-oid="uspv9lk">
              <Label htmlFor="edit-binder-name" data-oid="273n-m4">
                Binder name
              </Label>
              <Input
                id="edit-binder-name"
                value={editBinderName}
                onChange={(event) => setEditBinderName(event.target.value)}
                placeholder="e.g., Trade Binder"
                data-oid="s.4o9s9"
              />
            </div>
            <div className="space-y-2" data-oid="92i:94f">
              <Label htmlFor="edit-binder-description" data-oid="kcebysc">
                Description
              </Label>
              <Textarea
                id="edit-binder-description"
                value={editBinderDescription}
                onChange={(event) =>
                  setEditBinderDescription(event.target.value)
                }
                placeholder="Optional details"
                rows={3}
                data-oid="qax0leg"
              />
            </div>
            {editBinderError && (
              <p className="text-sm text-destructive" data-oid="3qglhv.">
                {editBinderError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between" data-oid="je-zova">
            <Button
              type="button"
              variant="ghost"
              onClick={closeEditBinderDialog}
              data-oid="sq9jju6"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveBinderEdit}
              disabled={!editBinderName.trim() || isEditingBinder}
              data-oid="h3iszn4"
            >
              {isEditingBinder ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isEditBinderColorOpen}
        onOpenChange={(open) => !open && closeEditBinderDialog()}
        data-oid="mqslmsx"
      >
        <DialogContent className="sm:max-w-md" data-oid="jerastu">
          <DialogHeader data-oid="p8tyt1n">
            <DialogTitle data-oid="gw.-9mg">Edit binder color</DialogTitle>
            <DialogDescription data-oid="4gtltv8">
              Choose a new color for your binder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4" data-oid="-mp.1gd">
            <div className="space-y-3" data-oid=":aqh.6y">
              <Label data-oid="ap6.voz">Color accent</Label>
              <div className="grid grid-cols-8 gap-2" data-oid="w2.vatl">
                {DEFAULT_BINDER_COLORS.map((color) => {
                  const isSelected =
                    normalizeHex(editBinderColor).toUpperCase() ===
                    color.toUpperCase();
                  return (
                    <button
                      type="button"
                      key={color}
                      onClick={() => setEditBinderColor(color)}
                      className={cn(
                        "h-6 w-6 rounded-full border border-transparent transition focus:outline-none focus:ring-2 focus:ring-offset-2",
                        isSelected
                          ? "ring-2 ring-primary ring-offset-2"
                          : "hover:ring-2 hover:ring-primary/60",
                      )}
                      style={{ backgroundColor: color }}
                      data-oid=":-qxdkk"
                    >
                      <span className="sr-only" data-oid=":d.d0:2">
                        {color}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3" data-oid="9b3pkes">
                <div
                  className="h-8 w-8 rounded-full border"
                  style={{
                    backgroundColor: normalizeHex(editBinderColor) || "#ffffff",
                  }}
                  data-oid="l9tevl6"
                />

                <Input
                  value={editBinderColor}
                  onChange={(event) => setEditBinderColor(event.target.value)}
                  placeholder="#4B5563"
                  data-oid="beiw0fn"
                />
              </div>
              <p className="text-xs text-muted-foreground" data-oid="5q6x0b1">
                Pick a palette color or enter any 6-digit hex value.
              </p>
            </div>
            {editBinderError && (
              <p className="text-sm text-destructive" data-oid="botq15t">
                {editBinderError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between" data-oid="sh7d2ko">
            <Button
              type="button"
              variant="ghost"
              onClick={closeEditBinderDialog}
              data-oid="45iy_c-"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveBinderColor}
              disabled={!editBinderColor.trim() || isEditingBinder}
              data-oid="lgnlw0j"
            >
              {isEditingBinder ? "Saving..." : "Save color"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
