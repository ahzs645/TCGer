export type YugiohDeckZone = 'main' | 'extra' | 'side';

export interface YugiohDeckDomainCard {
  externalId: string;
  name: string;
  quantity: number;
  zone?: YugiohDeckZone;
  isSideboard?: boolean;
  cardData?: Record<string, unknown>;
}

export interface OwnedCardQuantity {
  externalId: string;
  quantity: number;
}

export interface MissingDeckCard {
  externalId: string;
  name: string;
  quantity: number;
  zone: YugiohDeckZone;
}

export interface ClassicalBanlist {
  type: 'classical';
  name: string;
  effectiveDate?: string;
  cards: Record<string, string>;
}

export interface GenesysBanlist {
  type: 'genesys';
  name: string;
  effectiveDate?: string;
  maxPoints: number;
  cards: Record<string, number>;
}

export type YugiohBanlist = ClassicalBanlist | GenesysBanlist;

export interface YugiohBanlistViolation {
  externalId?: string;
  name?: string;
  zone?: YugiohDeckZone;
  message: string;
}

export interface YugiohBanlistResult {
  valid: boolean;
  points?: number;
  violations: YugiohBanlistViolation[];
}

export interface YdkSerializationResult {
  content: string;
  skipped: Array<{ externalId: string; name: string; reason: string }>;
}

const EXTRA_DECK_TYPES = ['fusion', 'synchro', 'xyz', 'link'];

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function attributesFrom(cardData?: Record<string, unknown>): Record<string, unknown> | undefined {
  const attributes = cardData?.attributes;
  return attributes && typeof attributes === 'object' && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>)
    : undefined;
}

export function resolveYugiohBaseId(card: Pick<YugiohDeckDomainCard, 'externalId' | 'cardData'>): string {
  const attributes = attributesFrom(card.cardData);
  return (
    stringValue(card.cardData?.baseId) ??
    stringValue(card.cardData?.baseExternalId) ??
    stringValue(card.cardData?.identityExternalId) ??
    stringValue(attributes?.baseId) ??
    card.externalId
  );
}

export function inferYugiohZone(
  card: Pick<YugiohDeckDomainCard, 'isSideboard' | 'zone' | 'cardData'>
): YugiohDeckZone {
  if (card.zone) {
    return card.zone;
  }
  if (card.isSideboard) {
    return 'side';
  }

  const attributes = attributesFrom(card.cardData);
  const type = (
    stringValue(card.cardData?.cardType) ??
    stringValue(card.cardData?.type) ??
    stringValue(attributes?.cardType) ??
    stringValue(attributes?.type) ??
    ''
  ).toLowerCase();

  return EXTRA_DECK_TYPES.some((extraType) => type.includes(extraType)) ? 'extra' : 'main';
}

export function calculateMissingDeckCards(
  deckCards: YugiohDeckDomainCard[],
  ownedCards: OwnedCardQuantity[]
): MissingDeckCard[] {
  const available = new Map<string, number>();
  for (const owned of ownedCards) {
    const current = available.get(owned.externalId) ?? 0;
    available.set(owned.externalId, current + Math.max(0, owned.quantity));
  }

  const missing = new Map<string, MissingDeckCard>();
  for (const card of deckCards) {
    const externalId = resolveYugiohBaseId(card);
    const zone = inferYugiohZone(card);
    let remainingOwned = available.get(externalId) ?? 0;

    for (let copy = 0; copy < Math.max(0, card.quantity); copy += 1) {
      if (remainingOwned > 0) {
        remainingOwned -= 1;
        continue;
      }

      const key = `${zone}:${externalId}`;
      const current = missing.get(key);
      if (current) {
        current.quantity += 1;
      } else {
        missing.set(key, {
          externalId,
          name: card.name,
          quantity: 1,
          zone
        });
      }
    }

    available.set(externalId, remainingOwned);
  }

  return Array.from(missing.values());
}

function classicalLimit(status: string | undefined): number {
  switch (status?.trim().toLowerCase()) {
    case 'forbidden':
    case 'banned':
      return 0;
    case 'limited':
      return 1;
    case 'semi-limited':
    case 'semilimited':
      return 2;
    default:
      return 3;
  }
}

export function evaluateYugiohBanlist(
  deckCards: YugiohDeckDomainCard[],
  banlist: YugiohBanlist
): YugiohBanlistResult {
  if (banlist.type === 'genesys') {
    let points = 0;
    for (const card of deckCards) {
      points += (banlist.cards[resolveYugiohBaseId(card)] ?? 0) * Math.max(0, card.quantity);
    }
    const violations =
      points > banlist.maxPoints
        ? [
            {
              message: `${banlist.name} points total is ${points}; maximum is ${banlist.maxPoints}`
            }
          ]
        : [];
    return {
      valid: violations.length === 0,
      points,
      violations
    };
  }

  const counts = new Map<string, { count: number; name: string; zones: Set<YugiohDeckZone> }>();
  for (const card of deckCards) {
    const externalId = resolveYugiohBaseId(card);
    const current = counts.get(externalId) ?? {
      count: 0,
      name: card.name,
      zones: new Set<YugiohDeckZone>()
    };
    current.count += Math.max(0, card.quantity);
    current.zones.add(inferYugiohZone(card));
    counts.set(externalId, current);
  }

  const violations: YugiohBanlistViolation[] = [];
  for (const [externalId, usage] of counts) {
    const status = banlist.cards[externalId];
    const limit = classicalLimit(status);
    if (usage.count <= limit) {
      continue;
    }
    for (const zone of usage.zones) {
      violations.push({
        externalId,
        name: usage.name,
        zone,
        message: `${usage.name} has ${usage.count} copies; ${status ?? 'default'} limit is ${limit}`
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

function numericPasscode(card: YugiohDeckDomainCard): string | null {
  const externalId = resolveYugiohBaseId(card).trim();
  return /^\d{8}$/.test(externalId) ? externalId : null;
}

export function serializeYdk(deckCards: YugiohDeckDomainCard[]): YdkSerializationResult {
  const zones: Record<YugiohDeckZone, string[]> = {
    main: [],
    extra: [],
    side: []
  };
  const skipped: YdkSerializationResult['skipped'] = [];

  for (const card of deckCards) {
    const passcode = numericPasscode(card);
    if (!passcode) {
      skipped.push({
        externalId: resolveYugiohBaseId(card),
        name: card.name,
        reason: 'Yu-Gi-Oh YDK exports require an eight-digit card passcode'
      });
      continue;
    }
    const zone = inferYugiohZone(card);
    for (let copy = 0; copy < Math.max(0, card.quantity); copy += 1) {
      zones[zone].push(passcode);
    }
  }

  return {
    content: [
      '#created by TCGer',
      '#main',
      ...zones.main,
      '#extra',
      ...zones.extra,
      '!side',
      ...zones.side
    ].join('\n'),
    skipped
  };
}

export function parseYdk(content: string): YugiohDeckDomainCard[] {
  const cards = new Map<string, YugiohDeckDomainCard>();
  let zone: YugiohDeckZone = 'main';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#created')) {
      continue;
    }
    if (line === '#main') {
      zone = 'main';
      continue;
    }
    if (line === '#extra') {
      zone = 'extra';
      continue;
    }
    if (line === '!side') {
      zone = 'side';
      continue;
    }
    if (line.startsWith('#') || !/^\d{8}$/.test(line)) {
      continue;
    }

    const key = `${zone}:${line}`;
    const current = cards.get(key);
    if (current) {
      current.quantity += 1;
    } else {
      cards.set(key, {
        externalId: line,
        name: line,
        quantity: 1,
        zone
      });
    }
  }

  return Array.from(cards.values());
}
