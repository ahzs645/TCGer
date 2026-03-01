export const CONDITION_ORDER = ['MINT', 'NM', 'LP', 'MP', 'HP', 'DMG'] as const;

export const CONDITION_COPY: Record<(typeof CONDITION_ORDER)[number], { label: string; color: string }> = {
  MINT: { label: 'Mint', color: '#10B981' },
  NM: { label: 'Near Mint', color: '#22D3EE' },
  LP: { label: 'Light Play', color: '#FACC15' },
  MP: { label: 'Moderate Play', color: '#FB923C' },
  HP: { label: 'Heavy Play', color: '#F87171' },
  DMG: { label: 'Damaged', color: '#A855F7' }
};

export function conditionScore(value?: string | null) {
  if (!value) {
    return CONDITION_ORDER.length;
  }
  const normalized = value.trim().toUpperCase();
  const index = CONDITION_ORDER.indexOf(normalized as (typeof CONDITION_ORDER)[number]);
  return index === -1 ? CONDITION_ORDER.length : index;
}

export function conditionRangeLabel(copies: { condition?: string | null }[]) {
  if (!copies.length) {
    return 'No copies';
  }
  const filtered = copies.filter((copy) => copy.condition).map((copy) => copy.condition!);
  if (!filtered.length) {
    return 'Not specified';
  }
  const sorted = [...filtered].sort((a, b) => conditionScore(a) - conditionScore(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) {
    return CONDITION_COPY[first as keyof typeof CONDITION_COPY]?.label ?? first;
  }
  const firstLabel = CONDITION_COPY[first as keyof typeof CONDITION_COPY]?.label ?? first;
  const lastLabel = CONDITION_COPY[last as keyof typeof CONDITION_COPY]?.label ?? last;
  return `${firstLabel} – ${lastLabel}`;
}

export function formatCurrency(value?: number) {
  if (value === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}
