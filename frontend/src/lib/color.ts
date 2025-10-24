export function normalizeHexColor(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (withoutHash.length === 3) {
    const expanded = withoutHash
      .split('')
      .map((char) => char + char)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  if (withoutHash.length === 6) {
    return `#${withoutHash.toUpperCase()}`;
  }
  return undefined;
}

export function hexToRgba(hex: string, alpha: number): string | undefined {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return undefined;
  const raw = normalized.slice(1);
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return undefined;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
