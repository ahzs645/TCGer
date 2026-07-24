const ENERGY_NAMES: Record<string, string> = {
  G: 'grass',
  R: 'fire',
  W: 'water',
  L: 'lightning',
  P: 'psychic',
  F: 'fighting',
  D: 'darkness',
  M: 'metal',
  Y: 'fairy',
  N: 'dragon',
  C: 'colorless',
  T: 'trainer'
};

const RARITY_ALIASES: Record<string, string> = {
  'rainbow rare': 'Secret Rare',
  'rare holo star': 'Star Rare',
  'rare prism star': 'Prism Star Rare',
  'rare secret': 'Secret Rare',
  'rare shining': 'Shining Rare',
  'rare shiny': 'Shiny Rare',
  'rare shiny gx': 'Shiny Rare GX'
};

/**
 * Normalize typography that commonly differs between catalog sources without
 * stripping meaningful letters or changing the display language.
 */
export function normalizePokemonTypography(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\u00d7/g, 'x')
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePokemonName(value?: string): string {
  if (!value) {
    return '';
  }

  return normalizePokemonTypography(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizePokemonEnergy(value?: string): string {
  if (!value) {
    return '';
  }

  const normalized = normalizePokemonTypography(value);
  const code = normalized.replace(/[\[\]{}]/g, '').trim().toUpperCase();
  return ENERGY_NAMES[code] ?? normalized.toLowerCase();
}

export function normalizePokemonEffectText(value?: string): string {
  if (!value) {
    return '';
  }

  let normalized = normalizePokemonTypography(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/pok[eé]mon/g, 'pokemon');

  normalized = normalized.replace(
    /[\[{]([a-z])[\]}]/gi,
    (_, symbol: string) =>
      ` ${ENERGY_NAMES[symbol.toUpperCase()] ?? symbol.toLowerCase()} `
  );
  normalized = normalized.replace(/[.,:;!?()[\]{}]/g, ' ');
  return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Collapse upstream rarity aliases while retaining the more specific modern
 * V/VMAX/VSTAR and Trainer Gallery distinctions.
 */
export function canonicalizePokemonRarity(
  rarity?: string,
  cardName?: string,
  options: { noneMeansPromo?: boolean } = {}
): string | undefined {
  if (!rarity) {
    return undefined;
  }

  const normalized = normalizePokemonTypography(rarity);
  const key = normalized.toLowerCase();
  const name = cardName ?? '';

  if (options.noneMeansPromo && (key === 'none' || key === 'no rarity')) {
    return 'Promo';
  }

  if (key === 'shiny rare v or vmax') {
    return /\bVMAX\b/i.test(name) ? 'Shiny Rare VMAX' : 'Shiny Rare V';
  }

  if (
    key === 'trainer gallery holo rare v' ||
    key === 'trainer gallery holo rare v or vmax'
  ) {
    if (/\bVSTAR\b/i.test(name)) {
      return 'Trainer Gallery Holo Rare VSTAR';
    }
    if (/\bVMAX\b/i.test(name)) {
      return 'Trainer Gallery Holo Rare VMAX';
    }
    return 'Trainer Gallery Holo Rare V';
  }

  return RARITY_ALIASES[key] ?? normalized;
}

